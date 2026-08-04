import { expect, test } from "@playwright/test";
import { createBrowserChannelAdapter } from "../../src/lib/browser-channel-adapter";
import type { ChannelDeliveryError } from "../../src/lib/channel-adapter-contract";
import {
  buildInboundCertificationMatrix,
  buildTaskReplyCertificationMatrix,
  CERTIFICATION_CHANNELS,
} from "../../src/lib/channel-certification";
import {
  getNormalizedChannelInboundRuntimeValue,
  normalizeChannelInboundV1,
} from "../../src/lib/channel-inbound-contract";
import {
  createTaskRuntimeReply,
  normalizeRuntimeReply,
  RUNTIME_REPLY_INTENTS,
  RUNTIME_REPLY_SCHEMA_VERSION,
} from "../../src/lib/runtime-replies";
import { createWhatsAppChannelAdapter } from "../../src/lib/whatsapp";

test("task replies use one versioned channel-neutral contract", () => {
  const question = createTaskRuntimeReply({
    inputRequest: {
      fieldKey: "guestEmail",
      inputKind: "email",
      label: "Guest Email",
      options: [],
      required: true,
    },
    nextAction: "ask",
    text: "What is your email?",
  });
  const choices = createTaskRuntimeReply({
    inputRequest: {
      fieldKey: "service",
      inputKind: "choice",
      label: "Service",
      options: [
        { label: "Classic Facial", value: "product:71" },
        { label: "Deep Tissue Massage", value: "product:72" },
      ],
      required: true,
    },
    nextAction: "ask",
    text: "Choose a service.",
  });
  const confirmation = createTaskRuntimeReply({
    nextAction: "confirm",
    text: "Confirm this booking?",
  });
  const media = createTaskRuntimeReply({
    inputRequest: {
      fieldKey: "referencePhoto",
      inputKind: "media",
      label: "Reference Photo",
      options: [],
      required: true,
    },
    nextAction: "ask",
    text: "Upload a reference photo.",
  });
  const handoff = createTaskRuntimeReply({
    nextAction: "handoff",
    text: "A team member will continue.",
  });
  const outcome = createTaskRuntimeReply({
    nextAction: "complete",
    text: "Booking completed.",
  });

  expect(
    [question, choices, confirmation, media, handoff, outcome].every(
      (reply) => reply.schemaVersion === RUNTIME_REPLY_SCHEMA_VERSION,
    ),
  ).toBe(true);
  expect(question.intent).toBe("question");
  expect(choices).toMatchObject({
    intent: "choices",
    payload: {
      options: expect.arrayContaining([
        expect.objectContaining({
          id: "task-field:service:product:71",
          label: "Classic Facial",
          value: "product:71",
        }),
      ]),
    },
  });
  expect(confirmation).toMatchObject({
    intent: "confirmation",
    type: "buttons",
  });
  expect(media.intent).toBe("media");
  expect(handoff).toMatchObject({ intent: "handoff", type: "handoff" });
  expect(outcome.intent).toBe("outcome");

  const browserChoice = createBrowserChannelAdapter("project_chat").adaptReply({
    context: { messageId: "task-choice" },
    reply: choices,
  });
  expect(browserChoice.delivery.inputRequest).toMatchObject({
    fieldKey: "service",
    inputKind: "choice",
    options: expect.arrayContaining([
      { label: "Classic Facial", value: "product:71" },
    ]),
  });
});

test("legacy stored replies normalize to version one without changing text", () => {
  expect(
    normalizeRuntimeReply({
      fallbackText: "Choose one\n\n1. Alpha",
      payload: { options: [{ id: "alpha", label: "Alpha", value: "a" }] },
      text: "Choose one",
      type: "buttons",
    }),
  ).toMatchObject({
    fallbackText: "Choose one\n\n1. Alpha",
    intent: "choices",
    schemaVersion: 1,
    text: "Choose one",
    type: "buttons",
  });
});

test("inbound text and interactive replies share one stable contract", () => {
  const text = normalizeChannelInboundV1({
    channelType: "widget",
    text: "Tomorrow afternoon",
  });
  const selection = normalizeChannelInboundV1({
    channelType: "whatsapp",
    selection: {
      id: "task-field:service:product:71",
      label: "Classic Facial",
      value: "product:71",
    },
    text: "Classic Facial",
  });
  const products = normalizeChannelInboundV1({
    channelType: "whatsapp",
    products: [{ quantity: 2, retailerId: "UAT-FACIAL" }],
  });

  expect(text).toMatchObject({ kind: "text", schemaVersion: 1 });
  expect(selection).toMatchObject({
    kind: "selection",
    selection: {
      label: "Classic Facial",
      resourceId: 71,
      resourceType: "product",
      value: "product:71",
    },
  });
  expect(getNormalizedChannelInboundRuntimeValue(selection)).toBe("product:71");
  expect(getNormalizedChannelInboundRuntimeValue(products)).toBe(
    "UAT-FACIAL x 2",
  );
});

test("certification covers every task reply intent and inbound kind", () => {
  const replies = buildTaskReplyCertificationMatrix();
  const inbound = buildInboundCertificationMatrix();

  expect(replies).toHaveLength(
    RUNTIME_REPLY_INTENTS.length * CERTIFICATION_CHANNELS.length,
  );
  expect(
    RUNTIME_REPLY_INTENTS.every(
      (intent) =>
        replies.filter((cell) => cell.intent === intent).length ===
        CERTIFICATION_CHANNELS.length,
    ),
  ).toBe(true);
  expect(inbound).toHaveLength(5 * CERTIFICATION_CHANNELS.length);
  expect(inbound.every((cell) => cell.normalized)).toBe(true);
});

test("adapter delivery failure preserves runtime semantics", async () => {
  const adapter = createWhatsAppChannelAdapter();

  await expect(
    adapter.adaptReply({
      context: { serviceWindowOpen: false, to: "15551234567" },
      reply: createTaskRuntimeReply({
        nextAction: "ask",
        text: "What date works for you?",
      }),
    }),
  ).rejects.toMatchObject({
    name: "ChannelDeliveryError",
    retryable: false,
    semanticsPreserved: true,
  } satisfies Partial<ChannelDeliveryError>);
});

test("channel adapters select a readable fallback for task media requests", async () => {
  const reply = createTaskRuntimeReply({
    inputRequest: {
      fieldKey: "referencePhoto",
      inputKind: "media",
      label: "Reference Photo",
      options: [],
      required: true,
    },
    nextAction: "ask",
    text: "Upload a reference photo.",
  });
  const browser = createBrowserChannelAdapter("widget").adaptReply({
    context: { messageId: "media-request" },
    reply,
  });
  const whatsapp = await createWhatsAppChannelAdapter().adaptReply({
    context: { serviceWindowOpen: true, to: "15551234567" },
    reply,
  });

  expect(browser).toMatchObject({ capability: "media", mode: "fallback" });
  expect(whatsapp).toMatchObject({ capability: "media", mode: "fallback" });
  expect(whatsapp.delivery.body).toMatchObject({ type: "text" });
});
