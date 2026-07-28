import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db-config";
import {
  catalogProducts,
  type InsertCatalogProduct,
  type InsertProductCatalog,
  productCatalogs,
} from "@/lib/db-schema";

export async function listProjectCatalogs(projectId: number) {
  return listProjectCatalogsByStatus(projectId, "active");
}

export async function listArchivedProjectCatalogs(projectId: number) {
  return listProjectCatalogsByStatus(projectId, "archived");
}

async function listProjectCatalogsByStatus(
  projectId: number,
  status: "active" | "archived",
) {
  return db
    .select()
    .from(productCatalogs)
    .where(
      and(
        eq(productCatalogs.projectId, projectId),
        eq(productCatalogs.status, status),
      ),
    )
    .orderBy(asc(productCatalogs.name), asc(productCatalogs.id));
}

export async function getProjectCatalog(projectId: number, catalogId: number) {
  const catalog = await getProjectCatalogById(projectId, catalogId);
  return catalog?.status === "active" ? catalog : null;
}

export async function getProjectCatalogById(
  projectId: number,
  catalogId: number,
) {
  const [catalog] = await db
    .select()
    .from(productCatalogs)
    .where(
      and(
        eq(productCatalogs.projectId, projectId),
        eq(productCatalogs.id, catalogId),
      ),
    )
    .limit(1);

  return catalog ?? null;
}

export async function createProjectCatalog(input: InsertProductCatalog) {
  const [catalog] = await db.insert(productCatalogs).values(input).returning();
  return catalog;
}

export async function archiveProjectCatalog(
  projectId: number,
  catalogId: number,
) {
  const [catalog] = await db
    .update(productCatalogs)
    .set({
      status: "archived",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(productCatalogs.projectId, projectId),
        eq(productCatalogs.id, catalogId),
      ),
    )
    .returning();

  return catalog ?? null;
}

export async function restoreProjectCatalog(
  projectId: number,
  catalogId: number,
) {
  const [catalog] = await db
    .update(productCatalogs)
    .set({
      status: "active",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(productCatalogs.projectId, projectId),
        eq(productCatalogs.id, catalogId),
      ),
    )
    .returning();

  return catalog ?? null;
}

export async function updateProjectCatalogDetails(input: {
  catalogId: number;
  description: string | null;
  name: string;
  projectId: number;
  whatsappCatalogId: string | null;
}) {
  const [catalog] = await db
    .update(productCatalogs)
    .set({
      description: input.description,
      externalId: input.whatsappCatalogId,
      name: input.name,
      providerType: input.whatsappCatalogId ? "whatsapp" : "internal",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(productCatalogs.projectId, input.projectId),
        eq(productCatalogs.id, input.catalogId),
      ),
    )
    .returning();

  return catalog ?? null;
}

export async function deleteProjectCatalog(
  projectId: number,
  catalogId: number,
) {
  const [catalog] = await db
    .delete(productCatalogs)
    .where(
      and(
        eq(productCatalogs.projectId, projectId),
        eq(productCatalogs.id, catalogId),
        eq(productCatalogs.status, "archived"),
      ),
    )
    .returning();

  return catalog ?? null;
}

export async function listProjectCatalogProducts(projectId: number) {
  return db
    .select({
      product: catalogProducts,
      catalog: productCatalogs,
    })
    .from(catalogProducts)
    .innerJoin(
      productCatalogs,
      and(
        eq(productCatalogs.id, catalogProducts.catalogId),
        eq(productCatalogs.projectId, projectId),
      ),
    )
    .where(
      and(
        eq(catalogProducts.projectId, projectId),
        eq(catalogProducts.status, "active"),
        eq(productCatalogs.status, "active"),
      ),
    )
    .orderBy(
      asc(productCatalogs.name),
      asc(catalogProducts.name),
      desc(catalogProducts.createdAt),
    );
}

export async function listArchivedProjectCatalogProducts(projectId: number) {
  return db
    .select({
      product: catalogProducts,
      catalog: productCatalogs,
    })
    .from(catalogProducts)
    .innerJoin(
      productCatalogs,
      and(
        eq(productCatalogs.id, catalogProducts.catalogId),
        eq(productCatalogs.projectId, projectId),
      ),
    )
    .where(
      and(
        eq(catalogProducts.projectId, projectId),
        eq(catalogProducts.status, "archived"),
      ),
    )
    .orderBy(
      asc(productCatalogs.name),
      asc(catalogProducts.name),
      desc(catalogProducts.createdAt),
    );
}

