import { expect, test } from "@playwright/test";
import {
  isProviderSecretReference,
  prepareProviderConfig,
} from "../../src/lib/provider-secrets";
import { createReferenceChannelPlugin } from "../../src/lib/reference-channel-adapter";
import { createTextReply } from "../../src/lib/runtime-replies";
import { createTelnyxVoiceChannelPlugin } from "../../src/lib/telnyx-voice";

test("a third-party channel plugin normalizes inbound data without joining Lia's channel union", () => {
  const plugin = createReferenceChannelPlugin();
  const inbound = plugin.normalizeInbound({
    selection: {
      id: "service-7",
      label: "Facial",
      value: "product:7",
    },
    text: "Facial",
  });

  expect(inbound).toEqual({
    channelType: "reference_future",
    kind: "selection",
    location: null,
    media: null,
    products: [],
    schemaVersion: 1,
    selection: {
      id: "service-7",
      label: "Facial",
      resourceId: 7,
      resourceType: "product",
      value: "product:7",
    },
    text: "Facial",
  });
});

test("one plugin contract owns inbound normalization and outbound adaptation", () => {
  const plugin = createTelnyxVoiceChannelPlugin();
  const inbound = plugin.normalizeInbound({ transcript: "  Please help  " });
  const outbound = plugin.outbound.adaptReply({
    context: {
      callControlId: "call-control-1",
      callSessionId: "call-session-1",
      commandId: "event-1:reply:1",
      correlationId: "event-1",
      voice: "Telnyx.NaturalHD.astra",
    },
    reply: createTextReply("How can I help?"),
  });

  expect(plugin.channelType).toBe("telnyx_voice");
  expect(inbound).toMatchObject({
    channelType: plugin.channelType,
    kind: "text",
    text: "Please help",
  });
  expect(outbound).toMatchObject({
    capability: "text",
    delivery: {
      callControlId: "call-control-1",
      correlationId: "event-1",
      schemaVersion: 1,
    },
    mode: "native",
  });
});

test("provider plugin credentials become encrypted server-only references", () => {
  const prepared = prepareProviderConfig({
    apiKey: "provider-api-secret",
    endpoint: "https://provider.example.test/run",
    headers: { Authorization: "Bearer provider-header-secret" },
    label: "Partner calendar",
  });
  const apiKey = prepared.config.apiKey;
  const authorization = (prepared.config.headers as Record<string, unknown>)
    .Authorization;

  expect(isProviderSecretReference(apiKey)).toBe(true);
  expect(isProviderSecretReference(authorization)).toBe(true);
  expect(prepared.config).toMatchObject({
    endpoint: "https://provider.example.test/run",
    label: "Partner calendar",
  });
  expect(prepared.secrets.map((secret) => secret.secretName)).toEqual([
    "apiKey",
    "headers.Authorization",
  ]);
  expect(JSON.stringify(prepared)).not.toContain("provider-api-secret");
  expect(JSON.stringify(prepared)).not.toContain("provider-header-secret");
});
