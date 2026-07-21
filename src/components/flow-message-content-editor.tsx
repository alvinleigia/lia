"use client";

import {
  ArrowDown,
  ArrowUp,
  ImageIcon,
  ListChecks,
  MessageSquareText,
  Plus,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  FlowCatalogContentBlock,
  FlowContentBlock,
  FlowMediaContentBlock,
} from "@/lib/flow-content-blocks";
import {
  getFlowMessageFamily,
  getFlowMessageFamilyDefinition,
  MAX_FLOW_MESSAGE_OPTIONS,
} from "@/lib/flow-message-editor";

export type FlowMessageMediaAssetOption = {
  id: number;
  label: string;
  mediaType: string;
};

export type FlowMessageProductCatalogOption = {
  id: number;
  name: string;
};

export type FlowMessageCatalogProductOption = {
  catalogId: number;
  catalogName: string;
  id: number;
  name: string;
  sku: string | null;
};

function getFamilyIcon(block: FlowContentBlock) {
  if (block.type === "choice") {
    return ListChecks;
  }

  if (block.type === "media") {
    return ImageIcon;
  }

  if (block.type === "catalog") {
    return ShoppingBag;
  }

  return MessageSquareText;
}

function moveOption(options: string[], fromIndex: number, toIndex: number) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= options.length ||
    toIndex >= options.length
  ) {
    return options;
  }

  const nextOptions = [...options];
  const [option] = nextOptions.splice(fromIndex, 1);
  nextOptions.splice(toIndex, 0, option);
  return nextOptions;
}

function FlowMediaMessageFields({
  block,
  mediaAssets,
  onChange,
}: {
  block: FlowMediaContentBlock;
  mediaAssets: FlowMessageMediaAssetOption[];
  onChange: (block: FlowContentBlock) => void;
}) {
  const selectedAsset = mediaAssets.find(
    (asset) => asset.id === block.mediaAssetId,
  );

  return (
    <div className="space-y-2">
      <label
        className="text-sm font-medium"
        htmlFor={`message-media-${block.id}`}
      >
        Media file
      </label>
      <select
        id={`message-media-${block.id}`}
        aria-label="Media file"
        value={block.mediaAssetId}
        onChange={(event) =>
          onChange({
            ...block,
            media: null,
            mediaAssetId: Number(event.target.value),
          })
        }
        className="flex h-10 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {mediaAssets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.label}
          </option>
        ))}
      </select>
      {selectedAsset && (
        <p className="text-xs text-muted-foreground">
          {selectedAsset.mediaType} selected
        </p>
      )}
    </div>
  );
}

