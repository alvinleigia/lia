import type {
  ActiveActionFlow,
  FlowChatMessage,
  RuntimeAction,
} from "@/lib/action-runtime";
import type {
  RuntimeReply,
  RuntimeReplyMedia,
  RuntimeReplyProduct,
} from "@/lib/runtime-replies";

export type BrowserFlowRuntimeResult = {
  action: RuntimeAction | null;
  activeFlow: ActiveActionFlow | null;
  handled: boolean;
  replies: RuntimeReply[];
};

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

export function runtimeRepliesToFlowMessages(
  replies: RuntimeReply[],
): FlowChatMessage[] {
  return replies.map((reply, index) => {
    const productMode = reply.payload?.mode;

    return {
      id: `runtime-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
      media: getPayloadMedia(reply),
      productMode:
        productMode === "catalog" ||
        productMode === "multiple_products" ||
        productMode === "single_product"
          ? productMode
          : undefined,
      products: getPayloadProducts(reply),
      role: "assistant",
      text:
        reply.type === "buttons" ||
        reply.type === "catalog" ||
        reply.type === "list" ||
        reply.type === "media"
          ? reply.text
          : reply.fallbackText,
    };
  });
}
