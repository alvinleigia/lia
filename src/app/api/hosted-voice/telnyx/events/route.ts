import { NextResponse } from "next/server";
import { recordHostedVoicePostCallObservation } from "@/lib/hosted-voice-observability";
import {
  getTelnyxHostedVoiceConversationEnded,
  telnyxHostedVoicePostCallEventSchema,
} from "@/lib/telnyx-hosted-voice-events";
import { getTelnyxHostedVoiceEventContext } from "@/lib/telnyx-hosted-voice-provider";
import { verifyTelnyxWebhookSignature } from "@/lib/telnyx-voice-provider";

const MAX_BODY_CHARACTERS = 64_000;

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_CHARACTERS) {
    return NextResponse.json({ error: "event_too_large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = telnyxHostedVoicePostCallEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }
  const ended = getTelnyxHostedVoiceConversationEnded(parsed.data);
  if (!ended) return NextResponse.json({ ignored: true, ok: true });
  const context = await getTelnyxHostedVoiceEventContext(ended.assistantId);
  if (!context) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  if (
    !verifyTelnyxWebhookSignature({
      publicKey: context.webhookPublicKey ?? "",
      rawBody,
      signature: request.headers.get("telnyx-signature-ed25519"),
      timestamp: request.headers.get("telnyx-timestamp"),
    })
  ) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  if (
    context.retention.mode === "disabled" ||
    context.retention.days === null
  ) {
    return NextResponse.json({ ignored: true, ok: true });
  }
  await recordHostedVoicePostCallObservation({
    costRateMicrounitsPerMinute: context.costRateMicrounitsPerMinute,
    deploymentId: context.deploymentId,
    deploymentVersionId: context.deploymentVersionId,
    event: ended,
    projectId: context.projectId,
    provider: "telnyx_ai_assistant",
    retentionDays: context.retention.days,
  });
  return NextResponse.json({ ok: true });
}
