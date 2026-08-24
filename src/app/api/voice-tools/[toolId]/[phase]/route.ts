import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getHostedVoiceBearerCredential,
  HOSTED_VOICE_TOOL_PHASES,
  telnyxHostedVoiceToolAdapter,
} from "@/lib/hosted-voice-tool-contract";
import { hostedVoiceToolExecutor } from "@/lib/hosted-voice-tool-executor";
import {
  executeHostedVoiceToolEnvelope,
  HostedVoiceToolRequestError,
} from "@/lib/hosted-voice-tool-gateway";
import { hostedVoiceToolGatewayRepository } from "@/lib/hosted-voice-tool-store";

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
    const envelope = telnyxHostedVoiceToolAdapter.normalize({
      phase: route.phase,
      raw: { body, headers: request.headers },
      toolId: route.toolId,
    });
    const result = await executeHostedVoiceToolEnvelope({
      commitSecret:
        process.env.VOICE_TOOL_COMMIT_SECRET ?? process.env.AUTH_SECRET ?? "",
      credential,
      envelope,
      executor: hostedVoiceToolExecutor,
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
