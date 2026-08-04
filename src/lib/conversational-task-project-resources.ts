import type {
  ProjectResourceResolution,
  ProjectResourceResolver,
  TaskFieldDefinition,
} from "@/lib/conversational-task-field-validation";
import {
  getProjectMediaAsset,
  listProjectMediaAssets,
} from "@/lib/media-assets";
import {
  getProjectCatalog,
  listProjectCatalogProducts,
  listProjectCatalogProductsForCatalog,
  listProjectCatalogs,
} from "@/lib/product-catalogs";

type ResourceOption = {
  id: string;
  label: string;
};

export async function listProjectTaskResourceOptions(input: {
  field: TaskFieldDefinition;
  fieldValues: ReadonlyMap<string, unknown>;
  projectId: number;
}): Promise<ResourceOption[]> {
  if (input.field.optionSource?.kind !== "project_resource") return [];

  const resourceType = input.field.optionSource.resourceType.toLowerCase();
  if (
    ["catalog", "category", "servicecategory", "productcategory"].includes(
      resourceType,
    )
  ) {
    return (await listProjectCatalogs(input.projectId)).map((catalog) => ({
      id: `catalog:${catalog.id}`,
      label: catalog.name,
    }));
  }
  if (["product", "service", "catalogproduct"].includes(resourceType)) {
    const catalogId = readCatalogDependency(input.field, input.fieldValues);
    const rows = catalogId
      ? (
          await listProjectCatalogProductsForCatalog(input.projectId, catalogId)
        ).map((product) => ({ product }))
      : await listProjectCatalogProducts(input.projectId);
    return rows.map(({ product }) => ({
      id: `product:${product.id}`,
      label: product.name,
    }));
  }
  if (["media", "mediaasset", "asset"].includes(resourceType)) {
    return (await listProjectMediaAssets(input.projectId)).map((asset) => ({
      id: `media:${asset.id}`,
      label: asset.originalName,
    }));
  }
  return [];
}

function parseScopedId(value: string, prefix: string) {
  const match = value.match(new RegExp(`^${prefix}:(\\d+)$`, "i"));
  return match ? Number(match[1]) : null;
}

function numericId(value: unknown, prefix: string) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const scoped = parseScopedId(trimmed, prefix);
  if (scoped) return scoped;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

function resolveOption(
  options: ResourceOption[],
  value: unknown,
): ProjectResourceResolution {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  const matches = options.filter(
    (option) =>
      option.id.toLowerCase() === normalized ||
      option.label.toLowerCase() === normalized,
  );
  if (matches.length === 1) {
    return { status: "resolved", ...matches[0] };
  }
  return { status: matches.length > 1 ? "ambiguous" : "not_found" };
}

function readCatalogDependency(
  field: TaskFieldDefinition,
  fieldValues: ReadonlyMap<string, unknown>,
) {
  if (field.optionSource?.kind !== "project_resource") return null;
  const filterKey = field.optionSource.filterByField;
  if (filterKey) {
    const value = fieldValues.get(filterKey);
    const catalogId =
      typeof value === "string" ? parseScopedId(value, "catalog") : null;
    if (catalogId) return catalogId;
  }
  return field.optionSource.collectionKey
    ? parseScopedId(field.optionSource.collectionKey, "catalog")
    : null;
}

async function resolveCatalog(
  projectId: number,
  value: unknown,
): Promise<ProjectResourceResolution> {
  const id = numericId(value, "catalog");
  if (id) {
    const catalog = await getProjectCatalog(projectId, id);
    return catalog
      ? { id: `catalog:${catalog.id}`, label: catalog.name, status: "resolved" }
      : { status: "not_found" };
  }
  const catalogs = await listProjectCatalogs(projectId);
  return resolveOption(
    catalogs.map((catalog) => ({
      id: `catalog:${catalog.id}`,
      label: catalog.name,
    })),
    value,
  );
}

async function resolveProduct(input: {
  field: TaskFieldDefinition;
  fieldValues: ReadonlyMap<string, unknown>;
  projectId: number;
  value: unknown;
}): Promise<ProjectResourceResolution> {
  const catalogId = readCatalogDependency(input.field, input.fieldValues);
  const rows = catalogId
    ? (
        await listProjectCatalogProductsForCatalog(input.projectId, catalogId)
      ).map((product) => ({ product }))
    : await listProjectCatalogProducts(input.projectId);
  const options = rows.map(({ product }) => ({
    id: `product:${product.id}`,
    label: product.name,
  }));
  const id = numericId(input.value, "product");
  return resolveOption(options, id ? `product:${id}` : input.value);
}

async function resolveMedia(
  projectId: number,
  value: unknown,
): Promise<ProjectResourceResolution> {
  const id = numericId(value, "media");
  if (id) {
    const asset = await getProjectMediaAsset(projectId, id);
    return asset
      ? {
          id: `media:${asset.id}`,
          label: asset.originalName,
          status: "resolved",
        }
      : { status: "not_found" };
  }
  const assets = await listProjectMediaAssets(projectId);
  return resolveOption(
    assets.map((asset) => ({
      id: `media:${asset.id}`,
      label: asset.originalName,
    })),
    value,
  );
}

async function resolveUnspecifiedResource(input: {
  field: TaskFieldDefinition;
  fieldValues: ReadonlyMap<string, unknown>;
  projectId: number;
  value: unknown;
}): Promise<ProjectResourceResolution> {
  const dependentCatalogId = input.field.dependsOn
    .map((key) => input.fieldValues.get(key))
    .find(
      (value): value is string =>
        typeof value === "string" && parseScopedId(value, "catalog") !== null,
    );
  if (dependentCatalogId) {
    const catalogId = parseScopedId(dependentCatalogId, "catalog");
    if (!catalogId) return { status: "not_found" };
    const products = await listProjectCatalogProductsForCatalog(
      input.projectId,
      catalogId,
    );
    return resolveOption(
      products.map((product) => ({
        id: `product:${product.id}`,
        label: product.name,
      })),
      input.value,
    );
  }

  const [catalogs, productRows, assets] = await Promise.all([
    listProjectCatalogs(input.projectId),
    listProjectCatalogProducts(input.projectId),
    listProjectMediaAssets(input.projectId),
  ]);
  return resolveOption(
    [
      ...catalogs.map((catalog) => ({
        id: `catalog:${catalog.id}`,
        label: catalog.name,
      })),
      ...productRows.map(({ product }) => ({
        id: `product:${product.id}`,
        label: product.name,
      })),
      ...assets.map((asset) => ({
        id: `media:${asset.id}`,
        label: asset.originalName,
      })),
    ],
    input.value,
  );
}

export const resolveProjectTaskResource: ProjectResourceResolver = async (
  input,
) => {
  const resourceType =
    input.field.optionSource?.kind === "project_resource"
      ? input.field.optionSource.resourceType.toLowerCase()
      : "";

  if (
    ["catalog", "category", "servicecategory", "productcategory"].includes(
      resourceType,
    )
  ) {
    return resolveCatalog(input.projectId, input.value);
  }
  if (["product", "service", "catalogproduct"].includes(resourceType)) {
    return resolveProduct(input);
  }
  if (["media", "mediaasset", "asset"].includes(resourceType)) {
    return resolveMedia(input.projectId, input.value);
  }
  if (!resourceType) {
    return resolveUnspecifiedResource(input);
  }
  return { status: "not_found" };
};
