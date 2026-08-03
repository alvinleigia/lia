"use client";

import { Loader2, Plus, Save } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  CANVAS_INPUT_TYPES,
  formatStepOptions,
  getInputFieldKeys,
  getOperationOutcomeRouteTargetIds,
  getOperationRoutePresetTargetId,
  getStepChoiceDisplayMode,
  getStepConnectedActionId,
  getStepConnectFlowMode,
  getStepHandoffPriority,
  getStepLabel,
  getStepMediaAssetId,
  getStepOperationExecutionMode,
  getStepOptions,
  getStepProductCatalogId,
  getStepProductDisplayLayout,
  getStepProductIds,
  getStepProductSelectionAllowMultiple,
  getStepProductSelectionAllowQuantity,
  getStepSettingNumber,
  getStepSettingText,
  getStepTemplateCategory,
  getStepTemplateStatus,
  getStepTemplateVariables,
  readStepForm,
} from "@/components/action-flow-canvas/model";
import type {
  BranchRule,
  CanvasStepInput,
  CatalogProductOption,
  FlowStep,
  MediaAssetOption,
  OperationOption,
  ProductCatalogOption,
  ProjectActionOption,
} from "@/components/action-flow-canvas/types";
import { FlowActionPrimaryFields } from "@/components/flow-action-primary-fields";
import {
  FlowInputAnswerStorageField,
  FlowInputPrimaryFields,
} from "@/components/flow-input-primary-fields";
import { FlowInputValidationFields } from "@/components/flow-input-validation-fields";
import { FlowResponsePolicyFields } from "@/components/flow-response-policy-fields";
import { FlowTemplateMessageFields } from "@/components/flow-template-message-fields";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { isFlowActionStepType } from "@/lib/flow-action-editor";
import {
  formatFlowComponentLabel,
  listEnabledStepFlowComponents,
} from "@/lib/flow-components";
import { isFlowInputStepType } from "@/lib/flow-input-editor";

