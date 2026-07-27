import type {
  ConversationalTaskSnapshotV1,
  TaskOutcomeV1,
} from "@/lib/conversation-contracts";
import type { TurnResultV1 } from "@/lib/conversation-turn-contracts";
import type { FieldCandidateV1 } from "@/lib/conversational-task-runtime-contracts";
import type {
  CompiledHybridFlowGraphV1,
  HybridFlowNodeV1,
  HybridFlowTransitionV1,
  HybridGraphTaskReturnTargetV1,
} from "@/lib/hybrid-flow-contracts";

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

type HybridBoundaryNode = Extract<
  HybridFlowNodeV1,
  { kind: "conversational_task" | "knowledge" }
>;
type HybridRuntimeResponseOwner = HybridFlowNodeV1["responseOwner"] | "human";

export type HybridBoundaryExecution<TOutput> = {
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
