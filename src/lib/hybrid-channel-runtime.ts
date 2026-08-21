import { and, eq, inArray, sql } from "drizzle-orm";
import { getActiveActionSubmissionForConversation } from "@/lib/action-flows";
import type { RuntimeAction } from "@/lib/action-runtime";
import {
  cancelChannelFlowAfterHybridEnd,
  completeChannelFlowAfterHybridEnd,
  requestHumanHandoff,
  resumeChannelFlowAtStep,
} from "@/lib/channel-flow-runtime";
import type { ChannelInboundSelectionV1 } from "@/lib/channel-inbound-contract";
import { type ChannelType, listRecentChannelMessages } from "@/lib/channels";
import {
  getProjectTurnContext,
  type ProjectTurnContext,
  toTurnHistory,
} from "@/lib/conversation-channel-context";
import {
  type ConversationalTaskSnapshotV1,
  conversationalTaskSnapshotV1Schema,
} from "@/lib/conversation-contracts";
import {
  isExplicitCancellationRequest,
  isExplicitConfirmationRequest,
} from "@/lib/conversation-control-intents";
import { getConversationProjectPolicy } from "@/lib/conversation-project-policies";
import type {
  TurnContextValueV1,
  TurnFieldStateV1,
  TurnMessageV1,
  TurnResultV1,
} from "@/lib/conversation-turn-contracts";
import { executeConfiguredStructuredTurn } from "@/lib/conversation-turn-service";
import {
  getBoundAvailabilityDefinition,
  readCanonicalAvailability,
} from "@/lib/conversational-task-availability";
import {
  confirmTaskOperation,
  executeConfirmedTaskOperation,
  listTaskOperationConfirmations,
  prepareTaskOperationConfirmation,
  processAndReconcileTaskOperation,
  type TaskOperationPrincipal,
} from "@/lib/conversational-task-operations";
import {
  listProjectTaskResourceOptions,
  resolveProjectTaskResource,
} from "@/lib/conversational-task-project-resources";
import {
  applyConversationalTaskEvent,
  ConversationalTaskRuntimeConflictError,
  startConversationalTaskRun,
} from "@/lib/conversational-task-runtime";
import { getConversationTaskRuntimeSession } from "@/lib/conversational-task-runtime-session";
import { db } from "@/lib/db-config";
import {
  conversationalTaskVersions,
  conversationExecutionStates,
  type SelectActionSubmission,
} from "@/lib/db-schema";
import type {
  CompiledHybridFlowGraphV1,
  HybridFlowNodeV1,
} from "@/lib/hybrid-flow-contracts";
import {
  bindRequestedTaskSelection,
  bindRequestedTaskTextAnswer,
  buildHybridGraphTaskReturnTarget,
  buildKnowledgeBoundarySignals,
  classifyRequestedTaskAnswer,
  createMismatchedTaskSelectionProposal,
  createRequestedTaskSelectionProposal,
  dispatchHybridFlowBoundary,
  getRequiredCompletionOperationDefinition,
  getResumedTaskRuntimeInputRequest,
  getTaskRuntimeInputRequest,
  type HybridBoundaryExecution,
  normalizeActiveTaskQuestion,
  reconcileTaskSideQuestionWithRuntime,
  reconcileTaskTurnWithAvailability,
  reconcileTaskTurnWithRuntime,
  resolveHybridBoundaryNode,
  resolveHybridDeterministicContinuation,
  resolveHybridRuntimeResponseOwner,
  shouldCheckTaskAvailability,
} from "@/lib/hybrid-flow-runtime";
import { startHybridTaskEntry } from "@/lib/hybrid-task-entry";
import { normalizeProjectAiSettings } from "@/lib/project-ai-settings";
import { getRuntimeProjectActionForSubmission } from "@/lib/runtime-actions";
import type { RuntimeInputRequest } from "@/lib/runtime-input-request";
import {
  createTaskRuntimeReply,
  type RuntimeReply,
} from "@/lib/runtime-replies";
import {
  measureRuntimeStage,
  type RuntimeTimingRecorder,
} from "@/lib/runtime-stage-timing";

export type HybridChannelBoundaryResult = {
  replies: RuntimeReply[];
};

export async function buildHybridChannelResumeReplies(input: {
  channelType: ChannelType;
  externalConversationId: string;
  projectId: number;
}) {
  const session = await getConversationTaskRuntimeSession(input);
  if (
    session.execution?.status !== "active" ||
    !session.execution.activeTaskRunId ||
    !session.runtime ||
    !session.snapshot
  ) {
    return [];
  }

  const inputRequest = await hydrateProjectResourceInputRequest({
    fields: session.runtime.fields,
    inputRequest: getResumedTaskRuntimeInputRequest({
      fields: session.runtime.fields,
      requestedFieldKey: session.runtime.run.lastRequestedFieldKey,
      snapshot: session.snapshot,
    }),
    projectId: input.projectId,
    snapshot: session.snapshot,
  });
  if (!inputRequest) {
    const confirmation = await prepareRequiredTaskConfirmation({
      projectId: input.projectId,
      runtime: session.runtime,
      snapshot: session.snapshot,
    });
    return confirmation
      ? [
          createTaskRuntimeReply({
            nextAction: "confirm",
            text: confirmation.text,
          }),
        ]
      : [];
  }

  const field = session.snapshot.task.definition.fields.find(
    (candidate) => candidate.key === inputRequest.fieldKey,
  );
  return [
    createTaskRuntimeReply({
      inputRequest,
      nextAction: "ask",
      text: field?.prompt ?? `Please provide ${inputRequest.label}.`,
    }),
  ];
}

function formatConfirmationValue(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return String(value);
  }
  return value === null || value === undefined ? "" : JSON.stringify(value);
}

async function buildTaskConfirmationText(input: {
  operationName: string;
  projectId: number;
  runtime: NonNullable<
    Awaited<ReturnType<typeof getConversationTaskRuntimeSession>>["runtime"]
  >;
  snapshot: ConversationalTaskSnapshotV1;
}) {
  const fieldValues = new Map<string, unknown>();
  for (const field of input.runtime.fields) {
    if (field.state !== "valid" && field.state !== "confirmed") continue;
    const value = field.canonicalValue ?? field.naturalValue;
    if (value !== null && value !== undefined) {
      fieldValues.set(field.fieldKey, value);
    }
  }

  const lines: string[] = [];
  for (const definition of input.snapshot.task.definition.fields) {
    if (!fieldValues.has(definition.key)) continue;
    const value = fieldValues.get(definition.key);
    let displayValue = formatConfirmationValue(value);
    if (
      definition.type === "project_resource" ||
      definition.optionSource?.kind === "project_resource"
    ) {
      const options = await listProjectTaskResourceOptions({
        field: definition,
        fieldValues,
        projectId: input.projectId,
      });
      const selected = options.find(
        (option) => option.id === String(value),
      )?.label;
      if (!selected) {
        throw new Error(
          `The selected ${definition.label} is no longer available.`,
        );
      }
      displayValue = selected;
    }
    lines.push(`- ${definition.label}: ${displayValue}`);
  }

  return [
    "Please review these details:",
    ...lines,
    "",
    `Confirm to submit this request through ${input.operationName}, or Cancel to stop.`,
  ].join("\n");
}

