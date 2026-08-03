import {
  Archive,
  ArchiveRestore,
  PackagePlus,
  Pencil,
  ShoppingBag,
} from "lucide-react";
import Link from "next/link";
import {
  CatalogFormFields,
  ProductFormFields,
} from "@/components/catalog-form-fields";
import { NoProjectState } from "@/components/no-project-state";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import {
  listArchivedProjectCatalogProducts,
  listArchivedProjectCatalogs,
  listProjectCatalogProducts,
  listProjectCatalogs,
} from "@/lib/product-catalogs";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import {
  archiveCatalogAction,
  archiveProductAction,
  createCatalogAction,
  createProductAction,
  restoreCatalogAction,
  restoreProductAction,
} from "./actions";

type CatalogPageProps = {
  searchParams: Promise<{
    catalogCreated?: string;
    catalogDeleted?: string;
    error?: string;
    productCreated?: string;
  }>;
};

type CatalogProductRow = Awaited<
  ReturnType<typeof listProjectCatalogProducts>
>[number];

function formatPrice(priceAmount: number | null, currency: string | null) {
  if (priceAmount === null) {
    return "No price";
  }

  return new Intl.NumberFormat("en", {
    currency: currency ?? "USD",
    style: "currency",
  }).format(priceAmount / 100);
}

function getWhatsAppRetailerId(metadata: Record<string, unknown>) {
  return typeof metadata.whatsappRetailerId === "string"
    ? metadata.whatsappRetailerId
    : "";
}

