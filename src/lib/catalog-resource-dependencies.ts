export type CatalogResourceTarget =
  | { catalogId: number; productId?: never }
  | { catalogId?: never; productId: number };

const catalogIdKeys = new Set(["catalogId", "productCatalogId"]);

function matchesId(value: unknown, expectedId: number) {
  return (
    value === expectedId ||
    (typeof value === "string" && value.trim() === String(expectedId))
  );
}

function containsReference(
  value: unknown,
  target: CatalogResourceTarget,
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsReference(item, target));
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (
      "catalogId" in target &&
      target.catalogId !== undefined &&
      ((catalogIdKeys.has(key) && matchesId(nestedValue, target.catalogId)) ||
        (key === "collectionKey" &&
          nestedValue === `catalog:${target.catalogId}`))
    ) {
      return true;
    }

    if (
      "productId" in target &&
      target.productId !== undefined &&
      key === "productIds" &&
      Array.isArray(nestedValue) &&
      nestedValue.some((item) => matchesId(item, target.productId))
    ) {
      return true;
    }

    if (containsReference(nestedValue, target)) {
      return true;
    }
  }

  return false;
}

export function containsCatalogReference(value: unknown, catalogId: number) {
  return containsReference(value, { catalogId });
}

export function containsProductReference(value: unknown, productId: number) {
  return containsReference(value, { productId });
}
