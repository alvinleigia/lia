"use client";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  ImageIcon,
  ListChecks,
  Loader2,
  MessageSquareText,
  Plus,
  Save,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { FlowAddContentMenuItems } from "@/components/action-flow-canvas/content-menu";
import {
  createFlowContentBlock,
  duplicateFlowContentBlock,
  formatStepOptions,
  getInputFieldKeys,
  getOperationRoutePresetTargetId,
  getStepChoiceDisplayMode,
  getStepLabel,
  getStepOptions,
  getStepSettingText,
  moveFlowContentBlock,
  readStepBasicsForm,
} from "@/components/action-flow-canvas/model";
import type {
  BranchRule,
  CanvasStepBasicsInput,
  CatalogProductOption,
  FlowStep,
  MediaAssetOption,
  OperationOption,
  ProductCatalogOption,
  ProjectActionOption,
} from "@/components/action-flow-canvas/types";
import { FlowActionPrimaryFields } from "@/components/flow-action-primary-fields";
import { FlowInputFamilySummary } from "@/components/flow-input-primary-fields";
import { FlowMessageContentEditor } from "@/components/flow-message-content-editor";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { isFlowActionStepType } from "@/lib/flow-action-editor";
import {
  type FlowContentBlock,
  getFlowContentBlocks,
  getFlowResponseCollectorCompatibilityIssue,
} from "@/lib/flow-content-blocks";
import type { FlowContentComponentKey } from "@/lib/flow-content-components";
import {
  FLOW_ANSWER_FORMATS as FLOW_INPUT_ANSWER_FORMATS,
  getFlowInputFamilyDefinition,
} from "@/lib/flow-input-editor";

