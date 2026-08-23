import { generateKeyPairSync, sign } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  type ChannelDeliveryError,
  getChannelAdapterProfile,
} from "../../src/lib/channel-adapter-contract";
import { normalizeChannelInboundV1 } from "../../src/lib/channel-inbound-contract";
import type { SelectProjectChannel } from "../../src/lib/db-schema";
import {
  createChoiceReply,
  createHandoffReply,
  createTextReply,
} from "../../src/lib/runtime-replies";
import { createTelnyxVoiceChannelAdapter } from "../../src/lib/telnyx-voice";
import {
  buildTelnyxAnswerBody,
  getTelnyxFinalTranscript,
  sendTelnyxVoiceCommand,
  telnyxVoiceWebhookSchema,
  verifyTelnyxWebhookSignature,
} from "../../src/lib/telnyx-voice-provider";

const context = {
  callControlId: "call-control-1",
  callSessionId: "call-session-1",
  commandId: "command-1",
  correlationId: "event-1",
  transferDestination: "+15551234567",
  voice: "Telnyx.NaturalHD.astra",
};

const channel = {
  channelType: "telnyx_voice",
  config: { apiKey: "telnyx-secret" },
  createdAt: new Date("2026-08-23T00:00:00.000Z"),
  externalId: "connection-1",
  id: 1,
  name: "Telnyx Voice",
  projectId: 2,
  status: "active",
  updatedAt: new Date("2026-08-23T00:00:00.000Z"),
} satisfies SelectProjectChannel;

function createWebhook(overrides?: {
  eventType?: string;
  isFinal?: boolean;
  transcript?: string;
}) {
  return {
    data: {
      event_type: overrides?.eventType ?? "call.transcription",
      id: "event-1",
      occurred_at: "2026-08-23T00:00:00.000Z",
      payload: {
        call_control_id: "call-control-1",
        call_leg_id: "call-leg-1",
        call_session_id: "call-session-1",
        connection_id: "connection-1",
        direction: "incoming",
        from: "+15550000001",
        to: "+15550000002",
        transcription_data: {
          is_final: overrides?.isFinal ?? true,
          transcript: overrides?.transcript ?? "Book an appointment",
        },
      },
      record_type: "event" as const,
    },
  };
}

test("Telnyx Voice declares speech input and explicit rich fallbacks", () => {
  expect(getChannelAdapterProfile("telnyx_voice")).toEqual({
    channelType: "telnyx_voice",
    inbound: {
      interactiveSelection: false,
      location: false,
      media: false,
      productSelection: false,
      text: true,
    },
    limits: { buttonOptions: 0, listOptions: 0, productItems: 0 },
    replies: {
      buttons: "fallback",
      catalog_message: "fallback",
      handoff: "conditional",
      list: "fallback",
      media: "fallback",
      multiple_products: "fallback",
      single_product: "fallback",
      template: "fallback",
      text: "native",
    },
  });
});

test("final speech transcripts normalize through the universal inbound contract", () => {
  expect(
    normalizeChannelInboundV1({
      channelType: "telnyx_voice",
      text: "I would like to book a facial.",
    }),
  ).toMatchObject({
    channelType: "telnyx_voice",
    kind: "text",
    schemaVersion: 1,
    text: "I would like to book a facial.",
  });
});

test("Telnyx Voice speaks text and readable rich-message fallbacks", () => {
  const adapter = createTelnyxVoiceChannelAdapter();
  const text = adapter.adaptReply({
    context,
    reply: createTextReply("Hello from Lia."),
  });
  const choices = adapter.adaptReply({
    context,
    reply: createChoiceReply({
      displayMode: "buttons",
      options: [
        { id: "one", label: "One", value: "one" },
        { id: "two", label: "Two", value: "two" },
      ],
      text: "Choose one.",
    }),
  });

  expect(text).toMatchObject({
    capability: "text",
    delivery: {
      action: "speak",
      body: {
        command_id: "command-1",
        payload: "Hello from Lia.",
        voice: "Telnyx.NaturalHD.astra",
      },
    },
    mode: "native",
  });
  expect(choices).toMatchObject({
    capability: "buttons",
    delivery: {
      action: "speak",
      body: { payload: "Choose one.\n\n1. One\n2. Two" },
    },
    mode: "fallback",
  });
});

