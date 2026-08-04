import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { getOrCreateChannelConversation } from "@/lib/channels";
import { db } from "@/lib/db-config";
import {
  channelMessages,
  outboxMessages,
  projectChannels,
  type SelectOutboxMessage,
} from "@/lib/db-schema";
import { getDurableRetryDelayMs } from "@/lib/durable-jobs";
import { resolveTraceId } from "@/lib/execution-trace";
import {
  getRuntimeReplyText,
  normalizeRuntimeReply,
  type RuntimeReply,
} from "@/lib/runtime-replies";
import { sendWhatsAppRuntimeReply } from "@/lib/whatsapp";

export const OUTBOX_TOPICS = ["whatsapp.runtime_reply"] as const;
export const OUTBOX_STATUSES = [
  "queued",
  "processing",
  "delivered",
  "failed",
  "cancelled",
] as const;

export type OutboxTopic = (typeof OUTBOX_TOPICS)[number];

function parseRuntimeReply(value: unknown): RuntimeReply | null {
  return normalizeRuntimeReply(value);
}

function outboxClaimCondition(now: Date) {
  return and(
    lt(outboxMessages.attempts, outboxMessages.maxAttempts),
    or(
      and(
        eq(outboxMessages.status, "queued"),
        lte(outboxMessages.availableAt, now),
      ),
      and(
        eq(outboxMessages.status, "processing"),
        lte(outboxMessages.leaseExpiresAt, now),
      ),
    ),
  );
}

async function claimNextOutboxMessage(input: {
  projectId: number;
  topics?: OutboxTopic[];
  workerId: string;
}) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + 60_000);

  for (let claimAttempt = 0; claimAttempt < 5; claimAttempt += 1) {
    const [candidate] = await db
      .select()
      .from(outboxMessages)
      .where(
        and(
          eq(outboxMessages.projectId, input.projectId),
          input.topics?.length
            ? inArray(outboxMessages.topic, input.topics)
            : undefined,
          outboxClaimCondition(now),
        ),
      )
      .orderBy(asc(outboxMessages.availableAt), asc(outboxMessages.id))
      .limit(1);

    if (!candidate) {
      return null;
    }

    const [claimed] = await db
      .update(outboxMessages)
      .set({
        attempts: sql`${outboxMessages.attempts} + 1`,
        lastError: null,
        leaseExpiresAt,
        leaseOwner: input.workerId,
        status: "processing",
        updatedAt: now,
      })
      .where(
        and(
          eq(outboxMessages.projectId, input.projectId),
          eq(outboxMessages.id, candidate.id),
          outboxClaimCondition(now),
        ),
      )
      .returning();

    if (claimed) {
      return claimed;
    }
  }

  return null;
}

async function completeOutboxMessage(input: {
  messageId: number;
  projectId: number;
  workerId: string;
}) {
  const now = new Date();
  const [delivered] = await db
    .update(outboxMessages)
    .set({
      deliveredAt: now,
      lastError: null,
      leaseExpiresAt: null,
      leaseOwner: null,
      status: "delivered",
      updatedAt: now,
    })
    .where(
      and(
        eq(outboxMessages.projectId, input.projectId),
        eq(outboxMessages.id, input.messageId),
        eq(outboxMessages.status, "processing"),
        eq(outboxMessages.leaseOwner, input.workerId),
      ),
    )
    .returning();

  return delivered ?? null;
}

async function failOutboxMessage(input: {
  errorMessage: string;
  message: SelectOutboxMessage;
  permanent?: boolean;
  projectId: number;
  workerId: string;
}) {
  const now = new Date();
  const exhausted =
    input.permanent === true ||
    input.message.attempts >= input.message.maxAttempts;
  const availableAt = exhausted
    ? input.message.availableAt
    : new Date(
        now.getTime() +
          getDurableRetryDelayMs({
            attempt: input.message.attempts,
            jitterKey: `${input.message.projectId}:${input.message.topic}:${input.message.dedupeKey}`,
          }),
      );
  const [failed] = await db
    .update(outboxMessages)
    .set({
      availableAt,
      lastError: input.errorMessage.slice(0, 4_000),
      leaseExpiresAt: null,
      leaseOwner: null,
      status: exhausted ? "failed" : "queued",
      updatedAt: now,
    })
    .where(
      and(
        eq(outboxMessages.projectId, input.projectId),
        eq(outboxMessages.id, input.message.id),
        eq(outboxMessages.status, "processing"),
        eq(outboxMessages.leaseOwner, input.workerId),
      ),
    )
    .returning();

  return failed ?? null;
}