function ProductList({
  archived,
  projectId,
  rows,
}: {
  archived?: boolean;
  projectId: number;
  rows: CatalogProductRow[];
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {archived ? "No archived products." : "No products added yet."}
      </p>
    );
  }

  return (
    <div className="divide-y rounded-md border">
      {rows.map(({ catalog, product }) => (
        <div
          key={product.id}
          className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{product.name}</p>
              <Badge variant="outline">{catalog.name}</Badge>
              {product.sku && <Badge variant="secondary">{product.sku}</Badge>}
              {getWhatsAppRetailerId(product.metadata) && (
                <Badge variant="outline">
                  WA: {getWhatsAppRetailerId(product.metadata)}
                </Badge>
              )}
            </div>
            <p className="text-sm font-medium">
              {formatPrice(product.priceAmount, product.currency)}
            </p>
            {product.description && (
              <p className="text-sm text-muted-foreground">
                {product.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" asChild>
              <Link
                href={`/projects/catalog/${catalog.id}/products/${product.id}`}
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
            </Button>
            <form
              action={archived ? restoreProductAction : archiveProductAction}
            >
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="returnTo" value="/projects/catalog" />
              <FormSubmitButton
                label={archived ? "Restore" : "Archive"}
                pendingLabel={archived ? "Restoring..." : "Archiving..."}
                variant="outline"
                icon={
                  archived ? (
                    <ArchiveRestore className="h-4 w-4" />
                  ) : (
                    <Archive className="h-4 w-4" />
                  )
                }
              />
            </form>
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function ProjectCatalogPage({
  searchParams,
}: CatalogPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Catalog needs a project" />;
  }

  const { project } = context;
  const [catalogs, archivedCatalogs, products, archivedProducts] =
    await Promise.all([
      listProjectCatalogs(project.id),
      listArchivedProjectCatalogs(project.id),
      listProjectCatalogProducts(project.id),
      listArchivedProjectCatalogProducts(project.id),
    ]);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <ShoppingBag className="h-6 w-6" />
              Product Catalog: {project.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {params.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {params.error}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Manage reusable products once for project chat, widgets, WhatsApp,
              and future channels. WhatsApp IDs are optional channel mappings;
              Lia remains the source of truth.
            </p>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-md border p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Active Catalogs
                </p>
                <p className="text-xl font-semibold">{catalogs.length}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Active Products
                </p>
                <p className="text-xl font-semibold">{products.length}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Archived Catalogs
                </p>
                <p className="text-xl font-semibold">
                  {archivedCatalogs.length}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Archived Products
                </p>
                <p className="text-xl font-semibold">
                  {archivedProducts.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <PackagePlus className="h-5 w-5" />
                Create Catalog
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ActionStateForm
                action={createCatalogAction}
                className="space-y-4"
              >
                <ActionFormError />
                <input type="hidden" name="projectId" value={project.id} />
                <CatalogFormFields idPrefix="create-catalog" />
                <FormSubmitButton
                  label="Create Catalog"
                  pendingLabel="Creating..."
                  icon={<PackagePlus className="h-4 w-4" />}
                />
              </ActionStateForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <PackagePlus className="h-5 w-5" />
                Add Product
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ActionStateForm
                action={createProductAction}
                className="space-y-4"
              >
                <ActionFormError />
                <input type="hidden" name="projectId" value={project.id} />
                <ProductFormFields
                  catalogs={catalogs}
                  idPrefix="create-product"
                />
                <FormSubmitButton
                  label="Add Product"
                  pendingLabel="Adding..."
                  disabled={catalogs.length === 0}
                  icon={<PackagePlus className="h-4 w-4" />}
                />
              </ActionStateForm>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Catalogs</CardTitle>
          </CardHeader>
          <CardContent>
            {catalogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No catalogs created yet.
              </p>
            ) : (
              <div className="divide-y rounded-md border">
                {catalogs.map((catalog) => (
                  <div
                    key={catalog.id}
                    className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <p className="font-medium">{catalog.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {catalog.description || "No description"}
                      </p>
                      {catalog.externalId && (
                        <p className="text-xs text-muted-foreground">
                          WhatsApp catalog: {catalog.externalId}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="outline" asChild>
                        <Link href={`/projects/catalog/${catalog.id}`}>
                          <Pencil className="h-4 w-4" />
                          Edit
                        </Link>
                      </Button>
                      <form action={archiveCatalogAction}>
                        <input
                          type="hidden"
                          name="projectId"
                          value={project.id}
                        />
                        <input
                          type="hidden"
                          name="catalogId"
                          value={catalog.id}
                        />
                        <input
                          type="hidden"
                          name="returnTo"
                          value="/projects/catalog"
                        />
                        <FormSubmitButton
                          label="Archive"
                          pendingLabel="Archiving..."
                          variant="outline"
                          icon={<Archive className="h-4 w-4" />}
                        />
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Products</CardTitle>
          </CardHeader>
          <CardContent>
            <ProductList projectId={project.id} rows={products} />
          </CardContent>
        </Card>

        {(archivedCatalogs.length > 0 || archivedProducts.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Archived Catalog Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <section className="space-y-3">
                <h2 className="font-medium">Catalogs</h2>
                {archivedCatalogs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No archived catalogs.
                  </p>
                ) : (
                  <div className="divide-y rounded-md border">
                    {archivedCatalogs.map((catalog) => (
                      <div
                        key={catalog.id}
                        className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="font-medium">{catalog.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {catalog.description || "No description"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button variant="outline" asChild>
                            <Link href={`/projects/catalog/${catalog.id}`}>
                              <Pencil className="h-4 w-4" />
                              View
                            </Link>
                          </Button>
                          <form action={restoreCatalogAction}>
                            <input
                              type="hidden"
                              name="projectId"
                              value={project.id}
                            />
                            <input
                              type="hidden"
                              name="catalogId"
                              value={catalog.id}
                            />
                            <input
                              type="hidden"
                              name="returnTo"
                              value="/projects/catalog"
                            />
                            <FormSubmitButton
                              label="Restore"
                              pendingLabel="Restoring..."
                              variant="outline"
                              icon={<ArchiveRestore className="h-4 w-4" />}
                            />
                          </form>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section className="space-y-3">
                <h2 className="font-medium">Products</h2>
                <ProductList
                  archived
                  projectId={project.id}
                  rows={archivedProducts}
                />
              </section>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
