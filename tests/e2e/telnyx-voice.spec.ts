import { expect, test } from "@playwright/test";
import { getChannelAdapterProfile } from "../../src/lib/channel-adapter-contract";
import { normalizeChannelInboundV1 } from "../../src/lib/channel-inbound-contract";
import {
  createChoiceReply,
  createHandoffReply,
  createTextReply,
} from "../../src/lib/runtime-replies";
import { createTelnyxVoiceChannelAdapter } from "../../src/lib/telnyx-voice";

const context = {
  callControlId: "call-control-1",
  callSessionId: "call-session-1",
  commandId: "command-1",
  correlationId: "event-1",
  transferDestination: "+15551234567",
  voice: "Telnyx.NaturalHD.astra",
};

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
