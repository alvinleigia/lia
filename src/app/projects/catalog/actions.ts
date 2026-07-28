"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import type { ActionFormState } from "@/lib/action-form-state";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndProject } from "@/lib/auth-project";
import {
  listCatalogDependencies,
  listProductDependencies,
} from "@/lib/catalog-resource-dependency-store";
import {
  archiveProjectCatalog,
  archiveProjectCatalogProduct,
  createProjectCatalog,
  createProjectCatalogProduct,
  deleteProjectCatalog,
  deleteProjectCatalogProduct,
  getProjectCatalog,
  getProjectCatalogById,
  getProjectCatalogProductById,
  listProjectCatalogProductsForCatalogIncludingArchived,
  restoreProjectCatalog,
  restoreProjectCatalogProduct,
  updateProjectCatalogDetails,
  updateProjectCatalogProductDetails,
} from "@/lib/product-catalogs";

const catalogIdSchema = z.coerce.number().int().positive();
const productIdSchema = z.coerce.number().int().positive();

const catalogSchema = z.object({
  description: z.string().trim().max(500).optional(),
  name: z.string().trim().min(1).max(120),
  whatsappCatalogId: z.string().trim().max(120).optional(),
});

const catalogDetailsSchema = catalogSchema.extend({
  catalogId: catalogIdSchema,
});

const productSchema = z.object({
  catalogId: catalogIdSchema,
  currency: z.string().trim().max(3).optional(),
  description: z.string().trim().max(1000).optional(),
  imageUrl: z.string().trim().url().optional().or(z.literal("")),
  name: z.string().trim().min(1).max(160),
  price: z.string().trim().optional(),
  productUrl: z.string().trim().url().optional().or(z.literal("")),
  sku: z.string().trim().max(80).optional(),
  whatsappRetailerId: z.string().trim().max(120).optional(),
});

const productDetailsSchema = productSchema.extend({
  productId: productIdSchema,
});

function catalogPath(catalogId: number) {
  return `/projects/catalog/${catalogId}`;
}

function productPath(catalogId: number, productId: number) {
  return `${catalogPath(catalogId)}/products/${productId}`;
}

function readReturnPath(formData: FormData, fallback: string) {
  const value = formData.get("returnTo");
  return typeof value === "string" && value.startsWith("/projects/catalog")
    ? value
    : fallback;
}

function redirectWithError(message: string): never {
  redirect(`/projects/catalog?error=${encodeURIComponent(message)}`);
}

function normalizeOptionalText(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function parsePriceToMinorUnits(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Price must be a valid amount with up to 2 decimals.");
  }

  const [wholePart, decimalPart = ""] = normalized.split(".");
  return Number(wholePart) * 100 + Number(decimalPart.padEnd(2, "0"));
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "code" in error.cause &&
    error.cause.code === "23505"
  );
}

function formatDependencyError(
  resourceLabel: string,
  dependencies: Awaited<ReturnType<typeof listCatalogDependencies>>,
) {
  const examples = dependencies
    .slice(0, 3)
    .map((dependency) => dependency.sourceName)
    .join(", ");
  const immutableCount = dependencies.filter(
    (dependency) => dependency.immutable,
  ).length;

  return `${resourceLabel} is still used by ${dependencies.length} flow or task contract${dependencies.length === 1 ? "" : "s"}${examples ? ` (${examples})` : ""}.${immutableCount > 0 ? " Published versions are immutable, so keep this resource archived." : " Remove the references before deleting it."}`;
}

function revalidateCatalogPaths(catalogId?: number, productId?: number) {
  revalidatePath("/projects/catalog");
  if (catalogId) {
    revalidatePath(catalogPath(catalogId));
  }
  if (catalogId && productId) {
    revalidatePath(productPath(catalogId, productId));
  }
}

