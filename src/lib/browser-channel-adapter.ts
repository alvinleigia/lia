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
import type {
  RuntimeReply,
  RuntimeReplyMedia,
  RuntimeReplyProduct,
} from "@/lib/runtime-replies";

type BrowserChannelType = Extract<ChannelType, "project_chat" | "widget">;

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

      return {
        capability,
        delivery: {
          id: context.messageId,
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
