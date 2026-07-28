import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type CatalogOption = {
  id: number;
  name: string;
};

type CatalogFormFieldsProps = {
  defaultValues?: {
    description?: string | null;
    name?: string;
    whatsappCatalogId?: string | null;
  };
  idPrefix: string;
};

type ProductFormFieldsProps = {
  catalogs: CatalogOption[];
  defaultValues?: {
    catalogId?: number;
    currency?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    name?: string;
    price?: string;
    productUrl?: string | null;
    sku?: string | null;
    whatsappRetailerId?: string | null;
  };
  idPrefix: string;
};

export function CatalogFormFields({
  defaultValues,
  idPrefix,
}: CatalogFormFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-name`}>Catalog Name</Label>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          defaultValue={defaultValues?.name ?? ""}
          placeholder="e.g. Salon Services"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-description`}>Description</Label>
        <Textarea
          id={`${idPrefix}-description`}
          name="description"
          defaultValue={defaultValues?.description ?? ""}
          placeholder="Optional internal note"
          rows={3}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-whatsapp-catalog-id`}>
          WhatsApp Catalog ID
        </Label>
        <Input
          id={`${idPrefix}-whatsapp-catalog-id`}
          name="whatsappCatalogId"
          defaultValue={defaultValues?.whatsappCatalogId ?? ""}
          placeholder="Optional Meta catalog ID"
        />
        <p className="text-xs text-muted-foreground">
          Optional channel mapping. Lia remains the source of truth.
        </p>
      </div>
    </>
  );
}

export function ProductFormFields({
  catalogs,
  defaultValues,
  idPrefix,
}: ProductFormFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-catalog-id`}>Catalog</Label>
        <select
          id={`${idPrefix}-catalog-id`}
          name="catalogId"
          defaultValue={defaultValues?.catalogId}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          required
          disabled={catalogs.length === 0}
        >
          {catalogs.length === 0 ? (
            <option value="">Create or restore a catalog first</option>
          ) : (
            catalogs.map((catalog) => (
              <option key={catalog.id} value={catalog.id}>
                {catalog.name}
              </option>
            ))
          )}
        </select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-name`}>Product Name</Label>
          <Input
            id={`${idPrefix}-name`}
            name="name"
            defaultValue={defaultValues?.name ?? ""}
            placeholder="e.g. Hair Spa"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-sku`}>SKU</Label>
          <Input
            id={`${idPrefix}-sku`}
            name="sku"
            defaultValue={defaultValues?.sku ?? ""}
            placeholder="Optional"
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-price`}>Price</Label>
          <Input
            id={`${idPrefix}-price`}
            name="price"
            defaultValue={defaultValues?.price ?? ""}
            inputMode="decimal"
            placeholder="e.g. 49.99"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-currency`}>Currency</Label>
          <Input
            id={`${idPrefix}-currency`}
            name="currency"
            defaultValue={defaultValues?.currency ?? ""}
            maxLength={3}
            placeholder="USD"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-description`}>Description</Label>
        <Textarea
          id={`${idPrefix}-description`}
          name="description"
          defaultValue={defaultValues?.description ?? ""}
          placeholder="Optional product details"
          rows={3}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-image-url`}>Image URL</Label>
          <Input
            id={`${idPrefix}-image-url`}
            name="imageUrl"
            type="url"
            defaultValue={defaultValues?.imageUrl ?? ""}
            placeholder="https://..."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-product-url`}>Product URL</Label>
          <Input
            id={`${idPrefix}-product-url`}
            name="productUrl"
            type="url"
            defaultValue={defaultValues?.productUrl ?? ""}
            placeholder="https://..."
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-whatsapp-retailer-id`}>
          WhatsApp Retailer ID
        </Label>
        <Input
          id={`${idPrefix}-whatsapp-retailer-id`}
          name="whatsappRetailerId"
          defaultValue={defaultValues?.whatsappRetailerId ?? ""}
          placeholder="Optional product_retailer_id"
        />
        <p className="text-xs text-muted-foreground">
          Optional channel mapping for WhatsApp catalog messages.
        </p>
      </div>
    </>
  );
}
