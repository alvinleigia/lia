import { expect, test } from "@playwright/test";
import { compileHostedVoiceAgent } from "../../src/lib/hosted-voice-contract";
import {
  createHostedVoiceContinuationMessage,
  getHostedVoiceCallMetrics,
  getHostedVoiceInterruptionDecision,
  getHostedVoiceToolOutcome,
  HOSTED_VOICE_TOOL_OUTCOMES,
  resolveHostedVoiceVersionAttribution,
} from "../../src/lib/hosted-voice-runtime";
import { buildTelnyxHostedVoiceToolSetupManifest } from "../../src/lib/hosted-voice-staging";
import { createTelnyxHostedVoiceCompiler } from "../../src/lib/telnyx-hosted-voice";
import { sendTelnyxHostedVoiceContinuation } from "../../src/lib/telnyx-hosted-voice-continuation";
import { getTelnyxHostedVoiceConversationEnded } from "../../src/lib/telnyx-hosted-voice-events";

test("ordinary hosted speech remains entirely inside the Telnyx native config", () => {
  const compiled = compileHostedVoiceAgent({
    compiler: createTelnyxHostedVoiceCompiler({
      modelId: "openai/gpt-4o-mini",
      transcriptionLanguage: "en",
      transcriptionModelId: "deepgram/flux",
      voiceId: "Telnyx.Natural",
    }),
    definition: {
      confirmation: { writeOperations: "explicit" },
      greeting: { strategy: "exact", text: "Hello" },
      handoff: { mode: "available" },
      identity: {
        defaultRequirement: "anonymous",
        verificationFactors: [],
      },
      instructions: "Handle ordinary conversation natively.",
      key: "clinic_voice",
      locale: { language: "en-AU", timezone: "Australia/Sydney" },
      name: "Clinic voice",
      publishedTaskVersions: [],
      requiredCapabilities: [
        "native_conversation",
        "interruptions",
        "transfer",
      ],
      retention: { days: 30, mode: "metadata_only" },
      schemaVersion: 1,
      tools: [],
    },
  });
  expect(compiled.managedConfig).toEqual({
    enabled_features: ["telephony"],
    greeting: "Hello",
    instructions: "Handle ordinary conversation natively.",
    model: "openai/gpt-4o-mini",
    name: "Clinic voice",
    privacy_settings: { data_retention: true },
    transcription: { language: "en", model: "deepgram/flux" },
    voice_settings: { voice: "Telnyx.Natural" },
  });
  expect(JSON.stringify(compiled.managedConfig)).not.toContain("/api/chat");
  expect(JSON.stringify(compiled.managedConfig)).not.toContain(
    "/api/conversation/turn",
  );
});

test("truthful continuation wording covers every hosted tool outcome", () => {
  const fixtures = [
    [{ status: "success" }, "success"],
    [{ reason: "slot_taken", status: "rejected" }, "conflict"],
    [{ reason: "appointment_not_found", status: "no_result" }, "not_found"],
    [{ status: "ambiguous" }, "ambiguous"],
    [{ status: "pending" }, "pending"],
    [{ status: "outcome_unknown" }, "outcome_unknown"],
    [{ status: "provider_failure" }, "provider_unavailable"],
  ] as const;
  expect(fixtures.map(([result]) => getHostedVoiceToolOutcome(result))).toEqual(
    HOSTED_VOICE_TOOL_OUTCOMES,
  );
  for (const [result, outcome] of fixtures) {
    const message = createHostedVoiceContinuationMessage({
      outcome,
      requestId: "safe-request",
      result,
    });
    expect(message).toContain(`outcome="${outcome}"`);
    if (outcome !== "success")
      expect(message).not.toContain("completed and was verified");
  }
  expect(getHostedVoiceToolOutcome({ status: "unexpected" })).toBe("ambiguous");
});

