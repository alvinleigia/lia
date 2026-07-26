import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { normalizeConversationProjectPolicy } from "@/lib/conversation-contracts";
import { db } from "@/lib/db-config";
import {
  channelMessages,
  conversationalTaskAuditEvents,
  conversationalTaskConfirmations,
  conversationalTaskContextValues,
  conversationalTaskFieldValues,
  conversationalTaskRuns,
  conversationalTaskToolRequests,
  conversationExecutionStates,
  conversationInboundEvents,
  conversationProjectPolicies,
} from "@/lib/db-schema";

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function getConversationalTaskRuntime(input: {
  projectId: number;
  taskRunId: number;
}) {
  const [run] = await db
    .select()
    .from(conversationalTaskRuns)
    .where(
      and(
        eq(conversationalTaskRuns.projectId, input.projectId),
        eq(conversationalTaskRuns.id, input.taskRunId),
      ),
    )
    .limit(1);
  if (!run) return null;

  const [execution, fields, context, tools, confirmations, audit] =
    await Promise.all([
      db
        .select()
        .from(conversationExecutionStates)
        .where(
          and(
            eq(conversationExecutionStates.projectId, input.projectId),
            eq(conversationExecutionStates.conversationId, run.conversationId),
          ),
        )
        .limit(1)
        .then(([row]) => row ?? null),
      db
        .select()
        .from(conversationalTaskFieldValues)
        .where(
          and(
            eq(conversationalTaskFieldValues.projectId, input.projectId),
            eq(conversationalTaskFieldValues.taskRunId, run.id),
          ),
        )
        .orderBy(asc(conversationalTaskFieldValues.id)),
      db
        .select()
        .from(conversationalTaskContextValues)
        .where(
          and(
            eq(conversationalTaskContextValues.projectId, input.projectId),
            eq(conversationalTaskContextValues.taskRunId, run.id),
          ),
        )
        .orderBy(asc(conversationalTaskContextValues.id)),
      db
        .select()
        .from(conversationalTaskToolRequests)
        .where(
          and(
            eq(conversationalTaskToolRequests.projectId, input.projectId),
            eq(conversationalTaskToolRequests.taskRunId, run.id),
          ),
        )
        .orderBy(desc(conversationalTaskToolRequests.requestedAt)),
      db
        .select()
        .from(conversationalTaskConfirmations)
        .where(
          and(
            eq(conversationalTaskConfirmations.projectId, input.projectId),
            eq(conversationalTaskConfirmations.taskRunId, run.id),
          ),
        )
        .orderBy(desc(conversationalTaskConfirmations.createdAt)),
      db
        .select()
        .from(conversationalTaskAuditEvents)
        .where(
          and(
            eq(conversationalTaskAuditEvents.projectId, input.projectId),
            eq(conversationalTaskAuditEvents.taskRunId, run.id),
          ),
        )
        .orderBy(asc(conversationalTaskAuditEvents.createdAt)),
    ]);

  return { audit, confirmations, context, execution, fields, run, tools };
}