async function prepareRequiredTaskConfirmation(input: {
  projectId: number;
  runtime: NonNullable<
    Awaited<ReturnType<typeof getConversationTaskRuntimeSession>>["runtime"]
  >;
  snapshot: ConversationalTaskSnapshotV1;
}) {
  const definition = getRequiredCompletionOperationDefinition(input.snapshot);
  if (!definition) return null;

  await prepareTaskOperationConfirmation({
    projectId: input.projectId,
    taskRunId: input.runtime.run.id,
    toolId: definition.id,
  });
  return {
    text: await buildTaskConfirmationText({
      operationName: definition.name,
      projectId: input.projectId,
      runtime: input.runtime,
      snapshot: input.snapshot,
    }),
  };
}

async function persistReturnedKnowledgeBoundary(input: {
  actionVersionId: number;
  conversationId: number;
  nodeId: string;
  projectId: number;
}) {
  const [execution] = await db
    .select({
      id: conversationExecutionStates.id,
      revision: conversationExecutionStates.revision,
    })
    .from(conversationExecutionStates)
    .where(
      and(
        eq(conversationExecutionStates.projectId, input.projectId),
        eq(conversationExecutionStates.conversationId, input.conversationId),
      ),
    )
    .limit(1);
  if (!execution) {
    return;
  }

  const [updatedExecution] = await db
    .update(conversationExecutionStates)
    .set({
      activeActionVersionId: input.actionVersionId,
      activeNodeId: input.nodeId,
      activeTaskRunId: null,
      activeTaskVersionId: null,
      executionMode: "knowledge",
      responseOwner: "knowledge",
      revision: sql`${conversationExecutionStates.revision} + 1`,
      status: "active",
      suspendedReturnTarget: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(conversationExecutionStates.id, execution.id),
        eq(conversationExecutionStates.projectId, input.projectId),
        eq(conversationExecutionStates.revision, execution.revision),
      ),
    )
    .returning({ id: conversationExecutionStates.id });
  if (!updatedExecution) {
    throw new ConversationalTaskRuntimeConflictError();
  }
}

function toTurnValue(value: unknown) {
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
  ) {
    return value;
  }
  return null;
}

function toRuntimeFieldState(input: {
  runtime: NonNullable<
    Awaited<ReturnType<typeof getConversationTaskRuntimeSession>>["runtime"]
  >;
  snapshot: ConversationalTaskSnapshotV1;
}): TurnFieldStateV1[] {
  const values = new Map(
    input.runtime.fields.map((field) => [field.fieldKey, field]),
  );

  return input.snapshot.task.definition.fields.map((field) => {
    const current = values.get(field.key);
    const value = toTurnValue(
      current?.canonicalValue ?? current?.naturalValue ?? null,
    );
    return {
      fieldKey: field.key,
      label: field.label,
      required: field.required,
      sensitivity: field.sensitivity,
      state:
        current?.state === "candidate" ||
        current?.state === "cleared" ||
        current?.state === "confirmed" ||
        current?.state === "invalid" ||
        current?.state === "missing" ||
        current?.state === "valid"
          ? current.state
          : "missing",
      value,
    };
  });
}

function toRuntimeContext(
  runtime: NonNullable<
    Awaited<ReturnType<typeof getConversationTaskRuntimeSession>>["runtime"]
  >,
): TurnContextValueV1[] {
  return runtime.context.flatMap((value) => {
    const turnValue = toTurnValue(value.value);
    return value.modelVisible &&
      turnValue !== null &&
      (value.sensitivity === "standard" ||
        value.sensitivity === "personal" ||
        value.sensitivity === "sensitive")
      ? [
          {
            key: value.key,
            modelVisible: true,
            sensitivity: value.sensitivity,
            value: turnValue,
          },
        ]
      : [];
  });
}

async function hydrateProjectResourceInputRequest(input: {
  fields: NonNullable<
    Awaited<ReturnType<typeof getConversationTaskRuntimeSession>>["runtime"]
  >["fields"];
  inputRequest: RuntimeInputRequest | null;
  projectId: number;
  snapshot: ConversationalTaskSnapshotV1;
}) {
  if (!input.inputRequest) return null;

  const field = input.snapshot.task.definition.fields.find(
    (candidate) => candidate.key === input.inputRequest?.fieldKey,
  );
  if (
    field?.type !== "project_resource" &&
    field?.optionSource?.kind !== "project_resource"
  ) {
    return input.inputRequest;
  }

  const fieldValues = new Map<string, unknown>();
  for (const runtimeField of input.fields) {
    if (runtimeField.state !== "valid" && runtimeField.state !== "confirmed") {
      continue;
    }
    const value = runtimeField.canonicalValue ?? runtimeField.naturalValue;
    if (value !== null && value !== undefined) {
      fieldValues.set(runtimeField.fieldKey, value);
    }
  }
  const options = await listProjectTaskResourceOptions({
    field,
    fieldValues,
    projectId: input.projectId,
  });

  return {
    ...input.inputRequest,
    inputKind: "choice" as const,
    options: options.map((option) => ({
      label: option.label,
      value: option.id,
    })),
  };
}

