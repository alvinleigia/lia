import {
  type ChannelType,
  getChannelConversation,
  listProjectChannels,
  recordChannelOutboundMessage,
} from "@/lib/channels";
import { enqueueWhatsAppRuntimeReplies } from "@/lib/outbox";
import type { RuntimeReply } from "@/lib/runtime-replies";
import { normalizeWhatsAppConfig } from "@/lib/whatsapp";

export async function deliverDurableFlowReplies(input: {
  channelType: ChannelType;
  conversationId: string;
  externalUserId: string | null;
  projectId: number;
  replies: RuntimeReply[];
  traceId?: string | null;
}) {
  if (input.replies.length === 0) {
    return;
  }

  if (input.channelType !== "whatsapp") {
    for (const reply of input.replies) {
      await recordChannelOutboundMessage({
        channelType: input.channelType,
        externalConversationId: input.conversationId,
        messageType: reply.type,
        payload: reply.payload,
        projectId: input.projectId,
        text: reply.fallbackText,
      });
    }
    return;
  }

  const [conversation, channels] = await Promise.all([
    getChannelConversation({
      channelType: "whatsapp",
      externalConversationId: input.conversationId,
      projectId: input.projectId,
    }),
    listProjectChannels(input.projectId),
  ]);
  const conversationChannelId = conversation?.metadata.channelId;
  const channel = channels.find(
    (candidate) =>
      candidate.channelType === "whatsapp" &&
      candidate.status === "active" &&
      (typeof conversationChannelId !== "number" ||
        candidate.id === conversationChannelId),
  );
  const phoneNumberId = channel
    ? normalizeWhatsAppConfig(channel.config).phoneNumberId ||
      channel.externalId ||
      ""
    : "";

  if (!channel || !phoneNumberId) {
    throw new Error(
      "The active WhatsApp channel for this scheduled flow reply is unavailable.",
    );
  }

  await enqueueWhatsAppRuntimeReplies({
    channelId: channel.id,
    externalConversationId: input.conversationId,
    phoneNumberId,
    projectId: input.projectId,
    replies: input.replies,
    to: input.externalUserId || input.conversationId,
    traceId: input.traceId,
  });
}
