import {
  type ActionOptionBehavior,
  getActionOptionBehavior,
  getActionOptionHref,
} from "@/lib/action-option-routing";
import type {
  RuntimeReplyMedia,
  RuntimeReplyProduct,
} from "@/lib/runtime-replies";

export const FLOW_CONTENT_BLOCK_TYPES = [
  "text",
  "choice",
  "media",
  "catalog",
] as const;

export type FlowContentBlockType = (typeof FLOW_CONTENT_BLOCK_TYPES)[number];

type FlowTextContentBlock = {
  id: string;
  text: string;
  type: "text";
};

export type FlowChoiceOption = {
  actionType?: ActionOptionBehavior;
  actionValue?: string;
  description: string;
  id: string;
  label: string;
  section: string;
  value: string;
};

type FlowChoiceContentBlock = {
  displayMode: "buttons" | "list" | "text";
  footer: string;
  header: string;
  id: string;
  options: FlowChoiceOption[];
  text: string;
  type: "choice";
};

export type FlowMediaContentBlock = {
  id: string;
  media: RuntimeReplyMedia | null;
  mediaAssetId: number;
  text: string;
  type: "media";
};

export type FlowCatalogContentBlock = {
  catalog: {
    externalId?: string | null;
    id: number;
    name: string;
    providerType?: string;
  } | null;
  catalogId: number;
  displayMode: "catalog" | "multiple_products" | "single_product";
  id: string;
  layout: "featured" | "grid" | "list";
  productIds: number[];
  products: RuntimeReplyProduct[];
  text: string;
  type: "catalog";
};

export type FlowContentBlock =
  | FlowCatalogContentBlock
  | FlowChoiceContentBlock
  | FlowMediaContentBlock
  | FlowTextContentBlock;

export type FlowContentBlockRole = "presentation" | "response_collector";
export type FlowResponseCollectorBlock = Extract<
  FlowContentBlock,
  { type: "choice" }
>;

export type FlowContentCompositionIssue = {
  code:
    | "choice_action_invalid"
    | "choice_reply_missing"
    | "multiple_response_collectors";
  message: string;
};

export type FlowResponseCollectorCompatibilityContext = {
  hasDynamicOptions: boolean;
  hasManualOptions: boolean;
  hasStoredResponseCollector: boolean;
  isInputStep: boolean;
};

export const FLOW_CONTENT_SCHEMA_VERSION = 1 as const;

export type FlowContentDocumentV1 = {
  blocks: FlowContentBlock[];
  schemaVersion: typeof FLOW_CONTENT_SCHEMA_VERSION;
};

export const MAX_FLOW_CONTENT_BLOCKS = 10;
const MAX_OPTIONS_PER_BLOCK = 20;
const MAX_PRODUCTS_PER_BLOCK = 50;

function getText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function getNullableText(value: unknown, maxLength: number) {
  const text = getText(value, maxLength);
  return text || null;
}

function getPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function getBlockId(value: unknown, index: number) {
  const id = getText(value, 80);
  return id || `content-${index + 1}`;
}

function parseChoiceDisplayMode(value: unknown) {
  return value === "list" || value === "text" || value === "buttons"
    ? value
    : "buttons";
}

function parseChoiceOption(
  value: unknown,
  index: number,
  blockId: string,
): FlowChoiceOption | null {
  if (typeof value === "string") {
    const label = getText(value, 160);
    return label
      ? {
          description: "",
          id: `${blockId}-option-${index + 1}`,
          label,
          section: "",
          value: label,
        }
      : null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const option = value as Record<string, unknown>;
  const label = getText(option.label, 160);
  if (!label) {
    return null;
  }
  const actionType =
    option.actionType === "reply" ||
    option.actionType === "url" ||
    option.actionType === "phone"
      ? option.actionType
      : undefined;
  const actionValue =
    typeof option.actionValue === "string"
      ? getText(option.actionValue, 2000)
      : undefined;

  return {
    ...(actionType ? { actionType } : {}),
    ...(actionValue !== undefined ? { actionValue } : {}),
    description: getText(option.description, 240),
    id: getText(option.id, 80) || `${blockId}-option-${index + 1}`,
    label,
    section: getText(option.section, 80),
    value: getText(option.value, 160) || label,
  };
}

function parseProductLayout(value: unknown) {
  return value === "featured" || value === "list" || value === "grid"
    ? value
    : "grid";
}

function parseProductDisplayMode(value: unknown) {
  return value === "single_product" || value === "multiple_products"
    ? value
    : "catalog";
}

function parseMedia(value: unknown): RuntimeReplyMedia | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const media = value as Record<string, unknown>;
  const id = getPositiveInteger(media.id);
  const mediaType = getText(media.mediaType, 40);
  const mimeType = getText(media.mimeType, 160);
  const originalName = getText(media.originalName, 240);
  const publicPath = getText(media.publicPath, 2000);

  return id && mediaType && mimeType && originalName && publicPath
    ? { id, mediaType, mimeType, originalName, publicPath }
    : null;
}

