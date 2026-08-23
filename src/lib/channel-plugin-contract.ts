import type { ChannelReplyAdapter } from "@/lib/channel-adapter-contract";
import type { NormalizedChannelInboundV1 } from "@/lib/channel-inbound-contract";

export type ChannelPluginContract<
  TChannelType extends string,
  TProviderInbound,
  TAdapterContext,
  TDelivery,
> = {
  channelType: TChannelType;
  normalizeInbound: (
    input: TProviderInbound,
  ) => NormalizedChannelInboundV1<TChannelType>;
  outbound: ChannelReplyAdapter<TAdapterContext, TDelivery, TChannelType>;
};
