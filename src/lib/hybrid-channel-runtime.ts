import { and, eq, inArray } from "drizzle-orm";
import { getActiveActionSubmissionForConversation } from "@/lib/action-flows";
import type { RuntimeAction } from "@/lib/action-runtime";
import { resumeChannelFlowAtStep } from "@/lib/channel-flow-runtime";
import { type ChannelType, listRecentChannelMessages } from "@/lib/channels";
import {
  type ConversationalTaskSnapshotV1,
  conversationalTaskSnapshotV1Schema,
} from "@/lib/conversation-contracts";
import { getConversationProjectPolicy } from "@/lib/conversation-project-policies";
import type {
  TurnContextValueV1,
  TurnFieldStateV1,
  TurnMessageV1,
  TurnResultV1,
} from "@/lib/conversation-turn-contracts";
import { executeConfiguredStructuredTurn } from "@/lib/conversation-turn-service";
import {
  applyConversationalTaskEvent,
  startConversationalTaskRun,
} from "@/lib/conversational-task-runtime";
import { getConversationTaskRuntimeSession } from "@/lib/conversational-task-runtime-session";
import { db } from "@/lib/db-config";
import {
  companies,
  conversationalTaskVersions,
  projects,
  type SelectActionSubmission,
  workspaces,
} from "@/lib/db-schema";
import type {
  CompiledHybridFlowGraphV1,
  HybridFlowNodeV1,
} from "@/lib/hybrid-flow-contracts";
import {
  buildHybridGraphTaskReturnTarget,
  buildKnowledgeBoundarySignals,
  dispatchHybridFlowBoundary,
  type HybridBoundaryExecution,
  type HybridRuntimeResponseOwner,
  resolveHybridBoundaryNode,
} from "@/lib/hybrid-flow-runtime";
import { startHybridTaskEntry } from "@/lib/hybrid-task-entry";
import { normalizeProjectAiSettings } from "@/lib/project-ai-settings";
import { getRuntimeProjectActionForSubmission } from "@/lib/runtime-actions";
import { createTextReply, type RuntimeReply } from "@/lib/runtime-replies";

type ProjectTurnContext = {
  companyName: string;
  projectAiSettings: unknown;
  projectName: string;
};

export type HybridChannelBoundaryResult = {
  replies: RuntimeReply[];
};

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

