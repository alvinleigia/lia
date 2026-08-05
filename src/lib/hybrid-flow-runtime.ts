import type {
  ConversationalTaskSnapshotV1,
  TaskOutcomeV1,
  ToolDefinitionV1,
} from "@/lib/conversation-contracts";
import type { TurnResultV1 } from "@/lib/conversation-turn-contracts";
import type { FieldCandidateV1 } from "@/lib/conversational-task-runtime-contracts";
import type {
  CompiledHybridFlowGraphV1,
  HybridFlowNodeV1,
  HybridFlowTransitionV1,
  HybridGraphTaskReturnTargetV1,
} from "@/lib/hybrid-flow-contracts";
import {
  createTaskRuntimeInputRequest,
  type RuntimeInputRequest,
} from "@/lib/runtime-input-request";

const TRANSITION_PRECEDENCE = {
  deterministic: 4,
  task_outcome: 3,
  tool_result: 3,
  semantic: 2,
  default: 1,
} satisfies Record<HybridFlowTransitionV1["kind"], number>;

export type HybridTransitionSignal = {
  kind: HybridFlowTransitionV1["kind"];
  sourceRuleId?: number | null;
  triggerKey?: string | null;
};

export function buildKnowledgeBoundarySignals(
  proposal: TurnResultV1,
): HybridTransitionSignal[] {
  if (proposal.taskRecommendation) {
    return [
      {
        kind: "semantic",
        triggerKey: `task:${proposal.taskRecommendation.taskId}`,
      },
    ];
  }
  if (proposal.safety.decision === "handoff") {
    return [{ kind: "tool_result", triggerKey: "handoff" }];
  }
  if (proposal.grounding.status === "no_answer") {
    return [{ kind: "semantic", triggerKey: "no_answer" }];
  }
  return [{ kind: "semantic", triggerKey: "answered" }];
}

type HybridTaskRuntimeField = {
  fieldKey: string;
  isRequired: boolean;
  state: string;
  validation: Record<string, unknown>;
};