function parseCatalog(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const catalog = value as Record<string, unknown>;
  const id = getPositiveInteger(catalog.id);
  const name = getText(catalog.name, 240);

  return id && name
    ? {
        externalId: getNullableText(catalog.externalId, 240),
        id,
        name,
        providerType: getText(catalog.providerType, 80) || undefined,
      }
    : null;
}

function parseProduct(value: unknown): RuntimeReplyProduct | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const product = value as Record<string, unknown>;
  const id = getPositiveInteger(product.id);
  const name = getText(product.name, 240);
  const priceAmount =
    typeof product.priceAmount === "number" &&
    Number.isInteger(product.priceAmount)
      ? product.priceAmount
      : null;

  return id && name
    ? {
        currency: getNullableText(product.currency, 12),
        description: getNullableText(product.description, 2000),
        id,
        imageUrl: getNullableText(product.imageUrl, 2000),
        name,
        priceAmount,
        productUrl: getNullableText(product.productUrl, 2000),
        sku: getNullableText(product.sku, 160),
        whatsappRetailerId: getNullableText(product.whatsappRetailerId, 240),
      }
    : null;
}

function parseProductIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value.map(getPositiveInteger).filter((id): id is number => id !== null),
    ),
  ).slice(0, MAX_PRODUCTS_PER_BLOCK);
}

export function parseFlowContentBlocks(value: unknown): FlowContentBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_FLOW_CONTENT_BLOCKS)
    .map((item, index): FlowContentBlock | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const block = item as Record<string, unknown>;

      if (block.type === "text") {
        const text = getText(block.text, 2000);
        return text
          ? {
              id: getBlockId(block.id, index),
              text,
              type: "text",
            }
          : null;
      }

      if (block.type === "choice") {
        const text = getText(block.text, 1000);
        const blockId = getBlockId(block.id, index);
        const options = Array.isArray(block.options)
          ? block.options
              .slice(0, MAX_OPTIONS_PER_BLOCK)
              .map((option, optionIndex) =>
                parseChoiceOption(option, optionIndex, blockId),
              )
              .filter((option): option is FlowChoiceOption => Boolean(option))
          : [];

        if (!text || options.length === 0) {
          return null;
        }

        return {
          displayMode: parseChoiceDisplayMode(block.displayMode),
          footer: getText(block.footer, 60),
          header: getText(block.header, 60),
          id: blockId,
          options,
          text,
          type: "choice",
        };
      }

      if (block.type === "media") {
        const mediaAssetId = getPositiveInteger(block.mediaAssetId);
        if (!mediaAssetId) {
          return null;
        }

        return {
          id: getBlockId(block.id, index),
          media: parseMedia(block.media),
          mediaAssetId,
          text: getText(block.text, 1000),
          type: "media",
        };
      }

      if (block.type === "catalog") {
        const catalogId = getPositiveInteger(block.catalogId);
        if (!catalogId) {
          return null;
        }

        const products = Array.isArray(block.products)
          ? block.products
              .slice(0, MAX_PRODUCTS_PER_BLOCK)
              .map(parseProduct)
              .filter((product): product is RuntimeReplyProduct =>
                Boolean(product),
              )
          : [];

        return {
          catalog: parseCatalog(block.catalog),
          catalogId,
          displayMode: parseProductDisplayMode(block.displayMode),
          id: getBlockId(block.id, index),
          layout: parseProductLayout(block.layout),
          productIds: parseProductIds(block.productIds),
          products,
          text: getText(block.text, 1000),
          type: "catalog",
        };
      }

      return null;
    })
    .filter((block): block is FlowContentBlock => block !== null);
}

export function buildFlowContentDocument(
  blocks: FlowContentBlock[],
): FlowContentDocumentV1 {
  return {
    blocks: [...blocks],
    schemaVersion: FLOW_CONTENT_SCHEMA_VERSION,
  };
}

export function parseFlowContentDocument(
  value: unknown,
): FlowContentDocumentV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const document = value as Record<string, unknown>;
  if (
    document.schemaVersion !== FLOW_CONTENT_SCHEMA_VERSION ||
    !Array.isArray(document.blocks)
  ) {
    return null;
  }

  return buildFlowContentDocument(parseFlowContentBlocks(document.blocks));
}

export function getFlowContentDocument(
  settings: Record<string, unknown>,
): FlowContentDocumentV1 | null {
  if (Object.hasOwn(settings, "contentDocument")) {
    return parseFlowContentDocument(settings.contentDocument);
  }

  return buildFlowContentDocument(
    parseFlowContentBlocks(settings.contentBlocks),
  );
}

export function getFlowContentBlocks(settings: Record<string, unknown>) {
  return getFlowContentDocument(settings)?.blocks ?? [];
}

export function getFlowContentBlockRole(
  block: FlowContentBlock,
): FlowContentBlockRole {
  return block.type === "choice" ? "response_collector" : "presentation";
}

export function getFlowResponseCollectorBlocks(
  blocks: FlowContentBlock[],
): FlowResponseCollectorBlock[] {
  return blocks.filter(
    (block): block is FlowResponseCollectorBlock =>
      getFlowContentBlockRole(block) === "response_collector",
  );
}

