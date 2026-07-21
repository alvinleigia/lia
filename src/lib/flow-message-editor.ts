import type { FlowContentBlock } from "@/lib/flow-content-blocks";

export const FLOW_MESSAGE_FAMILIES = [
  "text",
  "buttons",
  "list",
  "typed_choice",
  "media",
  "catalog",
  "single_product",
  "multiple_products",
] as const;

export type FlowMessageFamily = (typeof FLOW_MESSAGE_FAMILIES)[number];

export type FlowMessageFamilyDefinition = {
  description: string;
  messageLabel: string;
  messagePlaceholder: string;
  textLimit: number;
  title: string;
};

export const FLOW_MESSAGE_FAMILY_DEFINITIONS = {
  buttons: {
    description: "Offer quick reply buttons and save the visitor's choice.",
    messageLabel: "Question or introduction",
    messagePlaceholder: "What would you like to do?",
    textLimit: 1000,
    title: "Text + buttons",
  },
  catalog: {
    description: "Let visitors browse a complete product catalog.",
    messageLabel: "Introduction",
    messagePlaceholder: "Browse our products.",
    textLimit: 1000,
    title: "Catalogue message",
  },
  list: {
    description: "Show a structured list and save the visitor's choice.",
    messageLabel: "Question or introduction",
    messagePlaceholder: "Choose an option from the list.",
    textLimit: 1000,
    title: "List message",
  },
  media: {
    description: "Send an image, video, audio clip, or file.",
    messageLabel: "Caption",
    messagePlaceholder: "Add an optional caption.",
    textLimit: 1000,
    title: "Media",
  },
  multiple_products: {
    description: "Show a selected group of products from one catalog.",
    messageLabel: "Introduction",
    messagePlaceholder: "Here are some products you may like.",
    textLimit: 1000,
    title: "Multiple products",
  },
  single_product: {
    description: "Feature one selected product from a catalog.",
    messageLabel: "Introduction",
    messagePlaceholder: "Take a look at this product.",
    textLimit: 1000,
    title: "Single product",
  },
  text: {
    description: "Send a plain visitor-facing message.",
    messageLabel: "Message",
    messagePlaceholder: "Write the message visitors will receive.",
    textLimit: 2000,
    title: "Text message",
  },
  typed_choice: {
    description:
      "Ask for a typed answer and validate it against known options.",
    messageLabel: "Question or introduction",
    messagePlaceholder: "Type one of the available options.",
    textLimit: 1000,
    title: "Typed choices",
  },
} satisfies Record<FlowMessageFamily, FlowMessageFamilyDefinition>;

export const MAX_FLOW_MESSAGE_OPTIONS = 20;

export function getFlowMessageFamily(
  block: FlowContentBlock,
): FlowMessageFamily {
  if (block.type === "choice") {
    if (block.displayMode === "list") {
      return "list";
    }

    return block.displayMode === "text" ? "typed_choice" : "buttons";
  }

  if (block.type === "catalog") {
    if (block.displayMode === "single_product") {
      return "single_product";
    }

    return block.displayMode === "multiple_products"
      ? "multiple_products"
      : "catalog";
  }

  return block.type;
}

export function getFlowMessageFamilyDefinition(block: FlowContentBlock) {
  return FLOW_MESSAGE_FAMILY_DEFINITIONS[getFlowMessageFamily(block)];
}
