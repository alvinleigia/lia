import { Plus, Save } from "lucide-react";
import {
  createActionFlowStepAction,
  updateActionFlowStepAction,
} from "@/app/projects/actions/actions";
import { ACTION_STEP_INPUT_TYPES } from "@/lib/action-flow-constants";
import {
  formatFlowComponentLabel,
  getFlowComponentLabel,
  listEnabledStepFlowComponents,
} from "@/lib/flow-components";
import { FormSubmitButton } from "./ui/form-submit-button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

type OperationOption = {
  id: number;
  name: string;
};

type MediaAssetOption = {
  id: number;
  label: string;
  mediaType: string;
};

type ProductCatalogOption = {
  id: number;
  name: string;
};

type ProjectActionOption = {
  id: number;
  name: string;
};

type CatalogProductOption = {
  catalogId: number;
  catalogName: string;
  id: number;
  name: string;
  sku: string | null;
};

type ActionStepFormStep = {
  id: number;
  sortOrder: number;
  stepType: string;
  fieldKey: string | null;
  label: string | null;
  prompt: string | null;
  inputType: string | null;
  nextStepId: number | null;
  operationId: number | null;
  isRequired: boolean;
  isEnabled: boolean;
  options: unknown;
  settings: Record<string, unknown>;
};

type ReusableFieldOption = {
  actions: Array<{
    id: number;
    name: string;
  }>;
  fieldKey: string;
  inputTypes: string[];
  labels: string[];
  stepTypes: string[];
  usageCount: number;
};

type RouteStepOption = {
  id: number;
  sortOrder: number;
  stepType: string;
  fieldKey: string | null;
  label: string | null;
};

type ActionStepFormProps = {
  actionId: number;
  catalogProducts: CatalogProductOption[];
  mediaAssets: MediaAssetOption[];
  mode: "create" | "edit";
  operations: OperationOption[];
  productCatalogs: ProductCatalogOption[];
  projectActions: ProjectActionOption[];
  reusableFields?: ReusableFieldOption[];
  nextSortOrder?: number;
  operationRoutePresets?: {
    failureStepId?: number | null;
    successStepId?: number | null;
  };
  routeStepOptions?: RouteStepOption[];
  step?: ActionStepFormStep;
};

function optionsToText(options: unknown) {
  if (!Array.isArray(options)) {
    return "";
  }

  return options
    .map((option) => {
      if (
        option &&
        typeof option === "object" &&
        "label" in option &&
        typeof option.label === "string"
      ) {
        return option.label;
      }

      return typeof option === "string" ? option : "";
    })
    .filter(Boolean)
    .join("\n");
}

function getSourceType(settings?: Record<string, unknown>) {
  return typeof settings?.sourceType === "string" ? settings.sourceType : "";
}

function getChoiceDisplayMode(settings?: Record<string, unknown>) {
  return typeof settings?.choiceDisplayMode === "string"
    ? settings.choiceDisplayMode
    : "buttons";
}

function getOperationExecutionMode(settings?: Record<string, unknown>) {
  return settings?.operationExecutionMode === "inline"
    ? "inline"
    : "post_submit";
}

function getMediaAssetId(settings?: Record<string, unknown>) {
  const value = settings?.mediaAssetId;
  return typeof value === "number" ? value : "";
}

function getProductCatalogId(settings?: Record<string, unknown>) {
  const value = settings?.productCatalogId;
  return typeof value === "number" ? value : "";
}

function getProductIds(settings?: Record<string, unknown>) {
  const value = settings?.productIds;
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number")
    : [];
}

function getProductDisplayLayout(settings?: Record<string, unknown>) {
  const layout = settings?.productDisplayLayout;

  return layout === "featured" || layout === "list" || layout === "grid"
    ? layout
    : "grid";
}

function getProductSelectionAllowQuantity(settings?: Record<string, unknown>) {
  return settings?.productSelectionAllowQuantity === true;
}

function getProductSelectionAllowMultiple(settings?: Record<string, unknown>) {
  return settings?.productSelectionAllowMultiple === true;
}

function getConnectedActionId(settings?: Record<string, unknown>) {
  const value = settings?.connectedActionId;
  return typeof value === "number" ? value : "";
}

function getConnectFlowMode(settings?: Record<string, unknown>) {
  return settings?.connectFlowMode === "return" ? "return" : "jump";
}

function getTemplateCategory(settings?: Record<string, unknown>) {
  const category = settings?.whatsappTemplateCategory;

  return category === "authentication" ||
    category === "marketing" ||
    category === "utility"
    ? category
    : "utility";
}