export function getFlowContentCompositionIssues(
  blocks: FlowContentBlock[],
): FlowContentCompositionIssue[] {
  const issues: FlowContentCompositionIssue[] = [];
  if (getFlowResponseCollectorBlocks(blocks).length > 1) {
    issues.push({
      code: "multiple_response_collectors",
      message: "A step can contain one response collector.",
    });
  }

  for (const block of blocks) {
    if (block.type !== "choice") {
      continue;
    }

    if (
      !block.options.some(
        (option) => getActionOptionBehavior(option.actionType) === "reply",
      )
    ) {
      issues.push({
        code: "choice_reply_missing",
        message: "A choice collector needs at least one reply option.",
      });
    }

    if (
      block.options.some(
        (option) =>
          getActionOptionBehavior(option.actionType) !== "reply" &&
          !getActionOptionHref(option),
      )
    ) {
      issues.push({
        code: "choice_action_invalid",
        message: "Website and phone buttons need a valid destination.",
      });
    }
  }

  return issues;
}

export function getFlowResponseCollectorCompatibilityIssue(
  context: FlowResponseCollectorCompatibilityContext,
) {
  if (!context.isInputStep) {
    return "Response collectors can only be added to steps that collect a visitor answer.";
  }

  if (context.hasDynamicOptions) {
    return "This step already collects an answer from a dynamic choice source.";
  }

  if (context.hasManualOptions && !context.hasStoredResponseCollector) {
    return "This step already collects an answer from its configured choices.";
  }

  return null;
}

export function getFlowContentReadinessIssues(
  settings: Record<string, unknown>,
) {
  const hasDocument = Object.hasOwn(settings, "contentDocument");
  const storedDocument = hasDocument ? settings.contentDocument : null;
  const storedBlocks = hasDocument
    ? storedDocument &&
      typeof storedDocument === "object" &&
      !Array.isArray(storedDocument) &&
      Array.isArray((storedDocument as Record<string, unknown>).blocks)
      ? ((storedDocument as Record<string, unknown>).blocks as unknown[])
      : null
    : Array.isArray(settings.contentBlocks)
      ? settings.contentBlocks
      : [];

  if (hasDocument && !parseFlowContentDocument(storedDocument)) {
    return ["Content uses an unsupported or malformed document version."];
  }

  const blocks = getFlowContentBlocks(settings);
  const issues = getFlowContentCompositionIssues(blocks).map(
    (issue) => issue.message,
  );
  if (
    storedBlocks &&
    (storedBlocks.length > MAX_FLOW_CONTENT_BLOCKS ||
      parseFlowContentBlocks(storedBlocks).length !== storedBlocks.length)
  ) {
    issues.push("Content contains an incomplete or unsupported block.");
  }

  const blockIds = new Set<string>();
  for (const block of blocks) {
    if (blockIds.has(block.id)) {
      issues.push("Content block IDs must be unique.");
      break;
    }
    blockIds.add(block.id);
  }

  for (const block of blocks) {
    if (block.type === "choice") {
      const optionIds = new Set(block.options.map((option) => option.id));
      const optionValues = new Set(block.options.map((option) => option.value));
      if (optionIds.size !== block.options.length) {
        issues.push("Response option IDs must be unique.");
      }
      if (optionValues.size !== block.options.length) {
        issues.push("Response option stored values must be unique.");
      }
    }

    if (block.type === "media" && !block.media) {
      issues.push("Media content must reference an available asset.");
    }

    if (block.type === "catalog") {
      if (!block.catalog) {
        issues.push("Product content must reference an available catalog.");
      } else if (
        block.displayMode === "single_product" &&
        block.products.length !== 1
      ) {
        issues.push("Single product content needs exactly one product.");
      } else if (
        block.displayMode === "multiple_products" &&
        block.products.length === 0
      ) {
        issues.push("Multiple product content needs at least one product.");
      }
    }
  }

  return [...new Set(issues)];
}

export function getFlowChoiceContentBlock(settings: Record<string, unknown>) {
  return (
    getFlowContentBlocks(settings).find((block) => block.type === "choice") ??
    null
  );
}

export function getFlowMediaContentBlocks(settings: Record<string, unknown>) {
  return getFlowContentBlocks(settings).filter(
    (block): block is FlowMediaContentBlock => block.type === "media",
  );
}

export function getFlowCatalogContentBlocks(settings: Record<string, unknown>) {
  return getFlowContentBlocks(settings).filter(
    (block): block is FlowCatalogContentBlock => block.type === "catalog",
  );
}

export function formatFlowContentBlockText(settings: Record<string, unknown>) {
  return getFlowContentBlocks(settings)
    .map((block) => block.text)
    .filter(Boolean)
    .join("\n\n");
}

export function formatFlowInteractiveContentBlockText(
  settings: Record<string, unknown>,
) {
  return getFlowContentBlocks(settings)
    .filter((block) => block.type === "text" || block.type === "choice")
    .map((block) => block.text)
    .filter(Boolean)
    .join("\n\n");
}
