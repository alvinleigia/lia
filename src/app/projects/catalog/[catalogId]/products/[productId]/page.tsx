import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Package,
  Save,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductFormFields } from "@/components/catalog-form-fields";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormActionBar } from "@/components/ui/form-action-bar";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import {
  getProjectCatalogById,
  getProjectCatalogProductById,
  listProjectCatalogs,
} from "@/lib/product-catalogs";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import {
  archiveProductAction,
  deleteProductAction,
  restoreProductAction,
  updateProductAction,
} from "../../../actions";

type ProductDetailsPageProps = {
  params: Promise<{
    catalogId: string;
    productId: string;
  }>;
  searchParams: Promise<{
    restored?: string;
    updated?: string;
  }>;
};

function getWhatsAppRetailerId(metadata: Record<string, unknown>) {
  return typeof metadata.whatsappRetailerId === "string"
    ? metadata.whatsappRetailerId
    : "";
}

function getAvailability(metadata: Record<string, unknown>) {
  if (metadata.available === true) return "available" as const;
  if (metadata.available === false) return "unavailable" as const;
  return "not_recorded" as const;
}

function formatEditablePrice(priceAmount: number | null) {
  return priceAmount === null ? "" : (priceAmount / 100).toFixed(2);
}

export default async function ProductDetailsPage({
  params,
  searchParams,
}: ProductDetailsPageProps) {
  const [{ catalogId, productId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const parsedCatalogId = Number(catalogId);
  const parsedProductId = Number(productId);

  if (
    !Number.isInteger(parsedCatalogId) ||
    parsedCatalogId <= 0 ||
    !Number.isInteger(parsedProductId) ||
    parsedProductId <= 0
  ) {
    notFound();
  }

  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);
  if (!context) {
    notFound();
  }

  const [catalog, product, catalogs] = await Promise.all([
    getProjectCatalogById(context.project.id, parsedCatalogId),
    getProjectCatalogProductById(context.project.id, parsedProductId),
    listProjectCatalogs(context.project.id),
  ]);
  if (!catalog || !product || product.catalogId !== catalog.id) {
    notFound();
  }

  const canEdit = catalog.status === "active" && product.status === "active";
  const canRestore =
    catalog.status === "active" && product.status === "archived";
  const archiveFormId = `archive-product-${product.id}`;

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <Button variant="link" className="px-0" asChild>
          <Link href={`/projects/catalog/${catalog.id}`}>
            <ArrowLeft className="h-4 w-4" />
            Back to {catalog.name}
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Package className="h-6 w-6" />
                  {product.name}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Product in {catalog.name}
                </p>
              </div>
              <Badge
                variant={product.status === "active" ? "default" : "secondary"}
              >
                {product.status === "active" ? "Active" : "Archived"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {query.updated === "1" && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                Product updated.
              </p>
            )}
            {query.restored === "1" && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                Product restored.
              </p>
            )}

            {canEdit ? (
              <>
                <form id={archiveFormId} action={archiveProductAction}>
                  <input
                    type="hidden"
                    name="projectId"
                    value={context.project.id}
                  />
                  <input type="hidden" name="productId" value={product.id} />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={`/projects/catalog/${catalog.id}/products/${product.id}`}
                  />
                </form>
                <ActionStateForm
                  action={updateProductAction}
                  className="space-y-4"
                >
                  <ActionFormError />
                  <input
                    type="hidden"
                    name="projectId"
                    value={context.project.id}
                  />
                  <input type="hidden" name="productId" value={product.id} />
                  <ProductFormFields
                    catalogs={catalogs}
                    idPrefix={`product-${product.id}`}
                    defaultValues={{
                      availability: getAvailability(product.metadata),
                      catalogId: product.catalogId,
                      currency: product.currency,
                      description: product.description,
                      imageUrl: product.imageUrl,
                      name: product.name,
                      price: formatEditablePrice(product.priceAmount),
                      productUrl: product.productUrl,
                      sku: product.sku,
                      whatsappRetailerId: getWhatsAppRetailerId(
                        product.metadata,
                      ),
                    }}
                  />
                  <FormActionBar
                    primaryAction={
                      <FormSubmitButton
                        label="Save Product"
                        pendingLabel="Saving..."
                        icon={<Save className="h-4 w-4" />}
                      />
                    }
                    secondaryActions={
                      <Button
                        type="submit"
                        form={archiveFormId}
                        variant="outline"
                      >
                        <Archive className="h-4 w-4" />
                        Archive
                      </Button>
                    }
                  />
                </ActionStateForm>
              </>
            ) : (
              <div className="space-y-5">
                {catalog.status === "archived" && (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Restore the parent catalog before editing or restoring this
                    product.
                  </p>
                )}
                <dl className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">
                      SKU
                    </dt>
                    <dd className="mt-1 text-sm">{product.sku || "No SKU"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">
                      Description
                    </dt>
                    <dd className="mt-1 text-sm">
                      {product.description || "No description"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">
                      Price
                    </dt>
                    <dd className="mt-1 text-sm">
                      {product.priceAmount === null
                        ? "No price"
                        : `${formatEditablePrice(product.priceAmount)} ${product.currency ?? "USD"}`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">
                      WhatsApp Retailer ID
                    </dt>
                    <dd className="mt-1 text-sm">
                      {getWhatsAppRetailerId(product.metadata) || "Not mapped"}
                    </dd>
                  </div>
                </dl>

                {product.status === "active" && (
                  <form action={archiveProductAction}>
                    <input
                      type="hidden"
                      name="projectId"
                      value={context.project.id}
                    />
                    <input type="hidden" name="productId" value={product.id} />
                    <input
                      type="hidden"
                      name="returnTo"
                      value={`/projects/catalog/${catalog.id}/products/${product.id}`}
                    />
                    <FormSubmitButton
                      label="Archive Product"
                      pendingLabel="Archiving..."
                      variant="outline"
                      icon={<Archive className="h-4 w-4" />}
                    />
                  </form>
                )}

                {canRestore && (
                  <form action={restoreProductAction}>
                    <input
                      type="hidden"
                      name="projectId"
                      value={context.project.id}
                    />
                    <input type="hidden" name="productId" value={product.id} />
                    <FormSubmitButton
                      label="Restore Product"
                      pendingLabel="Restoring..."
                      icon={<ArchiveRestore className="h-4 w-4" />}
                    />
                  </form>
                )}

                {product.status === "archived" && (
                  <ActionStateForm
                    action={deleteProductAction}
                    className="space-y-3 border-t pt-4"
                  >
                    <ActionFormError />
                    <input
                      type="hidden"
                      name="projectId"
                      value={context.project.id}
                    />
                    <input type="hidden" name="productId" value={product.id} />
                    <p className="text-sm text-muted-foreground">
                      Permanent deletion is blocked while a draft or published
                      flow or task still references this product.
                    </p>
                    <FormSubmitButton
                      label="Delete Permanently"
                      pendingLabel="Deleting..."
                      variant="destructive"
                      icon={<Trash2 className="h-4 w-4" />}
                    />
                  </ActionStateForm>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