export async function createCatalogAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.project.manage");

  const parsed = catalogSchema.safeParse({
    description: formData.get("description"),
    name: formData.get("name"),
    whatsappCatalogId: formData.get("whatsappCatalogId"),
  });

  if (!parsed.success) {
    return { error: "Catalog name is required." };
  }

  try {
    const catalog = await createProjectCatalog({
      projectId: context.project.id,
      name: parsed.data.name,
      description: normalizeOptionalText(parsed.data.description),
      status: "active",
      providerType: parsed.data.whatsappCatalogId ? "whatsapp" : "internal",
      externalId: normalizeOptionalText(parsed.data.whatsappCatalogId),
      settings: {},
    });

    await writeAuditLog({
      ...context,
      action: "product_catalog.created",
      targetType: "product_catalog",
      targetId: catalog.id,
      metadata: { name: catalog.name },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "A catalog with this name already exists." };
    }
    throw error;
  }

  revalidateCatalogPaths();
  redirect("/projects/catalog?catalogCreated=1");
}

export async function updateCatalogAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = catalogDetailsSchema.safeParse({
    catalogId: formData.get("catalogId"),
    description: formData.get("description"),
    name: formData.get("name"),
    whatsappCatalogId: formData.get("whatsappCatalogId"),
  });
  if (!parsed.success) {
    return { error: "Enter a valid catalog name and provider mapping." };
  }

  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.project.manage");

  try {
    const catalog = await updateProjectCatalogDetails({
      catalogId: parsed.data.catalogId,
      description: normalizeOptionalText(parsed.data.description),
      name: parsed.data.name,
      projectId: context.project.id,
      whatsappCatalogId: normalizeOptionalText(parsed.data.whatsappCatalogId),
    });

    if (!catalog) {
      return { error: "Catalog not found." };
    }

    await writeAuditLog({
      ...context,
      action: "product_catalog.updated",
      targetType: "product_catalog",
      targetId: catalog.id,
      metadata: {
        externalId: catalog.externalId,
        name: catalog.name,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "A catalog with this name already exists." };
    }
    throw error;
  }

  revalidateCatalogPaths(parsed.data.catalogId);
  redirect(`${catalogPath(parsed.data.catalogId)}?updated=1`);
}

export async function archiveCatalogAction(formData: FormData) {
  const parsed = catalogIdSchema.safeParse(formData.get("catalogId"));
  if (!parsed.success) {
    redirectWithError("Invalid catalog.");
  }

  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.project.manage");
  const catalog = await archiveProjectCatalog(context.project.id, parsed.data);

  if (!catalog) {
    redirectWithError("Catalog not found.");
  }

  await writeAuditLog({
    ...context,
    action: "product_catalog.archived",
    targetType: "product_catalog",
    targetId: catalog.id,
    metadata: { name: catalog.name },
  });

  revalidateCatalogPaths(catalog.id);
  redirect(readReturnPath(formData, "/projects/catalog"));
}

export async function restoreCatalogAction(formData: FormData) {
  const parsed = catalogIdSchema.safeParse(formData.get("catalogId"));
  if (!parsed.success) {
    redirectWithError("Invalid catalog.");
  }

  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.project.manage");
  const catalog = await restoreProjectCatalog(context.project.id, parsed.data);

  if (!catalog) {
    redirectWithError("Catalog not found.");
  }

  await writeAuditLog({
    ...context,
    action: "product_catalog.restored",
    targetType: "product_catalog",
    targetId: catalog.id,
    metadata: { name: catalog.name },
  });

  revalidateCatalogPaths(catalog.id);
  redirect(readReturnPath(formData, `${catalogPath(catalog.id)}?restored=1`));
}

