import { NextResponse } from "next/server";
import { getActiveActionSubmissionForConversation } from "@/lib/action-flows";
import {
  processChannelFlowMedia,
  processChannelFlowText,
} from "@/lib/channel-flow-runtime";
import {
  recordChannelInboundMessage,
  recordChannelOutboundMessage,
} from "@/lib/channels";
import { getRuntimeReplyText } from "@/lib/runtime-replies";
import {
  extractWhatsAppMessageChanges,
  getActiveWhatsAppChannelByPhoneNumberId,
  getActiveWhatsAppChannelByVerifyToken,
  getWhatsAppInboundLocationValue,
  getWhatsAppInboundMediaReference,
  getWhatsAppInboundText,
  normalizeWhatsAppConfig,
  sendWhatsAppRuntimeReply,
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
    const inboundRecord = await recordChannelInboundMessage({
      projectId: channel.projectId,
      channelType: "whatsapp",
      externalConversationId: change.message.from,
      externalUserId: change.message.from,
      text: text ?? media?.originalName ?? location?.label ?? null,
      messageType: change.message.type ?? "text",
      payload: {
        location,
        mediaReference: media,
        message: change.message,
        phoneNumberId: change.phoneNumberId,
        displayPhoneNumber: change.displayPhoneNumber,
        whatsappMessageId: change.message.id,
      },
      metadata: {
        channelId: channel.id,
      },
    });

    if (!text?.trim() && !media && !location) {
      continue;
    }

    const activeSubmission = await getActiveActionSubmissionForConversation({
      projectId: channel.projectId,
      conversationId: change.message.from,
      source: WHATSAPP_FLOW_SOURCE,
    });
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
          text: text ?? (location ? JSON.stringify(location) : ""),
        });

    for (const reply of result.replies) {
      const replyText = getRuntimeReplyText(reply);
      let deliveryMode = "text";
      let deliveryStatus = "sent";
      let deliveryError: string | null = null;
      let messageType = "text";
      let outboundText = replyText;

      try {
        const sendResult = await sendWhatsAppRuntimeReply({
          channel,
          reply,
          to: change.message.from,
        });
        deliveryMode = sendResult.deliveryMode;
        messageType = sendResult.messageType;
        outboundText = sendResult.text;
      } catch (error) {
        deliveryStatus = "failed";
        deliveryError =
          error instanceof Error ? error.message : "WhatsApp send failed.";
        console.error("WhatsApp outbound send failed:", error);
      }

      await recordChannelOutboundMessage({
        projectId: channel.projectId,
        channelType: "whatsapp",
        externalConversationId: change.message.from,
        text: outboundText,
        messageType,
        payload: {
          deliveryMode,
          deliveryError,
          deliveryStatus,
          event: "whatsapp.flow_reply_sent",
          phoneNumberId: change.phoneNumberId,
          runtimeReply: reply,
        },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    receivedMessages: changes.length,
  });
}