export async function listProjectCatalogProductsForCatalog(
  projectId: number,
  catalogId: number,
) {
  return db
    .select()
    .from(catalogProducts)
    .where(
      and(
        eq(catalogProducts.projectId, projectId),
        eq(catalogProducts.catalogId, catalogId),
        eq(catalogProducts.status, "active"),
      ),
    )
    .orderBy(asc(catalogProducts.name), desc(catalogProducts.createdAt));
}

export async function listProjectCatalogProductsForCatalogIncludingArchived(
  projectId: number,
  catalogId: number,
) {
  return db
    .select()
    .from(catalogProducts)
    .where(
      and(
        eq(catalogProducts.projectId, projectId),
        eq(catalogProducts.catalogId, catalogId),
      ),
    )
    .orderBy(
      asc(catalogProducts.status),
      asc(catalogProducts.name),
      desc(catalogProducts.createdAt),
    );
}

export async function listProjectCatalogProductsByIds(
  projectId: number,
  productIds: number[],
) {
  if (productIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(catalogProducts)
    .where(
      and(
        eq(catalogProducts.projectId, projectId),
        eq(catalogProducts.status, "active"),
        inArray(catalogProducts.id, productIds),
      ),
    )
    .orderBy(asc(catalogProducts.name), desc(catalogProducts.createdAt));
}

export async function createProjectCatalogProduct(input: InsertCatalogProduct) {
  const [product] = await db.insert(catalogProducts).values(input).returning();
  return product;
}

export async function getProjectCatalogProductById(
  projectId: number,
  productId: number,
) {
  const [product] = await db
    .select()
    .from(catalogProducts)
    .where(
      and(
        eq(catalogProducts.projectId, projectId),
        eq(catalogProducts.id, productId),
      ),
    )
    .limit(1);

  return product ?? null;
}

export async function archiveProjectCatalogProduct(
  projectId: number,
  productId: number,
) {
  const [product] = await db
    .update(catalogProducts)
    .set({
      status: "archived",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(catalogProducts.projectId, projectId),
        eq(catalogProducts.id, productId),
      ),
    )
    .returning();

  return product ?? null;
}

export async function restoreProjectCatalogProduct(
  projectId: number,
  productId: number,
) {
  const [product] = await db
    .update(catalogProducts)
    .set({
      status: "active",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(catalogProducts.projectId, projectId),
        eq(catalogProducts.id, productId),
      ),
    )
    .returning();

  return product ?? null;
}

export async function updateProjectCatalogProductDetails(input: {
  catalogId: number;
  currency: string | null;
  description: string | null;
  imageUrl: string | null;
  name: string;
  priceAmount: number | null;
  productId: number;
  productUrl: string | null;
  projectId: number;
  sku: string | null;
  whatsappRetailerId: string | null;
}) {
  const [currentProduct] = await db
    .select()
    .from(catalogProducts)
    .where(
      and(
        eq(catalogProducts.projectId, input.projectId),
        eq(catalogProducts.id, input.productId),
      ),
    )
    .limit(1);

  if (!currentProduct) {
    return null;
  }

  const [product] = await db
    .update(catalogProducts)
    .set({
      catalogId: input.catalogId,
      currency: input.currency,
      description: input.description,
      imageUrl: input.imageUrl,
      metadata: {
        ...currentProduct.metadata,
        whatsappRetailerId: input.whatsappRetailerId,
      },
      name: input.name,
      priceAmount: input.priceAmount,
      productUrl: input.productUrl,
      sku: input.sku,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(catalogProducts.projectId, input.projectId),
        eq(catalogProducts.id, input.productId),
      ),
    )
    .returning();

  return product ?? null;
}

export async function deleteProjectCatalogProduct(
  projectId: number,
  productId: number,
) {
  const [product] = await db
    .delete(catalogProducts)
    .where(
      and(
        eq(catalogProducts.projectId, projectId),
        eq(catalogProducts.id, productId),
        eq(catalogProducts.status, "archived"),
      ),
    )
    .returning();

  return product ?? null;
}