function validationText(
  validation: Record<string, unknown>,
  key: "code" | "message",
) {
  const value = validation[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type TaskRuntimeReconciliationInput = {
  fields: HybridTaskRuntimeField[];
  proposal: TurnResultV1;
  snapshot: ConversationalTaskSnapshotV1;
};

export function getRequiredCompletionOperationDefinition(
  snapshot: ConversationalTaskSnapshotV1,
) {
  const definitions = snapshot.task.definition.tools.flatMap((binding) => {
    if (
      binding.access !== "write" ||
      !binding.allowedStages.includes("operation")
    ) {
      return [];
    }
    const definition = snapshot.toolDefinitions.find(
      (candidate) =>
        candidate.id === binding.tool.id &&
        candidate.version === binding.tool.version &&
        candidate.access === "write" &&
        candidate.execution.adapter === "operation" &&
        candidate.requiredForCompletion,
    );
    return definition ? [definition] : [];
  });

  return definitions.length === 1 ? definitions[0] : null;
}

function canRequestTaskField(proposal: TurnResultV1) {
  return !(
    proposal.turnKind === "cancellation" ||
    proposal.turnKind === "side_question" ||
    proposal.safety.decision !== "allow" ||
    (proposal.turnKind === "ordinary_question" &&
      proposal.grounding.status === "grounded")
  );
}

export function bindRequestedTaskSelection(input: {
  proposal: TurnResultV1;
  requestedFieldKey: string | null;
  selectionValue: string | null;
}): TurnResultV1 {
  if (!input.requestedFieldKey || !input.selectionValue) {
    return input.proposal;
  }

  return {
    ...input.proposal,
    fieldCandidates: [
      {
        confidence: 1,
        fieldKey: input.requestedFieldKey,
        naturalValue: input.selectionValue,
        source: "visitor",
      },
    ],
  };
}

function findUnresolvedTaskField(input: TaskRuntimeReconciliationInput) {
  if (!canRequestTaskField(input.proposal)) {
    return null;
  }
  const runtimeFields = new Map(
    input.fields.map((field) => [field.fieldKey, field]),
  );
  const proposedInvalidField = input.proposal.fieldCandidates
    .map(({ fieldKey }) => runtimeFields.get(fieldKey))
    .find((field) => field?.state === "invalid");
  const runtimeField =
    proposedInvalidField ??
    input.snapshot.task.definition.fields
      .map((field) => runtimeFields.get(field.key))
      .find(
        (field) =>
          field?.isRequired &&
          field.state !== "valid" &&
          field.state !== "confirmed",
      );
  if (!runtimeField) {
    return null;
  }

  const definition = input.snapshot.task.definition.fields.find(
    ({ key }) => key === runtimeField.fieldKey,
  );
  return definition ? { definition, runtimeField } : null;
}

function findRequestedOrUnresolvedTaskField(input: {
  fields: HybridTaskRuntimeField[];
  requestedFieldKey: string | null;
  snapshot: ConversationalTaskSnapshotV1;
}) {
  const runtimeFields = new Map(
    input.fields.map((field) => [field.fieldKey, field]),
  );
  const requestedField = input.requestedFieldKey
    ? runtimeFields.get(input.requestedFieldKey)
    : null;
  const runtimeField =
    requestedField &&
    requestedField.state !== "valid" &&
    requestedField.state !== "confirmed"
      ? requestedField
      : input.snapshot.task.definition.fields
          .map((field) => runtimeFields.get(field.key))
          .find(
            (field) =>
              field?.isRequired &&
              field.state !== "valid" &&
              field.state !== "confirmed",
          );
  if (!runtimeField) {
    return null;
  }

  const definition = input.snapshot.task.definition.fields.find(
    ({ key }) => key === runtimeField.fieldKey,
  );
  return definition ? { definition, runtimeField } : null;
}

export function getTaskRuntimeInputRequest(
  input: TaskRuntimeReconciliationInput,
): RuntimeInputRequest | null {
  if (input.proposal.nextAction !== "ask") {
    return null;
  }
  const unresolved = findUnresolvedTaskField(input);
  return unresolved
    ? createTaskRuntimeInputRequest(unresolved.definition)
    : null;
}

export function getResumedTaskRuntimeInputRequest(input: {
  fields: HybridTaskRuntimeField[];
  requestedFieldKey: string | null;
  snapshot: ConversationalTaskSnapshotV1;
}): RuntimeInputRequest | null {
  const unresolved = findRequestedOrUnresolvedTaskField(input);
  return unresolved
    ? createTaskRuntimeInputRequest(unresolved.definition)
    : null;
}

export function reconcileTaskSideQuestionWithRuntime(input: {
  fields: HybridTaskRuntimeField[];
  proposal: TurnResultV1;
  requestedFieldKey: string | null;
  snapshot: ConversationalTaskSnapshotV1;
}): TurnResultV1 {
  const unresolved = findRequestedOrUnresolvedTaskField(input);
  const resumePrompt = unresolved
    ? (unresolved.definition.prompt ??
      `Please provide ${unresolved.definition.label}.`)
    : null;

  return {
    ...input.proposal,
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: unresolved
      ? `The server answered a side question and resumed field ${unresolved.definition.key}.`
      : "The server answered a side question and returned control to the task.",
    fieldCandidates: [],
    nextAction: "ask",
    outcomeRecommendation: null,
    reply: resumePrompt
      ? `${input.proposal.reply}\n\n${resumePrompt}`
      : input.proposal.reply,
    routeRecommendation: null,
    taskRecommendation: null,
    toolRequest: null,
    turnKind: "side_question",
  };
}

export function reconcileTaskTurnWithRuntime(
  input: TaskRuntimeReconciliationInput,
): TurnResultV1 {
  const unresolved = findUnresolvedTaskField(input);
  if (!unresolved) {
    const requiredOperation = getRequiredCompletionOperationDefinition(
      input.snapshot,
    );
    if (
      requiredOperation &&
      (input.proposal.turnKind === "field_answer" ||
        input.proposal.turnKind === "field_correction") &&
      input.proposal.safety.decision === "allow"
    ) {
      return {
        ...input.proposal,
        ambiguity: { question: null, requiresClarification: false },
        decisionSummary: `The server prepared confirmation for required operation ${requiredOperation.id}.`,
        fieldCandidates: [],
        grounding: { excerptIds: [], status: "not_needed" },
        nextAction: "confirm",
        outcomeRecommendation: null,
        reply: "Please review the current details before submitting.",
        routeRecommendation: null,
        safety: { decision: "allow", reasonCode: null },
        taskRecommendation: null,
        toolRequest: null,
      };
    }
    return input.proposal;
  }
  const { definition, runtimeField: unresolvedField } = unresolved;

  const validationCode = validationText(unresolvedField.validation, "code");
  const validationMessage = validationText(
    unresolvedField.validation,
    "message",
  );
  const reply =
    unresolvedField.state === "invalid" &&
    validationCode !== "project_resource_not_found" &&
    validationMessage
      ? validationMessage
      : (definition.prompt ?? `Please provide ${definition.label}.`);

  return {
    ...input.proposal,
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: `The server requested unresolved field ${definition.key}.`,
    fieldCandidates: [],
    grounding: { excerptIds: [], status: "not_needed" },
    nextAction: "ask",
    outcomeRecommendation: null,
    reply,
    routeRecommendation: null,
    safety: { decision: "allow", reasonCode: null },
    taskRecommendation: null,
    toolRequest: null,
    turnKind:
      unresolvedField.state === "invalid" ? "field_correction" : "field_answer",
  };
}

export function reconcileTaskTurnWithAvailability(input: {
  availability: boolean | null;
  proposal: TurnResultV1;
}): TurnResultV1 {
  if (input.availability === true) {
    return input.proposal;
  }

  return {
    ...input.proposal,
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary:
      input.availability === false
        ? "The server blocked confirmation because the selected service is unavailable."
        : "The server blocked confirmation because availability could not be verified.",
    fieldCandidates: [],
    grounding: { excerptIds: [], status: "not_needed" },
    nextAction: "ask",
    outcomeRecommendation: null,
    reply:
      input.availability === false
        ? "That service is not available for the requested date and time. Please choose another date or time."
        : "I could not verify availability for that date and time, so I cannot place the appointment. Please choose another date or time or ask the team for help.",
    routeRecommendation: null,
    safety: { decision: "allow", reasonCode: null },
    taskRecommendation: null,
    toolRequest: null,
    turnKind: "field_correction",
  };
}

export function shouldCheckTaskAvailability(input: {
  definition: ToolDefinitionV1;
  fields: HybridTaskRuntimeField[];
  proposal: TurnResultV1;
}) {
  const taskFieldKeys = new Set(input.fields.map(({ fieldKey }) => fieldKey));
  const availabilityFieldKeys = new Set(
    input.definition.inputSchema.fields.flatMap((field) =>
      field.source.kind === "field" && taskFieldKeys.has(field.source.key)
        ? [field.source.key]
        : [],
    ),
  );
  const availabilityInputsResolved = input.fields
    .filter(({ fieldKey }) => availabilityFieldKeys.has(fieldKey))
    .every((field) => field.state === "valid" || field.state === "confirmed");
  const requiredFieldsResolved = input.fields.every(
    (field) =>
      !field.isRequired ||
      field.state === "valid" ||
      field.state === "confirmed",
  );
  const availabilityInputChanged = input.proposal.fieldCandidates.some(
    ({ fieldKey }) => availabilityFieldKeys.has(fieldKey),
  );
  return (
    availabilityInputsResolved &&
    (availabilityInputChanged ||
      input.proposal.nextAction === "confirm" ||
      input.proposal.nextAction === "complete" ||
      (requiredFieldsResolved && input.proposal.fieldCandidates.length > 0))
  );
}

type HybridBoundaryNode = Extract<
  HybridFlowNodeV1,
  { kind: "conversational_task" | "knowledge" }
>;
export type HybridRuntimeResponseOwner =
  | HybridFlowNodeV1["responseOwner"]
  | "human";

export function resolveHybridRuntimeResponseOwner(input: {
  executionStatus?: string | null;
  fallback: HybridRuntimeResponseOwner;
  responseOwner?: string | null;
}): HybridRuntimeResponseOwner {
  if (input.executionStatus !== "active") {
    return input.fallback;
  }

  return input.responseOwner === "deterministic" ||
    input.responseOwner === "human" ||
    input.responseOwner === "knowledge" ||
    input.responseOwner === "task"
    ? input.responseOwner
    : input.fallback;
}

export type HybridBoundaryExecution<TOutput> = {
  inputRequest?: RuntimeInputRequest | null;
  output: TOutput;
  signals: HybridTransitionSignal[];
};

export type HybridBoundaryDispatchResult<TOutput> = {
  execution: HybridBoundaryExecution<TOutput> | null;
  responseOwner: HybridRuntimeResponseOwner | null;
  sourceNode: HybridBoundaryNode | null;
  status: "ended" | "invalid" | "stayed" | "suppressed" | "transitioned";
  targetNode: HybridFlowNodeV1 | null;
  transition: HybridFlowTransitionV1 | null;
};

export function resolveHybridDeterministicContinuation<TOutput>(
  dispatch: HybridBoundaryDispatchResult<TOutput>,
) {
  if (dispatch.status === "ended") {
    return { kind: "complete" as const };
  }
  if (
    dispatch.status === "transitioned" &&
    dispatch.targetNode &&
    dispatch.targetNode.kind !== "conversational_task"
  ) {
    return {
      kind: "resume" as const,
      targetStepId: dispatch.targetNode.sourceStepId,
    };
  }
  return null;
}

export type HybridTaskEntryProposal = Pick<
  TurnResultV1,
  "fieldCandidates" | "taskRecommendation"
>;

export type PreparedHybridTaskEntry = {
  activeNodeId: string;
  fieldCandidates: FieldCandidateV1[];
  initializationContext: Record<string, unknown>;
  returnTarget: HybridGraphTaskReturnTargetV1;
  taskId: number;
  taskVersionId: number;
};

export type HybridTaskOutcomeResume = {
  actionVersionId: number | null;
  nodeId: string | null;
  responseOwner: HybridRuntimeResponseOwner;
  status: "active" | "closed";
};

export function selectHybridFlowEntryNode(input: {
  campaignKey?: string | null;
  channelType?: string | null;
  deepLinkKey?: string | null;
  graph: CompiledHybridFlowGraphV1;
}) {
  if (input.deepLinkKey) {
    const nodeId = input.graph.entryPolicy.deepLinkRoutes[input.deepLinkKey];
    if (nodeId) {
      return nodeId;
    }
  }
  if (input.campaignKey) {
    const nodeId = input.graph.entryPolicy.campaignRoutes[input.campaignKey];
    if (nodeId) {
      return nodeId;
    }
  }
  if (input.channelType) {
    const nodeId = input.graph.entryPolicy.channelRoutes[input.channelType];
    if (nodeId) {
      return nodeId;
    }
  }
  return input.graph.entryPolicy.normalNodeId;
}

export function resolveHybridBoundaryNode(input: {
  actionVersionId: number;
  activeActionVersionId?: number | null;
  activeNodeId?: string | null;
  graph: CompiledHybridFlowGraphV1;
  requestedNodeId: string;
}): HybridBoundaryNode | null {
  const findBoundaryNode = (nodeId: string | null | undefined) =>
    input.graph.nodes.find(
      (node): node is HybridBoundaryNode =>
        node.id === nodeId &&
        (node.kind === "knowledge" || node.kind === "conversational_task"),
    ) ?? null;

  if (input.activeActionVersionId == null) {
    return findBoundaryNode(input.requestedNodeId);
  }
  if (input.activeActionVersionId !== input.actionVersionId) {
    return null;
  }
  return findBoundaryNode(input.activeNodeId);
}

function signalMatchesTransition(
  transition: HybridFlowTransitionV1,
  signal: HybridTransitionSignal,
) {
  if (transition.kind !== signal.kind) {
    return false;
  }
  if (
    signal.sourceRuleId !== undefined &&
    transition.sourceRuleId !== signal.sourceRuleId
  ) {
    return false;
  }
  return (
    signal.triggerKey === undefined ||
    transition.triggerKey === signal.triggerKey
  );
}

export function selectHybridFlowTransition(input: {
  graph: CompiledHybridFlowGraphV1;
  signals: HybridTransitionSignal[];
  sourceNodeId: string;
}) {
  const matching = input.graph.transitions.filter(
    (transition) =>
      transition.sourceNodeId === input.sourceNodeId &&
      input.signals.some((signal) =>
        signalMatchesTransition(transition, signal),
      ),
  );

  return (
    matching.sort(
      (left, right) =>
        TRANSITION_PRECEDENCE[right.kind] - TRANSITION_PRECEDENCE[left.kind] ||
        right.priority - left.priority ||
        left.id.localeCompare(right.id),
    )[0] ?? null
  );
}

export async function dispatchHybridFlowBoundary<TOutput>(input: {
  execute: (
    node: HybridBoundaryNode,
  ) => Promise<HybridBoundaryExecution<TOutput>>;
  graph: CompiledHybridFlowGraphV1;
  responseOwner: HybridRuntimeResponseOwner;
  sourceNodeId: string;
}): Promise<HybridBoundaryDispatchResult<TOutput>> {
  const node = input.graph.nodes.find(
    (candidate) => candidate.id === input.sourceNodeId,
  );
  const sourceNode =
    node?.kind === "knowledge" || node?.kind === "conversational_task"
      ? node
      : null;

  if (!sourceNode) {
    return {
      execution: null,
      responseOwner: null,
      sourceNode: null,
      status: "invalid",
      targetNode: null,
      transition: null,
    };
  }

  if (input.responseOwner === "human") {
    return {
      execution: null,
      responseOwner: "human",
      sourceNode,
      status: "suppressed",
      targetNode: sourceNode,
      transition: null,
    };
  }

  if (input.responseOwner !== sourceNode.responseOwner) {
    return {
      execution: null,
      responseOwner: null,
      sourceNode,
      status: "invalid",
      targetNode: null,
      transition: null,
    };
  }

  const execution = await input.execute(sourceNode);
  const transition = selectHybridFlowTransition({
    graph: input.graph,
    signals: execution.signals,
    sourceNodeId: sourceNode.id,
  });

  if (!transition) {
    return {
      execution,
      responseOwner: sourceNode.responseOwner,
      sourceNode,
      status: "stayed",
      targetNode: sourceNode,
      transition: null,
    };
  }

  if (!transition.targetNodeId) {
    return {
      execution,
      responseOwner: null,
      sourceNode,
      status: "ended",
      targetNode: null,
      transition,
    };
  }

  const targetNode =
    input.graph.nodes.find(
      (candidate) => candidate.id === transition.targetNodeId,
    ) ?? null;

  if (!targetNode) {
    return {
      execution,
      responseOwner: null,
      sourceNode,
      status: "invalid",
      targetNode: null,
      transition,
    };
  }

  return {
    execution,
    responseOwner: targetNode.responseOwner,
    sourceNode,
    status: "transitioned",
    targetNode,
    transition,
  };
}

export function prepareHybridTaskEntry(input: {
  actionVersionId: number;
  contextValues: Record<string, unknown>;
  dispatch: HybridBoundaryDispatchResult<HybridTaskEntryProposal>;
  graph: CompiledHybridFlowGraphV1;
  taskSnapshot: ConversationalTaskSnapshotV1;
  taskSnapshotVersionId: number;
}): PreparedHybridTaskEntry | null {
  const { dispatch } = input;
  if (
    dispatch.status !== "transitioned" ||
    dispatch.sourceNode?.kind !== "knowledge" ||
    dispatch.targetNode?.kind !== "conversational_task" ||
    dispatch.transition?.kind !== "semantic" ||
    !dispatch.execution?.output.taskRecommendation
  ) {
    return null;
  }

  const taskNode = dispatch.targetNode;
  const taskReference = taskNode.settings.task;
  const recommendation = dispatch.execution.output.taskRecommendation;
  if (
    recommendation.taskId !== taskReference.taskId ||
    dispatch.transition.triggerKey !== `task:${taskReference.taskId}` ||
    !dispatch.sourceNode.settings.recommendationTargetStepIds.includes(
      taskNode.sourceStepId,
    ) ||
    input.taskSnapshotVersionId !== taskReference.taskVersionId ||
    input.taskSnapshot.task.id !== taskReference.taskId
  ) {
    return null;
  }

  const returnTarget = buildHybridGraphTaskReturnTarget({
    actionVersionId: input.actionVersionId,
    graph: input.graph,
    taskNodeId: taskNode.id,
  });
  if (!returnTarget) {
    return null;
  }

  const taskFields = new Map(
    input.taskSnapshot.task.definition.fields.map((field) => [
      field.key,
      field,
    ]),
  );
  const transferRules = new Map(
    input.taskSnapshot.task.definition.fieldTransferWhitelist.map((rule) => [
      rule.fieldKey,
      rule,
    ]),
  );
  const graphFieldKeys = new Set(taskNode.settings.transferFieldKeys);
  const acceptedFieldKeys = new Set<string>();
  const fieldCandidates = dispatch.execution.output.fieldCandidates.flatMap(
    (candidate): FieldCandidateV1[] => {
      const field = taskFields.get(candidate.fieldKey);
      const rule = transferRules.get(candidate.fieldKey);
      if (
        acceptedFieldKeys.has(candidate.fieldKey) ||
        !graphFieldKeys.has(candidate.fieldKey) ||
        !field ||
        !rule ||
        rule.minimumValidationState !== "candidate" ||
        !rule.allowedSources.includes("visitor") ||
        !field.sourcePriority.includes("visitor") ||
        (field.sensitivity === "sensitive" && !rule.allowSensitive)
      ) {
        return [];
      }
      acceptedFieldKeys.add(candidate.fieldKey);
      return [
        {
          fieldKey: candidate.fieldKey,
          naturalValue: candidate.naturalValue,
          provenance: {
            source: "visitor",
            sourceReference: null,
          },
          state: "candidate",
          validation: {
            code: null,
            message: null,
            valid: false,
          },
        },
      ];
    },
  );

  const graphContextKeys = new Set(taskNode.settings.transferContextKeys);
  const initializationContext = Object.fromEntries(
    input.taskSnapshot.task.definition.contextVariables.flatMap((variable) =>
      graphContextKeys.has(variable.key) &&
      Object.hasOwn(input.contextValues, variable.key) &&
      input.contextValues[variable.key] !== undefined
        ? [[variable.key, input.contextValues[variable.key]]]
        : [],
    ),
  );

  return {
    activeNodeId: taskNode.id,
    fieldCandidates,
    initializationContext,
    returnTarget,
    taskId: taskReference.taskId,
    taskVersionId: taskReference.taskVersionId,
  };
}

export function buildHybridGraphTaskReturnTarget(input: {
  actionVersionId: number;
  graph: CompiledHybridFlowGraphV1;
  taskNodeId: string;
}): HybridGraphTaskReturnTargetV1 | null {
  const taskNode = input.graph.nodes.find(
    (node) =>
      node.id === input.taskNodeId && node.kind === "conversational_task",
  );
  if (!taskNode) {
    return null;
  }

  const outcomeRoutes = Object.fromEntries(
    input.graph.transitions
      .filter(
        (transition) =>
          transition.sourceNodeId === taskNode.id &&
          transition.kind === "task_outcome" &&
          transition.triggerKey,
      )
      .map((transition) => {
        const targetNode = transition.targetNodeId
          ? input.graph.nodes.find(
              (candidate) => candidate.id === transition.targetNodeId,
            )
          : null;
        return [
          transition.triggerKey as string,
          {
            nodeId: transition.targetNodeId,
            responseOwner: targetNode?.responseOwner ?? "knowledge",
          },
        ];
      }),
  );

  return {
    actionVersionId: input.actionVersionId,
    kind: "hybrid_graph_task",
    outcomeRoutes,
    schemaVersion: 1,
    taskNodeId: taskNode.id,
  };
}

export function matchesHybridGraphTaskReturnTarget(
  expected: HybridGraphTaskReturnTargetV1,
  actual: HybridGraphTaskReturnTargetV1,
) {
  if (
    expected.schemaVersion !== actual.schemaVersion ||
    expected.kind !== actual.kind ||
    expected.actionVersionId !== actual.actionVersionId ||
    expected.taskNodeId !== actual.taskNodeId
  ) {
    return false;
  }

  const expectedRoutes = Object.entries(expected.outcomeRoutes);
  if (expectedRoutes.length !== Object.keys(actual.outcomeRoutes).length) {
    return false;
  }

  return expectedRoutes.every(([key, route]) => {
    const actualRoute = actual.outcomeRoutes[key];
    return (
      actualRoute?.nodeId === route.nodeId &&
      actualRoute.responseOwner === route.responseOwner
    );
  });
}

export function resolveTaskOutputPort(input: {
  eventType: "cancelled" | "completed" | "failed" | "handoff";
  outcomeKey: string | null;
  outcomes: TaskOutcomeV1[];
}) {
  const explicit = input.outcomeKey
    ? input.outcomes.find(
        (outcome) =>
          outcome.key === input.outcomeKey ||
          outcome.outputPort === input.outcomeKey,
      )
    : null;
  return (
    explicit?.outputPort ??
    input.outcomes.find((outcome) => outcome.type === input.eventType)
      ?.outputPort ??
    null
  );
}

export function resolveHybridTaskOutcomeRoute(input: {
  eventType: "cancelled" | "completed" | "failed" | "handoff";
  outcomeKey: string | null;
  outcomes: TaskOutcomeV1[];
  returnTarget: HybridGraphTaskReturnTargetV1 | null;
}) {
  const outputPort = resolveTaskOutputPort(input);
  return outputPort && input.returnTarget
    ? (input.returnTarget.outcomeRoutes[outputPort] ?? null)
    : null;
}

export function resolveHybridTaskOutcomeResume(input: {
  eventType: "cancelled" | "completed" | "failed" | "handoff";
  outcomeKey: string | null;
  outcomes: TaskOutcomeV1[];
  returnTarget: HybridGraphTaskReturnTargetV1 | null;
}): HybridTaskOutcomeResume | null {
  const route = resolveHybridTaskOutcomeRoute(input);
  if (!route) {
    return null;
  }

  return {
    actionVersionId: route.nodeId
      ? (input.returnTarget?.actionVersionId ?? null)
      : null,
    nodeId: route.nodeId,
    responseOwner: route.responseOwner,
    status: route.nodeId ? "active" : "closed",
  };
}
