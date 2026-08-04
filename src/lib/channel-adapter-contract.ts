import type { ChannelType } from "@/lib/channels";
import type { RuntimeReply } from "@/lib/runtime-replies";

export const CHANNEL_REPLY_CAPABILITIES = [
  "text",
  "buttons",
  "list",
  "media",
  "template",
  "catalog_message",
  "single_product",
  "multiple_products",
  "handoff",
] as const;

export type ChannelReplyCapability =
  (typeof CHANNEL_REPLY_CAPABILITIES)[number];
export type ChannelCapabilitySupport =
  | "native"
  | "conditional"
  | "fallback"
  | "unsupported";
export type ChannelDeliveryMode = "native" | "fallback";

export class ChannelDeliveryError extends Error {
  readonly semanticsPreserved = true;

  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ChannelDeliveryError";
  }
}

export type ChannelAdapterLimits = {
  buttonOptions: number | null;
  listOptions: number | null;
  productItems: number | null;
};

export type ChannelAdapterProfile<TChannelType extends string = ChannelType> = {
  channelType: TChannelType;
  inbound: {
    interactiveSelection: boolean;
    location: boolean;
    media: boolean;
    productSelection: boolean;
    text: boolean;
  };
  limits: ChannelAdapterLimits;
  replies: Record<ChannelReplyCapability, ChannelCapabilitySupport>;
};

export type AdaptedChannelReply<TDelivery> = {
  capability: ChannelReplyCapability;
  delivery: TDelivery;
  mode: ChannelDeliveryMode;
  source: RuntimeReply;
  warnings: string[];
};

export type ChannelReplyAdapter<
  TContext,
  TDelivery,
  TChannelType extends string = ChannelType,
> = {
  adaptReply(input: {
    context: TContext;
    reply: RuntimeReply;
  }): Promise<AdaptedChannelReply<TDelivery>> | AdaptedChannelReply<TDelivery>;
  profile: ChannelAdapterProfile<TChannelType>;
};

const browserReplySupport = {
  buttons: "native",
  catalog_message: "conditional",
  handoff: "fallback",
  list: "native",
  media: "conditional",
  multiple_products: "conditional",
  single_product: "conditional",
  template: "fallback",
  text: "native",
} as const satisfies Record<ChannelReplyCapability, ChannelCapabilitySupport>;

export const CHANNEL_ADAPTER_PROFILES = {
  project_chat: {
    channelType: "project_chat",
    inbound: {
      interactiveSelection: true,
      location: true,
      media: true,
      productSelection: true,
      text: true,
    },
    limits: { buttonOptions: null, listOptions: null, productItems: null },
    replies: browserReplySupport,
  },
  widget: {
    channelType: "widget",
    inbound: {
      interactiveSelection: true,
      location: true,
      media: true,
      productSelection: true,
      text: true,
    },
    limits: { buttonOptions: null, listOptions: null, productItems: null },
    replies: browserReplySupport,
  },
  whatsapp: {
    channelType: "whatsapp",
    inbound: {
      interactiveSelection: true,
      location: true,
      media: true,
      productSelection: true,
      text: true,
    },
    limits: { buttonOptions: 3, listOptions: 10, productItems: 30 },
    replies: {
      buttons: "conditional",
      catalog_message: "conditional",
      handoff: "fallback",
      list: "conditional",
      media: "conditional",
      multiple_products: "conditional",
      single_product: "conditional",
      template: "conditional",
      text: "native",
    },
  },
} as const satisfies Record<ChannelType, ChannelAdapterProfile>;

function readProductMode(reply: RuntimeReply) {
  const mode = reply.payload?.mode;
  return mode === "catalog" ||
    mode === "single_product" ||
    mode === "multiple_products"
    ? mode
    : "catalog";
}

export function getRuntimeReplyCapability(
  reply: RuntimeReply,
): ChannelReplyCapability {
  if (reply.intent === "media" && reply.type === "text") {
    return "media";
  }

  if (reply.type === "catalog") {
    const mode = readProductMode(reply);
    return mode === "catalog" ? "catalog_message" : mode;
  }

  return reply.type;
}

export function getChannelAdapterProfile(channelType: ChannelType) {
  return CHANNEL_ADAPTER_PROFILES[channelType];
}

export function getChannelReplySupport(
  channelType: ChannelType,
  reply: RuntimeReply,
) {
  return getChannelAdapterProfile(channelType).replies[
    getRuntimeReplyCapability(reply)
  ];
}