export async function exportConversationRuntimeData(input: {
  conversationId: number;
  projectId: number;
}) {
  const runs = await db
    .select()
    .from(conversationalTaskRuns)
    .where(
      and(
        eq(conversationalTaskRuns.projectId, input.projectId),
        eq(conversationalTaskRuns.conversationId, input.conversationId),
      ),
    )
    .orderBy(asc(conversationalTaskRuns.createdAt));
  const runIds = runs.map(({ id }) => id);
  const [execution, fields, context, tools, confirmations, audit, messages] =
    await Promise.all([
      db
        .select()
        .from(conversationExecutionStates)
        .where(
          and(
            eq(conversationExecutionStates.projectId, input.projectId),
            eq(
              conversationExecutionStates.conversationId,
              input.conversationId,
            ),
          ),
        )
        .limit(1)
        .then(([row]) => row ?? null),
      runIds.length
        ? db
            .select()
            .from(conversationalTaskFieldValues)
            .where(
              and(
                eq(conversationalTaskFieldValues.projectId, input.projectId),
                inArray(conversationalTaskFieldValues.taskRunId, runIds),
              ),
            )
        : [],
      runIds.length
        ? db
            .select()
            .from(conversationalTaskContextValues)
            .where(
              and(
                eq(conversationalTaskContextValues.projectId, input.projectId),
                inArray(conversationalTaskContextValues.taskRunId, runIds),
              ),
            )
        : [],
      runIds.length
        ? db
            .select()
            .from(conversationalTaskToolRequests)
            .where(
              and(
                eq(conversationalTaskToolRequests.projectId, input.projectId),
                inArray(conversationalTaskToolRequests.taskRunId, runIds),
              ),
            )
        : [],
      runIds.length
        ? db
            .select()
            .from(conversationalTaskConfirmations)
            .where(
              and(
                eq(conversationalTaskConfirmations.projectId, input.projectId),
                inArray(conversationalTaskConfirmations.taskRunId, runIds),
              ),
            )
        : [],
      db
        .select()
        .from(conversationalTaskAuditEvents)
        .where(
          and(
            eq(conversationalTaskAuditEvents.projectId, input.projectId),
            eq(
              conversationalTaskAuditEvents.conversationId,
              input.conversationId,
            ),
          ),
        ),
      db
        .select()
        .from(channelMessages)
        .where(
          and(
            eq(channelMessages.projectId, input.projectId),
            eq(channelMessages.conversationId, input.conversationId),
          ),
        ),
    ]);

  return {
    audit,
    confirmations,
    context,
    execution,
    fields,
    messages,
    runs,
    tools,
  };
}

export async function deleteConversationRuntimeData(input: {
  conversationId: number;
  includeMessages?: boolean;
  projectId: number;
}) {
  return db.transaction(async (tx) => {
    const runs = await tx
      .select({ id: conversationalTaskRuns.id })
      .from(conversationalTaskRuns)
      .where(
        and(
          eq(conversationalTaskRuns.projectId, input.projectId),
          eq(conversationalTaskRuns.conversationId, input.conversationId),
        ),
      );
    const runIds = runs.map(({ id }) => id);

    await tx
      .delete(conversationalTaskAuditEvents)
      .where(
        and(
          eq(conversationalTaskAuditEvents.projectId, input.projectId),
          eq(
            conversationalTaskAuditEvents.conversationId,
            input.conversationId,
          ),
        ),
      );
    await tx
      .delete(conversationInboundEvents)
      .where(
        and(
          eq(conversationInboundEvents.projectId, input.projectId),
          eq(conversationInboundEvents.conversationId, input.conversationId),
        ),
      );
    if (runIds.length > 0) {
      await tx
        .delete(conversationalTaskToolRequests)
        .where(
          and(
            eq(conversationalTaskToolRequests.projectId, input.projectId),
            inArray(conversationalTaskToolRequests.taskRunId, runIds),
          ),
        );
      await tx
        .delete(conversationalTaskConfirmations)
        .where(
          and(
            eq(conversationalTaskConfirmations.projectId, input.projectId),
            inArray(conversationalTaskConfirmations.taskRunId, runIds),
          ),
        );
      await tx
        .delete(conversationalTaskContextValues)
        .where(
          and(
            eq(conversationalTaskContextValues.projectId, input.projectId),
            inArray(conversationalTaskContextValues.taskRunId, runIds),
          ),
        );
      await tx
        .delete(conversationalTaskFieldValues)
        .where(
          and(
            eq(conversationalTaskFieldValues.projectId, input.projectId),
            inArray(conversationalTaskFieldValues.taskRunId, runIds),
          ),
        );
    }
    await tx
      .delete(conversationExecutionStates)
      .where(
        and(
          eq(conversationExecutionStates.projectId, input.projectId),
          eq(conversationExecutionStates.conversationId, input.conversationId),
        ),
      );
    await tx
      .delete(conversationalTaskRuns)
      .where(
        and(
          eq(conversationalTaskRuns.projectId, input.projectId),
          eq(conversationalTaskRuns.conversationId, input.conversationId),
        ),
      );
    if (input.includeMessages) {
      await tx
        .delete(channelMessages)
        .where(
          and(
            eq(channelMessages.projectId, input.projectId),
            eq(channelMessages.conversationId, input.conversationId),
          ),
        );
    }
    return { deletedRuns: runIds.length };
  });
}