async function refreshTaskAvailability(input: {
  definition: NonNullable<ReturnType<typeof getBoundAvailabilityDefinition>>;
  runtimeInput: HybridChannelRuntimeInput;
  session: Awaited<ReturnType<typeof getConversationTaskRuntimeSession>>;
}) {
  if (
    !input.session.execution?.activeTaskRunId ||
    !input.session.runtime ||
    !input.session.snapshot
  ) {
    return { availability: undefined, session: input.session };
  }
  const now = new Date().toISOString();
  const requestId = `hybrid-availability:${input.runtimeInput.inboundMessageId}:${input.definition.id}`;
  let result: Awaited<ReturnType<typeof applyConversationalTaskEvent>>;
  try {
    result = await applyConversationalTaskEvent({
      authentication: null,
      channelIdentity: {
        externalConversationId: input.runtimeInput.externalConversationId,
        externalUserId: input.runtimeInput.externalUserId ?? null,
      },
      channelType: input.runtimeInput.channelType,
      conversationId: input.session.runtime.run.conversationId,
      eventId: `${requestId}:requested`,
      expectedRevision: input.session.execution.revision,
      idempotencyKey: requestId,
      input: {},
      occurredAt: now,
      projectId: input.runtimeInput.projectId,
      providerSequence: null,
      receivedAt: now,
      requestId,
      requestMode: "synchronous",
      schemaVersion: 1,
      stage: "lookup",
      taskRunId: input.session.runtime.run.id,
      timeoutAt: null,
      toolId: input.definition.id,
      type: "tool.requested",
    });
  } catch {
    return { availability: null, session: input.session };
  }
  if (result.disposition !== "applied" && result.reason !== "duplicate_event") {
    return { availability: null, session: input.session };
  }

  const session = await getConversationTaskRuntimeSession({
    channelType: input.runtimeInput.channelType,
    externalConversationId: input.runtimeInput.externalConversationId,
    projectId: input.runtimeInput.projectId,
  });
  return {
    availability: session.runtime
      ? readCanonicalAvailability({
          context: session.runtime.context,
          definition: input.definition,
          fields: session.runtime.fields,
        })
      : null,
    session,
  };
}

async function listGraphTaskOptions(input: {
  graph: CompiledHybridFlowGraphV1;
  projectId: number;
  sourceNode: Extract<HybridFlowNodeV1, { kind: "knowledge" }>;
}) {
  const allowedTargets = new Set(
    input.sourceNode.settings.recommendationTargetStepIds,
  );
  const taskNodes = input.graph.nodes.filter(
    (
      node,
    ): node is Extract<HybridFlowNodeV1, { kind: "conversational_task" }> =>
      node.kind === "conversational_task" &&
      allowedTargets.has(node.sourceStepId),
  );
  const versionIds = taskNodes.map((node) => node.settings.task.taskVersionId);
  if (versionIds.length === 0) {
    return [];
  }

  const versions = await db
    .select({
      id: conversationalTaskVersions.id,
      snapshot: conversationalTaskVersions.snapshot,
    })
    .from(conversationalTaskVersions)
    .where(
      and(
        eq(conversationalTaskVersions.projectId, input.projectId),
        inArray(conversationalTaskVersions.id, versionIds),
      ),
    );
  const snapshots = new Map(
    versions.map((version) => [
      version.id,
      conversationalTaskSnapshotV1Schema.parse(version.snapshot),
    ]),
  );

  return taskNodes.flatMap((node) => {
    const snapshot = snapshots.get(node.settings.task.taskVersionId);
    return snapshot
      ? [
          {
            candidateFieldKeys: node.settings.transferFieldKeys,
            id: snapshot.task.id,
            name: snapshot.task.name,
            objective: snapshot.task.objective,
          },
        ]
      : [];
  });
}

function startEnvelope(
  input: HybridChannelRuntimeInput,
  conversationId: number,
) {
  const now = new Date().toISOString();
  return {
    anonymousVisitorId: input.externalUserId ?? input.externalConversationId,
    authenticatedUserId: null,
    channelIdentity: {
      externalConversationId: input.externalConversationId,
      externalUserId: input.externalUserId ?? null,
    },
    channelType: input.channelType,
    conversationId,
    eventId: `channel-message:${input.inboundMessageId}:task-start`,
    identityKind: "anonymous" as const,
    occurredAt: now,
    projectId: input.projectId,
    providerSequence: null,
    receivedAt: now,
    sessionExpiresAt: null,
    sessionId: input.externalConversationId,
    verifiedContactId: null,
  };
}

type HybridChannelRuntimeInput = {
  action: RuntimeAction;
  boundaryNodeId: string;
  channelConversationId: number;
  channelType: ChannelType;
  externalConversationId: string;
  externalUserId?: string | null;
  inboundMessageId: number;
  projectId: number;
  recordTiming?: RuntimeTimingRecorder;
  selection?: ChannelInboundSelectionV1 | null;
  submission: SelectActionSubmission;
  text: string;
  consumeTriggerMessage?: boolean;
};

type HybridChannelFlowBoundaryInput = Omit<
  HybridChannelRuntimeInput,
  "action" | "submission"
> & {
  source: string;
};

function channelTaskPrincipal(
  input: HybridChannelRuntimeInput,
): TaskOperationPrincipal {
  return {
    kind: "session",
    principal: input.externalUserId ?? input.externalConversationId,
  };
}

function operationTurn(input: {
  nextAction: TurnResultV1["nextAction"];
  outcomeKey?: string | null;
  reply: string;
}): TurnResultV1 {
  return {
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: "The server handled the confirmed task operation.",
    fieldCandidates: [],
    grounding: { excerptIds: [], status: "not_needed" },
    nextAction: input.nextAction,
    outcomeRecommendation: input.outcomeKey
      ? { confidence: 1, outcomeKey: input.outcomeKey }
      : null,
    reply: input.reply,
    routeRecommendation: null,
    safety: { decision: "allow", reasonCode: null },
    schemaVersion: 1,
    taskRecommendation: null,
    toolRequest: null,
    turnKind: "field_answer",
  };
}