test("Telnyx Voice transfers handoffs only when a destination is configured", () => {
  const adapter = createTelnyxVoiceChannelAdapter();
  const reply = createHandoffReply("A team member will continue.");
  const transfer = adapter.adaptReply({ context, reply });
  const fallback = adapter.adaptReply({
    context: { ...context, transferDestination: null },
    reply,
  });

  expect(transfer).toMatchObject({
    capability: "handoff",
    delivery: {
      action: "transfer",
      body: { command_id: "command-1", to: "+15551234567" },
    },
    mode: "native",
  });
  expect(fallback).toMatchObject({
    capability: "handoff",
    delivery: {
      action: "speak",
      body: { payload: "A team member will continue." },
    },
    mode: "fallback",
  });
});

test("Telnyx webhook signatures reject stale and tampered payloads", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const rawBody = JSON.stringify(createWebhook());
  const timestamp = "1787443200";
  const signature = sign(
    null,
    Buffer.from(`${timestamp}|${rawBody}`),
    privateKey,
  ).toString("base64");
  const publicKeyPem = publicKey
    .export({ format: "pem", type: "spki" })
    .toString();

  expect(
    verifyTelnyxWebhookSignature({
      nowSeconds: Number(timestamp),
      publicKey: publicKeyPem,
      rawBody,
      signature,
      timestamp,
    }),
  ).toBe(true);
  expect(
    verifyTelnyxWebhookSignature({
      nowSeconds: Number(timestamp) + 301,
      publicKey: publicKeyPem,
      rawBody,
      signature,
      timestamp,
    }),
  ).toBe(false);
  expect(
    verifyTelnyxWebhookSignature({
      nowSeconds: Number(timestamp),
      publicKey: publicKeyPem,
      rawBody: `${rawBody} `,
      signature,
      timestamp,
    }),
  ).toBe(false);
});

test("Telnyx webhook parsing accepts call events and only returns final speech", () => {
  const finalEvent = telnyxVoiceWebhookSchema.parse(createWebhook());
  const partialEvent = telnyxVoiceWebhookSchema.parse(
    createWebhook({ isFinal: false, transcript: "Book" }),
  );
  const blankEvent = telnyxVoiceWebhookSchema.parse(
    createWebhook({ transcript: "   " }),
  );

  expect(getTelnyxFinalTranscript(finalEvent)).toBe("Book an appointment");
  expect(getTelnyxFinalTranscript(partialEvent)).toBeNull();
  expect(getTelnyxFinalTranscript(blankEvent)).toBeNull();
});

test("Telnyx answer commands enable transcription with deterministic metadata", () => {
  expect(
    buildTelnyxAnswerBody({
      commandId: "event-1:answer",
      config: {
        apiKey: "secret",
        connectionId: "connection-1",
        greeting: "Hello",
        language: "en",
        phoneNumber: "+15550000002",
        publicKey: "public-key",
        transcriptionEngine: "Telnyx",
        transcriptionModel: "distil-whisper",
        transferDestination: "+15550000003",
        voice: "Telnyx.NaturalHD.astra",
      },
    }),
  ).toEqual({
    command_id: "event-1:answer",
    transcription: true,
    transcription_config: {
      language: "en",
      transcription_engine: "Telnyx",
      transcription_model: "distil-whisper",
    },
  });
});

test("Telnyx commands keep credentials in authorization headers", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await sendTelnyxVoiceCommand({
    action: "speak",
    body: { command_id: "command-1", payload: "Hello" },
    callControlId: "call/control",
    channel,
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return Response.json({ data: { result: "ok" } });
    },
  });

  expect(requestUrl).toBe(
    "https://api.telnyx.com/v2/calls/call%2Fcontrol/actions/speak",
  );
  expect(requestInit?.headers).toEqual({
    Authorization: "Bearer telnyx-secret",
    "Content-Type": "application/json",
  });
  expect(requestInit?.body).not.toContain("telnyx-secret");
  expect(result).toEqual({ data: { result: "ok" } });
});

test("Telnyx command failures preserve retry semantics without provider bodies", async () => {
  const error = await sendTelnyxVoiceCommand({
    action: "transfer",
    body: { command_id: "command-1", to: "+15550000003" },
    callControlId: "call-control-1",
    channel,
    fetchImpl: async () =>
      Response.json(
        { api_key: "must-not-leak", errors: [{ detail: "provider detail" }] },
        { status: 503 },
      ),
  }).catch((caught: unknown) => caught);

  expect(error).toMatchObject({
    message: "Telnyx transfer failed with status 503.",
    name: "ChannelDeliveryError",
    retryable: true,
    semanticsPreserved: true,
  } satisfies Partial<ChannelDeliveryError>);
  expect(String(error)).not.toContain("must-not-leak");
  expect(String(error)).not.toContain("provider detail");
});
