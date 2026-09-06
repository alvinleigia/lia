import { after, NextResponse } from "next/server";
import { z } from "zod";
import {
  getHostedVoiceBearerCredential,
  HOSTED_VOICE_TOOL_PHASES,
  telnyxHostedVoiceToolAdapter,
} from "@/lib/hosted-voice-tool-contract";
import { hostedVoiceToolExecutor } from "@/lib/hosted-voice-tool-executor";
import {
  executeHostedVoiceToolEnvelope,
  type HostedVoiceToolExecutor,
  HostedVoiceToolRequestError,
} from "@/lib/hosted-voice-tool-gateway";
import {
  HOSTED_VOICE_NO_CALL_VERIFICATION_HEADER,
  verifyHostedVoiceNoCallVerificationToken,
} from "@/lib/hosted-voice-tool-preflight";
import { hostedVoiceToolGatewayRepository } from "@/lib/hosted-voice-tool-store";
import { processProjectHostedVoiceToolQueue } from "@/lib/hosted-voice-tool-worker";

const MAX_BODY_CHARACTERS = 64_000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ phase: string; toolId: string }> },
) {
  try {
    const route = z
      .object({
        phase: z.enum(HOSTED_VOICE_TOOL_PHASES),
        toolId: z.string().trim().min(1).max(120),
      })
      .parse(await params);
    const credential = getHostedVoiceBearerCredential(request.headers);
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_CHARACTERS) {
      return NextResponse.json(
        { error: "tool_request_too_large" },
        { status: 413 },
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    const callControlId = request.headers
      .get("x-telnyx-call-control-id")
      ?.trim();
    const verifiedConversationId = callControlId
      ? undefined
      : (verifyHostedVoiceNoCallVerificationToken({
          phase: route.phase,
          secret:
            process.env.VOICE_TOOL_COMMIT_SECRET ??
            process.env.AUTH_SECRET ??
            "",
          token: request.headers.get(HOSTED_VOICE_NO_CALL_VERIFICATION_HEADER),
          toolId: route.toolId,
        }) ?? undefined);
    const envelope = telnyxHostedVoiceToolAdapter.normalize({
      phase: route.phase,
      raw: { body, headers: request.headers, verifiedConversationId },
      toolId: route.toolId,
    });
    const result = await executeHostedVoiceToolEnvelope({
      commitSecret:
        process.env.VOICE_TOOL_COMMIT_SECRET ?? process.env.AUTH_SECRET ?? "",
      credential,
      envelope,
      executor: callControlId
        ? createRequestHostedVoiceToolExecutor()
        : hostedVoiceToolExecutor,
      forceSynchronous: Boolean(verifiedConversationId),
      repository: hostedVoiceToolGatewayRepository,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof HostedVoiceToolRequestError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }
    console.error("Hosted voice tool request failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "hosted_voice_tool_failed" },
      { status: 500 },
    );
  }
}

function createRequestHostedVoiceToolExecutor(): HostedVoiceToolExecutor {
  return {
    execute: hostedVoiceToolExecutor.execute,
    async enqueue(input) {
      await hostedVoiceToolExecutor.enqueue(input);
      console.info("Hosted voice tool queued.", {
        callId: input.callId,
        projectId: input.projectId,
      });
      after(async () => {
        try {
          const result = await processProjectHostedVoiceToolQueue({
            maxJobs: 10,
            projectId: input.projectId,
            workerId: `hosted-voice-request:${crypto.randomUUID()}`,
          });
          console.info("Hosted voice tool queue processed.", {
            ...result,
            projectId: input.projectId,
          });
        } catch (error) {
          console.error("Hosted voice tool queue processing failed.", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            projectId: input.projectId,
          });
        }
      });
    },
  };
}