function FlowContentBlocksEditor({
  answerCollectionDisabledReason,
  blocks,
  catalogProducts,
  mediaAssets,
  onChange,
  productCatalogs,
}: {
  answerCollectionDisabledReason: string | null;
  blocks: FlowContentBlock[];
  catalogProducts: CatalogProductOption[];
  mediaAssets: MediaAssetOption[];
  onChange: (blocks: FlowContentBlock[]) => void;
  productCatalogs: ProductCatalogOption[];
}) {
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const hasResponseCollector = blocks.some((block) => block.type === "choice");

  const addBlock = (type: FlowContentComponentKey) => {
    const block = createFlowContentBlock({
      catalogProducts,
      mediaAssets,
      productCatalogs,
      type,
    });

    if (!block) {
      return;
    }

    onChange([...blocks, block]);
    setIsAddMenuOpen(false);
  };

  return (
    <div className="space-y-4 rounded-md border bg-gray-50/50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Continue the message</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Add content below the first message. Visitors receive it from top to
            bottom.
          </p>
        </div>
        {blocks.length > 0 && (
          <span className="shrink-0 rounded-full border bg-white px-2.5 py-1 text-xs text-muted-foreground">
            {blocks.length} {blocks.length === 1 ? "block" : "blocks"}
          </span>
        )}
      </div>

      {blocks.length === 0 && (
        <div className="rounded-md border border-dashed bg-white px-4 py-5 text-center">
          <p className="text-sm font-medium">No additional content</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The step will send only its first message.
          </p>
        </div>
      )}

      {blocks.length > 0 && (
        <div className="space-y-3">
          {blocks.map((block, blockIndex) => (
            <div
              key={block.id}
              className="rounded-md border bg-white shadow-xs"
            >
              <div className="flex min-h-12 items-center justify-between gap-3 border-b px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-700">
                    {block.type === "choice" && (
                      <ListChecks className="h-4 w-4" />
                    )}
                    {block.type === "text" && (
                      <MessageSquareText className="h-4 w-4" />
                    )}
                    {block.type === "media" && (
                      <ImageIcon className="h-4 w-4" />
                    )}
                    {block.type === "catalog" && (
                      <ShoppingBag className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {block.type === "choice" && "Choice buttons"}
                      {block.type === "text" && "Text message"}
                      {block.type === "media" && "Media"}
                      {block.type === "catalog" &&
                        (block.displayMode === "single_product"
                          ? "Single product"
                          : block.displayMode === "multiple_products"
                            ? "Multiple products"
                            : "Product catalog")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Content {blockIndex + 1}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={blockIndex === 0}
                    title={`Move content ${blockIndex + 1} up`}
                    onClick={() =>
                      onChange(
                        moveFlowContentBlock(
                          blocks,
                          blockIndex,
                          blockIndex - 1,
                        ),
                      )
                    }
                  >
                    <ArrowUp className="h-4 w-4" />
                    <span className="sr-only">Move content up</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={blockIndex === blocks.length - 1}
                    title={`Move content ${blockIndex + 1} down`}
                    onClick={() =>
                      onChange(
                        moveFlowContentBlock(
                          blocks,
                          blockIndex,
                          blockIndex + 1,
                        ),
                      )
                    }
                  >
                    <ArrowDown className="h-4 w-4" />
                    <span className="sr-only">Move content down</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={blocks.length >= 10 || block.type === "choice"}
                    title={`Duplicate content ${blockIndex + 1}`}
                    onClick={() => {
                      const nextBlocks = [...blocks];
                      nextBlocks.splice(
                        blockIndex + 1,
                        0,
                        duplicateFlowContentBlock(block),
                      );
                      onChange(nextBlocks);
                    }}
                  >
                    <Copy className="h-4 w-4" />
                    <span className="sr-only">Duplicate content</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title={`Remove content ${blockIndex + 1}`}
                    onClick={() =>
                      onChange(blocks.filter((item) => item.id !== block.id))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Remove content</span>
                  </Button>
                </div>
              </div>

              <div className="p-3">
                <FlowMessageContentEditor
                  block={block}
                  catalogProducts={catalogProducts}
                  mediaAssets={mediaAssets}
                  onChange={(updatedBlock) =>
                    onChange(
                      blocks.map((item) =>
                        item.id === updatedBlock.id ? updatedBlock : item,
                      ),
                    )
                  }
                  productCatalogs={productCatalogs}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Popover open={isAddMenuOpen} onOpenChange={setIsAddMenuOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="bg-white">
            <Plus className="h-4 w-4" />
            Add content
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-h-96 w-80 overflow-y-auto p-2"
        >
          <FlowAddContentMenuItems
            context={{
              answerCollectionDisabledReason,
              blockCount: blocks.length,
              catalogProductCount: catalogProducts.length,
              hasResponseCollector,
              mediaAssetCount: mediaAssets.length,
              productCatalogCount: productCatalogs.length,
            }}
            onAdd={addBlock}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ContentStepBasicsForm({
  catalogProducts,
  isPending,
  mediaAssets,
  onSubmit,
  productCatalogs,
  step,
}: {
  catalogProducts: CatalogProductOption[];
  isPending: boolean;
  mediaAssets: MediaAssetOption[];
  onSubmit: (input: CanvasStepBasicsInput) => void;
  productCatalogs: ProductCatalogOption[];
  step: FlowStep;
}) {
  const collectsAnswer = step.inputType !== null;
  const dynamicSourceType = getStepSettingText(step, "sourceType");
  const hasDynamicOptions = ["catalog_categories", "catalog_items"].includes(
    dynamicSourceType,
  );
  const storedOptions = formatStepOptions(step.options)
    .split("\n")
    .filter((option) => option.trim());
  const [options, setOptions] = useState(storedOptions);
  const storedContentBlocks = getFlowContentBlocks(step.settings);
  const [contentBlocks, setContentBlocks] = useState(storedContentBlocks);
  const hasContentChoice = contentBlocks.some(
    (block) => block.type === "choice",
  );
  const showsManualOptions =
    !hasContentChoice &&
    (step.stepType === "choice" || (!hasDynamicOptions && options.length > 0));
  const showsChoiceDisplay = hasDynamicOptions || showsManualOptions;
  const allowsAnswerFormat =
    step.stepType === "collect_input" && !hasDynamicOptions;
  const answerCollectionDisabledReason =
    getFlowResponseCollectorCompatibilityIssue({
      hasDynamicOptions,
      hasManualOptions: storedOptions.length > 0,
      hasStoredResponseCollector: storedContentBlocks.some(
        (block) => block.type === "choice",
      ),
      isInputStep: collectsAnswer,
    });
  const inputDefinition = getFlowInputFamilyDefinition(
    step.stepType,
    step.inputType,
  );
  const optionsChanged =
    options.length !== storedOptions.length ||
    options.some((option, index) => option !== storedOptions[index]);
  const contentBlocksChanged =
    JSON.stringify(contentBlocks) !== JSON.stringify(storedContentBlocks);

  return (
    <form
      key={`quick-edit-${step.id}`}
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(readStepBasicsForm(event.currentTarget));
      }}
    >
      <input type="hidden" name="options" value={options.join("\n")} readOnly />
      <input
        type="hidden"
        name="optionsChanged"
        value={String(optionsChanged)}
        readOnly
      />
      <input
        type="hidden"
        name="contentBlocks"
        value={JSON.stringify(contentBlocks)}
        readOnly
      />
      <input
        type="hidden"
        name="contentBlocksChanged"
        value={String(contentBlocksChanged)}
        readOnly
      />
      {!allowsAnswerFormat && (
        <input
          type="hidden"
          name="inputType"
          value={step.inputType ?? "text"}
          readOnly
        />
      )}
      {!showsChoiceDisplay && (
        <input
          type="hidden"
          name="choiceDisplayMode"
          value={getStepChoiceDisplayMode(step)}
          readOnly
        />
      )}

      {inputDefinition && (
        <FlowInputFamilySummary
          inputType={step.inputType}
          stepType={step.stepType}
        />
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="quick-step-label">
          Step name
        </label>
        <input
          id="quick-step-label"
          name="label"
          defaultValue={step.label ?? ""}
          placeholder="Give this step a clear name"
          className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          This name helps your team identify the step on the canvas.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="quick-step-prompt">
          {inputDefinition?.questionLabel ?? "Message shown to the visitor"}
        </label>
        <textarea
          id="quick-step-prompt"
          name="prompt"
          rows={4}
          defaultValue={step.prompt ?? ""}
          placeholder={
            inputDefinition?.questionPlaceholder ??
            "Write what the chatbot should say or ask"
          }
          className="flex min-h-28 w-full resize-y rounded-md border border-input bg-transparent px-3 py-3 text-sm leading-6 shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      <FlowContentBlocksEditor
        answerCollectionDisabledReason={answerCollectionDisabledReason}
        blocks={contentBlocks}
        catalogProducts={catalogProducts}
        mediaAssets={mediaAssets}
        onChange={setContentBlocks}
        productCatalogs={productCatalogs}
      />

      {allowsAnswerFormat && (
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="quick-input-type">
            Answer format
          </label>
          <select
            id="quick-input-type"
            name="inputType"
            defaultValue={step.inputType ?? "text"}
            className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {FLOW_INPUT_ANSWER_FORMATS.map((format) => (
              <option key={format.value} value={format.value}>
                {format.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Lia will validate the visitor&apos;s answer using this format.
          </p>
        </div>
      )}

      {hasDynamicOptions && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-medium text-blue-950">
            Choices are connected to your catalog
          </p>
          <p className="mt-1 text-xs leading-5 text-blue-800">
            {dynamicSourceType === "catalog_categories"
              ? "Visitors will see the current catalog categories."
              : "Visitors will see catalog items filtered by their earlier answer."}{" "}
            This live connection is protected from quick edits.
          </p>
        </div>
      )}

      {showsManualOptions && (
        <div className="space-y-3 rounded-md border p-4">
          <div>
            <p className="text-sm font-medium">Choices shown to visitors</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Each choice can be displayed as a button or list item.
            </p>
          </div>

          <div className="space-y-2">
            {options.map((option, index) => (
              <div key={`${step.id}-option-${index}`} className="flex gap-2">
                <input
                  aria-label={`Choice ${index + 1}`}
                  value={option}
                  onChange={(event) => {
                    const nextOptions = [...options];
                    nextOptions[index] = event.target.value;
                    setOptions(nextOptions);
                  }}
                  placeholder={`Choice ${index + 1}`}
                  className="flex h-10 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title={`Remove choice ${index + 1}`}
                  onClick={() =>
                    setOptions(
                      options.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Remove choice</span>
                </Button>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => setOptions([...options, ""])}
          >
            <Plus className="h-4 w-4" />
            Add choice
          </Button>
        </div>
      )}

      {showsChoiceDisplay && (
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="quick-choice-display">
            Display choices as
          </label>
          <select
            id="quick-choice-display"
            name="choiceDisplayMode"
            defaultValue={getStepChoiceDisplayMode(step)}
            className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="buttons">Buttons</option>
            <option value="list">List</option>
            <option value="text">Typed response</option>
          </select>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {collectsAnswer && (
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
            <input
              type="checkbox"
              name="isRequired"
              defaultChecked={step.isRequired}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-medium">Answer required</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Visitors must answer before the flow continues.
              </span>
            </span>
          </label>
        )}

        <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
          <input
            type="checkbox"
            name="isEnabled"
            defaultChecked={step.isEnabled}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-medium">Step active</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Include this step when the flow runs.
            </span>
          </span>
        </label>
      </div>

      <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        Save changes
      </Button>
    </form>
  );
}

function ActionStepBasicsForm({
  branchRules,
  isPending,
  onSubmit,
  operations,
  projectActions,
  step,
  steps,
}: {
  branchRules: BranchRule[];
  isPending: boolean;
  onSubmit: (input: CanvasStepBasicsInput) => void;
  operations: OperationOption[];
  projectActions: ProjectActionOption[];
  step: FlowStep;
  steps: FlowStep[];
}) {
  if (!isFlowActionStepType(step.stepType)) {
    return null;
  }

  const targetSteps = getStepOptions(steps, step.id);
  const failureStepId = getOperationRoutePresetTargetId(
    branchRules,
    step.id,
    "failure",
  );
  const successStepId = getOperationRoutePresetTargetId(
    branchRules,
    step.id,
    "success",
  );
  const savedActionRevision = JSON.stringify({
    failureStepId,
    fieldKey: step.fieldKey,
    isEnabled: step.isEnabled,
    label: step.label,
    operationId: step.operationId,
    prompt: step.prompt,
    settings: step.settings,
    successStepId,
  });

  return (
    <form
      key={`quick-action-${step.id}-${savedActionRevision}`}
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(readStepBasicsForm(event.currentTarget));
      }}
    >
      <FlowActionPrimaryFields
        defaultEnabled={step.isEnabled}
        defaultLabel={step.label}
        defaultOperationId={step.operationId}
        defaultPrompt={step.prompt}
        defaultStatusFieldKey={step.fieldKey}
        failureStepId={failureStepId}
        idPrefix={`quick-action-${step.id}`}
        operations={operations.map((operation) => ({
          id: operation.id,
          label: operation.name,
        }))}
        projectActions={projectActions.map((action) => ({
          id: action.id,
          label: action.name,
        }))}
        reusableFieldKeys={getInputFieldKeys(steps)}
        routeSteps={targetSteps.map((targetStep) => ({
          id: targetStep.id,
          label: `${targetStep.sortOrder}. ${getStepLabel(targetStep)}`,
        }))}
        settings={step.settings}
        stepType={step.stepType}
        successStepId={successStepId}
      />

      <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        Save action
      </Button>
    </form>
  );
}

export function StepBasicsForm({
  branchRules,
  catalogProducts,
  isPending,
  mediaAssets,
  onSubmit,
  operations,
  productCatalogs,
  projectActions,
  step,
  steps,
}: {
  branchRules: BranchRule[];
  catalogProducts: CatalogProductOption[];
  isPending: boolean;
  mediaAssets: MediaAssetOption[];
  onSubmit: (input: CanvasStepBasicsInput) => void;
  operations: OperationOption[];
  productCatalogs: ProductCatalogOption[];
  projectActions: ProjectActionOption[];
  step: FlowStep;
  steps: FlowStep[];
}) {
  if (isFlowActionStepType(step.stepType)) {
    return (
      <ActionStepBasicsForm
        branchRules={branchRules}
        isPending={isPending}
        onSubmit={onSubmit}
        operations={operations}
        projectActions={projectActions}
        step={step}
        steps={steps}
      />
    );
  }

  return (
    <ContentStepBasicsForm
      catalogProducts={catalogProducts}
      isPending={isPending}
      mediaAssets={mediaAssets}
      onSubmit={onSubmit}
      productCatalogs={productCatalogs}
      step={step}
    />
  );
}