test("Telnyx continuation uses one idempotent non-interrupting Add Messages call", async () => {
  const requests: Array<{ init?: RequestInit; url: string }> = [];
  await sendTelnyxHostedVoiceContinuation({
    apiKey: "secret-api-key",
    callControlId: "v3:call-control-token",
    fetchImpl: async (url, init) => {
      requests.push({ init, url: String(url) });
      return new Response(JSON.stringify({ data: { result: "ok" } }), {
        status: 200,
      });
    },
    message: "Verified result",
    requestId: "stable-request-id",
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toContain(
    "/calls/v3%3Acall-control-token/actions/ai_assistant_add_messages",
  );
  expect(requests[0]?.init?.headers).toEqual({
    Authorization: "Bearer secret-api-key",
    "Content-Type": "application/json",
  });
  const body = JSON.parse(String(requests[0]?.init?.body));
  expect(body).toMatchObject({
    messages: [{ content: "Verified result", role: "system" }],
    trigger_response: false,
  });
  expect(body.command_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(body)).not.toContain("secret-api-key");
});

test("interruption can cancel a pending read but never a committed write", () => {
  expect(
    getHostedVoiceInterruptionDecision({
      access: "read",
      cancellation: "best_effort",
      status: "pending",
    }),
  ).toBe("cancel_pending_read");
  expect(
    getHostedVoiceInterruptionDecision({
      access: "write",
      cancellation: "unsupported",
      status: "executing",
    }),
  ).toBe("continue_committed_write");
  expect(
    getHostedVoiceInterruptionDecision({
      access: "write",
      cancellation: "supported",
      status: "completed",
    }),
  ).toBe("continue_committed_write");
});

test("post-call synchronization keeps safe metadata, latency, and cost inputs", () => {
  const ended = getTelnyxHostedVoiceConversationEnded({
    data: {
      event_type: "call.conversation.ended",
      id: "event-1",
      occurred_at: "2026-08-24T10:05:00.000Z",
      payload: {
        assistant_id: "assistant-1",
        call_control_id: "v3:call-token",
        conversation_id: "conversation-1",
        duration_sec: 90,
        from: "+61400000000",
        llm_model: "openai/gpt-4o-mini",
        reason: "assistant_transfer",
        stt_model: "deepgram/flux",
        to: "+61200000000",
        transcript: "private caller words",
        tts_model_id: "Natural",
        tts_provider: "telnyx",
      },
    },
  });
  expect(ended).not.toBeNull();
  expect(JSON.stringify(ended)).not.toContain("+61400000000");
  expect(JSON.stringify(ended)).not.toContain("private caller words");
  const metrics = getHostedVoiceCallMetrics({
    costRateMicrounitsPerMinute: 200_000,
    durationMs: ended?.durationMs ?? 0,
    endReason: ended?.reason ?? "",
    tools: [
      { interrupted: true, latencyMs: 100, outcome: "success" },
      { interrupted: false, latencyMs: 200, outcome: "conflict" },
      { interrupted: false, latencyMs: 900, outcome: "success" },
    ],
  });
  expect(metrics).toMatchObject({
    estimatedCostMicrounits: 300_000,
    toolInterruptionCount: 1,
    toolLatencyP50Ms: 200,
    toolLatencyP95Ms: 900,
    toolLatencyP99Ms: 900,
    transferred: true,
  });
  expect(metrics.toolOutcomeCounts).toMatchObject({ conflict: 1, success: 2 });
  expect(
    resolveHostedVoiceVersionAttribution({
      currentMainVersionId: 8,
      toolVersionIds: [12, 12],
    }),
  ).toEqual({ deploymentVersionId: 12, source: "tool_binding" });
  expect(
    resolveHostedVoiceVersionAttribution({
      currentMainVersionId: 8,
      toolVersionIds: [],
    }),
  ).toEqual({ deploymentVersionId: 8, source: "current_main_at_sync" });
});

test("Telnyx candidate setup preserves Lia's read and two-phase write boundary", () => {
  const common = {
    description: "Manage the caller's booking.",
    execution: {
      adapter: "built_in" as const,
      cancellation: "unsupported" as const,
      handler: "calendar",
      mode: "synchronous" as const,
      retryAttempts: 0,
      retryDelayMs: 0,
      timeoutMs: 15_000,
    },
    inputSchema: {
      fields: [
        {
          key: "startsAt",
          required: true,
          source: { key: "startsAt", kind: "field" as const },
          type: "text" as const,
        },
        {
          key: "calendarId",
          required: true,
          source: { kind: "literal" as const, value: "private-calendar" },
          type: "text" as const,
        },
      ],
    },
    name: "Booking",
    outputSchema: { fields: [] },
    projectId: 12,
    requiredForCompletion: true,
    resultMappings: [],
    schemaVersion: 1 as const,
    version: 3,
  };
  const manifest = buildTelnyxHostedVoiceToolSetupManifest({
    baseUrl: "https://staging.example.com",
    toolDefinitions: [
      { ...common, access: "read", id: "calendar_availability" },
      { ...common, access: "write", id: "calendar_booking" },
    ],
  });

  expect(manifest.eventWebhookUrl).toBe(
    "https://staging.example.com/api/hosted-voice/telnyx/events",
  );
  expect(manifest.tools.map(({ phase }) => phase)).toEqual([
    "read",
    "prepare",
    "commit",
  ]);
  expect(manifest.tools[0]?.body_parameters).toMatchObject({
    properties: { startsAt: { type: "string" } },
    required: ["startsAt"],
  });
  expect(manifest.tools[1]?.timeout_ms).toBe(10_000);
  expect(manifest.tools[2]?.body_parameters).toMatchObject({
    properties: { commitToken: { type: "string" } },
    required: ["commitToken"],
  });
  const serialized = JSON.stringify(manifest);
  expect(serialized).not.toContain("private-calendar");
  expect(serialized).not.toContain("Bearer ");
  expect(serialized).not.toContain("secret-api-key");
});