function getTemplateStatus(settings?: Record<string, unknown>) {
  const status = settings?.whatsappTemplateStatus;

  return status === "approved" ||
    status === "draft" ||
    status === "pending" ||
    status === "rejected"
    ? status
    : "draft";
}

function getTemplateVariables(settings?: Record<string, unknown>) {
  const variables = settings?.whatsappTemplateVariables;

  return Array.isArray(variables)
    ? variables.filter((item): item is string => typeof item === "string")
    : [];
}

function getHandoffPriority(settings?: Record<string, unknown>) {
  const priority = settings?.handoffPriority;

  return priority === "urgent" ||
    priority === "high" ||
    priority === "normal" ||
    priority === "low"
    ? priority
    : "normal";
}

function getSettingText(settings: Record<string, unknown>, key: string) {
  const value = settings[key];
  return typeof value === "string" ? value : "";
}

function getSettingNumber(settings: Record<string, unknown>, key: string) {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

function getSourceConfigValue(
  settings: Record<string, unknown> | undefined,
  key: "catalogId" | "filterByField",
) {
  const sourceConfig =
    settings?.sourceConfig && typeof settings.sourceConfig === "object"
      ? settings.sourceConfig
      : null;

  if (!sourceConfig || !(key in sourceConfig)) {
    return "";
  }

  const value = sourceConfig[key as keyof typeof sourceConfig];
  return typeof value === "string" ? value : "";
}

function formatStepLabel(step: RouteStepOption) {
  return `${step.sortOrder}. ${
    step.label || step.fieldKey || getFlowComponentLabel(step.stepType)
  }`;
}

function formatReusableFieldMeta(field: ReusableFieldOption) {
  const label = field.labels[0] ? `${field.labels[0]} - ` : "";
  const inputType =
    field.inputTypes.length > 0 ? `${field.inputTypes.join(", ")} - ` : "";

  return `${label}${inputType}${field.usageCount} use${
    field.usageCount === 1 ? "" : "s"
  }`;
}

export function ActionStepForm({
  actionId,
  catalogProducts,
  mediaAssets,
  mode,
  operations,
  productCatalogs,
  projectActions,
  reusableFields = [],
  nextSortOrder,
  operationRoutePresets,
  routeStepOptions = [],
  step,
}: ActionStepFormProps) {
  const isEdit = mode === "edit";
  const settings = step?.settings ?? {};
  const nextStepOptions = routeStepOptions.filter(
    (option) => option.id !== step?.id,
  );
  const stepComponents = listEnabledStepFlowComponents();
  const reusableFieldSuggestions = reusableFields.slice(0, 8);

  return (
    <form
      action={isEdit ? updateActionFlowStepAction : createActionFlowStepAction}
      className="space-y-4"
    >
      <input type="hidden" name="actionId" value={actionId} />
      {step && <input type="hidden" name="stepId" value={step.id} />}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="sortOrder">Order</Label>
          <Input
            id="sortOrder"
            name="sortOrder"
            type="number"
            min="1"
            defaultValue={step?.sortOrder ?? nextSortOrder ?? 1}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="stepType">Step Behavior</Label>
          <select
            id="stepType"
            name="stepType"
            defaultValue={step?.stepType ?? "collect_input"}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            required
          >
            {stepComponents.map((component) => (
              <option key={component.key} value={component.stepType}>
                {component.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Input-like behaviors collect fields. File upload is a graceful
            placeholder until upload support is added.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="inputType">Data Type</Label>
          <select
            id="inputType"
            name="inputType"
            defaultValue={step?.inputType ?? "text"}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">Select data type</option>
            {ACTION_STEP_INPUT_TYPES.map((inputType) => (
              <option key={inputType} value={inputType}>
                {formatFlowComponentLabel(inputType)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fieldKey">Field Key</Label>
          <Input
            id="fieldKey"
            name="fieldKey"
            list="reusable-field-keys"
            defaultValue={step?.fieldKey ?? ""}
            placeholder="guestEmail"
          />
          <datalist id="reusable-field-keys">
            {reusableFields.map((field) => (
              <option
                key={field.fieldKey}
                value={field.fieldKey}
                label={formatReusableFieldMeta(field)}
              />
            ))}
          </datalist>
        </div>
      </div>

      {reusableFieldSuggestions.length > 0 && (
        <div className="space-y-2 rounded-md border bg-slate-50 p-3">
          <p className="text-sm font-medium">Reusable Fields</p>
          <div className="flex flex-wrap gap-2">
            {reusableFieldSuggestions.map((field) => (
              <span
                key={field.fieldKey}
                className="rounded-md border bg-white px-2 py-1 text-xs text-slate-700"
                title={`Used in ${field.actions
                  .map((action) => action.name)
                  .join(", ")}`}
              >
                {field.fieldKey} ({field.usageCount})
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Field keys with the same name are treated as the same collected
            value across routing, mappings, templates, and submissions.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="label">Label</Label>
          <Input
            id="label"
            name="label"
            defaultValue={step?.label ?? ""}
            placeholder="Guest email"
          />
        </div>
        <label className="flex items-center gap-2 pt-8 text-sm">
          <input
            type="checkbox"
            name="isRequired"
            defaultChecked={step?.isRequired ?? true}
          />
          Required
        </label>
        <label className="flex items-center gap-2 text-sm md:col-start-2">
          <input
            type="checkbox"
            name="isEnabled"
            defaultChecked={step?.isEnabled ?? true}
          />
          Enabled
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="sourceType">Option Source</Label>
          <select
            id="sourceType"
            name="sourceType"
            defaultValue={getSourceType(settings)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">Manual Options</option>
            <option value="catalog_categories">Catalog Categories</option>
            <option value="catalog_items">Catalog Items</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="catalogId">Catalog</Label>
          <select
            id="catalogId"
            name="catalogId"
            defaultValue={getSourceConfigValue(settings, "catalogId")}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">None</option>
            <option value="cat_spa_services">Spa Services</option>
            <option value="cat_salon_services">Salon Services</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="filterByField">Filter By Field</Label>
          <Input
            id="filterByField"
            name="filterByField"
            defaultValue={getSourceConfigValue(settings, "filterByField")}
            placeholder="serviceCategoryId"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mediaAssetId">Media Asset</Label>
        <select
          id="mediaAssetId"
          name="mediaAssetId"
          defaultValue={getMediaAssetId(settings)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">No media asset</option>
          {mediaAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.label} ({asset.mediaType})
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Used by Media message steps. Upload assets from the Media Library.
        </p>
      </div>

      <div className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="whatsappTemplateName">WhatsApp Template Name</Label>
          <Input
            id="whatsappTemplateName"
            name="whatsappTemplateName"
            defaultValue={getSettingText(settings, "whatsappTemplateName")}
            placeholder="appointment_reminder"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="whatsappTemplateLanguage">Language</Label>
          <Input
            id="whatsappTemplateLanguage"
            name="whatsappTemplateLanguage"
            defaultValue={
              getSettingText(settings, "whatsappTemplateLanguage") || "en_US"
            }
            placeholder="en_US"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="whatsappTemplateCategory">Category</Label>
          <select
            id="whatsappTemplateCategory"
            name="whatsappTemplateCategory"
            defaultValue={getTemplateCategory(settings)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="utility">Utility</option>
            <option value="marketing">Marketing</option>
            <option value="authentication">Authentication</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="whatsappTemplateStatus">Approval Status</Label>
          <select
            id="whatsappTemplateStatus"
            name="whatsappTemplateStatus"
            defaultValue={getTemplateStatus(settings)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="draft">Draft</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="whatsappTemplateBody">Meta Body Sample</Label>
          <Textarea
            id="whatsappTemplateBody"
            name="whatsappTemplateBody"
            defaultValue={getSettingText(settings, "whatsappTemplateBody")}
            placeholder="Hello {{1}}, your appointment is confirmed for {{2}}."
          />
          <p className="text-xs text-muted-foreground">
            Paste the approved Meta template body with numbered placeholders so
            the builder can check variable compatibility.
          </p>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="whatsappTemplateVariables">Body Variables</Label>
          <Textarea
            id="whatsappTemplateVariables"
            name="whatsappTemplateVariables"
            defaultValue={getTemplateVariables(settings).join("\n")}
            placeholder={"{{guestName}}\n{{preferredDate}}"}
          />
          <p className="text-xs text-muted-foreground">
            Used by Template blocks. Add one body parameter per line. Use
            {" {{fieldKey}} "} to fill from collected fields.
          </p>
        </div>
      </div>

      <div className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="productDisplayLayout">Browser Layout</Label>
          <select
            id="productDisplayLayout"
            name="productDisplayLayout"
            defaultValue={getProductDisplayLayout(settings)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="grid">Grid cards</option>
            <option value="list">Compact list</option>
            <option value="featured">Featured first item</option>
          </select>
          <p className="text-xs text-muted-foreground">
            Used by project chat and website widget product cards. WhatsApp uses
            its own product message layout.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            name="productSelectionAllowMultiple"
            defaultChecked={getProductSelectionAllowMultiple(settings)}
          />
          Allow multiple products as a cart for Product Selection blocks
        </label>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            name="productSelectionAllowQuantity"
            defaultChecked={getProductSelectionAllowQuantity(settings)}
          />
          Collect quantity for Product Selection blocks
        </label>
        <div className="space-y-2">
          <Label htmlFor="productCatalogId">Product Catalog</Label>
          <select
            id="productCatalogId"
            name="productCatalogId"
            defaultValue={getProductCatalogId(settings)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">No product catalog</option>
            {productCatalogs.map((catalog) => (
              <option key={catalog.id} value={catalog.id}>
                {catalog.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Used by Catalogue Message and Product Selection blocks. Single and
            Multiple Product blocks infer the catalog from selected products.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="productIds">Products</Label>
          <select
            id="productIds"
            name="productIds"
            multiple
            defaultValue={getProductIds(settings).map(String)}
            className="flex min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {catalogProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {product.catalogName}: {product.name}
                {product.sku ? ` (${product.sku})` : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Used by Single Product, Multiple Products, and Product Selection
            blocks. Hold Ctrl or Shift to select more than one.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="operationId">Operation</Label>
        <select
          id="operationId"
          name="operationId"
          defaultValue={step?.operationId ?? ""}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">No operation</option>
          {operations.map((operation) => (
            <option key={operation.id} value={operation.id}>
              {operation.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Operation steps can run inline or after submission. Request
          Intervention blocks can use this as the staff notification operation.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="operationExecutionMode">Operation Execution</Label>
        <select
          id="operationExecutionMode"
          name="operationExecutionMode"
          defaultValue={getOperationExecutionMode(settings)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="post_submit">After submission</option>
          <option value="inline">Inline during conversation</option>
        </select>
      </div>

      <div className="space-y-2 rounded-md border p-4">
        <Label htmlFor="connectedActionId">Connected Flow</Label>
        <select
          id="connectedActionId"
          name="connectedActionId"
          defaultValue={getConnectedActionId(settings)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">No connected flow</option>
          {projectActions.map((projectAction) => (
            <option key={projectAction.id} value={projectAction.id}>
              {projectAction.name}
            </option>
          ))}
        </select>
        <Label htmlFor="connectFlowMode">Flow Behavior</Label>
        <select
          id="connectFlowMode"
          name="connectFlowMode"
          defaultValue={getConnectFlowMode(settings)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="jump">Jump into connected flow</option>
          <option value="return">Return after connected flow submits</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Jump ends this flow and continues in the connected flow. Return uses
          the connected flow as a reusable subflow, then resumes this flow.
        </p>
      </div>

      <div className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="operationSuccessStepId">Success Route</Label>
          <select
            id="operationSuccessStepId"
            name="operationSuccessStepId"
            defaultValue={operationRoutePresets?.successStepId ?? ""}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">No preset route</option>
            {nextStepOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {formatStepLabel(option)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="operationFailureStepId">Failure Route</Label>
          <select
            id="operationFailureStepId"
            name="operationFailureStepId"
            defaultValue={operationRoutePresets?.failureStepId ?? ""}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">No preset route</option>
            {nextStepOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {formatStepLabel(option)}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground md:col-span-2">
          For inline operation steps, these create branch rules where the status
          field equals completed or failed.
        </p>
      </div>

      <div className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="contactAttributeKey">Contact Attribute Key</Label>
          <Input
            id="contactAttributeKey"
            name="contactAttributeKey"
            defaultValue={getSettingText(settings, "contactAttributeKey")}
            placeholder="lead_status"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contactAttributeValueSource">
            Attribute Value Source
          </Label>
          <select
            id="contactAttributeValueSource"
            name="contactAttributeValueSource"
            defaultValue={
              getSettingText(settings, "contactAttributeValueSource") || "field"
            }
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="field">Collected field</option>
            <option value="static">Static value</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="contactAttributeFieldKey">Attribute Field Key</Label>
          <Input
            id="contactAttributeFieldKey"
            name="contactAttributeFieldKey"
            defaultValue={getSettingText(settings, "contactAttributeFieldKey")}
            placeholder="guestEmail"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contactAttributeValue">Static Attribute Value</Label>
          <Input
            id="contactAttributeValue"
            name="contactAttributeValue"
            defaultValue={getSettingText(settings, "contactAttributeValue")}
            placeholder="qualified"
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="contactTagNames">Contact Tags</Label>
          <Textarea
            id="contactTagNames"
            name="contactTagNames"
            defaultValue={getSettingText(settings, "contactTagNames")}
            placeholder={"Interested Lead\nHigh Intent"}
          />
          <p className="text-xs text-muted-foreground">
            Used by Set Attribute and Add Tag action blocks.
          </p>
        </div>
      </div>

      <div className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="handoffPriority">Handoff Priority</Label>
          <select
            id="handoffPriority"
            name="handoffPriority"
            defaultValue={getHandoffPriority(settings)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="handoffQueue">Handoff Queue</Label>
          <Input
            id="handoffQueue"
            name="handoffQueue"
            defaultValue={getSettingText(settings, "handoffQueue")}
            placeholder="sales"
          />
        </div>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            name="handoffNotifyTeam"
            defaultChecked={settings.handoffNotifyTeam !== false}
            className="h-4 w-4"
          />
          Notify team when this handoff is requested
        </label>
        <p className="text-xs text-muted-foreground md:col-span-2">
          Used by Request Intervention blocks. The live flow is moved to Under
          Review and appears in the submissions queue.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="nextStepId">Default Next Step</Label>
        <select
          id="nextStepId"
          name="nextStepId"
          defaultValue={step?.nextStepId ?? ""}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">Next step by order</option>
          {nextStepOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {formatStepLabel(option)}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Used as the fallback route when no branch rule matches. Chat runtime
          uses this before falling back to the next enabled step by order.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="prompt">Prompt</Label>
        <Textarea
          id="prompt"
          name="prompt"
          defaultValue={step?.prompt ?? ""}
          placeholder="What should the chatbot say or ask?"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="requiredMessage">Required Message</Label>
          <Input
            id="requiredMessage"
            name="requiredMessage"
            defaultValue={getSettingText(settings, "requiredMessage")}
            placeholder="Please provide this detail."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="validationMessage">Invalid Value Message</Label>
          <Input
            id="validationMessage"
            name="validationMessage"
            defaultValue={getSettingText(settings, "validationMessage")}
            placeholder="Please enter a valid value."
          />
        </div>
      </div>

      <div className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="validationMinLength">Minimum Length</Label>
          <Input
            id="validationMinLength"
            name="validationMinLength"
            type="number"
            min="0"
            defaultValue={getSettingNumber(settings, "validationMinLength")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="validationMaxLength">Maximum Length</Label>
          <Input
            id="validationMaxLength"
            name="validationMaxLength"
            type="number"
            min="1"
            defaultValue={getSettingNumber(settings, "validationMaxLength")}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="validationRegex">Regex Pattern</Label>
          <Input
            id="validationRegex"
            name="validationRegex"
            defaultValue={getSettingText(settings, "validationRegex")}
            placeholder="^[A-Z0-9-]+$"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="validationMinNumber">Minimum Number</Label>
          <Input
            id="validationMinNumber"
            name="validationMinNumber"
            type="number"
            step="any"
            defaultValue={getSettingNumber(settings, "validationMinNumber")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="validationMaxNumber">Maximum Number</Label>
          <Input
            id="validationMaxNumber"
            name="validationMaxNumber"
            type="number"
            step="any"
            defaultValue={getSettingNumber(settings, "validationMaxNumber")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="validationMinDate">Minimum Date</Label>
          <Input
            id="validationMinDate"
            name="validationMinDate"
            type="date"
            defaultValue={getSettingText(settings, "validationMinDate")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="validationMaxDate">Maximum Date</Label>
          <Input
            id="validationMaxDate"
            name="validationMaxDate"
            type="date"
            defaultValue={getSettingText(settings, "validationMaxDate")}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="validationAllowedFileTypes">Allowed File Types</Label>
          <Input
            id="validationAllowedFileTypes"
            name="validationAllowedFileTypes"
            defaultValue={getSettingText(
              settings,
              "validationAllowedFileTypes",
            )}
            placeholder="image/png, image/jpeg, application/pdf"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="options">Options</Label>
        <Textarea
          id="options"
          name="options"
          defaultValue={optionsToText(step?.options)}
          placeholder={"Option A\nOption B\nOption C"}
        />
        <p className="text-xs text-muted-foreground">
          Used by choice steps and any input step that should show selectable
          options.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="choiceDisplayMode">Choice Display</Label>
        <select
          id="choiceDisplayMode"
          name="choiceDisplayMode"
          defaultValue={getChoiceDisplayMode(settings)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="buttons">Buttons</option>
          <option value="list">List</option>
          <option value="text">Text fallback</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Applies to choice steps. WhatsApp uses the text fallback until rich
          channel formatting is enabled.
        </p>
      </div>

      <FormSubmitButton
        label={isEdit ? "Save Step" : "Add Step"}
        pendingLabel={isEdit ? "Saving..." : "Adding..."}
        icon={
          isEdit ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />
        }
      />
    </form>
  );
}
