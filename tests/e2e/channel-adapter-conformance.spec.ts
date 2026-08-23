import { expect, test } from "@playwright/test";
import {
  CHANNEL_REPLY_CAPABILITIES,
  ChannelDeliveryError,
  type ChannelReplyAdapter,
  getRuntimeReplyCapability,
} from "../../src/lib/channel-adapter-contract";
import { createReferenceChannelAdapter } from "../../src/lib/reference-channel-adapter";
import {
  createChoiceReply,
  createHandoffReply,
  createMediaReply,
  createProductReply,
  createTemplateReply,
  createTextReply,
  type RuntimeReplyV1,
} from "../../src/lib/runtime-replies";

type ConformanceDelivery = {
  correlationId: string;
  fallbackText: string;
  schemaVersion: number;
  text: string;
};

function createConformanceReplies(): RuntimeReplyV1[] {
  const product = {
    currency: "USD",
    description: "Conformance product",
    id: 901,
    imageUrl: null,
    name: "Conformance Product",
    priceAmount: 2500,
    productUrl: null,
    sku: null,
    whatsappRetailerId: "conformance-product",
  };
  const catalog = {
    externalId: "conformance-catalog",
    id: 902,
    name: "Conformance Catalog",
  };

  return [
    createTextReply("Text reply"),
    createChoiceReply({
      displayMode: "buttons",
      options: [{ id: "one", label: "One", value: "one" }],
      text: "Button reply",
    }),
    createChoiceReply({
      displayMode: "list",
      options: [{ id: "one", label: "One", value: "one" }],
      text: "List reply",
    }),
    createMediaReply({
      media: {
        id: 903,
        mediaType: "image",
        mimeType: "image/png",
        originalName: "conformance.png",
        publicPath: "https://cdn.example.test/conformance.png",
      },
      text: "Media reply",
    }),
    createTemplateReply({
      template: {
        body: "Hello {{1}}",
        language: "en",
        name: "conformance_template",
        status: "approved",
        variables: ["Customer"],
      },
      text: "Template reply",
    }),
    createProductReply({
      catalog,
      mode: "catalog",
      products: [product],
      text: "Catalog reply",
    }),
    createProductReply({
      catalog,
      mode: "single_product",
      products: [product],
      text: "Single product reply",
    }),
    createProductReply({
      catalog,
      mode: "multiple_products",
      products: [product],
      text: "Multiple products reply",
    }),
    createHandoffReply("Handoff reply"),
  ];
}

async function expectChannelAdapterConformance<TDelivery>(input: {
  adapter: ChannelReplyAdapter<{ correlationId: string }, TDelivery, string>;
  readDelivery: (delivery: TDelivery) => ConformanceDelivery;
}) {
  const { adapter, readDelivery } = input;
  const profile = adapter.profile;
  const replies = createConformanceReplies();

  expect(profile.channelType.trim()).not.toBe("");
  expect(Object.keys(profile.replies).sort()).toEqual(
    [...CHANNEL_REPLY_CAPABILITIES].sort(),
  );
  expect(
    Object.values(profile.inbound).every((value) => typeof value === "boolean"),
  ).toBe(true);

  for (const limit of Object.values(profile.limits)) {
    expect(limit === null || (Number.isSafeInteger(limit) && limit >= 0)).toBe(
      true,
    );
  }

  for (const [index, reply] of replies.entries()) {
    const before = structuredClone(reply);
    const correlationId = `conformance-${index + 1}`;
    const adapted = await adapter.adaptReply({
      context: { correlationId },
      reply,
    });
    const capability = getRuntimeReplyCapability(reply);
    const support = profile.replies[capability];
    const allowedModes =
      support === "conditional"
        ? ["native", "fallback"]
        : support === "native"
          ? ["native"]
          : ["fallback"];
    const delivery = readDelivery(adapted.delivery);

    expect(reply).toEqual(before);
    expect(adapted.capability).toBe(capability);
    expect(adapted.source).toEqual(reply);
    expect(allowedModes).toContain(adapted.mode);
    expect(adapted.warnings.every((warning) => warning.trim().length > 0)).toBe(
      true,
    );
    expect(delivery).toEqual({
      correlationId,
      fallbackText: reply.fallbackText,
      schemaVersion: 1,
      text: reply.text,
    });
  }
}

test("reference implementation passes the third-party channel adapter contract", async () => {
  await expectChannelAdapterConformance({
    adapter: createReferenceChannelAdapter(),
    readDelivery: (delivery) => ({
      correlationId: delivery.correlationId,
      fallbackText: delivery.fallbackText,
      schemaVersion: delivery.schemaVersion,
      text: delivery.text,
    }),
  });
});

test("a custom adapter can declare readable fallback support without a Lia channel type", async () => {
  const replies = Object.fromEntries(
    CHANNEL_REPLY_CAPABILITIES.map((capability) => [
      capability,
      capability === "text" ? "native" : "fallback",
    ]),
  ) as Record<
    (typeof CHANNEL_REPLY_CAPABILITIES)[number],
    "fallback" | "native"
  >;
  const profile = {
    channelType: "third_party_test" as const,
    inbound: {
      interactiveSelection: false,
      location: false,
      media: false,
      productSelection: false,
      text: true,
    },
    limits: { buttonOptions: null, listOptions: null, productItems: null },
    replies,
  };
  const adapter = {
    profile,
    adaptReply({ context, reply }) {
      const capability = getRuntimeReplyCapability(reply);
      const mode =
        profile.replies[capability] === "native" ? "native" : "fallback";

      return {
        capability,
        delivery: {
          correlationId: context.correlationId,
          fallbackText: reply.fallbackText,
          schemaVersion: 1,
          text: reply.text,
        },
        mode,
        source: reply,
        warnings:
          mode === "fallback"
            ? [`${capability} uses the readable fallback.`]
            : [],
      } as const;
    },
  } satisfies ChannelReplyAdapter<
    { correlationId: string },
    ConformanceDelivery,
    "third_party_test"
  >;

  await expectChannelAdapterConformance({
    adapter,
    readDelivery: (delivery) => delivery,
  });
});

test("third-party delivery failures preserve runtime semantics", async () => {
  const adapter = createReferenceChannelAdapter();
  const failingAdapter = {
    ...adapter,
    adaptReply(_input: Parameters<typeof adapter.adaptReply>[0]) {
      throw new ChannelDeliveryError("Provider temporarily unavailable", true);
    },
  } satisfies typeof adapter;

  await expect(
    Promise.resolve().then(() =>
      failingAdapter.adaptReply({
        context: { correlationId: "failed-delivery" },
        reply: createTextReply("Try again later"),
      }),
    ),
  ).rejects.toMatchObject({
    name: "ChannelDeliveryError",
    retryable: true,
    semanticsPreserved: true,
  });
});
