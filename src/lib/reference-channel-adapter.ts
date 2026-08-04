import type {
  AdaptedChannelReply,
  ChannelAdapterProfile,
  ChannelReplyAdapter,
} from "@/lib/channel-adapter-contract";
import {
  CHANNEL_REPLY_CAPABILITIES,
  getRuntimeReplyCapability,
} from "@/lib/channel-adapter-contract";

export const REFERENCE_CHANNEL_TYPE = "reference_future" as const;

export type ReferenceChannelDelivery = {
  correlationId: string;
  fallbackText: string;
  kind: (typeof CHANNEL_REPLY_CAPABILITIES)[number];
  payload: Record<string, unknown> | null;
  schemaVersion: 1;
  text: string;
};

const referenceReplySupport = Object.fromEntries(
  CHANNEL_REPLY_CAPABILITIES.map((capability) => [capability, "native"]),
) as ChannelAdapterProfile<typeof REFERENCE_CHANNEL_TYPE>["replies"];

export const REFERENCE_CHANNEL_PROFILE = {
  channelType: REFERENCE_CHANNEL_TYPE,
  inbound: {
    interactiveSelection: true,
    location: true,
    media: true,
    productSelection: true,
    text: true,
  },
  limits: { buttonOptions: null, listOptions: null, productItems: null },
  replies: referenceReplySupport,
} satisfies ChannelAdapterProfile<typeof REFERENCE_CHANNEL_TYPE>;

export function createReferenceChannelAdapter() {
  return {
    profile: REFERENCE_CHANNEL_PROFILE,
    adaptReply({ context, reply }) {
      const capability = getRuntimeReplyCapability(reply);

      return {
        capability,
        delivery: {
          correlationId: context.correlationId,
          fallbackText: reply.fallbackText,
          kind: capability,
          payload: reply.payload ?? null,
          schemaVersion: 1,
          text: reply.text,
        },
        mode: "native",
        source: reply,
        warnings: [],
      } satisfies AdaptedChannelReply<ReferenceChannelDelivery>;
    },
  } satisfies ChannelReplyAdapter<
    { correlationId: string },
    ReferenceChannelDelivery,
    typeof REFERENCE_CHANNEL_TYPE
  >;
}
