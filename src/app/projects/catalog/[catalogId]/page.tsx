import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Package,
  Pencil,
  Save,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogFormFields } from "@/components/catalog-form-fields";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmSubmitButton } from "@/components/ui/confirm-action-button";
import { FormActionBar } from "@/components/ui/form-action-bar";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import {
  getProjectCatalogById,
  listProjectCatalogProductsForCatalogIncludingArchived,
} from "@/lib/product-catalogs";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import {
  archiveCatalogAction,
  deleteCatalogAction,
  restoreCatalogAction,
  updateCatalogAction,
} from "../actions";

type CatalogDetailsPageProps = {
  params: Promise<{
    catalogId: string;
  }>;
  searchParams: Promise<{
    productDeleted?: string;
    restored?: string;
    updated?: string;
  }>;
};

export default async function CatalogDetailsPage({
  params,
  searchParams,
}: CatalogDetailsPageProps) {
  const [{ catalogId }, query] = await Promise.all([params, searchParams]);
  const parsedCatalogId = Number(catalogId);

  if (!Number.isInteger(parsedCatalogId) || parsedCatalogId <= 0) {
    notFound();
  }

  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);
  if (!context) {
    notFound();
  }

  const catalog = await getProjectCatalogById(
    context.project.id,
    parsedCatalogId,
  );
  if (!catalog) {
    notFound();
  }

  const products = await listProjectCatalogProductsForCatalogIncludingArchived(
    context.project.id,
    catalog.id,
  );
  const archiveFormId = `archive-catalog-${catalog.id}`;

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <Button variant="link" className="px-0" asChild>
          <Link href="/projects/catalog">
            <ArrowLeft className="h-4 w-4" />
            Back to catalog
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Package className="h-6 w-6" />
                  {catalog.name}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Manage catalog details and optional channel mappings.
                </p>
              </div>
              <Badge
                variant={catalog.status === "active" ? "default" : "secondary"}
              >
                {catalog.status === "active" ? "Active" : "Archived"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {query.updated === "1" && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                Catalog updated.
              </p>
            )}
            {query.restored === "1" && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                Catalog restored.
              </p>
            )}
            {query.productDeleted === "1" && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                Product permanently deleted.
              </p>
            )}

            {catalog.status === "active" ? (
              <>
                <form id={archiveFormId} action={archiveCatalogAction}>
                  <input
                    type="hidden"
                    name="projectId"
                    value={context.project.id}
                  />
                  <input type="hidden" name="catalogId" value={catalog.id} />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={`/projects/catalog/${catalog.id}`}
                  />
                </form>
                <ActionStateForm
                  action={updateCatalogAction}
                  className="space-y-4"
                >
                  <ActionFormError />
                  <input
                    type="hidden"
                    name="projectId"
                    value={context.project.id}
                  />
                  <input type="hidden" name="catalogId" value={catalog.id} />
                  <CatalogFormFields
                    idPrefix={`catalog-${catalog.id}`}
                    defaultValues={{
                      description: catalog.description,
                      name: catalog.name,
                      whatsappCatalogId: catalog.externalId,
                    }}
                  />
                  <FormActionBar
                    primaryAction={
                      <FormSubmitButton
                        label="Save Catalog"
                        pendingLabel="Saving..."
                        icon={<Save className="h-4 w-4" />}
                      />
                    }
                    secondaryActions={
                      <ConfirmSubmitButton
                        form={archiveFormId}
                        variant="outline"
                        confirmation={{
                          title: "Archive this catalog?",
                          description:
                            "The catalog and its products will no longer be available to active flows until restored.",
                          confirmLabel: "Archive Catalog",
                          confirmVariant: "destructive",
                        }}
                      >
                        <Archive className="h-4 w-4" />
                        Archive
                      </ConfirmSubmitButton>
                    }
                  />
                </ActionStateForm>
              </>
            ) : (
              <div className="space-y-5">
                <dl className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">
                      Description
                    </dt>
                    <dd className="mt-1 text-sm">
                      {catalog.description || "No description"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">
                      WhatsApp Catalog ID
                    </dt>
                    <dd className="mt-1 text-sm">
                      {catalog.externalId || "Not mapped"}
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <form action={restoreCatalogAction}>
                    <input
                      type="hidden"
                      name="projectId"
                      value={context.project.id}
                    />
                    <input type="hidden" name="catalogId" value={catalog.id} />
                    <FormSubmitButton
                      label="Restore Catalog"
                      pendingLabel="Restoring..."
                      icon={<ArchiveRestore className="h-4 w-4" />}
                    />
                  </form>
                </div>
                <ActionStateForm
                  action={deleteCatalogAction}
                  className="space-y-3 border-t pt-4"
                >
                  <ActionFormError />
                  <input
                    type="hidden"
                    name="projectId"
                    value={context.project.id}
                  />
                  <input type="hidden" name="catalogId" value={catalog.id} />
                  <p className="text-sm text-muted-foreground">
                    Permanent deletion is available only after every product and
                    flow or task reference has been removed.
                  </p>
                  <FormSubmitButton
                    label="Delete Permanently"
                    pendingLabel="Deleting..."
                    variant="destructive"
                    icon={<Trash2 className="h-4 w-4" />}
                    confirmation={{
                      title: "Permanently delete this catalog?",
                      description:
                        "This cannot be undone. The catalog must have no products or flow references.",
                      confirmLabel: "Delete Catalog",
                      confirmVariant: "destructive",
                    }}
                  />
                </ActionStateForm>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Products</CardTitle>
          </CardHeader>
          <CardContent>
            {products.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No products in this catalog.
              </p>
            ) : (
              <div className="divide-y rounded-md border">
                {products.map((product) => (
                  <div
                    key={product.id}
                    className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{product.name}</p>
                        <Badge
                          variant={
                            product.status === "active"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {product.status === "active" ? "Active" : "Archived"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {product.sku || "No SKU"}
                      </p>
                    </div>
                    <Button variant="outline" asChild>
                      <Link
                        href={`/projects/catalog/${catalog.id}/products/${product.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                        Manage
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
