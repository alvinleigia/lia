import { and, desc, eq } from "drizzle-orm";
import { type ChannelType, getChannelConversation } from "@/lib/channels";
import { conversationalTaskSnapshotV1Schema } from "@/lib/conversation-contracts";
import {
  type ConversationalTaskRuntimeResult,
  getConversationalTaskRuntime,
} from "@/lib/conversational-task-runtime";
import { db } from "@/lib/db-config";
import {
  conversationalTaskAuditEvents,
  conversationalTaskRuns,
  conversationalTaskVersions,
  conversationExecutionStates,
} from "@/lib/db-schema";

export function getTaskRuntimeTestConversationId(userId: number) {
  return `task-runtime-test:user-${userId}`;
}

export async function getConversationTaskRuntimeSession(input: {
  channelType: ChannelType;
  externalConversationId: string;
  projectId: number;
}) {
  const conversation = await getChannelConversation(input);
  if (!conversation) {
    return {
      conversation: null,
      execution: null,
      runtime: null,
      safeAudit: [],
      snapshot: null,
      version: null,
    };
  }

  const [execution, latestRun, safeAudit] = await Promise.all([
    db
      .select()
      .from(conversationExecutionStates)
      .where(
        and(
          eq(conversationExecutionStates.projectId, input.projectId),
          eq(conversationExecutionStates.conversationId, conversation.id),
        ),
      )
      .limit(1)
      .then(([row]) => row ?? null),
    db
      .select({ id: conversationalTaskRuns.id })
      .from(conversationalTaskRuns)
      .where(
        and(
          eq(conversationalTaskRuns.projectId, input.projectId),
          eq(conversationalTaskRuns.conversationId, conversation.id),
        ),
      )
      .orderBy(desc(conversationalTaskRuns.id))
      .limit(1)
      .then(([row]) => row ?? null),
    db
      .select({
        createdAt: conversationalTaskAuditEvents.createdAt,
        eventType: conversationalTaskAuditEvents.eventType,
        id: conversationalTaskAuditEvents.id,
      })
      .from(conversationalTaskAuditEvents)
      .where(
        and(
          eq(conversationalTaskAuditEvents.projectId, input.projectId),
          eq(conversationalTaskAuditEvents.conversationId, conversation.id),
        ),
      )
      .orderBy(desc(conversationalTaskAuditEvents.id))
      .limit(50),
  ]);
  const taskRunId = execution?.activeTaskRunId ?? latestRun?.id ?? null;
  if (!taskRunId) {
    return {
      conversation,
      execution,
      runtime: null,
      safeAudit,
      snapshot: null,
      version: null,
    };
  }

  const runtime = await getConversationalTaskRuntime({
    projectId: input.projectId,
    taskRunId,
  });
  if (!runtime) {
    return {
      conversation,
      execution,
      runtime: null,
      safeAudit,
      snapshot: null,
      version: null,
    };
  }

  const [version] = await db
    .select()
    .from(conversationalTaskVersions)
    .where(
      and(
        eq(conversationalTaskVersions.projectId, input.projectId),
        eq(conversationalTaskVersions.id, runtime.run.taskVersionId),
      ),
    )
    .limit(1);
  const snapshot = version
    ? conversationalTaskSnapshotV1Schema.parse(version.snapshot)
    : null;

  return {
    conversation,
    execution: runtime.execution,
    runtime,
    safeAudit,
    snapshot,
    version: version ?? null,
  };
}

export type ConversationTaskRuntimeSession = Awaited<
  ReturnType<typeof getConversationTaskRuntimeSession>
>;

const runtimeReasonMessages: Record<string, string> = {
  required_tools_incomplete:
    "Complete the required operation before finishing this task.",
};

export function runtimeResultMessage(result: ConversationalTaskRuntimeResult) {
  if (result.disposition === "applied" && !result.reason) {
    return null;
  }
  if (result.reason === "duplicate_event") {
    return null;
  }
  return result.reason
    ? (runtimeReasonMessages[result.reason] ?? result.reason)
    : "The runtime event could not be applied.";
}
