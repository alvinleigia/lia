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

type FlowChoiceContentBlock = {
  displayMode: "buttons" | "list" | "text";
  id: string;
  options: string[];
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

const MAX_CONTENT_BLOCKS = 10;
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
    .slice(0, MAX_CONTENT_BLOCKS)
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
        const options = Array.isArray(block.options)
          ? block.options
              .slice(0, MAX_OPTIONS_PER_BLOCK)
              .map((option) => getText(option, 160))
              .filter(Boolean)
          : [];

        if (!text || options.length === 0) {
          return null;
        }

        return {
          displayMode: parseChoiceDisplayMode(block.displayMode),
          id: getBlockId(block.id, index),
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

export function getFlowContentBlocks(settings: Record<string, unknown>) {
  return parseFlowContentBlocks(settings.contentBlocks);
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
