import { NextResponse } from "next/server";
import { getActiveActionSubmissionForConversation } from "@/lib/action-flows";
import { processChannelFlowText } from "@/lib/channel-flow-runtime";
import {
  getChannelConversation,
  recordChannelInboundMessage,
  recordChannelOutboundMessage,
  updateChannelConversationStatus,
} from "@/lib/channels";
import type { SelectProjectChannel } from "@/lib/db-schema";
import { resolveTraceId } from "@/lib/execution-trace";
import { runHybridChannelFlowBoundary } from "@/lib/hybrid-channel-runtime";
import {
  createTelnyxVoiceChannelPlugin,
  TELNYX_VOICE_FLOW_SOURCE,
} from "@/lib/telnyx-voice";
import {
  buildTelnyxAnswerBody,
  getActiveTelnyxVoiceChannelByConnectionId,
  getTelnyxFinalTranscript,
  hasTelnyxSpeech,
  normalizeTelnyxVoiceConfig,
  sendTelnyxVoiceCommand,
  sendTelnyxVoiceDelivery,
  type TelnyxVoiceWebhook,
  telnyxVoiceWebhookSchema,
  verifyTelnyxWebhookSignature,
} from "@/lib/telnyx-voice-provider";

function lifecycleMetadata(event: TelnyxVoiceWebhook) {
  const payload = event.data.payload;
  return {
    callControlId: payload.call_control_id,
    callLegId: payload.call_leg_id,
    callSessionId: payload.call_session_id,
    channelId: null,
    connectionId: payload.connection_id,
    from: payload.from ?? null,
    telnyxEventType: event.data.event_type,
    telnyxSpeaking:
      event.data.event_type === "call.speak.started"
        ? true
        : event.data.event_type === "call.speak.ended"
          ? false
          : undefined,
    to: payload.to ?? null,
  };
}

async function recordLifecycleEvent(input: {
  channelId: number;
  event: TelnyxVoiceWebhook;
  projectId: number;
}) {
  const { event } = input;
  const payload = event.data.payload;
  return recordChannelInboundMessage({
    channelType: "telnyx_voice",
    externalConversationId: payload.call_session_id,
    externalMessageId: event.data.id,
    externalUserId: payload.from ?? null,
    messageType: event.data.event_type,
    metadata: {
      ...lifecycleMetadata(event),
      channelId: input.channelId,
    },
    payload: {
      callControlId: payload.call_control_id,
      callLegId: payload.call_leg_id,
      callSessionId: payload.call_session_id,
      connectionId: payload.connection_id,
      eventType: event.data.event_type,
      occurredAt: event.data.occurred_at,
    },
    projectId: input.projectId,
  });
}

