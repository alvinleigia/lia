import sampleServiceCatalog from "../../data/sample-service-catalog.json";

type CatalogItem = {
  id: string;
  name: string;
  description?: string;
  durationMinutes?: number;
  isActive?: boolean;
  price?: number;
};

type CatalogCategory = {
  id: string;
  name: string;
  description?: string;
  sortOrder?: number;
  items: CatalogItem[];
};

type Catalog = {
  id: string;
  name: string;
  categories: CatalogCategory[];
};

type Option = {
  label: string;
  value: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

export type ActionDataSourceSettings = {
  choiceDisplayMode?: "buttons" | "list" | "text";
  connectedActionId?: number;
  connectedActionName?: string;
  connectFlowMode?: "jump" | "return";
  handoffNotifyTeam?: boolean;
  handoffPriority?: "high" | "low" | "normal" | "urgent";
  handoffQueue?: string;
  mediaAsset?: {
    id: number;
    mediaType: string;
    mimeType: string;
    originalName: string;
    publicPath: string;
  };
  mediaAssetId?: number;
  operationExecutionMode?: "post_submit" | "inline";
  productDisplayLayout?: "featured" | "grid" | "list";
  productSelectionAllowMultiple?: boolean;
  productSelectionAllowQuantity?: boolean;
  productCatalog?: {
    externalId?: string | null;
    id: number;
    name: string;
    providerType?: string;
  };
  productCatalogId?: number;
  productIds?: number[];
  products?: {
    currency: string | null;
    description: string | null;
    id: number;
    imageUrl: string | null;
    name: string;
    priceAmount: number | null;
    productUrl: string | null;
    sku: string | null;
    whatsappRetailerId?: string | null;
  }[];
  requiredMessage?: string;
  sourceType?: string;
  sourceConfig?: {
    catalogId?: string;
    filterByField?: string;
  };
  validationMessage?: string;
  validationAllowedFileTypes?: string;
  validationMaxDate?: string;
  validationMaxLength?: number;
  validationMaxNumber?: number;
  validationMinDate?: string;
  validationMinLength?: number;
  validationMinNumber?: number;
  validationRegex?: string;
  whatsappTemplateCategory?: "authentication" | "marketing" | "utility";
  whatsappTemplateBody?: string;
  whatsappTemplateLanguage?: string;
  whatsappTemplateName?: string;
  whatsappTemplateStatus?: "approved" | "draft" | "pending" | "rejected";
  whatsappTemplateVariables?: string[];
};

function getCatalog(catalogId?: string) {
  if (!catalogId) {
    return null;
  }

  return (
    (sampleServiceCatalog.catalogs as Catalog[]).find(
      (catalog) => catalog.id === catalogId,
    ) ?? null
  );
}

function getCatalogCategoryOptions(catalog: Catalog): Option[] {
  return [...catalog.categories]
    .sort((first, second) => (first.sortOrder ?? 0) - (second.sortOrder ?? 0))
    .map((category) => ({
      label: category.name,
      value: category.id,
      description: category.description,
      metadata: {
        name: category.name,
      },
    }));
}

function getCatalogItemOptions(
  catalog: Catalog,
  selectedCategoryId?: unknown,
): Option[] {
  const categories =
    typeof selectedCategoryId === "string" && selectedCategoryId.length > 0
      ? catalog.categories.filter(
          (category) => category.id === selectedCategoryId,
        )
      : catalog.categories;

  return categories.flatMap((category) =>
    category.items
      .filter((item) => item.isActive !== false)
      .map((item) => ({
        label: item.name,
        value: item.id,
        description: item.description,
        metadata: {
          name: item.name,
          price: "price" in item ? item.price : null,
          durationMinutes:
            "durationMinutes" in item ? item.durationMinutes : null,
        },
      })),
  );
}

export function resolveActionDataSourceOptions(
  settings: ActionDataSourceSettings | null | undefined,
  fields: Record<string, unknown> = {},
): Option[] {
  const catalog = getCatalog(settings?.sourceConfig?.catalogId);

  if (!catalog) {
    return [];
  }

  switch (settings?.sourceType) {
    case "catalog_categories":
      return getCatalogCategoryOptions(catalog);
    case "catalog_items": {
      const filterByField = settings.sourceConfig?.filterByField;
      const selectedCategoryId = filterByField ? fields[filterByField] : null;
      return getCatalogItemOptions(catalog, selectedCategoryId);
    }
    default:
      return [];
  }
}