export async function enqueueWhatsAppRuntimeReplies(input: {
  channelId: number;
  externalConversationId: string;
  phoneNumberId: string;
  projectId: number;
  replies: RuntimeReply[];
  to: string;
  traceId?: string | null;
}) {
  const traceId = resolveTraceId(input.traceId);
  const conversation = await getOrCreateChannelConversation({
    channelType: "whatsapp",
    externalConversationId: input.externalConversationId,
    externalUserId: input.to,
    metadata: { channelId: input.channelId },
    projectId: input.projectId,
  });

  return db.transaction(async (tx) => {
    const queued = [];

    for (const reply of input.replies) {
      const [channelMessage] = await tx
        .insert(channelMessages)
        .values({
          conversationId: conversation.id,
          direction: "outbound",
          messageType: reply.type,
          payload: {
            deliveryStatus: "queued",
            event: "whatsapp.flow_reply_queued",
            phoneNumberId: input.phoneNumberId,
            runtimeReply: reply,
            traceId,
          },
          projectId: input.projectId,
          text: getRuntimeReplyText(reply),
        })
        .returning();
      const [outboxMessage] = await tx
        .insert(outboxMessages)
        .values({
          dedupeKey: `channel-message:${channelMessage.id}`,
          destination: input.to,
          maxAttempts: 5,
          payload: {
            channelId: input.channelId,
            channelMessageId: channelMessage.id,
            runtimeReply: reply,
            to: input.to,
          },
          projectId: input.projectId,
          topic: "whatsapp.runtime_reply",
          traceId,
        })
        .returning();

      queued.push({ channelMessage, outboxMessage });
    }

    return queued;
  });
}

function parseWhatsAppOutboxPayload(payload: Record<string, unknown>) {
  const channelId = payload.channelId;
  const channelMessageId = payload.channelMessageId;
  const reply = parseRuntimeReply(payload.runtimeReply);
  const to = payload.to;

  if (
    typeof channelId !== "number" ||
    !Number.isInteger(channelId) ||
    channelId <= 0 ||
    typeof channelMessageId !== "number" ||
    !Number.isInteger(channelMessageId) ||
    channelMessageId <= 0 ||
    !reply ||
    typeof to !== "string" ||
    !to.trim()
  ) {
    return null;
  }

  return { channelId, channelMessageId, reply, to };
}

async function updateOutboxChannelMessage(input: {
  deliveryError?: string | null;
  deliveryMode?: string;
  deliveryStatus: "failed" | "sent";
  messageId: number;
  messageType?: string;
  projectId: number;
  text?: string;
  traceId: string;
}) {
  const [message] = await db
    .select()
    .from(channelMessages)
    .where(
      and(
        eq(channelMessages.projectId, input.projectId),
        eq(channelMessages.id, input.messageId),
      ),
    )
    .limit(1);

  if (!message) {
    return null;
  }

  const [updated] = await db
    .update(channelMessages)
    .set({
      messageType: input.messageType ?? message.messageType,
      payload: {
        ...message.payload,
        deliveryError: input.deliveryError ?? null,
        deliveryMode: input.deliveryMode ?? "text",
        deliveryStatus: input.deliveryStatus,
        event:
          input.deliveryStatus === "sent"
            ? "whatsapp.flow_reply_sent"
            : "whatsapp.flow_reply_failed",
        traceId: input.traceId,
      },
      text: input.text ?? message.text,
    })
    .where(
      and(
        eq(channelMessages.projectId, input.projectId),
        eq(channelMessages.id, input.messageId),
      ),
    )
    .returning();

  return updated ?? null;
}

export async function processProjectOutboxQueue(input: {
  maxMessages?: number;
  projectId: number;
  workerId: string;
}) {
  const maxMessages = Math.max(
    1,
    Math.min(Math.trunc(input.maxMessages ?? 10), 50),
  );
  let delivered = 0;
  let failed = 0;
  let processed = 0;
  let rescheduled = 0;

  for (let index = 0; index < maxMessages; index += 1) {
    const message = await claimNextOutboxMessage({
      projectId: input.projectId,
      topics: ["whatsapp.runtime_reply"],
      workerId: input.workerId,
    });

    if (!message) {
      break;
    }

    processed += 1;
    const payload = parseWhatsAppOutboxPayload(message.payload);
    const [channel] = payload
      ? await db
          .select()
          .from(projectChannels)
          .where(
            and(
              eq(projectChannels.projectId, input.projectId),
              eq(projectChannels.id, payload.channelId),
              eq(projectChannels.channelType, "whatsapp"),
              eq(projectChannels.status, "active"),
            ),
          )
          .limit(1)
      : [];

    if (!payload || !channel) {
      await failOutboxMessage({
        errorMessage: !payload
          ? "WhatsApp outbox payload is invalid."
          : "WhatsApp channel is unavailable.",
        message,
        permanent: true,
        projectId: input.projectId,
        workerId: input.workerId,
      });
      failed += 1;
      continue;
    }

    try {
      const result = await sendWhatsAppRuntimeReply({
        channel,
        reply: payload.reply,
        to: payload.to,
      });
      await updateOutboxChannelMessage({
        deliveryMode: result.deliveryMode,
        deliveryStatus: "sent",
        messageId: payload.channelMessageId,
        messageType: result.messageType,
        projectId: input.projectId,
        text: result.text,
        traceId: message.traceId,
      });
      await completeOutboxMessage({
        messageId: message.id,
        projectId: input.projectId,
        workerId: input.workerId,
      });
      delivered += 1;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "WhatsApp delivery failed.";
      const failedMessage = await failOutboxMessage({
        errorMessage,
        message,
        projectId: input.projectId,
        workerId: input.workerId,
      });

      if (failedMessage?.status === "failed") {
        await updateOutboxChannelMessage({
          deliveryError: errorMessage,
          deliveryStatus: "failed",
          messageId: payload.channelMessageId,
          projectId: input.projectId,
          traceId: message.traceId,
        });
        failed += 1;
      } else {
        rescheduled += 1;
      }
    }
  }

  return {
    delivered,
    failed,
    idle: processed === 0,
    processed,
    rescheduled,
  };
}
