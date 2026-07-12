import { Archive, PackagePlus, ShoppingBag } from "lucide-react";
import { NoProjectState } from "@/components/no-project-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getActiveProjectIdCookie,
  resolveOptionalUserAndProject,
} from "@/lib/auth-project";
import {
  listProjectCatalogProducts,
  listProjectCatalogs,
} from "@/lib/product-catalogs";
import {
  archiveCatalogAction,
  archiveProductAction,
  createCatalogAction,
  createProductAction,
  updateCatalogWhatsAppSettingsAction,
  updateProductWhatsAppSettingsAction,
} from "./actions";

type CatalogPageProps = {
  searchParams: Promise<{
    catalogArchived?: string;
    catalogCreated?: string;
    catalogUpdated?: string;
    error?: string;
    productArchived?: string;
    productCreated?: string;
    productUpdated?: string;
  }>;
};

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

export default async function ProjectCatalogPage({
  searchParams,
}: CatalogPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Catalog needs a project" />;
  }

  const { project } = context;
  const [catalogs, products] = await Promise.all([
    listProjectCatalogs(project.id),
    listProjectCatalogProducts(project.id),
  ]);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <ShoppingBag className="h-6 w-6" />
              Product Catalog: {project.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}
            {params.catalogCreated === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Catalog created.
              </p>
            )}
            {params.productCreated === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Product created.
              </p>
            )}
            {(params.catalogUpdated === "1" ||
              params.productUpdated === "1") && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                WhatsApp catalog settings saved.
              </p>
            )}
            {(params.catalogArchived === "1" ||
              params.productArchived === "1") && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Catalog item archived.
              </p>
            )}

            <p className="text-sm text-muted-foreground">
              Keep reusable product data here first. Future catalog, single
              product, and multi-product flow blocks will reference this source
              for widget, WhatsApp, and other channels.
            </p>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Active Catalogs
                </p>
                <p className="text-xl font-semibold">{catalogs.length}</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Active Products
                </p>
                <p className="text-xl font-semibold">{products.length}</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Source
                </p>
                <p className="text-xl font-semibold">Internal</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <PackagePlus className="h-5 w-5" />
                Create Catalog
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createCatalogAction} className="space-y-4">
                <input type="hidden" name="projectId" value={project.id} />
                <div className="space-y-2">
                  <Label htmlFor="catalog-name">Catalog Name</Label>
                  <Input
                    id="catalog-name"
                    name="name"
                    placeholder="e.g. Salon Services"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="catalog-description">Description</Label>
                  <Textarea
                    id="catalog-description"
                    name="description"
                    placeholder="Optional internal note"
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="whatsapp-catalog-id">
                    WhatsApp Catalog ID
                  </Label>
                  <Input
                    id="whatsapp-catalog-id"
                    name="whatsappCatalogId"
                    placeholder="Optional Meta catalog id"
                  />
                </div>
                <FormSubmitButton
                  label="Create Catalog"
                  pendingLabel="Creating..."
                  icon={<PackagePlus className="h-4 w-4" />}
                />
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <PackagePlus className="h-5 w-5" />
                Add Product
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createProductAction} className="space-y-4">
                <input type="hidden" name="projectId" value={project.id} />
                <div className="space-y-2">
                  <Label htmlFor="catalog-id">Catalog</Label>
                  <select
                    id="catalog-id"
                    name="catalogId"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                    disabled={catalogs.length === 0}
                  >
                    {catalogs.length === 0 ? (
                      <option value="">Create a catalog first</option>
                    ) : (
                      catalogs.map((catalog) => (
                        <option key={catalog.id} value={catalog.id}>
                          {catalog.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="product-name">Product Name</Label>
                    <Input
                      id="product-name"
                      name="name"
                      placeholder="e.g. Hair Spa"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-sku">SKU</Label>
                    <Input id="product-sku" name="sku" placeholder="Optional" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="whatsapp-retailer-id">
                    WhatsApp Retailer ID
                  </Label>
                  <Input
                    id="whatsapp-retailer-id"
                    name="whatsappRetailerId"
                    placeholder="Optional product_retailer_id"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="product-price">Price</Label>
                    <Input
                      id="product-price"
                      name="price"
                      inputMode="decimal"
                      placeholder="e.g. 49.99"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-currency">Currency</Label>
                    <Input
                      id="product-currency"
                      name="currency"
                      maxLength={3}
                      placeholder="USD"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="product-description">Description</Label>
                  <Textarea
                    id="product-description"
                    name="description"
                    placeholder="Optional product details"
                    rows={3}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="product-image-url">Image URL</Label>
                    <Input
                      id="product-image-url"
                      name="imageUrl"
                      type="url"
                      placeholder="https://..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-url">Product URL</Label>
                    <Input
                      id="product-url"
                      name="productUrl"
                      type="url"
                      placeholder="https://..."
                    />
                  </div>
                </div>
                <FormSubmitButton
                  label="Add Product"
                  pendingLabel="Adding..."
                  disabled={catalogs.length === 0}
                  icon={<PackagePlus className="h-4 w-4" />}
                />
              </form>
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
              <div className="space-y-3">
                {catalogs.map((catalog) => (
                  <div
                    key={catalog.id}
                    className="rounded-md border bg-white px-4 py-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">{catalog.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {catalog.description || "No description"} ·{" "}
                          {catalog.providerType}
                        </p>
                        {catalog.externalId && (
                          <p className="text-xs text-muted-foreground">
                            WhatsApp catalog: {catalog.externalId}
                          </p>
                        )}
                        <form
                          action={updateCatalogWhatsAppSettingsAction}
                          className="mt-3 flex max-w-md flex-col gap-2 sm:flex-row"
                        >
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
                          <Input
                            name="whatsappCatalogId"
                            defaultValue={catalog.externalId ?? ""}
                            placeholder="WhatsApp catalog id"
                          />
                          <FormSubmitButton
                            label="Save"
                            pendingLabel="Saving..."
                            variant="outline"
                          />
                        </form>
                      </div>
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
            {products.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No products added yet.
              </p>
            ) : (
              <div className="space-y-3">
                {products.map(({ catalog, product }) => (
                  <div
                    key={product.id}
                    className="rounded-md border bg-white px-4 py-3"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{product.name}</p>
                          <span className="rounded-md border px-2 py-1 text-xs">
                            {catalog.name}
                          </span>
                          {product.sku && (
                            <span className="rounded-md border px-2 py-1 text-xs">
                              {product.sku}
                            </span>
                          )}
                          {getWhatsAppRetailerId(product.metadata) && (
                            <span className="rounded-md border px-2 py-1 text-xs">
                              WA: {getWhatsAppRetailerId(product.metadata)}
                            </span>
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
                        {(product.imageUrl || product.productUrl) && (
                          <p className="break-all text-xs text-muted-foreground">
                            {product.imageUrl || product.productUrl}
                          </p>
                        )}
                        <form
                          action={updateProductWhatsAppSettingsAction}
                          className="mt-3 flex max-w-md flex-col gap-2 sm:flex-row"
                        >
                          <input
                            type="hidden"
                            name="projectId"
                            value={project.id}
                          />
                          <input
                            type="hidden"
                            name="productId"
                            value={product.id}
                          />
                          <Input
                            name="whatsappRetailerId"
                            defaultValue={getWhatsAppRetailerId(
                              product.metadata,
                            )}
                            placeholder="WhatsApp retailer id"
                          />
                          <FormSubmitButton
                            label="Save"
                            pendingLabel="Saving..."
                            variant="outline"
                          />
                        </form>
                      </div>
                      <form action={archiveProductAction}>
                        <input
                          type="hidden"
                          name="projectId"
                          value={project.id}
                        />
                        <input
                          type="hidden"
                          name="productId"
                          value={product.id}
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
      </div>
    </div>
  );
}