export async function deleteCatalogAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = catalogIdSchema.safeParse(formData.get("catalogId"));
  if (!parsed.success) {
    return { error: "Invalid catalog." };
  }

  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.project.manage");
  const catalog = await getProjectCatalogById(context.project.id, parsed.data);

  if (!catalog || catalog.status !== "archived") {
    return { error: "Archive the catalog before permanently deleting it." };
  }

  const products = await listProjectCatalogProductsForCatalogIncludingArchived(
    context.project.id,
    catalog.id,
  );
  if (products.length > 0) {
    return {
      error:
        "This catalog still contains products. Archive and permanently delete those products first.",
    };
  }

  const dependencies = await listCatalogDependencies(
    context.project.id,
    catalog.id,
  );
  if (dependencies.length > 0) {
    return { error: formatDependencyError("This catalog", dependencies) };
  }

  const deleted = await deleteProjectCatalog(context.project.id, catalog.id);
  if (!deleted) {
    return { error: "Catalog not found." };
  }

  await writeAuditLog({
    ...context,
    action: "product_catalog.deleted",
    targetType: "product_catalog",
    targetId: catalog.id,
    metadata: { name: catalog.name },
  });

  revalidateCatalogPaths();
  redirect("/projects/catalog?catalogDeleted=1");
}

export async function createProductAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.project.manage");

  const parsed = productSchema.safeParse({
    catalogId: formData.get("catalogId"),
    currency: formData.get("currency"),
    description: formData.get("description"),
    imageUrl: formData.get("imageUrl"),
    name: formData.get("name"),
    price: formData.get("price"),
    productUrl: formData.get("productUrl"),
    sku: formData.get("sku"),
    whatsappRetailerId: formData.get("whatsappRetailerId"),
  });

  if (!parsed.success) {
    return { error: "Product name and catalog are required." };
  }

  const catalog = await getProjectCatalog(
    context.project.id,
    parsed.data.catalogId,
  );
  if (!catalog) {
    return { error: "Choose an active catalog." };
  }

  let priceAmount: number | null = null;
  try {
    priceAmount = parsePriceToMinorUnits(parsed.data.price);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid product price.",
    };
  }

  const currency = normalizeOptionalText(parsed.data.currency)?.toUpperCase();
  const product = await createProjectCatalogProduct({
    projectId: context.project.id,
    catalogId: catalog.id,
    sku: normalizeOptionalText(parsed.data.sku),
    name: parsed.data.name,
    description: normalizeOptionalText(parsed.data.description),
    imageUrl: normalizeOptionalText(parsed.data.imageUrl),
    productUrl: normalizeOptionalText(parsed.data.productUrl),
    priceAmount,
    currency: priceAmount === null ? null : (currency ?? "USD"),
    status: "active",
    metadata: {
      whatsappRetailerId: normalizeOptionalText(parsed.data.whatsappRetailerId),
    },
  });

  await writeAuditLog({
    ...context,
    action: "catalog_product.created",
    targetType: "catalog_product",
    targetId: product.id,
    metadata: {
      catalogId: catalog.id,
      name: product.name,
      sku: product.sku,
    },
  });

  revalidateCatalogPaths(catalog.id);
  redirect("/projects/catalog?productCreated=1");
}

export async function updateProductAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = productDetailsSchema.safeParse({
    catalogId: formData.get("catalogId"),
    currency: formData.get("currency"),
    description: formData.get("description"),
    imageUrl: formData.get("imageUrl"),
    name: formData.get("name"),
    price: formData.get("price"),
    productId: formData.get("productId"),
    productUrl: formData.get("productUrl"),
    sku: formData.get("sku"),
    whatsappRetailerId: formData.get("whatsappRetailerId"),
  });
  if (!parsed.success) {
    return { error: "Enter valid product details." };
  }

  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.project.manage");
  const catalog = await getProjectCatalog(
    context.project.id,
    parsed.data.catalogId,
  );
  if (!catalog) {
    return { error: "Choose an active catalog." };
  }

  let priceAmount: number | null = null;
  try {
    priceAmount = parsePriceToMinorUnits(parsed.data.price);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid product price.",
    };
  }

  const currency = normalizeOptionalText(parsed.data.currency)?.toUpperCase();
  const product = await updateProjectCatalogProductDetails({
    catalogId: catalog.id,
    currency: priceAmount === null ? null : (currency ?? "USD"),
    description: normalizeOptionalText(parsed.data.description),
    imageUrl: normalizeOptionalText(parsed.data.imageUrl),
    name: parsed.data.name,
    priceAmount,
    productId: parsed.data.productId,
    productUrl: normalizeOptionalText(parsed.data.productUrl),
    projectId: context.project.id,
    sku: normalizeOptionalText(parsed.data.sku),
    whatsappRetailerId: normalizeOptionalText(parsed.data.whatsappRetailerId),
  });

  if (!product) {
    return { error: "Product not found." };
  }

  await writeAuditLog({
    ...context,
    action: "catalog_product.updated",
    targetType: "catalog_product",
    targetId: product.id,
    metadata: {
      catalogId: product.catalogId,
      name: product.name,
      sku: product.sku,
    },
  });

  revalidateCatalogPaths(product.catalogId, product.id);
  redirect(`${productPath(product.catalogId, product.id)}?updated=1`);
}

