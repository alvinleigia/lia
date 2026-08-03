import type { FlowChatMessage } from "@/lib/action-runtime";
import type {
  AdaptedChannelReply,
  ChannelReplyAdapter,
} from "@/lib/channel-adapter-contract";
import {
  getChannelAdapterProfile,
  getChannelReplySupport,
  getRuntimeReplyCapability,
} from "@/lib/channel-adapter-contract";
import type { ChannelType } from "@/lib/channels";
import { parseRuntimeInputRequest } from "@/lib/runtime-input-request";
import type {
  RuntimeReply,
  RuntimeReplyMedia,
  RuntimeReplyProduct,
} from "@/lib/runtime-replies";

type BrowserChannelType = Extract<ChannelType, "project_chat" | "widget">;

type StoredBrowserChannelMessage = {
  direction: string;
  id: number;
  messageType: string;
  payload: Record<string, unknown>;
  text: string | null;
};

const RUNTIME_REPLY_TYPES = new Set<RuntimeReply["type"]>([
  "buttons",
  "catalog",
  "handoff",
  "list",
  "media",
  "template",
  "text",
]);

export type BrowserChannelDelivery = FlowChatMessage;

function getPayloadMedia(reply: RuntimeReply) {
  const media = reply.payload?.media;
  return media && typeof media === "object"
    ? [media as RuntimeReplyMedia]
    : undefined;
}

function getPayloadProducts(reply: RuntimeReply) {
  return Array.isArray(reply.payload?.products)
    ? (reply.payload.products as RuntimeReplyProduct[])
    : undefined;
}

function getBrowserReplyText(reply: RuntimeReply) {
  return reply.type === "buttons" ||
    reply.type === "catalog" ||
    reply.type === "list" ||
    reply.type === "media"
    ? reply.text
    : reply.fallbackText;
}

function getBrowserReplyWarnings(
  channelType: BrowserChannelType,
  reply: RuntimeReply,
) {
  const support = getChannelReplySupport(channelType, reply);
  const capability = getRuntimeReplyCapability(reply);
  const warnings: string[] = [];

  if (support === "fallback") {
    warnings.push(`${capability} is rendered using its text fallback.`);
  }

  if (capability === "media" && !getPayloadMedia(reply)) {
    warnings.push("Media payload is unavailable; text fallback was used.");
  }

  if (
    ["catalog_message", "multiple_products", "single_product"].includes(
      capability,
    ) &&
    !getPayloadProducts(reply)?.length
  ) {
    warnings.push("Product payload is empty; text fallback was used.");
  }

  return warnings;
}

export function createBrowserChannelAdapter(channelType: BrowserChannelType) {
  return {
    profile: getChannelAdapterProfile(channelType),
    adaptReply({ context, reply }) {
      const capability = getRuntimeReplyCapability(reply);
      const media = getPayloadMedia(reply);
      const products = getPayloadProducts(reply);
      const warnings = getBrowserReplyWarnings(channelType, reply);
      const inputRequest = parseRuntimeInputRequest(
        reply.payload?.inputRequest,
      );

      return {
        capability,
        delivery: {
          id: context.messageId,
          ...(inputRequest ? { inputRequest } : {}),
          media,
          productMode:
            reply.payload?.mode === "catalog" ||
            reply.payload?.mode === "multiple_products" ||
            reply.payload?.mode === "single_product"
              ? reply.payload.mode
              : undefined,
          products,
          role: "assistant",
          text: getBrowserReplyText(reply),
        },
        mode: warnings.length > 0 ? "fallback" : "native",
        source: reply,
        warnings,
      } satisfies AdaptedChannelReply<BrowserChannelDelivery>;
    },
  } satisfies ChannelReplyAdapter<
    { messageId: string },
    BrowserChannelDelivery
  >;
}

export function adaptBrowserRuntimeReplies(
  channelType: BrowserChannelType,
  replies: RuntimeReply[],
) {
  const adapter = createBrowserChannelAdapter(channelType);

  return replies.map((reply, index) =>
    adapter.adaptReply({
      context: {
        messageId: `runtime-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
      },
      reply,
    }),
  );
}

export function browserRuntimeRepliesToFlowMessages(
  channelType: BrowserChannelType,
  replies: RuntimeReply[],
) {
  return adaptBrowserRuntimeReplies(channelType, replies).map(
    (adapted) => adapted.delivery,
  );
}

function getStoredBrowserReplyText(message: StoredBrowserChannelMessage) {
  const text = message.text ?? "";

  return ["buttons", "catalog", "list", "media"].includes(message.messageType)
    ? (text.split("\n\n")[0] ?? text)
    : text;
}

export function browserChannelMessagesToFlowMessages(
  channelType: BrowserChannelType,
  messages: StoredBrowserChannelMessage[],
): FlowChatMessage[] {
  const adapter = createBrowserChannelAdapter(channelType);

  return messages.flatMap<FlowChatMessage>((message) => {
    if (!message.text) {
      return [];
    }

    if (message.direction === "inbound") {
      return [
        {
          id: `channel-${message.id}`,
          role: "user" as const,
          text: message.text,
        },
      ];
    }

    const type = RUNTIME_REPLY_TYPES.has(
      message.messageType as RuntimeReply["type"],
    )
      ? (message.messageType as RuntimeReply["type"])
      : "text";
    const reply: RuntimeReply = {
      fallbackText: message.text,
      payload: message.payload,
      text: getStoredBrowserReplyText(message),
      type,
    };

    return [
      adapter.adaptReply({
        context: { messageId: `channel-${message.id}` },
        reply,
      }).delivery,
    ];
  });
}