async function executeTaskConfirmation(input: {
  runtimeInput: HybridChannelRuntimeInput;
  session: Awaited<ReturnType<typeof getConversationTaskRuntimeSession>>;
}): Promise<HybridBoundaryExecution<TurnResultV1> | null> {
  if (
    !input.session.execution ||
    !input.session.runtime ||
    !input.session.snapshot
  ) {
    return null;
  }
  const answer = (
    input.runtimeInput.selection?.value ?? input.runtimeInput.text
  ).trim();
  const confirms = isExplicitConfirmationRequest(answer);
  const cancels = isExplicitCancellationRequest(answer, {
    allowBareNo: true,
  });
  if (!confirms && !cancels) return null;

  const confirmations = await listTaskOperationConfirmations({
    projectId: input.runtimeInput.projectId,
    taskRunId: input.session.runtime.run.id,
  });
  const active = confirmations.find((confirmation) =>
    ["pending", "confirmed", "executing", "outcome_unknown"].includes(
      confirmation.status,
    ),
  );
  if (!active) return null;

  if (cancels && active.status === "pending") {
    const outcome = input.session.snapshot.task.definition.outcomes.find(
      (candidate) => candidate.type === "cancelled",
    );
    const now = new Date().toISOString();
    const cancelled = await applyConversationalTaskEvent({
      authentication: null,
      channelIdentity: {
        externalConversationId: input.runtimeInput.externalConversationId,
        externalUserId: input.runtimeInput.externalUserId ?? null,
      },
      channelType: input.runtimeInput.channelType,
      conversationId: input.session.runtime.run.conversationId,
      eventId: `channel-message:${input.runtimeInput.inboundMessageId}:confirmation-cancel`,
      expectedRevision: input.session.execution.revision,
      occurredAt: now,
      outcomeKey: outcome?.key ?? null,
      projectId: input.runtimeInput.projectId,
      providerSequence: null,
      receivedAt: now,
      schemaVersion: 1,
      taskRunId: input.session.runtime.run.id,
      type: "task.cancel",
    });
    return {
      output: operationTurn({
        nextAction: "cancel",
        outcomeKey: outcome?.key,
        reply: "No problem. I cancelled this request.",
      }),
      signals:
        cancelled.disposition === "applied" && outcome
          ? [{ kind: "task_outcome", triggerKey: outcome.outputPort }]
          : [],
    };
  }

  if (!confirms) return null;

  const principal = channelTaskPrincipal(input.runtimeInput);
  if (active.status === "pending") {
    await confirmTaskOperation({
      confirmationId: active.id,
      principal,
      projectId: input.runtimeInput.projectId,
      taskRunId: input.session.runtime.run.id,
    });
  }
  await executeConfirmedTaskOperation({
    confirmationId: active.id,
    principal,
    projectId: input.runtimeInput.projectId,
    taskRunId: input.session.runtime.run.id,
  });
  const result = await processAndReconcileTaskOperation({
    confirmationId: active.id,
    principal,
    projectId: input.runtimeInput.projectId,
    workerId: `hybrid-channel-${input.runtimeInput.channelType}-${input.runtimeInput.inboundMessageId}`,
  });
  const definition = input.session.snapshot.toolDefinitions.find(
    (candidate) => candidate.id === active.toolId,
  );
  const operationName = definition?.name ?? "The operation";

  if (result.attempt.status === "completed") {
    const outcome = input.session.snapshot.task.definition.outcomes.find(
      (candidate) => candidate.type === "completed",
    );
    return {
      output: operationTurn({
        nextAction: "complete",
        outcomeKey: outcome?.key,
        reply: `${operationName} completed. Your request was submitted successfully.`,
      }),
      signals: outcome
        ? [{ kind: "task_outcome", triggerKey: outcome.outputPort }]
        : [],
    };
  }
  if (result.attempt.status === "failed") {
    const outcome =
      input.session.snapshot.task.definition.outcomes.find(
        (candidate) => candidate.type === "failed",
      ) ??
      input.session.snapshot.task.definition.outcomes.find(
        (candidate) => candidate.type === "handoff",
      );
    return {
      output: operationTurn({
        nextAction: outcome?.type === "handoff" ? "handoff" : "fail",
        outcomeKey: outcome?.key,
        reply: `${operationName} could not be completed. The team needs to review this request.`,
      }),
      signals: outcome
        ? [{ kind: "task_outcome", triggerKey: outcome.outputPort }]
        : [],
    };
  }

  return {
    output: operationTurn({
      nextAction: "lookup",
      reply:
        result.attempt.status === "outcome_unknown"
          ? `${operationName} needs reconciliation before its result can be confirmed.`
          : `${operationName} is being processed.`,
    }),
    signals: [],
  };
}

async function recordTaskFieldRequest(input: {
  conversationId: number;
  inputRequest: RuntimeInputRequest | null;
  revision: number;
  runtimeInput: HybridChannelRuntimeInput;
  taskRunId: number;
}) {
  if (!input.inputRequest) {
    return input.revision;
  }

  const now = new Date().toISOString();
  const result = await applyConversationalTaskEvent({
    authentication: null,
    channelIdentity: {
      externalConversationId: input.runtimeInput.externalConversationId,
      externalUserId: input.runtimeInput.externalUserId ?? null,
    },
    channelType: input.runtimeInput.channelType,
    conversationId: input.conversationId,
    eventId: `channel-message:${input.runtimeInput.inboundMessageId}:field-request`,
    expectedRevision: input.revision,
    fieldKey: input.inputRequest.fieldKey,
    occurredAt: now,
    projectId: input.runtimeInput.projectId,
    providerSequence: null,
    receivedAt: now,
    schemaVersion: 1,
    taskRunId: input.taskRunId,
    type: "field.requested",
  });

  return result.disposition === "applied" && result.revision !== null
    ? result.revision
    : input.revision;
}

async function ensureDirectTaskEntry(input: {
  node: Extract<HybridFlowNodeV1, { kind: "conversational_task" }>;
  project: ProjectTurnContext;
  runtimeInput: HybridChannelRuntimeInput;
}) {
  const existing = await measureRuntimeStage(
    "task_session_lookup",
    input.runtimeInput.recordTiming,
    () =>
      getConversationTaskRuntimeSession({
        channelType: input.runtimeInput.channelType,
        externalConversationId: input.runtimeInput.externalConversationId,
        projectId: input.runtimeInput.projectId,
      }),
  );
  if (existing.execution?.activeTaskRunId) {
    return existing;
  }
  if (!input.runtimeInput.action.versionId) {
    return existing;
  }

  const returnTarget = buildHybridGraphTaskReturnTarget({
    actionVersionId: input.runtimeInput.action.versionId,
    graph: input.runtimeInput.action.hybridGraph as CompiledHybridFlowGraphV1,
    taskNodeId: input.node.id,
  });
  if (!returnTarget) {
    return existing;
  }

  await measureRuntimeStage(
    "task_run_start",
    input.runtimeInput.recordTiming,
    () =>
      startConversationalTaskRun({
        ...startEnvelope(
          input.runtimeInput,
          input.runtimeInput.channelConversationId,
        ),
        activeNodeId: input.node.id,
        initializationContext: {
          lia_timezone: input.project.companyTimeZone,
        },
        returnTarget,
        taskId: input.node.settings.task.taskId,
        taskVersionId: input.node.settings.task.taskVersionId,
      }),
  );

  return measureRuntimeStage(
    "task_session_reload",
    input.runtimeInput.recordTiming,
    () =>
      getConversationTaskRuntimeSession({
        channelType: input.runtimeInput.channelType,
        externalConversationId: input.runtimeInput.externalConversationId,
        projectId: input.runtimeInput.projectId,
      }),
  );
}

