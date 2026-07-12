"use client";

import type { ProductDisplayLayout } from "@/lib/action-runtime";
import type { RuntimeReplyProduct } from "@/lib/runtime-replies";

type ActionFlowProductCardsProps = {
  compact?: boolean;
  layout?: ProductDisplayLayout;
  products: RuntimeReplyProduct[];
};

function formatPrice(product: RuntimeReplyProduct) {
  if (product.priceAmount === null) {
    return "";
  }

  return new Intl.NumberFormat("en", {
    currency: product.currency ?? "USD",
    style: "currency",
  }).format(product.priceAmount / 100);
}

export function ActionFlowProductCards({
  compact = false,
  layout = "grid",
  products,
}: ActionFlowProductCardsProps) {
  if (products.length === 0) {
    return null;
  }

  const resolvedLayout = compact && layout === "grid" ? "list" : layout;

  return (
    <div
      className={
        resolvedLayout === "grid"
          ? "mt-3 grid gap-3 sm:grid-cols-2"
          : "mt-3 space-y-2"
      }
    >
      {products.map((product, index) => {
        const price = formatPrice(product);
        const isFeatured = resolvedLayout === "featured" && index === 0;
        const content = (
          <div
            className={
              isFeatured
                ? "rounded-md border bg-white text-left text-gray-900 shadow-xs"
                : "flex h-full gap-3 rounded-md border bg-white p-3 text-left text-gray-900 shadow-xs"
            }
            key={product.id}
          >
            {product.imageUrl ? (
              <div
                className={
                  isFeatured
                    ? "aspect-[16/9] w-full rounded-t-md border-b bg-cover bg-center"
                    : "h-16 w-16 shrink-0 rounded-md border bg-cover bg-center"
                }
                style={{ backgroundImage: `url("${product.imageUrl}")` }}
              />
            ) : (
              <div
                className={
                  isFeatured
                    ? "flex aspect-[16/9] w-full items-center justify-center rounded-t-md border-b bg-gray-50 text-xs font-medium text-gray-500"
                    : "flex h-16 w-16 shrink-0 items-center justify-center rounded-md border bg-gray-50 text-xs font-medium text-gray-500"
                }
              >
                Item
              </div>
            )}
            <div className={isFeatured ? "min-w-0 p-3" : "min-w-0 flex-1"}>
              <p className="line-clamp-2 font-medium leading-snug">
                {product.name}
              </p>
              {price && <p className="text-sm font-semibold">{price}</p>}
              {product.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {product.description}
                </p>
              )}
              {(product.sku || product.whatsappRetailerId) && (
                <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {product.whatsappRetailerId || product.sku}
                </p>
              )}
            </div>
          </div>
        );

        return product.productUrl ? (
          <a
            className="block hover:opacity-90"
            href={product.productUrl}
            key={product.id}
            rel="noreferrer"
            target="_blank"
          >
            {content}
          </a>
        ) : (
          <div key={product.id}>{content}</div>
        );
      })}
    </div>
  );
}
