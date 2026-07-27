import { and, eq } from "drizzle-orm";
import { conversationalTaskSnapshotV1Schema } from "@/lib/conversation-contracts";
import {
  applyConversationalTaskEvent,
  type ConversationalTaskRuntimeResult,
  startConversationalTaskRun,
} from "@/lib/conversational-task-runtime";
import type { StartConversationalTaskRunV1 } from "@/lib/conversational-task-runtime-contracts";
import { db } from "@/lib/db-config";
import { conversationalTaskVersions } from "@/lib/db-schema";
import type { CompiledHybridFlowGraphV1 } from "@/lib/hybrid-flow-contracts";
import {
  type HybridBoundaryDispatchResult,
  type HybridTaskEntryProposal,
  type PreparedHybridTaskEntry,
  prepareHybridTaskEntry,
} from "@/lib/hybrid-flow-runtime";

type HybridTaskStartEnvelope = Omit<
  StartConversationalTaskRunV1,
  | "activeNodeId"
  | "initializationContext"
  | "returnTarget"
  | "taskId"
  | "taskVersionId"
>;

export type HybridTaskEntryRuntimeResult = {
  entry: PreparedHybridTaskEntry | null;
  fieldTransfer: ConversationalTaskRuntimeResult | null;
  start: ConversationalTaskRuntimeResult | null;
};

export async function startHybridTaskEntry(input: {
  actionVersionId: number;
  candidateEventId: string;
  contextValues: Record<string, unknown>;
  dispatch: HybridBoundaryDispatchResult<HybridTaskEntryProposal>;
  graph: CompiledHybridFlowGraphV1;
  start: HybridTaskStartEnvelope;
}): Promise<HybridTaskEntryRuntimeResult> {
  const targetNode =
    input.dispatch.status === "transitioned" &&
    input.dispatch.targetNode?.kind === "conversational_task"
      ? input.dispatch.targetNode
      : null;
  if (!targetNode) {
    return { entry: null, fieldTransfer: null, start: null };
  }

  const taskReference = targetNode.settings.task;
  const [version] = await db
    .select({
      id: conversationalTaskVersions.id,
      snapshot: conversationalTaskVersions.snapshot,
    })
    .from(conversationalTaskVersions)
    .where(
      and(
        eq(conversationalTaskVersions.projectId, input.start.projectId),
        eq(conversationalTaskVersions.taskId, taskReference.taskId),
        eq(conversationalTaskVersions.id, taskReference.taskVersionId),
      ),
    )
    .limit(1);
  if (!version) {
    return { entry: null, fieldTransfer: null, start: null };
  }

  const entry = prepareHybridTaskEntry({
    actionVersionId: input.actionVersionId,
    contextValues: input.contextValues,
    dispatch: input.dispatch,
    graph: input.graph,
    taskSnapshot: conversationalTaskSnapshotV1Schema.parse(version.snapshot),
    taskSnapshotVersionId: version.id,
  });
  if (!entry) {
    return { entry: null, fieldTransfer: null, start: null };
  }

  const start = await startConversationalTaskRun({
    ...input.start,
    activeNodeId: entry.activeNodeId,
    initializationContext: entry.initializationContext,
    returnTarget: entry.returnTarget,
    taskId: entry.taskId,
    taskVersionId: entry.taskVersionId,
  });
  if (
    entry.fieldCandidates.length === 0 ||
    !start.taskRunId ||
    start.revision === null
  ) {
    return { entry, fieldTransfer: null, start };
  }

  const fieldTransfer = await applyConversationalTaskEvent({
    authentication: null,
    candidates: entry.fieldCandidates,
    channelIdentity: input.start.channelIdentity,
    channelType: input.start.channelType,
    conversationId: input.start.conversationId,
    correction: false,
    eventId: input.candidateEventId,
    expectedRevision: start.revision,
    occurredAt: input.start.occurredAt,
    projectId: input.start.projectId,
    providerSequence: null,
    receivedAt: input.start.receivedAt,
    schemaVersion: 1,
    taskRunId: start.taskRunId,
    type: "field.candidates",
  });

  return { entry, fieldTransfer, start };
}