async function executeTaskBoundary(input: {
  history: TurnMessageV1[];
  node: Extract<HybridFlowNodeV1, { kind: "conversational_task" }>;
  project: ProjectTurnContext;
  runtimeInput: HybridChannelRuntimeInput;
}): Promise<HybridBoundaryExecution<TurnResultV1>> {
  const session = await ensureDirectTaskEntry({
    node: input.node,
    project: input.project,
    runtimeInput: input.runtimeInput,
  });
  if (
    !session.execution?.activeTaskRunId ||
    !session.runtime ||
    !session.snapshot ||
    session.execution.activeNodeId !== input.node.id
  ) {
    throw new Error("The pinned conversational task runtime is unavailable.");
  }
  const runtime = session.runtime;
  const snapshot = session.snapshot;

  const confirmationExecution = await executeTaskConfirmation({
    runtimeInput: input.runtimeInput,
    session,
  });
  if (confirmationExecution) return confirmationExecution;

  const requestedField = session.snapshot.task.definition.fields.find(
    (field) => field.key === session.runtime?.run.lastRequestedFieldKey,
  );
  const requestedFieldIsProjectResource =
    requestedField?.type === "project_resource" ||
    requestedField?.optionSource?.kind === "project_resource";
  const requestedAnswer =
    input.runtimeInput.selection?.value ?? input.runtimeInput.text;
  const requestedAnswerKind = classifyRequestedTaskAnswer({
    answer: requestedAnswer,
    hasSelection: Boolean(input.runtimeInput.selection),
    requestedFieldIsProjectResource,
  });
  const rejectMismatchedSelection = async () => ({
    inputRequest: await hydrateProjectResourceInputRequest({
      fields: runtime.fields,
      inputRequest: getResumedTaskRuntimeInputRequest({
        fields: runtime.fields,
        requestedFieldKey: runtime.run.lastRequestedFieldKey,
        snapshot,
      }),
      projectId: input.runtimeInput.projectId,
      snapshot,
    }),
    output: createMismatchedTaskSelectionProposal({
      reason: input.runtimeInput.selection
        ? "stale_selection"
        : "unmatched_value",
      requestedFieldPrompt:
        requestedField?.prompt ??
        (requestedField ? `Please provide ${requestedField.label}.` : null),
    }),
    signals: [],
  });
  let selectionValue: string | null = null;
  if (requestedAnswerKind === "project_resource" && requestedField) {
    const fieldValues = new Map<string, unknown>();
    for (const field of session.runtime.fields) {
      if (field.state !== "valid" && field.state !== "confirmed") continue;
      const value = field.canonicalValue ?? field.naturalValue;
      if (value !== null && value !== undefined) {
        fieldValues.set(field.fieldKey, value);
      }
    }
    const resolvedSelection = await resolveProjectTaskResource({
      field: requestedField,
      fieldValues,
      projectId: input.runtimeInput.projectId,
      value: requestedAnswer,
    });
    if (resolvedSelection.status === "resolved") {
      selectionValue = resolvedSelection.id;
    } else {
      return rejectMismatchedSelection();
    }
  } else if (
    requestedAnswerKind === "static_selection" &&
    input.runtimeInput.selection
  ) {
    const selectedOption =
      requestedField?.optionSource?.kind === "static"
        ? requestedField.optionSource.options.find(
            (option) => option.value === input.runtimeInput.selection?.value,
          )
        : null;
    if (!selectedOption) return rejectMismatchedSelection();
    selectionValue = selectedOption.value;
  }
  const selectionProposal = createRequestedTaskSelectionProposal({
    requestedFieldKey: selectionValue ? (requestedField?.key ?? null) : null,
    selectionValue,
  });
  const extractedProposal = selectionProposal
    ? selectionProposal
    : bindRequestedTaskSelection({
        proposal: (
          await executeConfiguredStructuredTurn({
            activeTask: session.snapshot,
            assistantBehavior: normalizeProjectAiSettings(
              session.snapshot.assistantBehavior,
            ),
            assistantIntroduced: input.history.some(
              (message) => message.role === "assistant",
            ),
            channel: input.runtimeInput.channelType,
            companyName: input.project.companyName,
            context: toRuntimeContext(session.runtime),
            fieldState: toRuntimeFieldState({
              runtime: session.runtime,
              snapshot: session.snapshot,
            }),
            history: input.history,
            projectId: input.runtimeInput.projectId,
            projectName: input.project.projectName,
            projectPolicy: session.snapshot.conversationPolicy,
            publishedTasks: [],
            requestedFieldKey: requestedField?.key ?? null,
            stage: "extraction",
            visitorMessage: requestedAnswer,
          })
        ).proposal,
        requestedFieldKey: selectionValue
          ? (requestedField?.key ?? null)
          : null,
        selectionValue,
      });
  const normalizedProposal = normalizeActiveTaskQuestion(extractedProposal);
  const proposal =
    requestedField?.type === "text" && !requestedField.optionSource
      ? bindRequestedTaskTextAnswer({
          proposal: normalizedProposal,
          requestedFieldKey: requestedField.key,
          text: input.runtimeInput.text,
        })
      : normalizedProposal;
  let revision = session.execution.revision;

  if (proposal.turnKind === "side_question") {
    const now = new Date().toISOString();
    const suspended = await applyConversationalTaskEvent({
      authentication: null,
      category: "visitor_question",
      channelIdentity: {
        externalConversationId: input.runtimeInput.externalConversationId,
        externalUserId: input.runtimeInput.externalUserId ?? null,
      },
      channelType: input.runtimeInput.channelType,
      conversationId: session.runtime.run.conversationId,
      eventId: `channel-message:${input.runtimeInput.inboundMessageId}:side-question`,
      expectedRevision: revision,
      occurredAt: now,
      projectId: input.runtimeInput.projectId,
      providerSequence: null,
      receivedAt: now,
      schemaVersion: 1,
      taskRunId: session.runtime.run.id,
      type: "task.side_question",
    });
    if (suspended.disposition !== "applied" || suspended.revision === null) {
      return { output: proposal, signals: [] };
    }

    let knowledgeProposal: TurnResultV1;
    let resumedRevision: number | null = null;
    try {
      const knowledgeExecution = await executeConfiguredStructuredTurn({
        activeTask: session.snapshot,
        assistantBehavior: normalizeProjectAiSettings(
          session.snapshot.assistantBehavior,
        ),
        assistantIntroduced: input.history.some(
          (message) => message.role === "assistant",
        ),
        channel: input.runtimeInput.channelType,
        companyName: input.project.companyName,
        context: toRuntimeContext(session.runtime),
        fieldState: toRuntimeFieldState({
          runtime: session.runtime,
          snapshot: session.snapshot,
        }),
        history: input.history,
        projectId: input.runtimeInput.projectId,
        projectName: input.project.projectName,
        projectPolicy: session.snapshot.conversationPolicy,
        publishedTasks: [],
        stage: "knowledge",
        visitorMessage: input.runtimeInput.text,
      });
      knowledgeProposal = knowledgeExecution.proposal;
    } finally {
      const resolvedAt = new Date().toISOString();
      const resumed = await applyConversationalTaskEvent({
        authentication: null,
        channelIdentity: {
          externalConversationId: input.runtimeInput.externalConversationId,
          externalUserId: input.runtimeInput.externalUserId ?? null,
        },
        channelType: input.runtimeInput.channelType,
        conversationId: session.runtime.run.conversationId,
        eventId: `channel-message:${input.runtimeInput.inboundMessageId}:side-question-resolved`,
        expectedRevision: suspended.revision,
        occurredAt: resolvedAt,
        projectId: input.runtimeInput.projectId,
        providerSequence: null,
        receivedAt: resolvedAt,
        schemaVersion: 1,
        taskRunId: session.runtime.run.id,
        type: "task.side_question_resolved",
      });
      resumedRevision =
        resumed.disposition === "applied" ? resumed.revision : null;
    }
    if (resumedRevision === null) {
      return { output: knowledgeProposal, signals: [] };
    }

    const resumedSession = await getConversationTaskRuntimeSession({
      channelType: input.runtimeInput.channelType,
      externalConversationId: input.runtimeInput.externalConversationId,
      projectId: input.runtimeInput.projectId,
    });
    if (
      !resumedSession.execution ||
      !resumedSession.runtime ||
      !resumedSession.snapshot
    ) {
      return { output: knowledgeProposal, signals: [] };
    }
    const resumedProposal = reconcileTaskSideQuestionWithRuntime({
      fields: resumedSession.runtime.fields,
      proposal: knowledgeProposal,
      requestedFieldKey: resumedSession.runtime.run.lastRequestedFieldKey,
      snapshot: resumedSession.snapshot,
    });
    const inputRequest = await hydrateProjectResourceInputRequest({
      fields: resumedSession.runtime.fields,
      inputRequest: getResumedTaskRuntimeInputRequest({
        fields: resumedSession.runtime.fields,
        requestedFieldKey: resumedSession.runtime.run.lastRequestedFieldKey,
        snapshot: resumedSession.snapshot,
      }),
      projectId: input.runtimeInput.projectId,
      snapshot: resumedSession.snapshot,
    });
    await recordTaskFieldRequest({
      conversationId: resumedSession.runtime.run.conversationId,
      inputRequest,
      revision: resumedSession.execution.revision,
      runtimeInput: input.runtimeInput,
      taskRunId: resumedSession.runtime.run.id,
    });

    return {
      inputRequest,
      output: resumedProposal,
      signals: [],
    };
  }

  if (proposal.fieldCandidates.length > 0) {
    const fieldResult = await applyConversationalTaskEvent({
      authentication: null,
      candidates: proposal.fieldCandidates.map((candidate) => ({
        fieldKey: candidate.fieldKey,
        naturalValue: candidate.naturalValue,
        provenance: { source: "visitor" as const, sourceReference: null },
        state: "candidate" as const,
        validation: { code: null, message: null, valid: false },
      })),
      channelIdentity: {
        externalConversationId: input.runtimeInput.externalConversationId,
        externalUserId: input.runtimeInput.externalUserId ?? null,
      },
      channelType: input.runtimeInput.channelType,
      conversationId: session.runtime.run.conversationId,
      correction: session.runtime.fields.some(
        (field) =>
          proposal.fieldCandidates.some(
            (candidate) => candidate.fieldKey === field.fieldKey,
          ) &&
          field.state !== "missing" &&
          field.state !== "cleared",
      ),
      eventId: `channel-message:${input.runtimeInput.inboundMessageId}:fields`,
      expectedRevision: revision,
      occurredAt: new Date().toISOString(),
      projectId: input.runtimeInput.projectId,
      providerSequence: null,
      receivedAt: new Date().toISOString(),
      schemaVersion: 1,
      taskRunId: session.runtime.run.id,
      type: "field.candidates",
    });
    if (
      fieldResult.disposition !== "applied" ||
      fieldResult.revision === null
    ) {
      return { output: proposal, signals: [] };
    }
    revision = fieldResult.revision;
  }

  let canonicalSession = await getConversationTaskRuntimeSession({
    channelType: input.runtimeInput.channelType,
    externalConversationId: input.runtimeInput.externalConversationId,
    projectId: input.runtimeInput.projectId,
  });
  let reconciledProposal =
    canonicalSession.runtime && canonicalSession.snapshot
      ? reconcileTaskTurnWithRuntime({
          fields: canonicalSession.runtime.fields,
          proposal,
          snapshot: canonicalSession.snapshot,
        })
      : proposal;
  const availabilityDefinition = canonicalSession.snapshot
    ? getBoundAvailabilityDefinition(canonicalSession.snapshot)
    : null;
  if (
    availabilityDefinition &&
    canonicalSession.runtime &&
    shouldCheckTaskAvailability({
      definition: availabilityDefinition,
      fields: canonicalSession.runtime.fields,
      proposal,
    })
  ) {
    const availability = await refreshTaskAvailability({
      definition: availabilityDefinition,
      runtimeInput: input.runtimeInput,
      session: canonicalSession,
    });
    canonicalSession = availability.session;
    revision = canonicalSession.execution?.revision ?? revision;
    if (availability.availability !== undefined) {
      reconciledProposal = reconcileTaskTurnWithAvailability({
        availability: availability.availability,
        proposal: reconciledProposal,
      });
    }
  }

  const outcome =
    reconciledProposal.nextAction === "complete" &&
    reconciledProposal.outcomeRecommendation
      ? session.snapshot.task.definition.outcomes.find(
          (candidate) =>
            candidate.key ===
            reconciledProposal.outcomeRecommendation?.outcomeKey,
        )
      : reconciledProposal.nextAction === "cancel"
        ? (session.snapshot.task.definition.outcomes.find(
            (candidate) =>
              candidate.key ===
              reconciledProposal.outcomeRecommendation?.outcomeKey,
          ) ??
          session.snapshot.task.definition.outcomes.find(
            (candidate) => candidate.type === "cancelled",
          ))
        : reconciledProposal.nextAction === "handoff"
          ? (session.snapshot.task.definition.outcomes.find(
              (candidate) =>
                candidate.key ===
                reconciledProposal.outcomeRecommendation?.outcomeKey,
            ) ??
            session.snapshot.task.definition.outcomes.find(
              (candidate) => candidate.type === "handoff",
            ))
          : null;
  if (!outcome) {
    if (
      reconciledProposal.nextAction === "confirm" &&
      canonicalSession.runtime &&
      canonicalSession.snapshot
    ) {
      const prepared = await prepareRequiredTaskConfirmation({
        projectId: input.runtimeInput.projectId,
        runtime: canonicalSession.runtime,
        snapshot: canonicalSession.snapshot,
      });
      if (prepared) {
        return {
          inputRequest: null,
          output: {
            ...reconciledProposal,
            reply: prepared.text,
          },
          signals: [],
        };
      }
    }
    const baseInputRequest =
      canonicalSession.runtime && canonicalSession.snapshot
        ? getTaskRuntimeInputRequest({
            fields: canonicalSession.runtime.fields,
            proposal: reconciledProposal,
            snapshot: canonicalSession.snapshot,
          })
        : null;
    const inputRequest =
      canonicalSession.runtime && canonicalSession.snapshot
        ? await hydrateProjectResourceInputRequest({
            fields: canonicalSession.runtime.fields,
            inputRequest: baseInputRequest,
            projectId: input.runtimeInput.projectId,
            snapshot: canonicalSession.snapshot,
          })
        : null;
    if (
      canonicalSession.execution &&
      canonicalSession.runtime &&
      canonicalSession.snapshot
    ) {
      await recordTaskFieldRequest({
        conversationId: canonicalSession.runtime.run.conversationId,
        inputRequest,
        revision: canonicalSession.execution.revision,
        runtimeInput: input.runtimeInput,
        taskRunId: canonicalSession.runtime.run.id,
      });
    }
    return {
      inputRequest,
      output: reconciledProposal,
      signals: [],
    };
  }

  const outcomeEvent = {
    channelIdentity: {
      externalConversationId: input.runtimeInput.externalConversationId,
      externalUserId: input.runtimeInput.externalUserId ?? null,
    },
    channelType: input.runtimeInput.channelType,
    conversationId: session.runtime.run.conversationId,
    eventId: `channel-message:${input.runtimeInput.inboundMessageId}:outcome`,
    expectedRevision: revision,
    occurredAt: new Date().toISOString(),
    outcomeKey: outcome.key,
    projectId: input.runtimeInput.projectId,
    providerSequence: null,
    receivedAt: new Date().toISOString(),
    schemaVersion: 1,
    taskRunId: session.runtime.run.id,
  } as const;
  const outcomeResult = await applyConversationalTaskEvent(
    reconciledProposal.nextAction === "handoff"
      ? {
          ...outcomeEvent,
          authentication: {
            ...channelTaskPrincipal(input.runtimeInput),
            keyId: null,
            verifiedAt: new Date().toISOString(),
          },
          reason: "visitor_requested_human_help",
          type: "task.handoff",
        }
      : {
          ...outcomeEvent,
          authentication: null,
          type:
            reconciledProposal.nextAction === "cancel"
              ? "task.cancel"
              : "task.complete",
        },
  );

  return {
    output: reconciledProposal,
    signals:
      outcomeResult.disposition === "applied"
        ? [{ kind: "task_outcome", triggerKey: outcome.outputPort }]
        : [],
  };
}

