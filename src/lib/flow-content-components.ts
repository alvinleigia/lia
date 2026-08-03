import type { ActionStepType } from "@/lib/action-flow-constants";
import {
  type FlowContentBlockType,
  MAX_FLOW_CONTENT_BLOCKS,
} from "@/lib/flow-content-blocks";

export const FLOW_CONTENT_COMPONENT_KEYS = [
  "text",
  "choice_buttons",
  "list",
  "media",
  "catalog",
  "single_product",
  "multiple_products",
  "template",
  "handoff",
] as const;

export type FlowContentComponentKey =
  (typeof FLOW_CONTENT_COMPONENT_KEYS)[number];
export type FlowContentComponentGroup = "action" | "message";
export type FlowContentComponentTarget = "content_block" | "step";
export type FlowContentRequirement =
  | "answer_collection"
  | "catalog_product"
  | "media_asset"
  | "product_catalog"
  | "single_response_collector";

export type FlowContentComponentDefinition = {
  blockType: FlowContentBlockType | null;
  defaultChoiceDisplayMode?: "buttons" | "list";
  defaultProductDisplayMode?:
    | "catalog"
    | "multiple_products"
    | "single_product";
  description: string;
  group: FlowContentComponentGroup;
  key: FlowContentComponentKey;
  label: string;
  requirements: readonly FlowContentRequirement[];
  stepType?: ActionStepType;
  target: FlowContentComponentTarget;
};

export type FlowContentEligibilityContext = {
  allowsAnswerCollection: boolean;
  blockCount: number;
  catalogProductCount: number;
  hasResponseCollector: boolean;
  mediaAssetCount: number;
  productCatalogCount: number;
};

export type FlowContentMenuItem = {
  component: FlowContentComponentDefinition;
  disabledReason: string | null;
  enabled: boolean;
};

export const FLOW_CONTENT_COMPONENTS = [
  {
    blockType: "text",
    description: "Add another text message to this step.",
    group: "message",
    key: "text",
    label: "Text message",
    requirements: [],
    target: "content_block",
  },
  {
    blockType: "choice",
    defaultChoiceDisplayMode: "buttons",
    description: "Let the visitor select a quick reply button.",
    group: "message",
    key: "choice_buttons",
    label: "Text + buttons",
    requirements: ["single_response_collector", "answer_collection"],
    target: "content_block",
  },
  {
    blockType: "choice",
    defaultChoiceDisplayMode: "list",
    description: "Let the visitor choose from a structured list.",
    group: "message",
    key: "list",
    label: "List message",
    requirements: ["single_response_collector", "answer_collection"],
    target: "content_block",
  },
  {
    blockType: "media",
    description: "Add an image, video, audio clip, or file.",
    group: "message",
    key: "media",
    label: "Media",
    requirements: ["media_asset"],
    target: "content_block",
  },
  {
    blockType: "catalog",
    defaultProductDisplayMode: "catalog",
    description: "Show all active products from a catalog.",
    group: "message",
    key: "catalog",
    label: "Catalogue message",
    requirements: ["product_catalog"],
    target: "content_block",
  },
  {
    blockType: "catalog",
    defaultProductDisplayMode: "single_product",
    description: "Highlight one active catalog product.",
    group: "message",
    key: "single_product",
    label: "Single product",
    requirements: ["catalog_product"],
    target: "content_block",
  },
  {
    blockType: "catalog",
    defaultProductDisplayMode: "multiple_products",
    description: "Show a selected group of active products.",
    group: "message",
    key: "multiple_products",
    label: "Multiple products",
    requirements: ["catalog_product"],
    target: "content_block",
  },
  {
    blockType: null,
    description: "Send an approved provider template.",
    group: "message",
    key: "template",
    label: "Template",
    requirements: [],
    stepType: "template_message",
    target: "step",
  },
  {
    blockType: null,
    description: "Send the conversation to a person or review queue.",
    group: "action",
    key: "handoff",
    label: "Request intervention",
    requirements: [],
    stepType: "handoff",
    target: "step",
  },
] as const satisfies readonly FlowContentComponentDefinition[];

export function getFlowContentComponent(key: FlowContentComponentKey) {
  return (
    FLOW_CONTENT_COMPONENTS.find((component) => component.key === key) ?? null
  );
}

function getStandaloneStepReason(component: FlowContentComponentDefinition) {
  return `${component.label} is a standalone ${component.group} block. Add it from the Blocks panel.`;
}

function getRequirementReason(
  requirement: FlowContentRequirement,
  context: FlowContentEligibilityContext,
) {
  switch (requirement) {
    case "answer_collection":
      return context.allowsAnswerCollection
        ? null
        : "Available on steps that collect a compatible visitor answer.";
    case "single_response_collector":
      return context.hasResponseCollector
        ? "This step already has a response collector (buttons or list)."
        : null;
    case "media_asset":
      return context.mediaAssetCount > 0
        ? null
        : "Upload an active asset in the Media Library first.";
    case "product_catalog":
      return context.productCatalogCount > 0
        ? null
        : "Create an active product catalog first.";
    case "catalog_product":
      if (context.catalogProductCount > 0) {
        return null;
      }

      return context.productCatalogCount > 0
        ? "Add an active product to a catalog first."
        : "Create a product catalog and add an active product first.";
  }
}

export function resolveFlowContentMenu(
  context: FlowContentEligibilityContext,
): FlowContentMenuItem[] {
  return FLOW_CONTENT_COMPONENTS.map((component) => {
    let disabledReason: string | null = null;

    if (context.blockCount >= MAX_FLOW_CONTENT_BLOCKS) {
      disabledReason = `This step already has the maximum of ${MAX_FLOW_CONTENT_BLOCKS} content blocks.`;
    } else if (component.target === "step") {
      disabledReason = getStandaloneStepReason(component);
    } else {
      for (const requirement of component.requirements) {
        disabledReason = getRequirementReason(requirement, context);
        if (disabledReason) {
          break;
        }
      }
    }

    return {
      component,
      disabledReason,
      enabled: disabledReason === null,
    };
  });
}