function FlowCatalogMessageFields({
  block,
  catalogProducts,
  onChange,
  productCatalogs,
}: {
  block: FlowCatalogContentBlock;
  catalogProducts: FlowMessageCatalogProductOption[];
  onChange: (block: FlowContentBlock) => void;
  productCatalogs: FlowMessageProductCatalogOption[];
}) {
  const availableProducts = catalogProducts.filter(
    (product) => product.catalogId === block.catalogId,
  );

  const selectCatalog = (catalogId: number) => {
    const availableProductIds = catalogProducts
      .filter((product) => product.catalogId === catalogId)
      .map((product) => product.id);

    onChange({
      ...block,
      catalog: null,
      catalogId,
      productIds:
        block.displayMode === "catalog"
          ? []
          : block.displayMode === "single_product"
            ? availableProductIds.slice(0, 1)
            : availableProductIds.slice(0, 3),
      products: [],
    });
  };

  const selectProduct = (productId: number, selected: boolean) => {
    const productIds =
      block.displayMode === "single_product"
        ? [productId]
        : selected
          ? [...new Set([...block.productIds, productId])]
          : block.productIds.filter((id) => id !== productId);

    onChange({ ...block, productIds, products: [] });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label
          className="text-sm font-medium"
          htmlFor={`message-catalog-${block.id}`}
        >
          Product catalog
        </label>
        <select
          id={`message-catalog-${block.id}`}
          aria-label="Product catalog"
          value={block.catalogId}
          onChange={(event) => selectCatalog(Number(event.target.value))}
          className="flex h-10 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {productCatalogs.map((catalog) => (
            <option key={catalog.id} value={catalog.id}>
              {catalog.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Card layout</legend>
        <div className="grid grid-cols-3 overflow-hidden rounded-md border bg-white">
          {(
            [
              ["grid", "Grid"],
              ["list", "List"],
              ["featured", "Featured"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={block.layout === value}
              onClick={() => onChange({ ...block, layout: value })}
              className={`min-h-10 border-r px-2 text-sm last:border-r-0 ${
                block.layout === value
                  ? "bg-gray-900 font-medium text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      {block.displayMode !== "catalog" && (
        <fieldset className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <legend className="text-sm font-medium">
              {block.displayMode === "single_product"
                ? "Choose one product"
                : "Choose products"}
            </legend>
            {block.displayMode === "multiple_products" && (
              <span className="text-xs text-muted-foreground">
                {block.productIds.length} selected
              </span>
            )}
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border bg-white p-2">
            {availableProducts.map((product) => {
              const selected = block.productIds.includes(product.id);

              return (
                <label
                  key={product.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-gray-50"
                >
                  <input
                    type={
                      block.displayMode === "single_product"
                        ? "radio"
                        : "checkbox"
                    }
                    name={
                      block.displayMode === "single_product"
                        ? `message-product-${block.id}`
                        : undefined
                    }
                    checked={selected}
                    onChange={(event) =>
                      selectProduct(product.id, event.target.checked)
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {product.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {product.sku || product.catalogName}
                    </span>
                  </span>
                </label>
              );
            })}
            {availableProducts.length === 0 && (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                This catalog has no active products.
              </p>
            )}
          </div>
        </fieldset>
      )}
    </div>
  );
}

export function FlowMessageContentEditor({
  block,
  catalogProducts,
  mediaAssets,
  onChange,
  productCatalogs,
}: {
  block: FlowContentBlock;
  catalogProducts: FlowMessageCatalogProductOption[];
  mediaAssets: FlowMessageMediaAssetOption[];
  onChange: (block: FlowContentBlock) => void;
  productCatalogs: FlowMessageProductCatalogOption[];
}) {
  const definition = getFlowMessageFamilyDefinition(block);
  const family = getFlowMessageFamily(block);
  const Icon = getFamilyIcon(block);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-700">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{definition.title}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {definition.description}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label
            className="text-sm font-medium"
            htmlFor={`message-copy-${block.id}`}
          >
            {definition.messageLabel}
          </label>
          <span className="text-xs text-muted-foreground">
            {block.text.length}/{definition.textLimit}
          </span>
        </div>
        <textarea
          id={`message-copy-${block.id}`}
          aria-label={definition.messageLabel}
          value={block.text}
          maxLength={definition.textLimit}
          rows={block.type === "text" ? 4 : 3}
          placeholder={definition.messagePlaceholder}
          onChange={(event) =>
            onChange({ ...block, text: event.target.value } as FlowContentBlock)
          }
          className="flex min-h-24 w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm leading-6 shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      {block.type === "choice" && (
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Presentation</legend>
            <div className="grid grid-cols-3 overflow-hidden rounded-md border bg-white">
              {(
                [
                  ["buttons", "Buttons"],
                  ["list", "List"],
                  ["text", "Typed reply"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={block.displayMode === value}
                  onClick={() => onChange({ ...block, displayMode: value })}
                  className={`min-h-10 border-r px-2 text-sm last:border-r-0 ${
                    block.displayMode === value
                      ? "bg-gray-900 font-medium text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Options</p>
              <span className="text-xs text-muted-foreground">
                {block.options.length}/{MAX_FLOW_MESSAGE_OPTIONS}
              </span>
            </div>

            <div className="space-y-2">
              {block.options.map((option, optionIndex) => (
                <div
                  key={`${block.id}-friendly-option-${optionIndex}`}
                  className="flex items-center gap-1.5 rounded-md border bg-white p-1.5"
                >
                  <input
                    aria-label={`Option ${optionIndex + 1}`}
                    value={option}
                    maxLength={160}
                    placeholder={`Option ${optionIndex + 1}`}
                    onChange={(event) => {
                      const options = [...block.options];
                      options[optionIndex] = event.target.value;
                      onChange({ ...block, options });
                    }}
                    className="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={optionIndex === 0}
                    title={`Move option ${optionIndex + 1} up`}
                    onClick={() =>
                      onChange({
                        ...block,
                        options: moveOption(
                          block.options,
                          optionIndex,
                          optionIndex - 1,
                        ),
                      })
                    }
                  >
                    <ArrowUp className="h-4 w-4" />
                    <span className="sr-only">Move option up</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={optionIndex === block.options.length - 1}
                    title={`Move option ${optionIndex + 1} down`}
                    onClick={() =>
                      onChange({
                        ...block,
                        options: moveOption(
                          block.options,
                          optionIndex,
                          optionIndex + 1,
                        ),
                      })
                    }
                  >
                    <ArrowDown className="h-4 w-4" />
                    <span className="sr-only">Move option down</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={block.options.length === 1}
                    title={`Remove option ${optionIndex + 1}`}
                    onClick={() =>
                      onChange({
                        ...block,
                        options: block.options.filter(
                          (_, index) => index !== optionIndex,
                        ),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Remove option</span>
                  </Button>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={block.options.length >= MAX_FLOW_MESSAGE_OPTIONS}
              onClick={() =>
                onChange({
                  ...block,
                  options: [...block.options, "New option"],
                })
              }
            >
              <Plus className="h-4 w-4" />
              Add option
            </Button>
          </div>

          {family === "buttons" && block.options.length > 3 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              Some channels show only three native buttons. Extra options will
              use the channel's readable fallback.
            </p>
          )}
          {family === "list" && block.options.length > 10 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              Some channels show only ten native list rows. Extra options will
              use the channel's readable fallback.
            </p>
          )}
        </div>
      )}

      {block.type === "media" && (
        <FlowMediaMessageFields
          block={block}
          mediaAssets={mediaAssets}
          onChange={onChange}
        />
      )}

      {block.type === "catalog" && (
        <FlowCatalogMessageFields
          block={block}
          catalogProducts={catalogProducts}
          onChange={onChange}
          productCatalogs={productCatalogs}
        />
      )}
    </div>
  );
}
