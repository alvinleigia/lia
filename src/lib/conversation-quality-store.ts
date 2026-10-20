import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  detectConversationQuality,
  type QualityMessage,
} from "@/lib/conversation-quality";
import { db } from "@/lib/db-config";
import {
  channelConversations,
  channelMessages,
  conversationalTaskAuditEvents,
  conversationalTaskRuns,
  conversationalTaskToolRequests,
  conversationDiagnosticFindings,
  conversationExecutionStates,
  conversationInboundEvents,
} from "@/lib/db-schema";

export async function getProjectQualityDashboard(projectId: number) {
  const conversations = await db
    .select()
    .from(channelConversations)
    .where(eq(channelConversations.projectId, projectId))
    .orderBy(
      desc(channelConversations.lastMessageAt),
      desc(channelConversations.id),
    )
    .limit(50);
  const ids = conversations.map((c) => c.id);
  if (!ids.length) return [];
  const [messages, runs, reviews, failed, owners] = await Promise.all([
    // Bound each conversation independently so busy chats do not hide others.
    db.execute<QualityMessage & { conversationId: number }>(sql`
      select m.id, m.conversation_id as "conversationId", m.direction, m.text,
        m.created_at as "createdAt"
      from ${channelConversations} c cross join lateral (
        select id, conversation_id, direction, text, created_at from ${channelMessages}
        where project_id = ${projectId} and conversation_id = c.id
        order by id desc limit 100
      ) m where c.project_id = ${projectId} and c.id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
    `),
    db
      .select({ conversationId: conversationalTaskRuns.conversationId })
      .from(conversationalTaskRuns)
      .where(
        and(
          eq(conversationalTaskRuns.projectId, projectId),
          inArray(conversationalTaskRuns.conversationId, ids),
          eq(conversationalTaskRuns.status, "active"),
        ),
      ),
    db
      .select()
      .from(conversationDiagnosticFindings)
      .where(
        and(
          eq(conversationDiagnosticFindings.projectId, projectId),
          inArray(conversationDiagnosticFindings.conversationId, ids),
        ),
      )
      .orderBy(desc(conversationDiagnosticFindings.createdAt))
      .limit(1000),
    db
      .select({
        conversationId: conversationalTaskRuns.conversationId,
        total: sql<number>`count(*)::int`,
      })
      .from(conversationalTaskToolRequests)
      .innerJoin(
        conversationalTaskRuns,
        and(
          eq(
            conversationalTaskRuns.id,
            conversationalTaskToolRequests.taskRunId,
          ),
          eq(conversationalTaskRuns.projectId, projectId),
        ),
      )
      .where(
        and(
          eq(conversationalTaskToolRequests.projectId, projectId),
          inArray(conversationalTaskRuns.conversationId, ids),
          inArray(conversationalTaskToolRequests.status, [
            "failed",
            "error",
            "timeout",
          ]),
        ),
      )
      .groupBy(conversationalTaskRuns.conversationId),
    db
      .select({
        conversationId: conversationExecutionStates.conversationId,
        owner: conversationExecutionStates.responseOwner,
      })
      .from(conversationExecutionStates)
      .where(
        and(
          eq(conversationExecutionStates.projectId, projectId),
          inArray(conversationExecutionStates.conversationId, ids),
        ),
      ),
  ]);
  return conversations.map((conversation) => {
    const humanReviews = reviews.filter(
      (r) => r.conversationId === conversation.id && r.category !== "ai_review",
    );
    const feedback = humanReviews[0];
    const flags = detectConversationQuality({
      messages: messages
        .filter((m) => m.conversationId === conversation.id)
        .map((m) => ({ ...m, createdAt: new Date(m.createdAt) })),
      activeTask: runs.some((r) => r.conversationId === conversation.id),
      humanOwned: owners.some(
        (r) => r.conversationId === conversation.id && r.owner === "human",
      ),
      failedActions:
        failed.find((r) => r.conversationId === conversation.id)?.total ?? 0,
      lastMessageAt: conversation.lastMessageAt,
    });
    return {
      id: conversation.id,
      channel: conversation.channelType,
      lastMessageAt: conversation.lastMessageAt,
      flags,
      feedback: feedback?.category ?? null,
      reviewed: Boolean(
        feedback &&
          (!conversation.lastMessageAt ||
            feedback.createdAt >= conversation.lastMessageAt) &&
          flags.every((flag) =>
            humanReviews.some(
              (review) =>
                (!review.messageId || review.messageId === flag.messageId) &&
                (!conversation.lastMessageAt ||
                  review.createdAt >= conversation.lastMessageAt),
            ),
          ),
      ),
      sample: conversation.id % 10 === 0,
    };
  });
}

// Allowlisted operational evidence only; never expose arbitrary audit payloads.
const turnEvidenceSchema = z.object({
  source: z.enum(["model", "deterministic"]),
  stage: z.string().regex(/^[a-z_]{1,40}$/),
  model: z
    .string()
    .regex(/^[a-zA-Z0-9./:_-]{1,100}$/)
    .nullable(),
  attempts: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
  totalTokens: z.number().nonnegative().nullable(),
  referenceIds: z
    .array(z.string().regex(/^(?:document|project_approved_answer):\d+$/))
    .max(8),
});

export async function getConversationQualityEvidence(
  projectId: number,
  conversationId: number,
) {
  const [events, timings] = await Promise.all([
    db
      .select({
        id: conversationalTaskAuditEvents.id,
        eventType: conversationalTaskAuditEvents.eventType,
        taskRunId: conversationalTaskAuditEvents.taskRunId,
        summary: conversationalTaskAuditEvents.summary,
        createdAt: conversationalTaskAuditEvents.createdAt,
      })
      .from(conversationalTaskAuditEvents)
      .where(
        and(
          eq(conversationalTaskAuditEvents.projectId, projectId),
          eq(conversationalTaskAuditEvents.conversationId, conversationId),
        ),
      )
      .orderBy(desc(conversationalTaskAuditEvents.id))
      .limit(30),
    db
      .select({
        id: conversationInboundEvents.id,
        status: conversationInboundEvents.status,
        receivedAt: conversationInboundEvents.receivedAt,
        processedAt: conversationInboundEvents.processedAt,
      })
      .from(conversationInboundEvents)
      .where(
        and(
          eq(conversationInboundEvents.projectId, projectId),
          eq(conversationInboundEvents.conversationId, conversationId),
        ),
      )
      .orderBy(desc(conversationInboundEvents.id))
      .limit(30),
  ]);
  return {
    events: events.map(({ summary, ...event }) => ({
      ...event,
      turn: turnEvidenceSchema.safeParse(summary).success
        ? turnEvidenceSchema.parse(summary)
        : null,
      status:
        typeof summary.status === "string" &&
        /^[a-z_]{1,40}$/.test(summary.status)
          ? summary.status
          : null,
      grounding: ["grounded", "no_answer", "not_needed"].includes(
        String(summary.groundingStatus),
      )
        ? String(summary.groundingStatus)
        : null,
    })),
    timings: timings.map((t) => ({
      id: t.id,
      status: t.status,
      durationMs: t.processedAt
        ? Math.max(0, t.processedAt.getTime() - t.receivedAt.getTime())
        : null,
    })),
  };
}
