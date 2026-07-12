import { and, desc, eq, sql } from "drizzle-orm";
import { getOrCreateContactForConversation } from "@/lib/contacts";
import { db } from "@/lib/db-config";
import {
  channelConversations,
  channelMessages,
  projectChannels,
} from "@/lib/db-schema";

export const CHANNEL_TYPES = ["project_chat", "widget", "whatsapp"] as const;
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
  text?: string | null;
  messageType?: string;
  payload?: Record<string, unknown>;
};

export const CHANNEL_METADATA_LAST_INBOUND_AT = "lastInboundMessageAt";

export function getChannelTypeForFlowSource(source: string): ChannelType {
  switch (source) {
    case "whatsapp_chat":
      return "whatsapp";
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
        metadata: input.metadata ?? sql`${channelConversations.metadata}`,
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

  const [message] = await db
    .insert(channelMessages)
    .values({
      projectId: input.projectId,
      conversationId: conversation.id,
      direction: input.direction,
      messageType: input.messageType ?? "text",
      text: input.text ?? null,
      payload: input.payload ?? {},
    })
    .returning();

  return { conversation, message };
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