async function executeKnowledgeBoundary(input: {
  graph: CompiledHybridFlowGraphV1;
  history: TurnMessageV1[];
  node: Extract<HybridFlowNodeV1, { kind: "knowledge" }>;
  project: ProjectTurnContext;
  runtimeInput: HybridChannelRuntimeInput;
}): Promise<HybridBoundaryExecution<TurnResultV1>> {
  const [projectPolicy, publishedTasks] = await Promise.all([
    getConversationProjectPolicy(input.runtimeInput.projectId),
    listGraphTaskOptions({
      graph: input.graph,
      projectId: input.runtimeInput.projectId,
      sourceNode: input.node,
    }),
  ]);
  const execution = await executeConfiguredStructuredTurn({
    activeTask: null,
    assistantBehavior: normalizeProjectAiSettings(
      input.project.projectAiSettings,
    ),
    assistantIntroduced: input.history.some(
      (message) => message.role === "assistant",
    ),
    channel: input.runtimeInput.channelType,
    companyName: input.project.companyName,
    context: [],
    fieldState: [],
    history: input.history,
    projectId: input.runtimeInput.projectId,
    projectName: input.project.projectName,
    projectPolicy,
    publishedTasks,
    stage: "knowledge",
    visitorMessage: input.runtimeInput.text,
  });

  return {
    output: execution.proposal,
    signals: buildKnowledgeBoundarySignals(execution.proposal),
  };
}