function toHistory(
  messages: Awaited<ReturnType<typeof listRecentChannelMessages>>,
): TurnMessageV1[] {
  return messages.flatMap((message) =>
    message.text
      ? [
          {
            content: message.text,
            role: message.direction === "inbound" ? "user" : "assistant",
          } satisfies TurnMessageV1,
        ]
      : [],
  );
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

function getResponseOwner(
  value: string | null | undefined,
  fallback: HybridRuntimeResponseOwner,
): HybridRuntimeResponseOwner {
  return value === "deterministic" ||
    value === "human" ||
    value === "knowledge" ||
    value === "task"
    ? value
    : fallback;
}

async function getProjectTurnContext(
  projectId: number,
): Promise<ProjectTurnContext | null> {
  const [project] = await db
    .select({
      companyName: companies.name,
      projectAiSettings: projects.aiSettings,
      projectName: projects.name,
    })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .innerJoin(companies, eq(companies.id, workspaces.companyId))
    .where(eq(projects.id, projectId))
    .limit(1);

  return project ?? null;
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
  submission: SelectActionSubmission;
  text: string;
};

type HybridChannelFlowBoundaryInput = Omit<
  HybridChannelRuntimeInput,
  "action" | "submission"
> & {
  source: string;
};

async function ensureDirectTaskEntry(input: {
  node: Extract<HybridFlowNodeV1, { kind: "conversational_task" }>;
  runtimeInput: HybridChannelRuntimeInput;
}) {
  const existing = await getConversationTaskRuntimeSession({
    channelType: input.runtimeInput.channelType,
    externalConversationId: input.runtimeInput.externalConversationId,
    projectId: input.runtimeInput.projectId,
  });
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

  await startConversationalTaskRun({
    ...startEnvelope(
      input.runtimeInput,
      input.runtimeInput.channelConversationId,
    ),
    activeNodeId: input.node.id,
    initializationContext: {},
    returnTarget,
    taskId: input.node.settings.task.taskId,
    taskVersionId: input.node.settings.task.taskVersionId,
  });

  return getConversationTaskRuntimeSession({
    channelType: input.runtimeInput.channelType,
    externalConversationId: input.runtimeInput.externalConversationId,
    projectId: input.runtimeInput.projectId,
  });
}

async function executeTaskBoundary(input: {
  history: TurnMessageV1[];
  node: Extract<HybridFlowNodeV1, { kind: "conversational_task" }>;
  project: ProjectTurnContext;
  runtimeInput: HybridChannelRuntimeInput;
}): Promise<HybridBoundaryExecution<TurnResultV1>> {
  const session = await ensureDirectTaskEntry({
    node: input.node,
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

  const execution = await executeConfiguredStructuredTurn({
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
    stage: "extraction",
    visitorMessage: input.runtimeInput.text,
  });
  const proposal = execution.proposal;
  let revision = session.execution.revision;

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

  const outcome =
    proposal.nextAction === "complete" && proposal.outcomeRecommendation
      ? session.snapshot.task.definition.outcomes.find(
          (candidate) =>
            candidate.key === proposal.outcomeRecommendation?.outcomeKey,
        )
      : proposal.nextAction === "cancel"
        ? (session.snapshot.task.definition.outcomes.find(
            (candidate) =>
              candidate.key === proposal.outcomeRecommendation?.outcomeKey,
          ) ??
          session.snapshot.task.definition.outcomes.find(
            (candidate) => candidate.type === "cancelled",
          ))
        : null;
  if (!outcome) {
    return { output: proposal, signals: [] };
  }

  const outcomeResult = await applyConversationalTaskEvent({
    authentication: null,
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
    type: proposal.nextAction === "cancel" ? "task.cancel" : "task.complete",
  });

  return {
    output: proposal,
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
    projectPolicy: await getConversationProjectPolicy(
      input.runtimeInput.projectId,
    ),
    publishedTasks: await listGraphTaskOptions({
      graph: input.graph,
      projectId: input.runtimeInput.projectId,
      sourceNode: input.node,
    }),
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

  const project = await getProjectTurnContext(input.projectId);
  if (!project) {
    return { replies: [] };
  }

  const session = await getConversationTaskRuntimeSession({
    channelType: input.channelType,
    externalConversationId: input.externalConversationId,
    projectId: input.projectId,
  });
  const sourceNode = resolveHybridBoundaryNode({
    actionVersionId: input.action.versionId,
    activeActionVersionId: session.execution?.activeActionVersionId,
    activeNodeId: session.execution?.activeNodeId,
    graph,
    requestedNodeId: input.boundaryNodeId,
  });
  if (!sourceNode) {
    return { replies: [] };
  }
  const history = toHistory(
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
    responseOwner: getResponseOwner(
      session.execution?.responseOwner,
      sourceNode.responseOwner,
    ),
    sourceNodeId: sourceNode.id,
  });
  const proposal = dispatch.execution?.output;
  if (!proposal) {
    return { replies: [] };
  }

  if (
    sourceNode.kind === "knowledge" &&
    dispatch.targetNode?.kind === "conversational_task"
  ) {
    await startHybridTaskEntry({
      actionVersionId: input.action.versionId,
      candidateEventId: `channel-message:${input.inboundMessageId}:task-fields`,
      contextValues: {},
      dispatch,
      graph,
      start: startEnvelope(input, input.channelConversationId),
    });
  }

  const replies = [createTextReply(proposal.reply)];
  if (
    dispatch.status === "ended" ||
    (dispatch.status === "transitioned" &&
      dispatch.targetNode?.kind !== "conversational_task")
  ) {
    const resumed = await resumeChannelFlowAtStep({
      action: input.action,
      contactId: null,
      projectId: input.projectId,
      submission: input.submission,
      targetStepId: dispatch.targetNode?.sourceStepId ?? null,
    });
    replies.push(...resumed.replies);
  }

  return { replies };
}

export async function runHybridChannelFlowBoundary(
  input: HybridChannelFlowBoundaryInput,
): Promise<HybridChannelBoundaryResult> {
  const submission = await getActiveActionSubmissionForConversation({
    conversationId: input.externalConversationId,
    projectId: input.projectId,
    source: input.source,
  });
  if (!submission) {
    return { replies: [] };
  }

  const action = await getRuntimeProjectActionForSubmission(
    input.projectId,
    submission,
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
