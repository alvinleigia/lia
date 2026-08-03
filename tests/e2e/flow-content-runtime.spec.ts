import { expect, test } from "@playwright/test";
import {
  getActionStepChoicePresentation,
  getActionStepOptions,
  groupActionStepOptionsBySection,
  type RuntimeActionStep,
} from "@/lib/action-runtime";
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

test("preserves list chrome and groups stable options for browser controls", () => {
  const step: RuntimeActionStep = {
    fieldKey: "selection",
    id: 43,
    inputType: "text",
    isEnabled: true,
    isRequired: true,
    label: "Selection",
    nextStepId: null,
    operationId: null,
    options: [],
    prompt: "Choose",
    settings: {
      contentDocument: buildFlowContentDocument([
        {
          displayMode: "list",
          footer: "Choose one service",
          header: "Spa services",
          id: "services",
          options: [
            {
              description: "Classic treatment",
              id: "classic",
              label: "Classic Facial",
              section: "Facials",
              value: "service_classic_facial",
            },
            {
              description: "Deep pressure",
              id: "deep",
              label: "Deep Tissue Massage",
              section: "Massages",
              value: "service_deep_tissue",
            },
            {
              description: "Another facial",
              id: "express",
              label: "Express Facial",
              section: "Facials",
              value: "service_express_facial",
            },
          ],
          text: "Pick a service",
          type: "choice",
        },
      ]),
    },
    sortOrder: 1,
    stepType: "collect_input",
  };

  expect(getActionStepChoicePresentation(step)).toEqual({
    displayMode: "list",
    footer: "Choose one service",
    header: "Spa services",
  });
  expect(groupActionStepOptionsBySection(getActionStepOptions(step))).toEqual([
    {
      options: [
        expect.objectContaining({
          id: "classic",
          label: "Classic Facial",
          value: "service_classic_facial",
        }),
        expect.objectContaining({
          id: "express",
          label: "Express Facial",
          value: "service_express_facial",
        }),
      ],
      title: "Facials",
    },
    {
      options: [
        expect.objectContaining({
          id: "deep",
          label: "Deep Tissue Massage",
          value: "service_deep_tissue",
        }),
      ],
      title: "Massages",
    },
  ]);
});