export async function runHybridChannelBoundary(
  input: HybridChannelRuntimeInput,
): Promise<HybridChannelBoundaryResult> {
  const graph = input.action.hybridGraph;
  if (!graph || !input.action.versionId || !input.text.trim()) {
    return { replies: [] };
  }

  const [project, session] = await measureRuntimeStage(
    "hybrid_context",
    input.recordTiming,
    () =>
      Promise.all([
        getProjectTurnContext(input.projectId),
        getConversationTaskRuntimeSession({
          channelType: input.channelType,
          externalConversationId: input.externalConversationId,
          projectId: input.projectId,
        }),
      ]),
  );
  if (!project) {
    return { replies: [] };
  }

  let sourceNode = resolveHybridBoundaryNode({
    actionVersionId: input.action.versionId,
    activeActionVersionId: session.execution?.activeActionVersionId,
    activeNodeId: session.execution?.activeNodeId,
    graph,
    requestedNodeId: input.boundaryNodeId,
  });
  if (
    !sourceNode &&
    session.execution?.activeActionVersionId === input.action.versionId &&
    !session.execution.activeTaskRunId
  ) {
    const activeNode = graph.nodes.find(
      (node) => node.id === session.execution?.activeNodeId,
    );
    const requestedNode = graph.nodes.find(
      (node): node is Extract<HybridFlowNodeV1, { kind: "knowledge" }> =>
        node.id === input.boundaryNodeId && node.kind === "knowledge",
    );
    if (activeNode?.kind === "deterministic" && requestedNode) {
      await persistReturnedKnowledgeBoundary({
        actionVersionId: input.action.versionId,
        conversationId: input.channelConversationId,
        nodeId: requestedNode.id,
        projectId: input.projectId,
      });
      sourceNode = requestedNode;
    }
  }
  if (!sourceNode) {
    return { replies: [] };
  }
  if (
    input.consumeTriggerMessage &&
    sourceNode.kind === "conversational_task"
  ) {
    const taskSession = await ensureDirectTaskEntry({
      node: sourceNode,
      project,
      runtimeInput: input,
    });
    if (
      !taskSession.execution?.activeTaskRunId ||
      !taskSession.runtime ||
      !taskSession.snapshot
    ) {
      throw new Error("The pinned conversational task runtime is unavailable.");
    }
    const execution = taskSession.execution;
    const runtime = taskSession.runtime;
    const snapshot = taskSession.snapshot;
    const inputRequest = await measureRuntimeStage(
      "task_input_options",
      input.recordTiming,
      () =>
        hydrateProjectResourceInputRequest({
          fields: runtime.fields,
          inputRequest: getResumedTaskRuntimeInputRequest({
            fields: runtime.fields,
            requestedFieldKey: runtime.run.lastRequestedFieldKey,
            snapshot,
          }),
          projectId: input.projectId,
          snapshot,
        }),
    );
    if (inputRequest) {
      await measureRuntimeStage("task_field_request", input.recordTiming, () =>
        recordTaskFieldRequest({
          conversationId: runtime.run.conversationId,
          inputRequest,
          revision: execution.revision,
          runtimeInput: input,
          taskRunId: runtime.run.id,
        }),
      );
      const field = snapshot.task.definition.fields.find(
        (candidate) => candidate.key === inputRequest.fieldKey,
      );
      return {
        replies: [
          createTaskRuntimeReply({
            inputRequest,
            nextAction: "ask",
            text: field?.prompt ?? `Please provide ${inputRequest.label}.`,
          }),
        ],
      };
    }
  }
  const history = toTurnHistory(
    await listRecentChannelMessages({
      beforeMessageId: input.inboundMessageId,
      conversationId: input.channelConversationId,
      projectId: input.projectId,
    }),
  );
  const dispatch = await dispatchHybridFlowBoundary<TurnResultV1>({
    execute: (node) =>
      node.kind === "knowledge"
        ? executeKnowledgeBoundary({
            graph,
            history,
            node,
            project,
            runtimeInput: input,
          })
        : executeTaskBoundary({
            history,
            node,
            project,
            runtimeInput: input,
          }),
    graph,
    responseOwner: resolveHybridRuntimeResponseOwner({
      executionStatus: session.execution?.status,
      fallback: sourceNode.responseOwner,
      responseOwner: session.execution?.responseOwner,
    }),
    sourceNodeId: sourceNode.id,
  });
  const proposal = dispatch.execution?.output;
  if (!proposal) {
    return { replies: [] };
  }

  let inputRequest = dispatch.execution?.inputRequest ?? null;
  let replyProposal = proposal;
  if (
    sourceNode.kind === "knowledge" &&
    dispatch.targetNode?.kind === "conversational_task"
  ) {
    await startHybridTaskEntry({
      actionVersionId: input.action.versionId,
      candidateEventId: `channel-message:${input.inboundMessageId}:task-fields`,
      contextValues: { lia_timezone: project.companyTimeZone },
      dispatch,
      graph,
      start: startEnvelope(input, input.channelConversationId),
    });
    const taskSession = await getConversationTaskRuntimeSession({
      channelType: input.channelType,
      externalConversationId: input.externalConversationId,
      projectId: input.projectId,
    });
    if (
      taskSession.execution?.activeTaskRunId &&
      taskSession.execution.activeNodeId === dispatch.targetNode.id &&
      taskSession.runtime &&
      taskSession.snapshot
    ) {
      replyProposal = reconcileTaskTurnWithRuntime({
        fields: taskSession.runtime.fields,
        proposal,
        snapshot: taskSession.snapshot,
      });
      inputRequest = await hydrateProjectResourceInputRequest({
        fields: taskSession.runtime.fields,
        inputRequest: getTaskRuntimeInputRequest({
          fields: taskSession.runtime.fields,
          proposal: replyProposal,
          snapshot: taskSession.snapshot,
        }),
        projectId: input.projectId,
        snapshot: taskSession.snapshot,
      });
      await recordTaskFieldRequest({
        conversationId: taskSession.runtime.run.conversationId,
        inputRequest,
        revision: taskSession.execution.revision,
        runtimeInput: input,
        taskRunId: taskSession.runtime.run.id,
      });
    }
  }

  const replies: RuntimeReply[] = [
    createTaskRuntimeReply({
      inputRequest,
      nextAction: replyProposal.nextAction,
      text: replyProposal.reply,
    }),
  ];
  const continuation = resolveHybridDeterministicContinuation(dispatch);
  if (continuation?.kind === "cancel") {
    const cancelled = await cancelChannelFlowAfterHybridEnd({
      projectId: input.projectId,
      submission: input.submission,
    });
    replies.push(...cancelled.replies);
  } else if (
    replyProposal.nextAction === "handoff" &&
    continuation?.kind === "complete"
  ) {
    const handoffStep = input.action.steps.find(
      (step) => step.id === sourceNode.sourceStepId,
    );
    if (!handoffStep) {
      throw new Error("The handoff source step is unavailable.");
    }
    await requestHumanHandoff({
      action: input.action,
      projectId: input.projectId,
      step: handoffStep,
      submission: input.submission,
    });
  } else if (continuation?.kind === "complete") {
    const completed = await completeChannelFlowAfterHybridEnd({
      contactId: null,
      projectId: input.projectId,
      submission: input.submission,
    });
    replies.push(...completed.replies);
  } else if (continuation?.kind === "resume") {
    const resumed = await resumeChannelFlowAtStep({
      action: input.action,
      contactId: null,
      projectId: input.projectId,
      submission: input.submission,
      targetStepId: continuation.targetStepId,
    });
    replies.push(...resumed.replies);
    const returnedBoundary = resumed.boundaryNodeId
      ? graph.nodes.find(
          (node) =>
            node.id === resumed.boundaryNodeId && node.kind === "knowledge",
        )
      : null;
    if (returnedBoundary) {
      await persistReturnedKnowledgeBoundary({
        actionVersionId: input.action.versionId,
        conversationId: input.channelConversationId,
        nodeId: returnedBoundary.id,
        projectId: input.projectId,
      });
    }
  }

  return { replies };
}

export async function runHybridChannelFlowBoundary(
  input: HybridChannelFlowBoundaryInput,
): Promise<HybridChannelBoundaryResult> {
  const submission = await measureRuntimeStage(
    "hybrid_submission",
    input.recordTiming,
    () =>
      getActiveActionSubmissionForConversation({
        conversationId: input.externalConversationId,
        projectId: input.projectId,
        source: input.source,
      }),
  );
  if (!submission) {
    return { replies: [] };
  }

  const action = await measureRuntimeStage(
    "hybrid_action",
    input.recordTiming,
    () => getRuntimeProjectActionForSubmission(input.projectId, submission),
  );
  if (!action) {
    return { replies: [] };
  }

  return runHybridChannelBoundary({
    ...input,
    action,
    submission,
  });
}
