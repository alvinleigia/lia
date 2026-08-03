import { expect, test } from "@playwright/test";
import { getActionOptionHref } from "@/lib/action-option-routing";
import {
  buildActionReviewSummary,
  buildStepAnswerResult,
  getActionStepChoicePresentation,
  getActionStepOptions,
  groupActionStepOptionsBySection,
  type RuntimeActionStep,
  validateStepAnswer,
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
          outputPort: "option:classic",
          value: "service_classic_facial",
        }),
        expect.objectContaining({
          id: "express",
          label: "Express Facial",
          outputPort: "option:express",
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
          outputPort: "option:deep",
          value: "service_deep_tissue",
        }),
      ],
      title: "Massages",
    },
  ]);

  const answer = buildStepAnswerResult(
    step,
    "phase9Service",
    "service_deep_tissue",
  );

  expect(answer).toEqual({
    fields: {
      phase9Service: "service_deep_tissue",
      phase9ServiceName: "Deep Tissue Massage",
    },
    label: "Deep Tissue Massage",
  });
  expect(buildActionReviewSummary(answer.fields)).toBe(
    "- phase9Service: Deep Tissue Massage",
  );
});

test("assigns output ports to legacy, dynamic, and product options", () => {
  const baseStep: RuntimeActionStep = {
    fieldKey: "selection",
    id: 44,
    inputType: "text",
    isEnabled: true,
    isRequired: true,
    label: "Selection",
    nextStepId: null,
    operationId: null,
    options: [],
    prompt: "Choose",
    settings: {},
    sortOrder: 1,
    stepType: "choice",
  };
  const legacyOptions = getActionStepOptions({
    ...baseStep,
    options: [
      { id: "yes", label: "Yes", value: "accepted" },
      { label: "No", value: "declined" },
    ],
  });

  expect(legacyOptions).toEqual([
    expect.objectContaining({ id: "yes", outputPort: "option:yes" }),
    expect.objectContaining({
      id: "legacy-option-2",
      outputPort: "option:legacy-option-2",
    }),
  ]);

  const dynamicOptions = getActionStepOptions({
    ...baseStep,
    options: [],
    settings: {
      sourceConfig: { catalogId: "cat_spa_services" },
      sourceType: "catalog_categories",
    },
  });
  expect(dynamicOptions.length).toBeGreaterThan(0);
  expect(
    dynamicOptions.every(
      (option) => option.outputPort === `option:${option.id}`,
    ),
  ).toBe(true);

  const productOptions = getActionStepOptions({
    ...baseStep,
    settings: {
      products: [
        {
          currency: "INR",
          description: "Deep pressure massage",
          id: 91,
          imageUrl: null,
          name: "Deep Tissue Massage",
          priceAmount: 9500,
          productUrl: null,
          sku: "DEEP",
        },
      ],
    },
    stepType: "product_selection",
  });
  expect(productOptions).toEqual([
    expect.objectContaining({
      id: "product-91",
      outputPort: "option:product-91",
      value: "91",
    }),
  ]);
});

test("preserves website and phone buttons without accepting them as replies", () => {
  const step: RuntimeActionStep = {
    fieldKey: "nextAction",
    id: 45,
    inputType: "text",
    isEnabled: true,
    isRequired: true,
    label: "Next action",
    nextStepId: null,
    operationId: null,
    options: [],
    prompt: "Choose",
    settings: {
      contentDocument: buildFlowContentDocument([
        {
          displayMode: "buttons",
          footer: "",
          header: "",
          id: "actions",
          options: [
            {
              actionType: "reply",
              description: "",
              id: "book",
              label: "Book",
              section: "",
              value: "book",
            },
            {
              actionType: "url",
              actionValue: "https://example.com/services",
              description: "",
              id: "website",
              label: "Website",
              section: "",
              value: "website",
            },
            {
              actionType: "phone",
              actionValue: "+91 98765 43210",
              description: "",
              id: "call",
              label: "Call",
              section: "",
              value: "call",
            },
          ],
          text: "Choose",
          type: "choice",
        },
      ]),
    },
    sortOrder: 1,
    stepType: "choice",
  };
  const options = getActionStepOptions(step);
  const replies = buildRuntimeRepliesForStep(step, {});

  expect(options.map((option) => getActionOptionHref(option))).toEqual([
    null,
    "https://example.com/services",
    "tel:+919876543210",
  ]);
  expect(validateStepAnswer(step, "Book")).toMatchObject({ isValid: true });
  expect(validateStepAnswer(step, "Website")).toMatchObject({
    isValid: false,
  });
  expect(replies.at(-1)?.payload?.options).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        actionType: "url",
        actionValue: "https://example.com/services",
      }),
      expect.objectContaining({
        actionType: "phone",
        actionValue: "+91 98765 43210",
      }),
    ]),
  );
  expect(replies.at(-1)?.fallbackText).toContain(
    "https://example.com/services",
  );
  expect(replies.at(-1)?.fallbackText).toContain("tel:+919876543210");
});

test("boolean input exposes stable Yes and No outputs", () => {
  const step: RuntimeActionStep = {
    fieldKey: "acceptedTerms",
    id: 46,
    inputType: "text",
    isEnabled: true,
    isRequired: true,
    label: "Accepted terms",
    nextStepId: null,
    operationId: null,
    options: [],
    prompt: "Do you accept?",
    settings: {},
    sortOrder: 1,
    stepType: "boolean",
  };

  expect(getActionStepOptions(step)).toEqual([
    expect.objectContaining({
      id: "boolean-true",
      label: "Yes",
      outputPort: "option:boolean-true",
      value: true,
    }),
    expect.objectContaining({
      id: "boolean-false",
      label: "No",
      outputPort: "option:boolean-false",
      value: false,
    }),
  ]);
  expect(validateStepAnswer(step, "Yes")).toEqual({
    isValid: true,
    value: true,
  });
  expect(validateStepAnswer(step, "No")).toEqual({
    isValid: true,
    value: false,
  });
  expect(validateStepAnswer(step, "Maybe")).toEqual({
    isValid: false,
    value: "Maybe",
  });
});
