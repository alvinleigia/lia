import { NextResponse } from "next/server";
import { getActiveActionSubmissionForConversation } from "@/lib/action-flows";
import {
  processChannelFlowMedia,
  processChannelFlowText,
} from "@/lib/channel-flow-runtime";
import {
  getNormalizedChannelInboundRuntimeValue,
  normalizeChannelInboundV1,
} from "@/lib/channel-inbound-contract";
import {
  listRecentChannelMessages,
  markChannelMessageIgnored,
  recordChannelInboundMessage,
} from "@/lib/channels";
import { resolveTraceId } from "@/lib/execution-trace";
import { runHybridChannelFlowBoundary } from "@/lib/hybrid-channel-runtime";
import {
  cancelPendingWhatsAppReplies,
  enqueueWhatsAppRuntimeReplies,
  processProjectOutboxQueue,
} from "@/lib/outbox";
import {
  extractWhatsAppMessageChanges,
  getActiveWhatsAppChannelByPhoneNumberId,
  getActiveWhatsAppChannelByVerifyToken,
  getWhatsAppInboundLocationValue,
  getWhatsAppInboundMediaReference,
  getWhatsAppInboundProducts,
  getWhatsAppInboundSelection,
  getWhatsAppInboundText,
  hasNewerWhatsAppInboundMessage,
  normalizeWhatsAppConfig,
  verifyWhatsAppSignature,
  type WhatsAppWebhookPayload,
} from "@/lib/whatsapp";

const WHATSAPP_FLOW_SOURCE = "whatsapp_chat";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const verifyToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !verifyToken || !challenge) {
    return NextResponse.json(
      { error: "Invalid verification" },
      { status: 400 },
    );
  }

  const channel = await getActiveWhatsAppChannelByVerifyToken(verifyToken);
  if (!channel) {
    return NextResponse.json({ error: "Verification failed" }, { status: 403 });
  }

  return new Response(challenge, {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
    },
  });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  let payload: WhatsAppWebhookPayload;

  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const changes = extractWhatsAppMessageChanges(payload);
  for (const change of changes) {
    const channel = await getActiveWhatsAppChannelByPhoneNumberId(
      change.phoneNumberId,
    );

    if (!channel) {
      continue;
    }

    const config = normalizeWhatsAppConfig(channel.config);
    const isSignatureValid = verifyWhatsAppSignature({
      rawBody,
      signature: req.headers.get("x-hub-signature-256"),
      appSecret: config.appSecret,
    });

    if (!isSignatureValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const text = getWhatsAppInboundText(change.message);
    const media = getWhatsAppInboundMediaReference(change.message);
    const location = getWhatsAppInboundLocationValue(change.message);
    const normalizedInbound = normalizeChannelInboundV1({
      channelType: "whatsapp",
      location: location ? { ...location } : null,
      media: media ? { ...media } : null,
      products: getWhatsAppInboundProducts(change.message),
      selection: getWhatsAppInboundSelection(change.message),
      text,
    });
    const inboundRecord = await recordChannelInboundMessage({
      projectId: channel.projectId,
      channelType: "whatsapp",
      externalConversationId: change.message.from,
      externalMessageId: change.message.id,
      externalUserId: change.message.from,
      text:
        normalizedInbound.selection?.label ??
        text ??
        media?.originalName ??
        location?.label ??
        null,
      messageType: change.message.type ?? "text",
      payload: {
        location,
        mediaReference: media,
        message: change.message,
        normalizedInbound,
        phoneNumberId: change.phoneNumberId,
        displayPhoneNumber: change.displayPhoneNumber,
        whatsappMessageId: change.message.id,
      },
      metadata: {
        channelId: channel.id,
      },
    });

    if (inboundRecord.duplicate) {
      continue;
    }

    const recentMessages = await listRecentChannelMessages({
      beforeMessageId: inboundRecord.message.id,
      conversationId: inboundRecord.conversation.id,
      limit: 50,
      projectId: channel.projectId,
    });
    if (
      hasNewerWhatsAppInboundMessage({
        message: change.message,
        recentMessages,
      })
    ) {
      await markChannelMessageIgnored({
        messageId: inboundRecord.message.id,
        projectId: channel.projectId,
        reason: "out_of_order_provider_timestamp",
      });
      continue;
    }

    if (!text?.trim() && !media && !location) {
      continue;
    }

    await cancelPendingWhatsAppReplies({
      destination: change.message.from,
      projectId: channel.projectId,
    });

    const activeSubmission = await getActiveActionSubmissionForConversation({
      projectId: channel.projectId,
      conversationId: change.message.from,
      source: WHATSAPP_FLOW_SOURCE,
    });
    const traceId = resolveTraceId(activeSubmission?.traceId);
    const runtimeText = location
      ? JSON.stringify(location)
      : getNormalizedChannelInboundRuntimeValue(normalizedInbound);
    const result = media
      ? await processChannelFlowMedia({
          activeSubmission,
          contactId: inboundRecord.conversation.contactId,
          media,
          projectId: channel.projectId,
        })
      : await processChannelFlowText({
          activeSubmission,
          contactId: inboundRecord.conversation.contactId,
          conversationId: change.message.from,
          projectId: channel.projectId,
          source: WHATSAPP_FLOW_SOURCE,
          text: runtimeText,
          traceId,
        });
    const hybrid =
      !media && result.boundaryNodeId && runtimeText.trim()
        ? await runHybridChannelFlowBoundary({
            boundaryNodeId: result.boundaryNodeId,
            channelConversationId: inboundRecord.conversation.id,
            channelType: "whatsapp",
            externalConversationId: change.message.from,
            externalUserId: change.message.from,
            inboundMessageId: inboundRecord.message.id,
            projectId: channel.projectId,
            selection: normalizedInbound.selection,
            source: WHATSAPP_FLOW_SOURCE,
            text: runtimeText,
            consumeTriggerMessage: result.consumeTriggerMessage,
          })
        : { replies: [] };
    const replies = [...result.replies, ...hybrid.replies];

    if (replies.length > 0) {
      await enqueueWhatsAppRuntimeReplies({
        channelId: channel.id,
        externalConversationId: change.message.from,
        phoneNumberId: change.phoneNumberId,
        projectId: channel.projectId,
        replies,
        sourceInboundMessageId: inboundRecord.message.id,
        to: change.message.from,
        traceId,
      });
      await processProjectOutboxQueue({
        destination: change.message.from,
        maxMessages: 50,
        projectId: channel.projectId,
        workerId: `whatsapp-webhook:${change.message.id}`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    receivedMessages: changes.length,
  });
}