async function handleFinalTranscript(input: {
  channel: SelectProjectChannel;
  event: TelnyxVoiceWebhook;
  text: string;
}) {
  const { channel, event, text } = input;
  const payload = event.data.payload;
  const plugin = createTelnyxVoiceChannelPlugin();
  const normalizedInbound = plugin.normalizeInbound({ transcript: text });
  const inboundRecord = await recordChannelInboundMessage({
    channelType: "telnyx_voice",
    externalConversationId: payload.call_session_id,
    externalMessageId: event.data.id,
    externalUserId: payload.from ?? null,
    messageType: "speech",
    metadata: {
      ...lifecycleMetadata(event),
      channelId: channel.id,
    },
    payload: {
      confidence: payload.transcription_data?.confidence ?? null,
      normalizedInbound,
      occurredAt: event.data.occurred_at,
    },
    projectId: channel.projectId,
    text,
  });
  if (inboundRecord.duplicate) {
    return { duplicate: true, replies: 0 };
  }

  const activeSubmission = await getActiveActionSubmissionForConversation({
    conversationId: payload.call_session_id,
    projectId: channel.projectId,
    source: TELNYX_VOICE_FLOW_SOURCE,
  });
  const traceId = resolveTraceId(activeSubmission?.traceId);
  const result = await processChannelFlowText({
    activeSubmission,
    channelConversationId: inboundRecord.conversation.id,
    contactId: inboundRecord.conversation.contactId,
    conversationId: payload.call_session_id,
    inboundMessageId: inboundRecord.message.id,
    projectId: channel.projectId,
    source: TELNYX_VOICE_FLOW_SOURCE,
    text,
    traceId,
  });
  const hybrid = result.boundaryNodeId
    ? await runHybridChannelFlowBoundary({
        boundaryNodeId: result.boundaryNodeId,
        channelConversationId: inboundRecord.conversation.id,
        channelType: "telnyx_voice",
        consumeTriggerMessage: result.consumeTriggerMessage,
        externalConversationId: payload.call_session_id,
        externalUserId: payload.from ?? null,
        inboundMessageId: inboundRecord.message.id,
        projectId: channel.projectId,
        selection: null,
        source: TELNYX_VOICE_FLOW_SOURCE,
        text,
      })
    : { replies: [] };
  const replies = [...result.replies, ...hybrid.replies];
  const config = normalizeTelnyxVoiceConfig(channel.config);

  for (const [index, reply] of replies.entries()) {
    const commandId = `${event.data.id}:reply:${index + 1}`;
    const adapted = plugin.outbound.adaptReply({
      context: {
        callControlId: payload.call_control_id,
        callSessionId: payload.call_session_id,
        commandId,
        correlationId: event.data.id,
        transferDestination: config.transferDestination,
        voice: config.voice,
      },
      reply,
    });
    const providerResult = await sendTelnyxVoiceDelivery({
      channel,
      delivery: adapted.delivery,
    });
    await recordChannelOutboundMessage({
      channelType: "telnyx_voice",
      externalConversationId: payload.call_session_id,
      externalMessageId: commandId,
      messageType: adapted.delivery.action,
      payload: {
        action: adapted.delivery.action,
        callControlId: payload.call_control_id,
        mode: adapted.mode,
        providerAccepted: Boolean(providerResult),
        warnings: adapted.warnings,
      },
      projectId: channel.projectId,
      text: adapted.mode === "fallback" ? reply.fallbackText : reply.text,
    });
  }

  return { duplicate: false, replies: replies.length };
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = telnyxVoiceWebhookSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  }
  const event = parsed.data;
  const channel = await getActiveTelnyxVoiceChannelByConnectionId(
    event.data.payload.connection_id,
  );
  if (!channel) {
    return NextResponse.json({ ignored: true, ok: true });
  }
  const config = normalizeTelnyxVoiceConfig(channel.config);
  if (
    !verifyTelnyxWebhookSignature({
      publicKey: config.publicKey,
      rawBody,
      signature: req.headers.get("telnyx-signature-ed25519"),
      timestamp: req.headers.get("telnyx-timestamp"),
    })
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = event.data.payload;
  const eventType = event.data.event_type;

  if (eventType === "call.transcription") {
    const conversation = await getChannelConversation({
      channelType: "telnyx_voice",
      externalConversationId: payload.call_session_id,
      projectId: channel.projectId,
    });
    if (hasTelnyxSpeech(event) && conversation?.metadata.telnyxSpeaking) {
      await sendTelnyxVoiceCommand({
        action: "playback_stop",
        body: { command_id: `${event.data.id}:interrupt` },
        callControlId: payload.call_control_id,
        channel,
      }).catch(() => null);
    }
    const transcript = getTelnyxFinalTranscript(event);
    if (!transcript) {
      return NextResponse.json({ final: false, ok: true });
    }
    const result = await handleFinalTranscript({
      channel,
      event,
      text: transcript,
    });
    return NextResponse.json({ ok: true, ...result });
  }

  const lifecycle = await recordLifecycleEvent({
    channelId: channel.id,
    event,
    projectId: channel.projectId,
  });
  if (lifecycle.duplicate) {
    return NextResponse.json({ duplicate: true, ok: true });
  }

  if (eventType === "call.initiated" && payload.direction === "incoming") {
    await sendTelnyxVoiceCommand({
      action: "answer",
      body: buildTelnyxAnswerBody({
        commandId: `${event.data.id}:answer`,
        config,
      }),
      callControlId: payload.call_control_id,
      channel,
    });
  } else if (eventType === "call.answered" && config.greeting) {
    const commandId = `${event.data.id}:greeting`;
    await sendTelnyxVoiceCommand({
      action: "speak",
      body: {
        command_id: commandId,
        payload: config.greeting,
        voice: config.voice,
      },
      callControlId: payload.call_control_id,
      channel,
    });
    await recordChannelOutboundMessage({
      channelType: "telnyx_voice",
      externalConversationId: payload.call_session_id,
      externalMessageId: commandId,
      messageType: "speak",
      payload: {
        callControlId: payload.call_control_id,
        providerAccepted: true,
      },
      projectId: channel.projectId,
      text: config.greeting,
    });
  } else if (eventType === "call.hangup") {
    await updateChannelConversationStatus({
      channelType: "telnyx_voice",
      externalConversationId: payload.call_session_id,
      projectId: channel.projectId,
      status: "closed",
    });
  }

  return NextResponse.json({
    eventType,
    ok: true,
    recorded: true,
  });
}
