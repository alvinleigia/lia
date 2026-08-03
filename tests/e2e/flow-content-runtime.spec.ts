import { expect, test } from "@playwright/test";
import type { RuntimeActionStep } from "@/lib/action-runtime";
import { buildRuntimeRepliesForStep } from "@/lib/channel-flow-runtime";
import { buildFlowContentDocument } from "@/lib/flow-content-blocks";

test("emits composed content in stored array order", () => {
  const step: RuntimeActionStep = {
    fieldKey: "selection",
    id: 42,
    inputType: "text",
    isEnabled: true,
    isRequired: true,
    label: "Selection",
    nextStepId: null,
    operationId: null,
    options: [],
    prompt: "First message",
    settings: {
      contentDocument: buildFlowContentDocument([
        {
          id: "hero",
          media: {
            id: 12,
            mediaType: "image",
            mimeType: "image/png",
            originalName: "hero.png",
            publicPath: "https://example.test/hero.png",
          },
          mediaAssetId: 12,
          text: "Second: image",
          type: "media",
        },
        { id: "details", text: "Third: details", type: "text" },
        {
          catalog: { id: 34, name: "Services" },
          catalogId: 34,
          displayMode: "single_product",
          id: "service",
          layout: "featured",
          productIds: [56],
          products: [
            {
              currency: "USD",
              description: "A service",
              id: 56,
              imageUrl: null,
              name: "Massage",
              priceAmount: 9000,
              productUrl: null,
              sku: "massage",
              whatsappRetailerId: null,
            },
          ],
          text: "Fourth: product",
          type: "catalog",
        },
        {
          displayMode: "list",
          footer: "Choose one",
          header: "Next step",
          id: "answer",
          options: [
            {
              description: "Continue with booking",
              id: "book",
              label: "Book",
              section: "Actions",
              value: "book_service",
            },
          ],
          text: "Fifth: choose",
          type: "choice",
        },
      ]),
    },
    sortOrder: 1,
    stepType: "collect_input",
  };

  const replies = buildRuntimeRepliesForStep(step, {});

  expect(replies.map((reply) => reply.type)).toEqual([
    "text",
    "media",
    "text",
    "catalog",
    "list",
  ]);
  expect(replies.map((reply) => reply.text)).toEqual([
    "First message",
    "Second: image",
    "Third: details",
    "Fourth: product",
    "Fifth: choose",
  ]);
  expect(replies[4]?.payload).toMatchObject({
    footer: "Choose one",
    header: "Next step",
    options: [
      {
        id: "book",
        label: "Book",
        section: "Actions",
        value: "book_service",
      },
    ],
  });
});
