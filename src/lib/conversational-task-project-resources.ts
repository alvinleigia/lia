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
  const filterKey =
    field.optionSource?.kind === "project_resource"
      ? field.optionSource.filterByField
      : null;
  if (!filterKey) return null;
  const value = fieldValues.get(filterKey);
  return typeof value === "string" ? parseScopedId(value, "catalog") : null;
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
  return { status: "not_found" };
};
