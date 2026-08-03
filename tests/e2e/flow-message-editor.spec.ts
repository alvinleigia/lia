import { expect, test } from "@playwright/test";
import type { FlowContentBlock } from "../../src/lib/flow-content-blocks";
import {
  FLOW_MESSAGE_FAMILY_DEFINITIONS,
  getFlowMessageFamily,
  getFlowMessageFamilyDefinition,
} from "../../src/lib/flow-message-editor";

const options = [
  {
    description: "",
    id: "sales",
    label: "Sales",
    section: "",
    value: "sales",
  },
  {
    description: "",
    id: "support",
    label: "Support",
    section: "",
    value: "support",
  },
];

const blocks: FlowContentBlock[] = [
  { id: "text", text: "Hello", type: "text" },
  {
    displayMode: "buttons",
    footer: "",
    header: "",
    id: "buttons",
    options,
    text: "Choose one",
    type: "choice",
  },
  {
    displayMode: "list",
    footer: "",
    header: "",
    id: "list",
    options,
    text: "Choose one",
    type: "choice",
  },
  {
    displayMode: "text",
    footer: "",
    header: "",
    id: "typed",
    options,
    text: "Choose one",
    type: "choice",
  },
  { id: "media", media: null, mediaAssetId: 1, text: "", type: "media" },
  {
    catalog: null,
    catalogId: 1,
    displayMode: "catalog",
    id: "catalog",
    layout: "grid",
    productIds: [],
    products: [],
    text: "Browse",
    type: "catalog",
  },
  {
    catalog: null,
    catalogId: 1,
    displayMode: "single_product",
    id: "single",
    layout: "featured",
    productIds: [1],
    products: [],
    text: "Featured",
    type: "catalog",
  },
  {
    catalog: null,
    catalogId: 1,
    displayMode: "multiple_products",
    id: "multiple",
    layout: "grid",
    productIds: [1, 2],
    products: [],
    text: "Selected",
    type: "catalog",
  },
];

test("every persisted message block maps to a friendly editor family", () => {
  expect(blocks.map(getFlowMessageFamily)).toEqual([
    "text",
    "buttons",
    "list",
    "typed_choice",
    "media",
    "catalog",
    "single_product",
    "multiple_products",
  ]);
});

test("friendly definitions use visitor-facing labels and bounded message copy", () => {
  for (const block of blocks) {
    const definition = getFlowMessageFamilyDefinition(block);
    expect(definition.title).not.toContain("ID");
    expect(definition.messageLabel.length).toBeGreaterThan(0);
    expect(definition.messagePlaceholder.length).toBeGreaterThan(0);
    expect(definition.textLimit).toBeGreaterThan(0);
  }

  expect(FLOW_MESSAGE_FAMILY_DEFINITIONS.text.textLimit).toBe(2000);
  expect(FLOW_MESSAGE_FAMILY_DEFINITIONS.buttons.title).toBe("Text + buttons");
});
