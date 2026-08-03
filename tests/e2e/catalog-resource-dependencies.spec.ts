import { expect, test } from "@playwright/test";
import {
  containsCatalogReference,
  containsProductReference,
} from "@/lib/catalog-resource-dependencies";

test("finds catalog references in flow and task contracts", () => {
  expect(containsCatalogReference({ productCatalogId: 12 }, 12)).toBe(true);
  expect(
    containsCatalogReference(
      {
        contentDocument: {
          blocks: [
            { catalogId: "12", productIds: [20, 21] },
            { collectionKey: "catalog:12" },
          ],
          schemaVersion: 1,
        },
      },
      12,
    ),
  ).toBe(true);
});

test("finds product references without matching unrelated ids", () => {
  expect(
    containsProductReference(
      {
        contentDocument: {
          blocks: [{ productIds: [20, "21"] }],
          schemaVersion: 1,
        },
      },
      21,
    ),
  ).toBe(true);
  expect(containsProductReference({ id: 21, productId: 21 }, 21)).toBe(false);
});

test("does not match neighboring catalog identifiers", () => {
  expect(
    containsCatalogReference(
      {
        id: 12,
        collectionKey: "catalog:120",
        productCatalogId: 120,
      },
      12,
    ),
  ).toBe(false);
});
