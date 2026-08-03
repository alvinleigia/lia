"use client";

import { Handle, Position } from "@xyflow/react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Copy,
  ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Save,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { FlowAddContentMenuItems } from "@/components/action-flow-canvas/content-menu";
import { isHybridStepType } from "@/components/action-flow-canvas/hybrid-step-form";
import {
  createFlowContentBlock,
  duplicateFlowContentBlock,
  formatLabel,
  formatStepOptions,
  getCanvasPosition,
  getStepChoiceDisplayMode,
  getStepColor,
  getStepLabel,
  moveFlowContentBlock,
} from "@/components/action-flow-canvas/model";
import type {
  BranchRule,
  CanvasNode,
  CanvasOptionRouteChange,
  CanvasQuickEditChange,
  CanvasStepQuickSave,
  CatalogProductOption,
  FlowStep,
  MediaAssetOption,
  ProductCatalogOption,
} from "@/components/action-flow-canvas/types";
import { FlowMessageContentEditor } from "@/components/flow-message-content-editor";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ActionFlowRouteValidationIssue } from "@/lib/action-flows";
import { getStoredActionOptionRoute } from "@/lib/action-option-routing";
import {
  getActionStepOptions,
  type RuntimeActionStep,
} from "@/lib/action-runtime";
import {
  type FlowContentBlock,
  getFlowContentBlocks,
  getFlowResponseCollectorCompatibilityIssue,
} from "@/lib/flow-content-blocks";
import type { FlowContentComponentKey } from "@/lib/flow-content-components";
import { getFlowMessageFamilyDefinition } from "@/lib/flow-message-editor";