export async function archiveProductAction(formData: FormData) {
  const parsed = productIdSchema.safeParse(formData.get("productId"));
  if (!parsed.success) {
    redirectWithError("Invalid product.");
  }

  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.project.manage");
  const product = await archiveProjectCatalogProduct(
    context.project.id,
    parsed.data,
  );

  if (!product) {
    redirectWithError("Product not found.");
  }

  await writeAuditLog({
    ...context,
    action: "catalog_product.archived",
    targetType: "catalog_product",
    targetId: product.id,
    metadata: {
      catalogId: product.catalogId,
      name: product.name,
      sku: product.sku,
    },
  });

  revalidateCatalogPaths(product.catalogId, product.id);
  redirect(readReturnPath(formData, "/projects/catalog"));
}

export async function restoreProductAction(formData: FormData) {
  const parsed = productIdSchema.safeParse(formData.get("productId"));
  if (!parsed.success) {
    redirectWithError("Invalid product.");
  }

  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.project.manage");
  const product = await getProjectCatalogProductById(
    context.project.id,
    parsed.data,
  );
  if (!product) {
    redirectWithError("Product not found.");
  }

  const catalog = await getProjectCatalog(
    context.project.id,
    product.catalogId,
  );
  if (!catalog) {
    redirectWithError("Restore the product catalog first.");
  }

  const restored = await restoreProjectCatalogProduct(
    context.project.id,
    product.id,
  );
  if (!restored) {
    redirectWithError("Product not found.");
  }

  await writeAuditLog({
    ...context,
    action: "catalog_product.restored",
    targetType: "catalog_product",
    targetId: restored.id,
    metadata: {
      catalogId: restored.catalogId,
      name: restored.name,
    },
  });

  revalidateCatalogPaths(restored.catalogId, restored.id);
  redirect(
    readReturnPath(
      formData,
      `${productPath(restored.catalogId, restored.id)}?restored=1`,
    ),
  );
}

export async function deleteProductAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = productIdSchema.safeParse(formData.get("productId"));
  if (!parsed.success) {
    return { error: "Invalid product." };
  }

  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.project.manage");
  const product = await getProjectCatalogProductById(
    context.project.id,
    parsed.data,
  );

  if (!product || product.status !== "archived") {
    return { error: "Archive the product before permanently deleting it." };
  }

  const dependencies = await listProductDependencies(
    context.project.id,
    product.id,
  );
  if (dependencies.length > 0) {
    return { error: formatDependencyError("This product", dependencies) };
  }

  const deleted = await deleteProjectCatalogProduct(
    context.project.id,
    product.id,
  );
  if (!deleted) {
    return { error: "Product not found." };
  }

  await writeAuditLog({
    ...context,
    action: "catalog_product.deleted",
    targetType: "catalog_product",
    targetId: product.id,
    metadata: {
      catalogId: product.catalogId,
      name: product.name,
    },
  });

  revalidateCatalogPaths(product.catalogId);
  redirect(`${catalogPath(product.catalogId)}?productDeleted=1`);
}