export async function cleanupExpiredConversationRuntime(input: {
  now?: Date;
  projectId: number;
}) {
  const now = input.now ?? new Date();
  const [policyRow] = await db
    .select({ definition: conversationProjectPolicies.definition })
    .from(conversationProjectPolicies)
    .where(eq(conversationProjectPolicies.projectId, input.projectId))
    .limit(1);
  const policy = normalizeConversationProjectPolicy(policyRow?.definition);
  const messageCutoff = addDays(now, -policy.dataHandling.messageRetentionDays);

  return db.transaction(async (tx) => {
    const expiredRuns = await tx
      .select({
        conversationId: conversationalTaskRuns.conversationId,
        id: conversationalTaskRuns.id,
      })
      .from(conversationalTaskRuns)
      .where(
        and(
          eq(conversationalTaskRuns.projectId, input.projectId),
          inArray(conversationalTaskRuns.status, [
            "active",
            "paused",
            "waiting",
            "handoff",
          ]),
          lte(conversationalTaskRuns.expiresAt, now),
        ),
      );
    const expiredRunIds = expiredRuns.map(({ id }) => id);
    if (expiredRunIds.length > 0) {
      await tx
        .update(conversationExecutionStates)
        .set({
          activeNodeId: null,
          activeTaskRunId: null,
          activeTaskVersionId: null,
          executionMode: "knowledge",
          responseOwner: "knowledge",
          revision: sql`${conversationExecutionStates.revision} + 1`,
          suspendedReturnTarget: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(conversationExecutionStates.projectId, input.projectId),
            inArray(conversationExecutionStates.activeTaskRunId, expiredRunIds),
          ),
        );
      await tx
        .update(conversationalTaskRuns)
        .set({
          abandonedAt: now,
          revision: sql`${conversationalTaskRuns.revision} + 1`,
          status: "abandoned",
          updatedAt: now,
        })
        .where(
          and(
            eq(conversationalTaskRuns.projectId, input.projectId),
            inArray(conversationalTaskRuns.id, expiredRunIds),
          ),
        );
      await tx.insert(conversationalTaskAuditEvents).values(
        expiredRuns.map((run) => ({
          conversationId: run.conversationId,
          eventType: "task.abandoned",
          projectId: input.projectId,
          summary: { reason: "retention_expired" },
          taskRunId: run.id,
        })),
      );
    }

    const expiredFields = await tx
      .delete(conversationalTaskFieldValues)
      .where(
        and(
          eq(conversationalTaskFieldValues.projectId, input.projectId),
          lte(conversationalTaskFieldValues.expiresAt, now),
        ),
      )
      .returning({ id: conversationalTaskFieldValues.id });
    const expiredContext = await tx
      .delete(conversationalTaskContextValues)
      .where(
        and(
          eq(conversationalTaskContextValues.projectId, input.projectId),
          lte(conversationalTaskContextValues.expiresAt, now),
        ),
      )
      .returning({ id: conversationalTaskContextValues.id });
    const expiredMessages = await tx
      .delete(channelMessages)
      .where(
        and(
          eq(channelMessages.projectId, input.projectId),
          lte(channelMessages.createdAt, messageCutoff),
        ),
      )
      .returning({ id: channelMessages.id });
    const timedOutTools = await tx
      .update(conversationalTaskToolRequests)
      .set({
        completedAt: now,
        errorCode: "timeout",
        status: "timeout",
        updatedAt: now,
      })
      .where(
        and(
          eq(conversationalTaskToolRequests.projectId, input.projectId),
          eq(conversationalTaskToolRequests.status, "pending"),
          lte(conversationalTaskToolRequests.timeoutAt, now),
        ),
      )
      .returning({ id: conversationalTaskToolRequests.id });
    const expiredSessions = await tx
      .update(conversationExecutionStates)
      .set({
        status: "session_expired",
        updatedAt: now,
      })
      .where(
        and(
          eq(conversationExecutionStates.projectId, input.projectId),
          lte(conversationExecutionStates.sessionExpiresAt, now),
          or(
            isNull(conversationExecutionStates.status),
            eq(conversationExecutionStates.status, "active"),
          ),
        ),
      )
      .returning({ id: conversationExecutionStates.id });

    return {
      abandonedRuns: expiredRunIds.length,
      expiredContext: expiredContext.length,
      expiredFields: expiredFields.length,
      expiredMessages: expiredMessages.length,
      expiredSessions: expiredSessions.length,
      timedOutTools: timedOutTools.length,
    };
  });
}
