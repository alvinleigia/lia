"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndProject } from "@/lib/auth-project";
import {
  archiveProjectCatalog,
  archiveProjectCatalogProduct,
  createProjectCatalog,
  createProjectCatalogProduct,
  getProjectCatalog,
  updateProjectCatalogProductWhatsAppSettings,
  updateProjectCatalogWhatsAppSettings,
} from "@/lib/product-catalogs";

const catalogIdSchema = z.coerce.number().int().positive();
const productIdSchema = z.coerce.number().int().positive();
const whatsappCatalogConfigSchema = z.object({
  catalogId: z.coerce.number().int().positive(),
  whatsappCatalogId: z.string().trim().max(120).optional(),
});
const whatsappProductConfigSchema = z.object({
  productId: z.coerce.number().int().positive(),
  whatsappRetailerId: z.string().trim().max(120).optional(),
});

const createCatalogSchema = z.object({
  description: z.string().trim().max(500).optional(),
  name: z.string().trim().min(1).max(120),
  whatsappCatalogId: z.string().trim().max(120).optional(),
});

const createProductSchema = z.object({
  catalogId: z.coerce.number().int().positive(),
  currency: z.string().trim().max(3).optional(),
  description: z.string().trim().max(1000).optional(),
  imageUrl: z.string().trim().url().optional().or(z.literal("")),
  name: z.string().trim().min(1).max(160),
  price: z.string().trim().optional(),
  productUrl: z.string().trim().url().optional().or(z.literal("")),
  sku: z.string().trim().max(80).optional(),
  whatsappRetailerId: z.string().trim().max(120).optional(),
});

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

export async function createCatalogAction(formData: FormData) {
  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.project.manage");

  const parsed = createCatalogSchema.safeParse({
    description: formData.get("description"),
    name: formData.get("name"),
    whatsappCatalogId: formData.get("whatsappCatalogId"),
  });

  if (!parsed.success) {
    redirectWithError("Catalog name is required.");
  }

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
    metadata: {
      name: catalog.name,
    },
  });

  revalidatePath("/projects/catalog");
  redirect("/projects/catalog?catalogCreated=1");
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
    metadata: {
      name: catalog.name,
    },
  });

  revalidatePath("/projects/catalog");
  redirect("/projects/catalog?catalogArchived=1");
}

export async function updateCatalogWhatsAppSettingsAction(formData: FormData) {
  const parsed = whatsappCatalogConfigSchema.safeParse({
    catalogId: formData.get("catalogId"),
    whatsappCatalogId: formData.get("whatsappCatalogId"),
  });
  if (!parsed.success) {
    redirectWithError("Invalid WhatsApp catalog settings.");
  }

  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.project.manage");
  const catalog = await updateProjectCatalogWhatsAppSettings({
    catalogId: parsed.data.catalogId,
    projectId: context.project.id,
    whatsappCatalogId: normalizeOptionalText(parsed.data.whatsappCatalogId),
  });

  if (!catalog) {
    redirectWithError("Catalog not found.");
  }

  await writeAuditLog({
    ...context,
    action: "product_catalog.whatsapp_settings_updated",
    targetType: "product_catalog",
    targetId: catalog.id,
    metadata: {
      externalId: catalog.externalId,
      name: catalog.name,
    },
  });

  revalidatePath("/projects/catalog");
  redirect("/projects/catalog?catalogUpdated=1");
}

export async function createProductAction(formData: FormData) {
  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.project.manage");

  const parsed = createProductSchema.safeParse({
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
    redirectWithError("Product name and catalog are required.");
  }

  const catalog = await getProjectCatalog(
    context.project.id,
    parsed.data.catalogId,
  );
  if (!catalog) {
    redirectWithError("Catalog not found.");
  }

  let priceAmount: number | null = null;
  try {
    priceAmount = parsePriceToMinorUnits(parsed.data.price);
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Invalid product price.",
    );
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

  revalidatePath("/projects/catalog");
  redirect("/projects/catalog?productCreated=1");
}

export async function updateProductWhatsAppSettingsAction(formData: FormData) {
  const parsed = whatsappProductConfigSchema.safeParse({
    productId: formData.get("productId"),
    whatsappRetailerId: formData.get("whatsappRetailerId"),
  });
  if (!parsed.success) {
    redirectWithError("Invalid WhatsApp product settings.");
  }

  const context = await resolveUserAndProject(formData.get("projectId"));
  assertPermission(context.membership, "company.project.manage");
  const product = await updateProjectCatalogProductWhatsAppSettings({
    productId: parsed.data.productId,
    projectId: context.project.id,
    whatsappRetailerId: normalizeOptionalText(parsed.data.whatsappRetailerId),
  });

  if (!product) {
    redirectWithError("Product not found.");
  }

  await writeAuditLog({
    ...context,
    action: "catalog_product.whatsapp_settings_updated",
    targetType: "catalog_product",
    targetId: product.id,
    metadata: {
      name: product.name,
      whatsappRetailerId:
        typeof product.metadata.whatsappRetailerId === "string"
          ? product.metadata.whatsappRetailerId
          : null,
    },
  });

  revalidatePath("/projects/catalog");
  redirect("/projects/catalog?productUpdated=1");
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

  revalidatePath("/projects/catalog");
  redirect("/projects/catalog?productArchived=1");
}
