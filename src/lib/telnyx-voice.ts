import {
  type AdaptedChannelReply,
  type ChannelReplyAdapter,
  getChannelAdapterProfile,
  getRuntimeReplyCapability,
} from "@/lib/channel-adapter-contract";
import { normalizeChannelInboundV1 } from "@/lib/channel-inbound-contract";
import type { ChannelPluginContract } from "@/lib/channel-plugin-contract";
import type { RuntimeReply } from "@/lib/runtime-replies";

export const TELNYX_VOICE_CHANNEL_TYPE = "telnyx_voice" as const;
export const TELNYX_VOICE_FLOW_SOURCE = "telnyx_voice" as const;

export type TelnyxVoiceAdapterContext = {
  callControlId: string;
  callSessionId: string;
  commandId: string;
  correlationId: string;
  transferDestination?: string | null;
  voice: string;
};

export type TelnyxVoiceDelivery = {
  action: "speak" | "transfer";
  body: Record<string, unknown>;
  callControlId: string;
  callSessionId: string;
  correlationId: string;
  fallbackText: string;
  schemaVersion: 1;
  text: string;
};

function speakDelivery(input: {
  context: TelnyxVoiceAdapterContext;
  reply: RuntimeReply;
  useFallback: boolean;
}): TelnyxVoiceDelivery {
  return {
    action: "speak",
    body: {
      command_id: input.context.commandId,
      payload: input.useFallback ? input.reply.fallbackText : input.reply.text,
      voice: input.context.voice,
    },
    callControlId: input.context.callControlId,
    callSessionId: input.context.callSessionId,
    correlationId: input.context.correlationId,
    fallbackText: input.reply.fallbackText,
    schemaVersion: 1,
    text: input.reply.text,
  };
}

export function createTelnyxVoiceChannelAdapter() {
  const profile = getChannelAdapterProfile(TELNYX_VOICE_CHANNEL_TYPE);

  return {
    profile,
    adaptReply({ context, reply }) {
      const capability = getRuntimeReplyCapability(reply);

      if (capability === "handoff" && context.transferDestination) {
        return {
          capability,
          delivery: {
            action: "transfer",
            body: {
              command_id: context.commandId,
              to: context.transferDestination,
            },
            callControlId: context.callControlId,
            callSessionId: context.callSessionId,
            correlationId: context.correlationId,
            fallbackText: reply.fallbackText,
            schemaVersion: 1,
            text: reply.text,
          },
          mode: "native",
          source: reply,
          warnings: [],
        } satisfies AdaptedChannelReply<TelnyxVoiceDelivery>;
      }

      const useFallback = capability !== "text";
      return {
        capability,
        delivery: speakDelivery({ context, reply, useFallback }),
        mode: useFallback ? "fallback" : "native",
        source: reply,
        warnings: useFallback
          ? [
              capability === "handoff"
                ? "No transfer destination is configured; speaking the handoff fallback."
                : `${capability} is delivered as readable speech.`,
            ]
          : [],
      } satisfies AdaptedChannelReply<TelnyxVoiceDelivery>;
    },
  } satisfies ChannelReplyAdapter<
    TelnyxVoiceAdapterContext,
    TelnyxVoiceDelivery,
    typeof TELNYX_VOICE_CHANNEL_TYPE
  >;
}

export function createTelnyxVoiceChannelPlugin() {
  return {
    channelType: TELNYX_VOICE_CHANNEL_TYPE,
    normalizeInbound(input) {
      return normalizeChannelInboundV1({
        channelType: TELNYX_VOICE_CHANNEL_TYPE,
        text: input.transcript,
      });
    },
    outbound: createTelnyxVoiceChannelAdapter(),
  } satisfies ChannelPluginContract<
    typeof TELNYX_VOICE_CHANNEL_TYPE,
    { transcript: string },
    TelnyxVoiceAdapterContext,
    TelnyxVoiceDelivery
  >;
}