function CanvasContentBlockPreview({ block }: { block: FlowContentBlock }) {
  if (block.type === "choice") {
    return (
      <div className="space-y-2 rounded-md border bg-gray-50 p-2.5">
        <p className="line-clamp-2 break-words text-xs leading-snug text-gray-700">
          {block.text}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {block.options.slice(0, 3).map((option) => (
            <span
              key={option.id}
              className="max-w-full truncate rounded-md border bg-white px-2 py-1 text-[11px] leading-none text-gray-700"
            >
              {option.label}
            </span>
          ))}
          {block.options.length > 3 && (
            <span className="rounded-md bg-gray-200 px-2 py-1 text-[11px] leading-none text-gray-600">
              +{block.options.length - 3}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (block.type === "media") {
    return (
      <div className="flex items-center gap-2.5 rounded-md border bg-gray-50 p-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-gray-600">
          <ImageIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-gray-800">
            {block.media?.originalName ?? "Media"}
          </p>
          {block.text && (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
              {block.text}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (block.type === "catalog") {
    return (
      <div className="flex items-center gap-2.5 rounded-md border bg-gray-50 p-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-gray-600">
          <ShoppingBag className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-gray-800">
            {block.catalog?.name ?? "Product catalog"}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {block.products.length} product
            {block.products.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <p className="line-clamp-2 break-words rounded-md border bg-gray-50 p-2.5 text-xs leading-snug text-gray-700">
      {block.text}
    </p>
  );
}

function getContentBlockName(block: FlowContentBlock) {
  return getFlowMessageFamilyDefinition(block).title;
}

function StepDiagnosticIndicator({
  issues,
}: {
  issues: ActionFlowRouteValidationIssue[];
}) {
  if (issues.length === 0) {
    return null;
  }

  const hasBlockingIssue = issues.some((issue) => issue.severity === "error");
  const label = `${issues.length} flow ${
    hasBlockingIssue ? "issue" : "warning"
  }${issues.length === 1 ? "" : "s"}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`${label}: ${issues.map((issue) => issue.message).join(" ")}`}
          className="nodrag nopan h-6 w-6 cursor-help text-amber-600 hover:text-amber-700"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <AlertTriangle className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 space-y-1.5" side="top">
        <p className="font-medium">{label}</p>
        {issues.map((issue, index) => (
          <p key={`${issue.code}-${index}`}>{issue.message}</p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

function CanvasContentBlockEditor({
  block,
  catalogProducts,
  isSaving,
  mediaAssets,
  onCancel,
  onRemove,
  onSave,
  productCatalogs,
}: {
  block: FlowContentBlock;
  catalogProducts: CatalogProductOption[];
  isSaving: boolean;
  mediaAssets: MediaAssetOption[];
  onCancel: () => void;
  onRemove: () => void;
  onSave: (block: FlowContentBlock) => void;
  productCatalogs: ProductCatalogOption[];
}) {
  const [draft, setDraft] = useState<FlowContentBlock>(block);

  return (
    <div className="space-y-3 rounded-md border bg-gray-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">{getContentBlockName(draft)}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Cancel content edit"
          disabled={isSaving}
          onClick={onCancel}
        >
          <X className="h-3.5 w-3.5" />
          <span className="sr-only">Cancel content edit</span>
        </Button>
      </div>

      <FlowMessageContentEditor
        block={draft}
        catalogProducts={catalogProducts}
        mediaAssets={mediaAssets}
        onChange={setDraft}
        productCatalogs={productCatalogs}
      />

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isSaving}
          className="flex-1"
          onClick={() => onSave(draft)}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="icon"
          disabled={isSaving}
          title="Remove content"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Remove content</span>
        </Button>
      </div>
    </div>
  );
}

function CanvasStepNodeContent({
  branchRules,
  catalogProducts,
  issues,
  mediaAssets,
  onQuickEditChange,
  onOptionRouteChange,
  onQuickSave,
  productCatalogs,
  step,
  steps,
}: {
  branchRules: BranchRule[];
  catalogProducts: CatalogProductOption[];
  issues: ActionFlowRouteValidationIssue[];
  mediaAssets: MediaAssetOption[];
  onQuickEditChange: CanvasQuickEditChange;
  onOptionRouteChange: CanvasOptionRouteChange;
  onQuickSave: CanvasStepQuickSave;
  productCatalogs: ProductCatalogOption[];
  step: FlowStep;
  steps: FlowStep[];
}) {
  const contentBlocks = getFlowContentBlocks(step.settings);
  const choiceBlock = contentBlocks.find((block) => block.type === "choice");
  const sourceType =
    typeof step.settings.sourceType === "string"
      ? step.settings.sourceType
      : "";
  const hasDynamicChoices = ["catalog_categories", "catalog_items"].includes(
    sourceType,
  );
  const storedManualChoices = hasDynamicChoices
    ? []
    : formatStepOptions(step.options)
        .split("\n")
        .filter((option) => option.trim());
  const storedChoices =
    choiceBlock?.options.map((option) => option.label) ?? storedManualChoices;
  const storedChoicesKey = storedChoices.join("\n");
  const canQuickEditChoices =
    !hasDynamicChoices &&
    (Boolean(choiceBlock) ||
      step.stepType === "choice" ||
      storedManualChoices.length > 0);
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(step.label ?? "");
  const [prompt, setPrompt] = useState(step.prompt ?? "");
  const [choices, setChoices] = useState(storedChoices);
  const [editingContentBlockId, setEditingContentBlockId] = useState<
    string | null
  >(null);
  const [isAddContentOpen, setIsAddContentOpen] = useState(false);
  const [localFeedback, setLocalFeedback] = useState("");
  const [isSaving, startSaving] = useTransition();
  const stepColor = getStepColor(step);
  const supportsOptionRoutes =
    step.stepType !== "product_selection" ||
    (step.settings.productSelectionAllowMultiple !== true &&
      step.settings.productSelectionAllowQuantity !== true);
  const routeOptions = supportsOptionRoutes
    ? getActionStepOptions(step as RuntimeActionStep)
    : [];
  const optionRouteTargets = new Map(
    branchRules.flatMap((rule) => {
      const optionRoute = getStoredActionOptionRoute(rule.settings);
      return optionRoute
        ? [[optionRoute.sourceOptionId, rule.targetStepId] as const]
        : [];
    }),
  );

  useEffect(() => {
    onQuickEditChange(step.id, isEditing);

    return () => {
      if (isEditing) {
        onQuickEditChange(step.id, false);
      }
    };
  }, [isEditing, onQuickEditChange, step.id]);

  useEffect(() => {
    if (isEditing) {
      return;
    }

    setLabel(step.label ?? "");
    setPrompt(step.prompt ?? "");
    setChoices(storedChoicesKey ? storedChoicesKey.split("\n") : []);
  }, [isEditing, step.label, step.prompt, storedChoicesKey]);

  const stopCanvasInteraction = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  const persistContentBlocks = (
    nextContentBlocks: FlowContentBlock[],
    onSuccess: () => void,
  ) => {
    setLocalFeedback("");
    startSaving(async () => {
      const result = await onQuickSave(step.id, {
        choiceDisplayMode: getStepChoiceDisplayMode(step),
        contentBlocks: JSON.stringify(nextContentBlocks),
        contentBlocksChanged: true,
        inputType: step.inputType ?? "text",
        isEnabled: step.isEnabled,
        isRequired: step.isRequired,
        label: step.label ?? "",
        options: storedManualChoices.join("\n"),
        optionsChanged: false,
        prompt: step.prompt ?? "",
      });

      setLocalFeedback(result.message);
      if (result.ok) {
        onSuccess();
      }
    });
  };

  const saveInlineChanges = () => {
    const nextContentBlocks = choiceBlock
      ? contentBlocks.map((block) =>
          block.id === choiceBlock.id && block.type === "choice"
            ? {
                ...block,
                options: choices.map((label, index) =>
                  block.options[index]
                    ? { ...block.options[index], label }
                    : {
                        description: "",
                        id: `${block.id}-option-${index + 1}`,
                        label,
                        section: "",
                        value: label,
                      },
                ),
              }
            : block,
        )
      : contentBlocks;
    const contentBlocksChanged = choiceBlock
      ? JSON.stringify(nextContentBlocks) !== JSON.stringify(contentBlocks)
      : false;
    const optionsChanged = choiceBlock
      ? false
      : choices.join("\n") !== storedManualChoices.join("\n");

    setLocalFeedback("");
    startSaving(async () => {
      const result = await onQuickSave(step.id, {
        choiceDisplayMode: getStepChoiceDisplayMode(step),
        contentBlocks: JSON.stringify(nextContentBlocks),
        contentBlocksChanged,
        inputType: step.inputType ?? "text",
        isEnabled: step.isEnabled,
        isRequired: step.isRequired,
        label,
        options: choiceBlock
          ? storedManualChoices.join("\n")
          : choices.join("\n"),
        optionsChanged,
        prompt,
      });

      setLocalFeedback(result.message);
      if (result.ok) {
        setIsEditing(false);
      }
    });
  };

  const addContentBlock = (type: FlowContentComponentKey) => {
    const block = createFlowContentBlock({
      catalogProducts,
      mediaAssets,
      productCatalogs,
      type,
    });

    if (!block) {
      setLocalFeedback(
        type === "media"
          ? "Upload media before adding this content."
          : "Add products to a catalog before using this content.",
      );
      return;
    }

    persistContentBlocks([...contentBlocks, block], () => {
      setIsAddContentOpen(false);
      setEditingContentBlockId(block.id);
    });
  };

  const answerCollectionDisabledReason =
    getFlowResponseCollectorCompatibilityIssue({
      hasDynamicOptions: hasDynamicChoices,
      hasManualOptions: storedManualChoices.length > 0,
      hasStoredResponseCollector: Boolean(choiceBlock),
      isInputStep: step.inputType !== null,
    });

  if (isHybridStepType(step.stepType)) {
    return (
      <div className="w-full space-y-3 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase leading-none text-muted-foreground">
              Step {step.sortOrder}
            </p>
            <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-gray-950">
              {getStepLabel(step)}
            </p>
          </div>
          <StepDiagnosticIndicator issues={issues} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span
            className="max-w-full truncate rounded-full px-2.5 py-1 font-medium leading-none text-white"
            style={{ backgroundColor: stepColor }}
          >
            {formatLabel(step.stepType)}
          </span>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 leading-none text-gray-700">
            {step.isEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        {step.prompt && (
          <p className="line-clamp-3 break-words rounded-md border bg-white p-2.5 text-xs leading-snug text-gray-700">
            {step.prompt}
          </p>
        )}
      </div>
    );
  }

  if (isEditing) {
    return (
      <form
        className="nodrag nopan nowheel w-full space-y-3 text-left"
        onClick={stopCanvasInteraction}
        onKeyDown={stopCanvasInteraction}
        onPointerDown={stopCanvasInteraction}
        onSubmit={(event) => {
          event.preventDefault();
          stopCanvasInteraction(event);
          saveInlineChanges();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase text-muted-foreground">
            Quick edit step {step.sortOrder}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Cancel quick edit"
            disabled={isSaving}
            onClick={() => {
              setIsEditing(false);
              setLocalFeedback("");
            }}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Cancel quick edit</span>
          </Button>
        </div>

        <div className="space-y-1.5">
          <label
            className="text-xs font-medium"
            htmlFor={`node-label-${step.id}`}
          >
            Step name
          </label>
          <input
            id={`node-label-${step.id}`}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>

        <div className="space-y-1.5">
          <label
            className="text-xs font-medium"
            htmlFor={`node-prompt-${step.id}`}
          >
            Visitor message
          </label>
          <textarea
            id={`node-prompt-${step.id}`}
            value={prompt}
            rows={3}
            onChange={(event) => setPrompt(event.target.value)}
            className="flex min-h-20 w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm leading-5 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>

        {canQuickEditChoices && (
          <div className="space-y-2">
            <p className="text-xs font-medium">Choices</p>
            {choices.map((choice, index) => (
              <div
                key={`${step.id}-quick-choice-${index}`}
                className="flex gap-1.5"
              >
                <input
                  aria-label={`Choice ${index + 1}`}
                  value={choice}
                  onChange={(event) => {
                    const nextChoices = [...choices];
                    nextChoices[index] = event.target.value;
                    setChoices(nextChoices);
                  }}
                  className="flex h-9 min-w-0 flex-1 rounded-md border border-input bg-white px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={choices.length === 1}
                  title={`Remove choice ${index + 1}`}
                  onClick={() => {
                    const routeOption = routeOptions[index];
                    if (routeOption && optionRouteTargets.has(routeOption.id)) {
                      setLocalFeedback(
                        `Clear the Go to route for "${routeOption.label}" before deleting it.`,
                      );
                      return;
                    }

                    setChoices(
                      choices.filter((_, choiceIndex) => choiceIndex !== index),
                    );
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Remove choice</span>
                </Button>
              </div>
            ))}
            {choices.length < 20 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setChoices([...choices, "New choice"])}
              >
                <Plus className="h-4 w-4" />
                Add choice
              </Button>
            )}
          </div>
        )}

        {hasDynamicChoices && (
          <p className="rounded-md bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
            Choices are connected to the catalog and remain managed in the full
            editor.
          </p>
        )}

        {localFeedback && !localFeedback.toLowerCase().includes("updated") && (
          <p className="text-xs text-red-700">{localFeedback}</p>
        )}

        <Button type="submit" size="sm" disabled={isSaving} className="w-full">
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save text
        </Button>
      </form>
    );
  }

  return (
    <div className="w-full space-y-3 text-left">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase leading-none text-muted-foreground">
            Step {step.sortOrder}
          </p>
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-gray-950">
            {getStepLabel(step)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <StepDiagnosticIndicator issues={issues} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Quick edit text"
            className="nodrag nopan h-7 w-7"
            onClick={(event) => {
              stopCanvasInteraction(event);
              setIsEditing(true);
            }}
            onPointerDown={stopCanvasInteraction}
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="sr-only">Quick edit text</span>
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span
          className="max-w-full truncate rounded-full px-2.5 py-1 font-medium leading-none text-white"
          style={{ backgroundColor: stepColor }}
        >
          {formatLabel(step.stepType)}
        </span>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 leading-none text-gray-700">
          {step.isEnabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      {step.prompt && (
        <p className="line-clamp-3 break-words rounded-md border bg-white p-2.5 text-xs leading-snug text-gray-700">
          {step.prompt}
        </p>
      )}
      {routeOptions.length > 0 && step.fieldKey && (
        <div className="nodrag nopan nowheel space-y-2 rounded-md border bg-gray-50 p-2.5">
          <p className="text-[11px] font-medium uppercase text-muted-foreground">
            Option routes
          </p>
          {routeOptions.map((option) => (
            <div
              key={option.id}
              className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {option.label}
              </span>
              <select
                aria-label={`Go to for ${option.label}`}
                className="h-7 min-w-0 max-w-36 rounded-md border border-input bg-white px-2 text-[11px]"
                value={optionRouteTargets.get(option.id) ?? ""}
                onChange={(event) => {
                  const targetStepId = Number(event.currentTarget.value);
                  onOptionRouteChange(
                    step.id,
                    option.id,
                    Number.isInteger(targetStepId) && targetStepId > 0
                      ? targetStepId
                      : null,
                  );
                }}
                onClick={stopCanvasInteraction}
                onPointerDown={stopCanvasInteraction}
              >
                <option value="">Use default / no match</option>
                {steps
                  .filter((candidate) => candidate.id !== step.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {getStepLabel(candidate)}
                    </option>
                  ))}
              </select>
              <Handle
                id={option.outputPort}
                type="source"
                position={Position.Right}
                className="!relative !right-auto !top-auto !h-3 !w-3 !translate-x-0 !translate-y-0 !border-2 !border-white !bg-blue-600"
                title={`Connect ${option.label}`}
              />
            </div>
          ))}
          <p className="text-[11px] leading-4 text-muted-foreground">
            Choose a destination or drag an option handle to a step.
          </p>
        </div>
      )}
      {contentBlocks.length > 0 && (
        <div className="nodrag nopan nowheel max-h-64 space-y-2 overflow-y-auto pr-1">
          {contentBlocks.map((block, blockIndex) =>
            editingContentBlockId === block.id ? (
              <fieldset
                key={block.id}
                aria-label={`Edit ${getContentBlockName(block).toLowerCase()}`}
                className="min-w-0 border-0 p-0"
                onClick={stopCanvasInteraction}
                onKeyDown={stopCanvasInteraction}
                onPointerDown={stopCanvasInteraction}
              >
                <CanvasContentBlockEditor
                  block={block}
                  catalogProducts={catalogProducts}
                  isSaving={isSaving}
                  mediaAssets={mediaAssets}
                  onCancel={() => setEditingContentBlockId(null)}
                  onRemove={() =>
                    persistContentBlocks(
                      contentBlocks.filter((item) => item.id !== block.id),
                      () => setEditingContentBlockId(null),
                    )
                  }
                  onSave={(updatedBlock) =>
                    persistContentBlocks(
                      contentBlocks.map((item) =>
                        item.id === updatedBlock.id ? updatedBlock : item,
                      ),
                      () => setEditingContentBlockId(null),
                    )
                  }
                  productCatalogs={productCatalogs}
                />
              </fieldset>
            ) : (
              <div className="flex items-start gap-1.5" key={block.id}>
                <div className="min-w-0 flex-1">
                  <CanvasContentBlockPreview block={block} />
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="Move content up"
                    className="nodrag nopan h-7 w-7 bg-white shadow-sm"
                    disabled={isSaving || blockIndex === 0}
                    onClick={(event) => {
                      stopCanvasInteraction(event);
                      persistContentBlocks(
                        moveFlowContentBlock(
                          contentBlocks,
                          blockIndex,
                          blockIndex - 1,
                        ),
                        () => {},
                      );
                    }}
                    onPointerDown={stopCanvasInteraction}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                    <span className="sr-only">Move content up</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="Move content down"
                    className="nodrag nopan h-7 w-7 bg-white shadow-sm"
                    disabled={
                      isSaving || blockIndex === contentBlocks.length - 1
                    }
                    onClick={(event) => {
                      stopCanvasInteraction(event);
                      persistContentBlocks(
                        moveFlowContentBlock(
                          contentBlocks,
                          blockIndex,
                          blockIndex + 1,
                        ),
                        () => {},
                      );
                    }}
                    onPointerDown={stopCanvasInteraction}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                    <span className="sr-only">Move content down</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="Duplicate content"
                    className="nodrag nopan h-7 w-7 bg-white shadow-sm"
                    disabled={
                      isSaving ||
                      contentBlocks.length >= 10 ||
                      block.type === "choice"
                    }
                    onClick={(event) => {
                      stopCanvasInteraction(event);
                      const duplicate = duplicateFlowContentBlock(block);
                      const nextContentBlocks = [...contentBlocks];
                      nextContentBlocks.splice(blockIndex + 1, 0, duplicate);
                      persistContentBlocks(nextContentBlocks, () =>
                        setEditingContentBlockId(duplicate.id),
                      );
                    }}
                    onPointerDown={stopCanvasInteraction}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span className="sr-only">Duplicate content</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title={`Edit ${getContentBlockName(block).toLowerCase()}`}
                    className="nodrag nopan h-7 w-7 bg-white shadow-sm"
                    disabled={isSaving}
                    onClick={(event) => {
                      stopCanvasInteraction(event);
                      setEditingContentBlockId(block.id);
                    }}
                    onPointerDown={stopCanvasInteraction}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span className="sr-only">Edit content</span>
                  </Button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
      <Popover open={isAddContentOpen} onOpenChange={setIsAddContentOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="nodrag nopan w-full bg-white"
            disabled={isSaving}
            onClick={stopCanvasInteraction}
            onPointerDown={stopCanvasInteraction}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add content
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="right"
          className="nodrag nopan nowheel max-h-96 w-80 overflow-y-auto p-2"
          onClick={stopCanvasInteraction}
          onKeyDown={stopCanvasInteraction}
          onPointerDown={stopCanvasInteraction}
        >
          <FlowAddContentMenuItems
            context={{
              answerCollectionDisabledReason,
              blockCount: contentBlocks.length,
              catalogProductCount: catalogProducts.length,
              hasResponseCollector: Boolean(choiceBlock),
              mediaAssetCount: mediaAssets.length,
              productCatalogCount: productCatalogs.length,
            }}
            onAdd={addContentBlock}
          />
        </PopoverContent>
      </Popover>
      {localFeedback &&
        !localFeedback.toLowerCase().includes("updated") &&
        !isEditing && (
          <p className="text-xs leading-5 text-red-700">{localFeedback}</p>
        )}
    </div>
  );
}

export function buildNodes(input: {
  branchRules: BranchRule[];
  catalogProducts: CatalogProductOption[];
  mediaAssets: MediaAssetOption[];
  onQuickEditChange: CanvasQuickEditChange;
  onOptionRouteChange: CanvasOptionRouteChange;
  onQuickSave: CanvasStepQuickSave;
  productCatalogs: ProductCatalogOption[];
  routeIssues: ActionFlowRouteValidationIssue[];
  steps: FlowStep[];
}): CanvasNode[] {
  const issuesByStepId = new Map<number, ActionFlowRouteValidationIssue[]>();

  for (const issue of input.routeIssues) {
    if (issue.stepId) {
      issuesByStepId.set(issue.stepId, [
        ...(issuesByStepId.get(issue.stepId) ?? []),
        issue,
      ]);
    }
  }

  return input.steps.map((step, index) => {
    const issues = issuesByStepId.get(step.id) ?? [];
    const row = Math.floor(index / 2);
    const column = index % 2;
    const stepColor = getStepColor(step);
    const savedPosition = getCanvasPosition(step.settings);

    return {
      id: String(step.id),
      className: "action-flow-step-node",
      data: {
        label: (
          <CanvasStepNodeContent
            branchRules={input.branchRules.filter(
              (rule) => rule.sourceStepId === step.id,
            )}
            catalogProducts={input.catalogProducts}
            issues={issues}
            mediaAssets={input.mediaAssets}
            onQuickEditChange={input.onQuickEditChange}
            onOptionRouteChange={input.onOptionRouteChange}
            onQuickSave={input.onQuickSave}
            productCatalogs={input.productCatalogs}
            step={step}
            steps={input.steps}
          />
        ),
      },
      position: savedPosition ?? {
        x: column * 500,
        y: row * 340,
      },
      sourcePosition: Position.Right,
      style: {
        backgroundColor: "#ffffff",
        borderColor: issues.length > 0 ? "#d97706" : stepColor,
        borderRadius: 8,
        borderWidth: 1.5,
        boxSizing: "border-box",
        boxShadow: "0 12px 24px rgba(15, 23, 42, 0.07)",
        minHeight: 160,
        opacity: step.isEnabled ? 1 : 0.68,
        padding: 18,
        width: 344,
      },
      targetPosition: Position.Left,
      type: "default",
    };
  });
}
