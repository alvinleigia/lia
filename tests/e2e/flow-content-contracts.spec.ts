import { expect, test } from "@playwright/test";
import {
  buildFlowContentDocument,
  FLOW_CONTENT_SCHEMA_VERSION,
  type FlowContentBlock,
  getFlowContentBlockRole,
  getFlowContentBlocks,
  getFlowContentCompositionIssues,
  getFlowContentDocument,
  getFlowResponseCollectorBlocks,
  getFlowResponseCollectorCompatibilityIssue,
  parseFlowContentDocument,
} from "@/lib/flow-content-blocks";

const orderedBlocks: FlowContentBlock[] = [
  {
    id: "intro",
    text: "Welcome",
    type: "text",
  },
  {
    id: "answer",
    displayMode: "buttons",
    options: ["Book", "Ask a question"],
    text: "What would you like to do?",
    type: "choice",
  },
];

const presentationBlocks: FlowContentBlock[] = [
  orderedBlocks[0],
  {
    id: "hero",
    media: null,
    mediaAssetId: 12,
    text: "Treatment room",
    type: "media",
  },
  {
    catalog: null,
    catalogId: 34,
    displayMode: "multiple_products",
    id: "services",
    layout: "grid",
    productIds: [56, 78],
    products: [],
    text: "Available treatments",
    type: "catalog",
  },
];

test("builds a versioned ordered-content document", () => {
  expect(buildFlowContentDocument(orderedBlocks)).toEqual({
    blocks: orderedBlocks,
    schemaVersion: FLOW_CONTENT_SCHEMA_VERSION,
  });
});

test("preserves content order and stable ids through a JSON round trip", () => {
  const storedDocument = JSON.parse(
    JSON.stringify(buildFlowContentDocument(orderedBlocks)),
  ) as unknown;

  expect(parseFlowContentDocument(storedDocument)?.blocks).toEqual(
    orderedBlocks,
  );
  expect(
    parseFlowContentDocument(storedDocument)?.blocks.map((block) => block.id),
  ).toEqual(["intro", "answer"]);
});

test("reads legacy content arrays as a version 1 document", () => {
  expect(getFlowContentDocument({ contentBlocks: orderedBlocks })).toEqual({
    blocks: orderedBlocks,
    schemaVersion: FLOW_CONTENT_SCHEMA_VERSION,
  });
});

test("prefers the versioned document when legacy content is also present", () => {
  expect(
    getFlowContentBlocks({
      contentBlocks: [...orderedBlocks].reverse(),
      contentDocument: buildFlowContentDocument(orderedBlocks),
    }).map((block) => block.id),
  ).toEqual(["intro", "answer"]);
});

test("does not treat an unsupported document version as legacy content", () => {
  const settings = {
    contentBlocks: orderedBlocks,
    contentDocument: {
      blocks: [...orderedBlocks].reverse(),
      schemaVersion: 2,
    },
  };

  expect(parseFlowContentDocument(settings.contentDocument)).toBeNull();
  expect(getFlowContentDocument(settings)).toBeNull();
  expect(getFlowContentBlocks(settings)).toEqual([]);
});

test("does not fall back when an explicitly stored document is malformed", () => {
  expect(
    getFlowContentBlocks({
      contentBlocks: orderedBlocks,
      contentDocument: { blocks: orderedBlocks },
    }),
  ).toEqual([]);
});

test("classifies text, media, and catalog as compatible presentations", () => {
  expect(presentationBlocks.map(getFlowContentBlockRole)).toEqual([
    "presentation",
    "presentation",
    "presentation",
  ]);
});

test("allows several presentations with one response collector", () => {
  const blocks = [...presentationBlocks, orderedBlocks[1]];

  expect(getFlowContentCompositionIssues(blocks)).toEqual([]);
  expect(
    getFlowResponseCollectorBlocks(blocks).map((block) => block.id),
  ).toEqual(["answer"]);
});

test("rejects a second response collector", () => {
  const collector = orderedBlocks[1];
  const issues = getFlowContentCompositionIssues([
    ...presentationBlocks,
    collector,
    { ...collector, id: "answer-again" },
  ]);

  expect(issues).toEqual([
    {
      code: "multiple_response_collectors",
      message: "A step can contain one response collector.",
    },
  ]);
});

test("rejects collectors on presentation-only and dynamic-choice steps", () => {
  expect(
    getFlowResponseCollectorCompatibilityIssue({
      hasDynamicOptions: false,
      hasManualOptions: false,
      hasStoredResponseCollector: false,
      isInputStep: false,
    }),
  ).toContain("collect a visitor answer");
  expect(
    getFlowResponseCollectorCompatibilityIssue({
      hasDynamicOptions: true,
      hasManualOptions: false,
      hasStoredResponseCollector: false,
      isInputStep: true,
    }),
  ).toContain("dynamic choice source");
});

test("rejects a collector beside manual choices but permits editing a stored collector", () => {
  expect(
    getFlowResponseCollectorCompatibilityIssue({
      hasDynamicOptions: false,
      hasManualOptions: true,
      hasStoredResponseCollector: false,
      isInputStep: true,
    }),
  ).toContain("configured choices");
  expect(
    getFlowResponseCollectorCompatibilityIssue({
      hasDynamicOptions: false,
      hasManualOptions: true,
      hasStoredResponseCollector: true,
      isInputStep: true,
    }),
  ).toBeNull();
});
