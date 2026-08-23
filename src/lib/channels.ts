import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getOrCreateContactForConversation } from "@/lib/contacts";
import { db } from "@/lib/db-config";
import {
  channelConversations,
  channelMessages,
  projectChannels,
} from "@/lib/db-schema";

export const CHANNEL_TYPES = [
  "project_chat",
  "widget",
  "whatsapp",
  "telnyx_voice",
] as const;
export const CHANNEL_STATUSES = ["active", "disabled"] as const;
export const CHANNEL_CONVERSATION_STATUSES = [
  "active",
  "closed",
  "blocked",
] as const;
export const CHANNEL_MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;

export type ChannelType = (typeof CHANNEL_TYPES)[number];
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];
export type ChannelConversationStatus =
  (typeof CHANNEL_CONVERSATION_STATUSES)[number];
export type ChannelMessageDirection =
  (typeof CHANNEL_MESSAGE_DIRECTIONS)[number];

export type NormalizedChannelInboundMessage = {
  projectId: number;
  channelType: ChannelType;
  externalConversationId: string;
  externalMessageId?: string | null;
  externalUserId?: string | null;
  text?: string | null;
  messageType?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type NormalizedChannelOutboundMessage = {
  projectId: number;
  channelType: ChannelType;
  externalConversationId: string;
  externalMessageId?: string | null;
  text?: string | null;
  messageType?: string;
  payload?: Record<string, unknown>;
};

export const CHANNEL_METADATA_LAST_INBOUND_AT = "lastInboundMessageAt";

export function getChannelTypeForFlowSource(source: string): ChannelType {
  switch (source) {
    case "whatsapp_chat":
      return "whatsapp";
    case "telnyx_voice":
      return "telnyx_voice";
    case "widget_chat":
      return "widget";
    default:
      return "project_chat";
  }
}

export async function listProjectChannels(projectId: number) {
  return db
    .select()
    .from(projectChannels)
    .where(eq(projectChannels.projectId, projectId))
    .orderBy(desc(projectChannels.updatedAt), desc(projectChannels.id));
}

export async function getOrCreateChannelConversation(input: {
  projectId: number;
  channelType: ChannelType;
  externalConversationId: string;
  externalUserId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date();
  const contact = await getOrCreateContactForConversation({
    projectId: input.projectId,
    channelType: input.channelType,
    externalConversationId: input.externalConversationId,
    externalUserId: input.externalUserId,
    metadata: input.metadata,
  });
  const [conversation] = await db
    .insert(channelConversations)
    .values({
      projectId: input.projectId,
      channelType: input.channelType,
      contactId: contact.id,
      externalConversationId: input.externalConversationId,
      externalUserId: input.externalUserId ?? null,
      metadata: input.metadata ?? {},
      lastMessageAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        channelConversations.projectId,
        channelConversations.channelType,
        channelConversations.externalConversationId,
      ],
      set: {
        contactId: sql`coalesce(${channelConversations.contactId}, ${contact.id})`,
        externalUserId:
          input.externalUserId ?? sql`${channelConversations.externalUserId}`,
        lastMessageAt: now,
        metadata: input.metadata
          ? sql`${channelConversations.metadata} || ${JSON.stringify(input.metadata)}::jsonb`
          : sql`${channelConversations.metadata}`,
        updatedAt: now,
      },
    })
    .returning();

  return conversation;
}

export async function recordChannelMessage(input: {
  projectId: number;
  channelType: ChannelType;
  externalConversationId: string;
  externalMessageId?: string | null;
  externalUserId?: string | null;
  direction: ChannelMessageDirection;
  text?: string | null;
  messageType?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  const metadata =
    input.direction === "inbound"
      ? {
          ...(input.metadata ?? {}),
          [CHANNEL_METADATA_LAST_INBOUND_AT]: new Date().toISOString(),
        }
      : input.metadata;
  const conversation = await getOrCreateChannelConversation({
    projectId: input.projectId,
    channelType: input.channelType,
    externalConversationId: input.externalConversationId,
    externalUserId: input.externalUserId,
    metadata,
  });

  const externalMessageId = input.externalMessageId?.trim() || null;
  const [insertedMessage] = await db
    .insert(channelMessages)
    .values({
      projectId: input.projectId,
      conversationId: conversation.id,
      direction: input.direction,
      externalMessageId,
      messageType: input.messageType ?? "text",
      text: input.text ?? null,
      payload: input.payload ?? {},
    })
    .onConflictDoNothing({
      target: [
        channelMessages.projectId,
        channelMessages.conversationId,
        channelMessages.direction,
        channelMessages.externalMessageId,
      ],
    })
    .returning();

  if (insertedMessage) {
    return { conversation, duplicate: false, message: insertedMessage };
  }

  if (!externalMessageId) {
    throw new Error("Channel message could not be recorded.");
  }

  const [existingMessage] = await db
    .select()
    .from(channelMessages)
    .where(
      and(
        eq(channelMessages.projectId, input.projectId),
        eq(channelMessages.conversationId, conversation.id),
        eq(channelMessages.direction, input.direction),
        eq(channelMessages.externalMessageId, externalMessageId),
      ),
    )
    .limit(1);

  if (!existingMessage) {
    throw new Error("Channel message could not be recorded.");
  }

  return { conversation, duplicate: true, message: existingMessage };
}

export function recordChannelInboundMessage(
  input: NormalizedChannelInboundMessage,
) {
  return recordChannelMessage({
    ...input,
    direction: "inbound",
  });
}

export function recordChannelOutboundMessage(
  input: NormalizedChannelOutboundMessage,
) {
  return recordChannelMessage({
    ...input,
    direction: "outbound",
  });
}

export async function getChannelConversation(input: {
  projectId: number;
  channelType: ChannelType;
  externalConversationId: string;
}) {
  const [conversation] = await db
    .select()
    .from(channelConversations)
    .where(
      and(
        eq(channelConversations.projectId, input.projectId),
        eq(channelConversations.channelType, input.channelType),
        eq(
          channelConversations.externalConversationId,
          input.externalConversationId,
        ),
      ),
    )
    .limit(1);

  return conversation ?? null;
}

export async function listRecentChannelMessages(input: {
  beforeMessageId?: number | null;
  conversationId: number;
  limit?: number;
  projectId: number;
}) {
  const rows = await db
    .select({
      direction: channelMessages.direction,
      id: channelMessages.id,
      messageType: channelMessages.messageType,
      payload: channelMessages.payload,
      text: channelMessages.text,
    })
    .from(channelMessages)
    .where(
      and(
        eq(channelMessages.projectId, input.projectId),
        eq(channelMessages.conversationId, input.conversationId),
        input.beforeMessageId
          ? lt(channelMessages.id, input.beforeMessageId)
          : undefined,
      ),
    )
    .orderBy(desc(channelMessages.id))
    .limit(Math.min(Math.max(input.limit ?? 20, 1), 50));

  return rows.reverse();
}

export async function markChannelMessageIgnored(input: {
  messageId: number;
  projectId: number;
  reason: string;
}) {
  await db
    .update(channelMessages)
    .set({
      messageType: "ignored",
      payload: sql`${channelMessages.payload} || ${JSON.stringify({
        processing: { reason: input.reason, status: "ignored" },
      })}::jsonb`,
      text: null,
    })
    .where(
      and(
        eq(channelMessages.id, input.messageId),
        eq(channelMessages.projectId, input.projectId),
      ),
    );
}

export async function markChannelConversationForReview(input: {
  channelType: ChannelType;
  externalConversationId: string;
  handoff: Record<string, unknown>;
  projectId: number;
}) {
  const conversation = await getChannelConversation({
    projectId: input.projectId,
    channelType: input.channelType,
    externalConversationId: input.externalConversationId,
  });

  if (!conversation) {
    return null;
  }

  const [updatedConversation] = await db
    .update(channelConversations)
    .set({
      metadata: {
        ...conversation.metadata,
        handoff: input.handoff,
      },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(channelConversations.projectId, input.projectId),
        eq(channelConversations.id, conversation.id),
      ),
    )
    .returning();

  return updatedConversation ?? null;
}

export async function updateChannelConversationStatus(input: {
  channelType: ChannelType;
  externalConversationId: string;
  projectId: number;
  status: ChannelConversationStatus;
}) {
  const [conversation] = await db
    .update(channelConversations)
    .set({ status: input.status, updatedAt: new Date() })
    .where(
      and(
        eq(channelConversations.projectId, input.projectId),
        eq(channelConversations.channelType, input.channelType),
        eq(
          channelConversations.externalConversationId,
          input.externalConversationId,
        ),
      ),
    )
    .returning();

  return conversation ?? null;
}