function StepAdvancedOptions({
  children,
  collapsed,
}: {
  children: ReactNode;
  collapsed: boolean;
}) {
  if (!collapsed) {
    return <div className="space-y-3">{children}</div>;
  }

  return (
    <Accordion type="single" collapsible>
      <AccordionItem
        value="advanced-options"
        className="group rounded-md border px-4"
      >
        <AccordionTrigger className="hover:no-underline">
          <span>
            <span className="block">Advanced options</span>
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Data collection, validation, integrations, and routing
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent
          forceMount
          className="space-y-3 border-t pt-4 group-data-[state=closed]:hidden"
        >
          {children}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function StepCreateForm({
  branchRules = [],
  catalogProducts,
  defaultStepType = "collect_input",
  isPending,
  mediaAssets,
  onSubmit,
  operations,
  productCatalogs,
  projectActions,
  step,
  steps = [],
  submitLabel = "Create Step",
}: {
  branchRules?: BranchRule[];
  catalogProducts: CatalogProductOption[];
  defaultStepType?: string;
  isPending: boolean;
  mediaAssets: MediaAssetOption[];
  onSubmit: (input: CanvasStepInput) => void;
  operations: OperationOption[];
  productCatalogs: ProductCatalogOption[];
  projectActions: ProjectActionOption[];
  step?: FlowStep;
  steps?: FlowStep[];
  submitLabel?: string;
}) {
  const stepComponents = listEnabledStepFlowComponents();
  const targetSteps = step ? getStepOptions(steps, step.id) : steps;
  const [selectedStepType, setSelectedStepType] = useState(
    step?.stepType ?? defaultStepType,
  );
  const [selectedInputType, setSelectedInputType] = useState(
    step?.inputType ?? "text",
  );
  const isInputStep = isFlowInputStepType(selectedStepType);
  const isActionStep = isFlowActionStepType(selectedStepType);
  const isMessageStep = selectedStepType === "message";

  return (
    <form
      key={step ? `edit-${step.id}` : `create-${defaultStepType}`}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(readStepForm(event.currentTarget));
      }}
    >
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="canvas-step-type">
          Step Behavior
        </label>
        <select
          id="canvas-step-type"
          name="stepType"
          required
          defaultValue={step?.stepType ?? defaultStepType}
          onChange={(event) => setSelectedStepType(event.currentTarget.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {stepComponents.map((component) => (
            <option key={component.key} value={component.stepType}>
              {component.label}
            </option>
          ))}
        </select>
      </div>

      {isInputStep ? (
        <FlowInputPrimaryFields
          defaultEnabled={step?.isEnabled ?? true}
          defaultInputType={step?.inputType ?? "text"}
          defaultLabel={step?.label}
          defaultPrompt={step?.prompt}
          defaultRequired={step?.isRequired ?? true}
          idPrefix="canvas-input"
          onInputTypeChange={setSelectedInputType}
          stepType={selectedStepType}
        />
      ) : isActionStep ? (
        <FlowActionPrimaryFields
          defaultEnabled={step?.isEnabled ?? true}
          defaultLabel={step?.label}
          defaultOperationId={step?.operationId}
          defaultPrompt={step?.prompt}
          defaultStatusFieldKey={step?.fieldKey}
          failureStepId={getOperationRoutePresetTargetId(
            branchRules,
            step?.id,
            "failure",
          )}
          idPrefix="canvas-action"
          operations={operations.map((operation) => ({
            id: operation.id,
            label: operation.name,
            outcomeKeys: operation.outcomeKeys,
          }))}
          outcomeStepIds={getOperationOutcomeRouteTargetIds(
            branchRules,
            step?.id ?? 0,
          )}
          projectActions={projectActions.map((action) => ({
            id: action.id,
            label: action.name,
          }))}
          reusableFieldKeys={getInputFieldKeys(steps)}
          routeSteps={targetSteps.map((targetStep) => ({
            id: targetStep.id,
            label: `${targetStep.sortOrder}. ${getStepLabel(targetStep)}`,
          }))}
          settings={step?.settings}
          stepType={selectedStepType}
          successStepId={getOperationRoutePresetTargetId(
            branchRules,
            step?.id,
            "success",
          )}
        />
      ) : (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="canvas-step-label">
              Label
            </label>
            <input
              id="canvas-step-label"
              name="label"
              defaultValue={step?.label ?? ""}
              placeholder={isMessageStep ? "Welcome message" : "Customer name"}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="canvas-step-prompt">
              {isMessageStep ? "Message" : "Prompt"}
            </label>
            <textarea
              id="canvas-step-prompt"
              name="prompt"
              rows={3}
              defaultValue={step?.prompt ?? ""}
              placeholder={
                isMessageStep
                  ? "Enter the message visitors will see"
                  : "What should the chatbot ask or say?"
              }
              className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isEnabled"
              defaultChecked={step?.isEnabled ?? true}
            />
            Enabled
          </label>
        </>
      )}

      <StepAdvancedOptions collapsed={!step}>
        {isInputStep ? (
          <FlowInputAnswerStorageField
            defaultValue={step?.fieldKey}
            idPrefix="canvas-input"
          />
        ) : !isActionStep ? (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="canvas-field-key">
                Field Key
              </label>
              <input
                id="canvas-field-key"
                name="fieldKey"
                defaultValue={step?.fieldKey ?? ""}
                placeholder="customerName"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <p className="text-xs text-muted-foreground">
                Used when this step stores or reuses a value.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-input-type"
                >
                  Input Type
                </label>
                <select
                  id="canvas-input-type"
                  name="inputType"
                  defaultValue={step?.inputType ?? "text"}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {CANVAS_INPUT_TYPES.map((inputType) => (
                    <option key={inputType} value={inputType}>
                      {formatFlowComponentLabel(inputType)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end gap-4 pb-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="isRequired"
                    defaultChecked={step?.isRequired ?? true}
                  />
                  Required
                </label>
              </div>
            </div>
          </>
        ) : null}

        {isInputStep && (
          <>
            <FlowInputValidationFields
              defaultAllowedFileTypes={getStepSettingText(
                step,
                "validationAllowedFileTypes",
              )}
              defaultInvalidMessage={getStepSettingText(
                step,
                "validationMessage",
              )}
              defaultMaxDate={getStepSettingText(step, "validationMaxDate")}
              defaultMaxLength={getStepSettingNumber(
                step,
                "validationMaxLength",
              )}
              defaultMaxNumber={getStepSettingNumber(
                step,
                "validationMaxNumber",
              )}
              defaultMinDate={getStepSettingText(step, "validationMinDate")}
              defaultMinLength={getStepSettingNumber(
                step,
                "validationMinLength",
              )}
              defaultMinNumber={getStepSettingNumber(
                step,
                "validationMinNumber",
              )}
              defaultRegex={getStepSettingText(step, "validationRegex")}
              defaultRequiredMessage={getStepSettingText(
                step,
                "requiredMessage",
              )}
              idPrefix="canvas-input"
              inputType={selectedInputType}
              stepType={selectedStepType}
            />
            <FlowResponsePolicyFields
              idPrefix="canvas-input-policy"
              routeSteps={targetSteps.map((targetStep) => ({
                id: targetStep.id,
                label: `${targetStep.sortOrder}. ${getStepLabel(targetStep)}`,
              }))}
              settings={step?.settings}
            />
          </>
        )}

        {!isInputStep && !isActionStep && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">Validation</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-required-message"
                >
                  Required Message
                </label>
                <input
                  id="canvas-required-message"
                  name="requiredMessage"
                  defaultValue={getStepSettingText(step, "requiredMessage")}
                  placeholder="Please provide this detail."
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-validation-message"
                >
                  Invalid Value Message
                </label>
                <input
                  id="canvas-validation-message"
                  name="validationMessage"
                  defaultValue={getStepSettingText(step, "validationMessage")}
                  placeholder="Please enter a valid value."
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-validation-min-length"
                >
                  Minimum Length
                </label>
                <input
                  id="canvas-validation-min-length"
                  name="validationMinLength"
                  type="number"
                  min="0"
                  defaultValue={getStepSettingNumber(
                    step,
                    "validationMinLength",
                  )}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-validation-max-length"
                >
                  Maximum Length
                </label>
                <input
                  id="canvas-validation-max-length"
                  name="validationMaxLength"
                  type="number"
                  min="1"
                  defaultValue={getStepSettingNumber(
                    step,
                    "validationMaxLength",
                  )}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-validation-regex"
                >
                  Regex Pattern
                </label>
                <input
                  id="canvas-validation-regex"
                  name="validationRegex"
                  defaultValue={getStepSettingText(step, "validationRegex")}
                  placeholder="^[A-Z0-9-]+$"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-validation-min-number"
                >
                  Minimum Number
                </label>
                <input
                  id="canvas-validation-min-number"
                  name="validationMinNumber"
                  type="number"
                  step="any"
                  defaultValue={getStepSettingNumber(
                    step,
                    "validationMinNumber",
                  )}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-validation-max-number"
                >
                  Maximum Number
                </label>
                <input
                  id="canvas-validation-max-number"
                  name="validationMaxNumber"
                  type="number"
                  step="any"
                  defaultValue={getStepSettingNumber(
                    step,
                    "validationMaxNumber",
                  )}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-validation-min-date"
                >
                  Minimum Date
                </label>
                <input
                  id="canvas-validation-min-date"
                  name="validationMinDate"
                  type="date"
                  defaultValue={getStepSettingText(step, "validationMinDate")}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-validation-max-date"
                >
                  Maximum Date
                </label>
                <input
                  id="canvas-validation-max-date"
                  name="validationMaxDate"
                  type="date"
                  defaultValue={getStepSettingText(step, "validationMaxDate")}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-validation-file-types"
                >
                  Allowed File Types
                </label>
                <input
                  id="canvas-validation-file-types"
                  name="validationAllowedFileTypes"
                  defaultValue={getStepSettingText(
                    step,
                    "validationAllowedFileTypes",
                  )}
                  placeholder="image/png, image/jpeg, application/pdf"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
            </div>
          </div>
        )}

        {selectedStepType === "media" && (
          <div className="space-y-2 rounded-md border bg-gray-50/50 p-4">
            <label
              className="text-sm font-medium"
              htmlFor="canvas-media-asset-id"
            >
              Media file
            </label>
            <select
              id="canvas-media-asset-id"
              name="mediaAssetId"
              defaultValue={getStepMediaAssetId(step)}
              className="flex h-10 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">Choose an uploaded file</option>
              {mediaAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.label} ({asset.mediaType})
                </option>
              ))}
            </select>
            <p className="text-xs leading-5 text-muted-foreground">
              Upload and manage reusable files from the Media Library.
            </p>
          </div>
        )}

        {selectedStepType === "template_message" && (
          <FlowTemplateMessageFields
            body={getStepSettingText(step, "whatsappTemplateBody")}
            category={getStepTemplateCategory(step)}
            language={
              getStepSettingText(step, "whatsappTemplateLanguage") || "en_US"
            }
            name={getStepSettingText(step, "whatsappTemplateName")}
            status={getStepTemplateStatus(step)}
            variables={getStepTemplateVariables(step)}
          />
        )}

        {[
          "catalog_message",
          "multiple_products",
          "product_selection",
          "single_product",
        ].includes(selectedStepType) && (
          <div className="space-y-3 rounded-md border bg-gray-50/50 p-4">
            <p className="text-sm font-medium">Products shown to visitors</p>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="canvas-product-display-layout"
              >
                Browser Layout
              </label>
              <select
                id="canvas-product-display-layout"
                name="productDisplayLayout"
                defaultValue={getStepProductDisplayLayout(step)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="grid">Grid cards</option>
                <option value="list">Compact list</option>
                <option value="featured">Featured first item</option>
              </select>
            </div>
            {selectedStepType === "product_selection" && (
              <>
                <label className="flex items-center gap-2 text-sm md:col-span-2">
                  <input
                    type="checkbox"
                    name="productSelectionAllowMultiple"
                    defaultChecked={getStepProductSelectionAllowMultiple(step)}
                  />
                  Allow visitors to choose multiple products
                </label>
                <label className="flex items-center gap-2 text-sm md:col-span-2">
                  <input
                    type="checkbox"
                    name="productSelectionAllowQuantity"
                    defaultChecked={getStepProductSelectionAllowQuantity(step)}
                  />
                  Ask visitors for a quantity
                </label>
              </>
            )}
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="canvas-product-catalog-id"
              >
                Product Catalog
              </label>
              <select
                id="canvas-product-catalog-id"
                name="productCatalogId"
                defaultValue={getStepProductCatalogId(step)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">No product catalog</option>
                {productCatalogs.map((catalog) => (
                  <option key={catalog.id} value={catalog.id}>
                    {catalog.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="canvas-product-ids"
              >
                Products
              </label>
              <select
                id="canvas-product-ids"
                name="productIds"
                multiple
                defaultValue={getStepProductIds(step)}
                className="flex min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {catalogProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.catalogName}: {product.name}
                    {product.sku ? ` (${product.sku})` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Choose the products visitors should see in this message.
              </p>
            </div>
          </div>
        )}

        {!isActionStep && (
          <>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="canvas-operation-id"
              >
                Operation
              </label>
              <select
                id="canvas-operation-id"
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
                Operation blocks can run workflow actions. Request Intervention
                blocks can use this as the staff notification operation.
              </p>
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="canvas-operation-execution-mode"
              >
                Operation Execution
              </label>
              <select
                id="canvas-operation-execution-mode"
                name="operationExecutionMode"
                defaultValue={getStepOperationExecutionMode(step)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="post_submit">After submission</option>
                <option value="inline">Inline during conversation</option>
              </select>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <label
                className="text-sm font-medium"
                htmlFor="canvas-connected-action-id"
              >
                Connected Flow
              </label>
              <select
                id="canvas-connected-action-id"
                name="connectedActionId"
                defaultValue={getStepConnectedActionId(step)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">No connected flow</option>
                {projectActions.map((projectAction) => (
                  <option key={projectAction.id} value={projectAction.id}>
                    {projectAction.name}
                  </option>
                ))}
              </select>
              <label
                className="text-sm font-medium"
                htmlFor="canvas-connect-flow-mode"
              >
                Flow Behavior
              </label>
              <select
                id="canvas-connect-flow-mode"
                name="connectFlowMode"
                defaultValue={getStepConnectFlowMode(step)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="jump">Jump into connected flow</option>
                <option value="return">
                  Return after connected flow submits
                </option>
              </select>
              <p className="text-xs text-muted-foreground">
                Jump ends this flow. Return uses the connected flow as a
                reusable subflow, then resumes here.
              </p>
            </div>

            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-operation-success-step-id"
                >
                  Success Route
                </label>
                <select
                  id="canvas-operation-success-step-id"
                  name="operationSuccessStepId"
                  defaultValue={getOperationRoutePresetTargetId(
                    branchRules,
                    step?.id,
                    "success",
                  )}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="">No preset route</option>
                  {targetSteps.map((targetStep) => (
                    <option key={targetStep.id} value={targetStep.id}>
                      {targetStep.sortOrder}. {getStepLabel(targetStep)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-operation-failure-step-id"
                >
                  Failure Route
                </label>
                <select
                  id="canvas-operation-failure-step-id"
                  name="operationFailureStepId"
                  defaultValue={getOperationRoutePresetTargetId(
                    branchRules,
                    step?.id,
                    "failure",
                  )}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="">No preset route</option>
                  {targetSteps.map((targetStep) => (
                    <option key={targetStep.id} value={targetStep.id}>
                      {targetStep.sortOrder}. {getStepLabel(targetStep)}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                For inline operation steps, these create completed/failed branch
                rules from the operation status field.
              </p>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Contact Mutation</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="canvas-contact-attribute-key"
                  >
                    Attribute Key
                  </label>
                  <input
                    id="canvas-contact-attribute-key"
                    name="contactAttributeKey"
                    defaultValue={getStepSettingText(
                      step,
                      "contactAttributeKey",
                    )}
                    placeholder="lead_status"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="canvas-contact-attribute-source"
                  >
                    Value Source
                  </label>
                  <select
                    id="canvas-contact-attribute-source"
                    name="contactAttributeValueSource"
                    defaultValue={
                      getStepSettingText(step, "contactAttributeValueSource") ||
                      "field"
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="field">Collected field</option>
                    <option value="static">Static value</option>
                  </select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="canvas-contact-attribute-field"
                  >
                    Field Key
                  </label>
                  <input
                    id="canvas-contact-attribute-field"
                    name="contactAttributeFieldKey"
                    defaultValue={getStepSettingText(
                      step,
                      "contactAttributeFieldKey",
                    )}
                    placeholder="guestEmail"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="canvas-contact-attribute-value"
                  >
                    Static Value
                  </label>
                  <input
                    id="canvas-contact-attribute-value"
                    name="contactAttributeValue"
                    defaultValue={getStepSettingText(
                      step,
                      "contactAttributeValue",
                    )}
                    placeholder="qualified"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-contact-tag-names"
                >
                  Tags
                </label>
                <textarea
                  id="canvas-contact-tag-names"
                  name="contactTagNames"
                  rows={2}
                  defaultValue={getStepSettingText(step, "contactTagNames")}
                  placeholder="Interested Lead"
                  className="flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Handoff</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="canvas-handoff-priority"
                  >
                    Priority
                  </label>
                  <select
                    id="canvas-handoff-priority"
                    name="handoffPriority"
                    defaultValue={getStepHandoffPriority(step)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="canvas-handoff-queue"
                  >
                    Queue
                  </label>
                  <input
                    id="canvas-handoff-queue"
                    name="handoffQueue"
                    defaultValue={getStepSettingText(step, "handoffQueue")}
                    placeholder="sales"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="handoffNotifyTeam"
                  defaultChecked={step?.settings.handoffNotifyTeam !== false}
                  className="h-4 w-4"
                />
                Notify team when requested
              </label>
              <p className="text-xs text-muted-foreground">
                Request Intervention blocks move the live submission to Under
                Review.
              </p>
            </div>
          </>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="canvas-step-options">
            Options
          </label>
          <textarea
            id="canvas-step-options"
            name="options"
            rows={3}
            defaultValue={step ? formatStepOptions(step.options) : ""}
            placeholder="One option per line"
            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>

        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor="canvas-choice-display-mode"
          >
            Choice Display
          </label>
          <select
            id="canvas-choice-display-mode"
            name="choiceDisplayMode"
            defaultValue={getStepChoiceDisplayMode(step)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="buttons">Buttons</option>
            <option value="list">List</option>
            <option value="text">Text fallback</option>
          </select>
        </div>
      </StepAdvancedOptions>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : submitLabel.toLowerCase().includes("save") ? (
          <Save className="h-4 w-4" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {submitLabel}
      </Button>
    </form>
  );
}
