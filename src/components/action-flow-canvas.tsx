"use client";

import {
  Background,
  type Connection,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type Node,
  Position,
  ReactFlow,
  useNodesState,
} from "@xyflow/react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  FileDown,
  GitBranch,
  ImageIcon,
  Link2,
  ListChecks,
  Loader2,
  type LucideIcon,
  MessageSquareText,
  Package,
  Pencil,
  Plus,
  Route,
  Save,
  ShoppingBag,
  Trash2,
  Unlink,
  Wand2,
  Workflow,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  clearCanvasDefaultRouteAction,
  createCanvasBranchRuleAction,
  createCanvasStepAction,
  deleteCanvasBranchRuleAction,
  saveCanvasStepPositionsAction,
  setCanvasDefaultRouteAction,
  updateCanvasBranchRuleAction,
  updateCanvasStepAction,
  updateCanvasStepBasicsAction,
} from "@/app/projects/actions/canvas-actions";
import { FlowActionPrimaryFields } from "@/components/flow-action-primary-fields";
import {
  FlowInputAnswerStorageField,
  FlowInputFamilySummary,
  FlowInputPrimaryFields,
} from "@/components/flow-input-primary-fields";
import { FlowInputValidationFields } from "@/components/flow-input-validation-fields";
import { FlowMessageContentEditor } from "@/components/flow-message-content-editor";
import { FlowTemplateMessageFields } from "@/components/flow-template-message-fields";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getStoredActionFlowConditionGroup,
  type StoredActionFlowConditionGroup,
} from "@/lib/action-flow-compiler";
import type {
  ActionBranchOperator,
  ActionFlowRouteValidationIssue,
  listActionFlowBranchRules,
  listActionFlowSteps,
} from "@/lib/action-flows";
import { isFlowActionStepType } from "@/lib/flow-action-editor";
import {
  type FlowComponentDefinition,
  type FlowComponentGroup,
  formatFlowComponentLabel,
  getFlowComponentColor,
  getFlowComponentLabel,
  listEnabledStepFlowComponents,
  listPlannedFlowComponents,
} from "@/lib/flow-components";
import {
  type FlowContentBlock,
  getFlowContentBlocks,
} from "@/lib/flow-content-blocks";
import {
  type FlowContentComponentKey,
  type FlowContentEligibilityContext,
  getFlowContentComponent,
  resolveFlowContentMenu,
} from "@/lib/flow-content-components";
import {
  FLOW_ANSWER_FORMATS,
  getFlowInputFamilyDefinition,
  isFlowInputStepType,
} from "@/lib/flow-input-editor";
import { getFlowMessageFamilyDefinition } from "@/lib/flow-message-editor";

type FlowStep = Awaited<ReturnType<typeof listActionFlowSteps>>[number];
type BranchRule = Awaited<ReturnType<typeof listActionFlowBranchRules>>[number];

type CanvasNodeData = {
  label: ReactNode;
};

type CanvasNode = Node<CanvasNodeData>;

type ActionFlowCanvasProps = {
  actionId: number;
  branchRules: BranchRule[];
  catalogProducts: CatalogProductOption[];
  mediaAssets: MediaAssetOption[];
  operations: OperationOption[];
  productCatalogs: ProductCatalogOption[];
  projectActions: ProjectActionOption[];
  routeIssues: ActionFlowRouteValidationIssue[];
  steps: FlowStep[];
};

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

type InspectorSelection =
  | { id: string; type: "edge" }
  | { id: string; type: "node" }
  | null;

const FLOW_CONTENT_COMPONENT_ICONS = {
  catalog: ShoppingBag,
  choice_buttons: ListChecks,
  handoff: Workflow,
  list: ListChecks,
  media: ImageIcon,
  multiple_products: ShoppingBag,
  single_product: Package,
  template: Wand2,
  text: MessageSquareText,
} satisfies Record<FlowContentComponentKey, LucideIcon>;

function FlowAddContentMenuItems({
  context,
  onAdd,
}: {
  context: FlowContentEligibilityContext;
  onAdd: (key: FlowContentComponentKey) => void;
}) {
  const items = resolveFlowContentMenu(context);

  return (
    <div className="space-y-3">
      {(["message", "action"] as const).map((group) => {
        const groupItems = items.filter(
          (item) => item.component.group === group,
        );

        return (
          <div key={group} className="space-y-1">
            <p className="px-3 py-1 text-[11px] font-medium uppercase text-muted-foreground">
              {group === "message" ? "Message content" : "Actions"}
            </p>
            {groupItems.map(({ component, disabledReason, enabled }) => {
              const Icon = FLOW_CONTENT_COMPONENT_ICONS[component.key];

              return (
                <button
                  key={component.key}
                  type="button"
                  disabled={!enabled}
                  title={disabledReason ?? component.description}
                  onClick={() => onAdd(component.key)}
                  className="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors enabled:hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-muted-foreground"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {component.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                      {disabledReason ?? component.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

type CanvasBranchRuleInput = {
  branchLabel: string;
  comparisonValue: string;
  conditionGroup: string;
  isEnabled: boolean;
  operator: string;
  sortOrder: number;
  sourceFieldKey: string;
  sourceStepId: number;
  targetStepId: number;
};

type BranchConditionDraft = {
  comparisonValue: string;
  fieldKey: string;
  id: string;
  operator: string;
};

type BranchFieldOption = {
  fieldKey: string;
  inputType: "date" | "number" | "text" | "time";
  label: string;
};

type CanvasStepInput = {
  choiceDisplayMode: string;
  contactAttributeFieldKey: string;
  contactAttributeKey: string;
  contactAttributeValue: string;
  contactAttributeValueSource: string;
  contactTagNames: string;
  connectedActionId: string;
  connectFlowMode: string;
  fieldKey: string;
  handoffNotifyTeam: boolean;
  handoffPriority: string;
  handoffQueue: string;
  inputType: string;
  isEnabled: boolean;
  isRequired: boolean;
  label: string;
  mediaAssetId: string;
  operationExecutionMode: string;
  operationFailureStepId: string;
  operationId: string;
  operationSuccessStepId: string;
  options: string;
  productCatalogId: string;
  productDisplayLayout: string;
  productIds: string[];
  productSelectionAllowMultiple: boolean;
  productSelectionAllowQuantity: boolean;
  prompt: string;
  requiredMessage: string;
  stepType: string;
  validationAllowedFileTypes: string;
  validationMaxDate: string;
  validationMaxLength: string;
  validationMaxNumber: string;
  validationMessage: string;
  validationMinDate: string;
  validationMinLength: string;
  validationMinNumber: string;
  validationRegex: string;
  waitAmount: string;
  waitUnit: string;
  whatsappTemplateBody: string;
  whatsappTemplateCategory: string;
  whatsappTemplateLanguage: string;
  whatsappTemplateName: string;
  whatsappTemplateStatus: string;
  whatsappTemplateVariables: string;
};

type CanvasStepBasicsInput = {
  choiceDisplayMode: string;
  contactAttributeFieldKey?: string;
  contactAttributeKey?: string;
  contactAttributeValue?: string;
  contactAttributeValueSource?: string;
  contactTagNames?: string;
  connectedActionId?: string;
  connectFlowMode?: string;
  contentBlocks: string;
  contentBlocksChanged: boolean;
  fieldKey?: string;
  handoffNotifyTeam?: boolean;
  handoffPriority?: string;
  handoffQueue?: string;
  inputType: string;
  isEnabled: boolean;
  isRequired: boolean;
  label: string;
  operationExecutionMode?: string;
  operationFailureStepId?: string;
  operationId?: string;
  operationSuccessStepId?: string;
  options: string;
  optionsChanged: boolean;
  prompt: string;
  waitAmount?: string;
  waitUnit?: string;
};

type CanvasStepQuickSave = (
  stepId: number,
  input: CanvasStepBasicsInput,
) => Promise<{ message: string; ok: boolean }>;

const CANVAS_INPUT_TYPES = [
  "text",
  "email",
  "phone",
  "date",
  "time",
  "int",
  "float",
] as const;

const CANVAS_BRANCH_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "greater_than",
  "less_than",
  "is_empty",
  "is_not_empty",
] as const;

const BRANCH_OPERATOR_COPY = {
  contains: {
    label: "Contains",
    hint: "Routes when the field includes the compare text.",
    needsComparison: true,
  },
  equals: {
    label: "Equals",
    hint: "Routes when the field exactly matches the compare value.",
    needsComparison: true,
  },
  greater_than: {
    label: "Greater than",
    hint: "Routes when the field is numerically greater than the compare value.",
    needsComparison: true,
  },
  is_empty: {
    label: "Is empty",
    hint: "Routes when the field is blank or missing.",
    needsComparison: false,
  },
  is_not_empty: {
    label: "Is not empty",
    hint: "Routes when the field has any value.",
    needsComparison: false,
  },
  less_than: {
    label: "Less than",
    hint: "Routes when the field is numerically less than the compare value.",
    needsComparison: true,
  },
  not_equals: {
    label: "Does not equal",
    hint: "Routes when the field does not exactly match the compare value.",
    needsComparison: true,
  },
} satisfies Record<
  (typeof CANVAS_BRANCH_OPERATORS)[number],
  { hint: string; label: string; needsComparison: boolean }
>;

function formatLabel(value: string) {
  return formatFlowComponentLabel(value);
}

function formatBranchOperator(operator: string) {
  return operator in BRANCH_OPERATOR_COPY
    ? BRANCH_OPERATOR_COPY[operator as keyof typeof BRANCH_OPERATOR_COPY].label
    : formatLabel(operator);
}

function getBranchOperatorHint(operator: string) {
  return operator in BRANCH_OPERATOR_COPY
    ? BRANCH_OPERATOR_COPY[operator as keyof typeof BRANCH_OPERATOR_COPY].hint
    : "";
}

function branchOperatorNeedsComparison(operator: string) {
  return operator in BRANCH_OPERATOR_COPY
    ? BRANCH_OPERATOR_COPY[operator as keyof typeof BRANCH_OPERATOR_COPY]
        .needsComparison
    : true;
}

function getStepLabel(step: FlowStep) {
  return step.label || step.fieldKey || getFlowComponentLabel(step.stepType);
}

function isWarningDiagnostic(issue: ActionFlowRouteValidationIssue) {
  return issue.severity === "warning";
}

function countBlockingDiagnostics(issues: ActionFlowRouteValidationIssue[]) {
  return issues.filter((issue) => !isWarningDiagnostic(issue)).length;
}

function countWarningDiagnostics(issues: ActionFlowRouteValidationIssue[]) {
  return issues.filter(isWarningDiagnostic).length;
}

function getStepColor(step: FlowStep) {
  if (!step.isEnabled) {
    return "#9ca3af";
  }

  return getFlowComponentColor(step.stepType);
}

function getCanvasPosition(settings: Record<string, unknown>) {
  const position = settings.canvasPosition;

  if (!position || typeof position !== "object" || Array.isArray(position)) {
    return null;
  }

  const positionRecord = position as Record<string, unknown>;

  if (
    typeof positionRecord.x !== "number" ||
    typeof positionRecord.y !== "number" ||
    !Number.isFinite(positionRecord.x) ||
    !Number.isFinite(positionRecord.y)
  ) {
    return null;
  }

  return {
    x: positionRecord.x,
    y: positionRecord.y,
  };
}

function getStepById(steps: FlowStep[], stepId: number | null) {
  if (stepId === null) {
    return null;
  }

  return steps.find((step) => step.id === stepId) ?? null;
}

function getBranchRuleSettingText(rule: BranchRule, key: string) {
  const value = rule.settings[key];
  return typeof value === "string" ? value : "";
}

function getBranchConditionText(rule: BranchRule) {
  if (rule.settings.operationRoutePreset === "success") {
    return "operation success";
  }

  if (rule.settings.operationRoutePreset === "failure") {
    return "operation failure";
  }

  const parsed = getStoredActionFlowConditionGroup(rule);
  if (!parsed.group) {
    return "Invalid route condition";
  }

  const conditions = parsed.group.conditions.map((condition) => {
    const comparison = condition.comparisonValue?.trim();
    const description = comparison
      ? `${formatBranchOperator(condition.operator).toLowerCase()} ${comparison}`
      : formatBranchOperator(condition.operator).toLowerCase();
    return `${condition.fieldKey} ${description}`;
  });

  return conditions.join(parsed.group.combinator === "and" ? " and " : " or ");
}

function getBranchLabel(rule: BranchRule) {
  return (
    getBranchRuleSettingText(rule, "branchLabel") ||
    getBranchConditionText(rule)
  );
}

function getStepRouteLabel(steps: FlowStep[], stepId: number) {
  const step = getStepById(steps, stepId);

  return step ? `${step.sortOrder}. ${getStepLabel(step)}` : `Step #${stepId}`;
}

const CANVAS_EDGE_LABEL_PROPS = {
  labelBgBorderRadius: 8,
  labelBgPadding: [8, 4] as [number, number],
  labelBgStyle: {
    fill: "#ffffff",
    fillOpacity: 0.94,
  },
  labelStyle: {
    fill: "#64748b",
    fontSize: 11,
    fontWeight: 500,
  },
};

function buildOrderedFallbackEdges(steps: FlowStep[]) {
  const enabledSteps = steps.filter((step) => step.isEnabled);
  const edges: Edge[] = [];

  for (const [index, step] of enabledSteps.entries()) {
    const nextStep = enabledSteps[index + 1];
    if (!nextStep || step.nextStepId !== null || step.stepType === "submit") {
      continue;
    }

    edges.push({
      id: `ordered-${step.id}-${nextStep.id}`,
      source: String(step.id),
      target: String(nextStep.id),
      label: "fallback",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: {
        stroke: "#94a3b8",
        strokeDasharray: "5 5",
        strokeWidth: 1.4,
      },
      type: "smoothstep",
      ...CANVAS_EDGE_LABEL_PROPS,
    });
  }

  return edges;
}

function CanvasContentBlockPreview({ block }: { block: FlowContentBlock }) {
  if (block.type === "choice") {
    return (
      <div className="space-y-2 rounded-md border bg-gray-50 p-2.5">
        <p className="line-clamp-2 break-words text-xs leading-snug text-gray-700">
          {block.text}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {block.options.slice(0, 3).map((option, optionIndex) => (
            <span
              key={`${block.id}-${option}-${optionIndex}`}
              className="max-w-full truncate rounded-md border bg-white px-2 py-1 text-[11px] leading-none text-gray-700"
            >
              {option}
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
  catalogProducts,
  issueCount,
  mediaAssets,
  onQuickSave,
  productCatalogs,
  step,
}: {
  catalogProducts: CatalogProductOption[];
  issueCount: number;
  mediaAssets: MediaAssetOption[];
  onQuickSave: CanvasStepQuickSave;
  productCatalogs: ProductCatalogOption[];
  step: FlowStep;
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
  const storedChoices = choiceBlock?.options ?? storedManualChoices;
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
            ? { ...block, options: choices }
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

  const allowsAnswerCollection =
    step.inputType !== null &&
    !hasDynamicChoices &&
    step.stepType !== "choice" &&
    storedManualChoices.length === 0;

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
                  onClick={() =>
                    setChoices(
                      choices.filter((_, choiceIndex) => choiceIndex !== index),
                    )
                  }
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
          {issueCount > 0 && (
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          )}
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
              allowsAnswerCollection,
              blockCount: contentBlocks.length,
              catalogProductCount: catalogProducts.length,
              hasChoiceBlock: Boolean(choiceBlock),
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

function buildNodes(input: {
  catalogProducts: CatalogProductOption[];
  mediaAssets: MediaAssetOption[];
  onQuickSave: CanvasStepQuickSave;
  productCatalogs: ProductCatalogOption[];
  routeIssues: ActionFlowRouteValidationIssue[];
  steps: FlowStep[];
}): CanvasNode[] {
  const issueCountByStepId = new Map<number, number>();

  for (const issue of input.routeIssues) {
    if (issue.stepId) {
      issueCountByStepId.set(
        issue.stepId,
        (issueCountByStepId.get(issue.stepId) ?? 0) + 1,
      );
    }
  }

  return input.steps.map((step, index) => {
    const issueCount = issueCountByStepId.get(step.id) ?? 0;
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
            catalogProducts={input.catalogProducts}
            issueCount={issueCount}
            mediaAssets={input.mediaAssets}
            onQuickSave={input.onQuickSave}
            productCatalogs={input.productCatalogs}
            step={step}
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
        borderColor: issueCount > 0 ? "#d97706" : stepColor,
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

function buildEdges(input: {
  branchRules: BranchRule[];
  routeIssues: ActionFlowRouteValidationIssue[];
  steps: FlowStep[];
}) {
  const issueRuleIds = new Set(
    input.routeIssues
      .map((issue) => issue.ruleId)
      .filter((ruleId): ruleId is number => typeof ruleId === "number"),
  );

  const defaultEdges = input.steps
    .filter((step) => step.nextStepId !== null)
    .map<Edge>((step) => ({
      id: `default-${step.id}-${step.nextStepId}`,
      source: String(step.id),
      target: String(step.nextStepId),
      label: "default route",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: {
        stroke: step.isEnabled ? "#111827" : "#9ca3af",
        strokeWidth: 1.6,
      },
      type: "smoothstep",
      ...CANVAS_EDGE_LABEL_PROPS,
    }));

  const branchEdges = input.branchRules.map<Edge>((rule) => ({
    id: `branch-${rule.id}`,
    source: String(rule.sourceStepId),
    target: String(rule.targetStepId),
    label: rule.isEnabled
      ? getBranchLabel(rule)
      : `${getBranchLabel(rule)} (off)`,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      stroke: issueRuleIds.has(rule.id)
        ? "#d97706"
        : rule.isEnabled
          ? "#2563eb"
          : "#9ca3af",
      strokeDasharray: rule.isEnabled ? undefined : "5 5",
      strokeWidth: 1.6,
    },
    type: "smoothstep",
    ...CANVAS_EDGE_LABEL_PROPS,
  }));

  return [
    ...defaultEdges,
    ...branchEdges,
    ...buildOrderedFallbackEdges(input.steps),
  ];
}

function getNextBranchSortOrder(
  branchRules: BranchRule[],
  sourceStepId: number,
) {
  return (
    branchRules
      .filter((rule) => rule.sourceStepId === sourceStepId)
      .reduce((max, rule) => Math.max(max, rule.sortOrder), 0) + 1
  );
}

function getStepOptions(steps: FlowStep[], sourceStepId: number) {
  return steps.filter((step) => step.id !== sourceStepId);
}

function getInputFieldKeys(steps: FlowStep[]) {
  return Array.from(
    new Set(
      steps.flatMap((step) => {
        const keys = step.fieldKey ? [step.fieldKey] : [];
        if (step.stepType === "operation") {
          keys.push(step.fieldKey || `operation_${step.id}_status`);
        }

        return keys;
      }),
    ),
  );
}

function getBranchFieldOptions(steps: FlowStep[]): BranchFieldOption[] {
  const options = new Map<string, BranchFieldOption>();

  for (const step of steps) {
    if (!step.isEnabled) {
      continue;
    }

    if (
      step.stepType === "operation" &&
      step.settings.operationExecutionMode !== "inline"
    ) {
      continue;
    }

    const fieldKey =
      step.stepType === "operation"
        ? step.fieldKey || `operation_${step.id}_status`
        : step.fieldKey;
    if (!fieldKey) {
      continue;
    }

    const inputType =
      step.stepType === "date" || step.inputType === "date"
        ? "date"
        : step.stepType === "time" || step.inputType === "time"
          ? "time"
          : step.stepType === "number" ||
              step.inputType === "int" ||
              step.inputType === "float"
            ? "number"
            : "text";

    if (!options.has(fieldKey)) {
      options.set(fieldKey, {
        fieldKey,
        inputType,
        label: getStepLabel(step),
      });
    }
  }

  return [...options.values()];
}

function readBranchRuleForm(form: HTMLFormElement): CanvasBranchRuleInput {
  const formData = new FormData(form);

  return {
    branchLabel: String(formData.get("branchLabel") ?? ""),
    comparisonValue: String(formData.get("comparisonValue") ?? ""),
    conditionGroup: String(formData.get("conditionGroup") ?? ""),
    isEnabled: formData.get("isEnabled") === "on",
    operator: String(formData.get("operator") ?? "equals"),
    sortOrder: Number(formData.get("sortOrder")),
    sourceFieldKey: String(formData.get("sourceFieldKey") ?? ""),
    sourceStepId: Number(formData.get("sourceStepId")),
    targetStepId: Number(formData.get("targetStepId")),
  };
}

function readStepForm(form: HTMLFormElement): CanvasStepInput {
  const formData = new FormData(form);

  return {
    choiceDisplayMode: String(formData.get("choiceDisplayMode") ?? "buttons"),
    contactAttributeFieldKey: String(
      formData.get("contactAttributeFieldKey") ?? "",
    ),
    contactAttributeKey: String(formData.get("contactAttributeKey") ?? ""),
    contactAttributeValue: String(formData.get("contactAttributeValue") ?? ""),
    contactAttributeValueSource: String(
      formData.get("contactAttributeValueSource") ?? "field",
    ),
    contactTagNames: String(formData.get("contactTagNames") ?? ""),
    connectedActionId: String(formData.get("connectedActionId") ?? ""),
    connectFlowMode: String(formData.get("connectFlowMode") ?? "jump"),
    fieldKey: String(formData.get("fieldKey") ?? ""),
    handoffNotifyTeam: formData.get("handoffNotifyTeam") === "on",
    handoffPriority: String(formData.get("handoffPriority") ?? "normal"),
    handoffQueue: String(formData.get("handoffQueue") ?? ""),
    inputType: String(formData.get("inputType") ?? ""),
    isEnabled: formData.get("isEnabled") === "on",
    isRequired: formData.get("isRequired") === "on",
    label: String(formData.get("label") ?? ""),
    mediaAssetId: String(formData.get("mediaAssetId") ?? ""),
    operationExecutionMode: String(
      formData.get("operationExecutionMode") ?? "post_submit",
    ),
    operationFailureStepId: String(
      formData.get("operationFailureStepId") ?? "",
    ),
    operationId: String(formData.get("operationId") ?? ""),
    operationSuccessStepId: String(
      formData.get("operationSuccessStepId") ?? "",
    ),
    options: String(formData.get("options") ?? ""),
    productCatalogId: String(formData.get("productCatalogId") ?? ""),
    productDisplayLayout: String(
      formData.get("productDisplayLayout") ?? "grid",
    ),
    productIds: formData.getAll("productIds").map(String),
    productSelectionAllowMultiple:
      formData.get("productSelectionAllowMultiple") === "on",
    productSelectionAllowQuantity:
      formData.get("productSelectionAllowQuantity") === "on",
    prompt: String(formData.get("prompt") ?? ""),
    requiredMessage: String(formData.get("requiredMessage") ?? ""),
    stepType: String(formData.get("stepType") ?? "collect_input"),
    validationAllowedFileTypes: String(
      formData.get("validationAllowedFileTypes") ?? "",
    ),
    validationMaxDate: String(formData.get("validationMaxDate") ?? ""),
    validationMaxLength: String(formData.get("validationMaxLength") ?? ""),
    validationMaxNumber: String(formData.get("validationMaxNumber") ?? ""),
    validationMessage: String(formData.get("validationMessage") ?? ""),
    validationMinDate: String(formData.get("validationMinDate") ?? ""),
    validationMinLength: String(formData.get("validationMinLength") ?? ""),
    validationMinNumber: String(formData.get("validationMinNumber") ?? ""),
    validationRegex: String(formData.get("validationRegex") ?? ""),
    waitAmount: String(formData.get("waitAmount") ?? ""),
    waitUnit: String(formData.get("waitUnit") ?? "minutes"),
    whatsappTemplateBody: String(formData.get("whatsappTemplateBody") ?? ""),
    whatsappTemplateCategory: String(
      formData.get("whatsappTemplateCategory") ?? "utility",
    ),
    whatsappTemplateLanguage: String(
      formData.get("whatsappTemplateLanguage") ?? "",
    ),
    whatsappTemplateName: String(formData.get("whatsappTemplateName") ?? ""),
    whatsappTemplateStatus: String(
      formData.get("whatsappTemplateStatus") ?? "draft",
    ),
    whatsappTemplateVariables: String(
      formData.get("whatsappTemplateVariables") ?? "",
    ),
  };
}

function readStepBasicsForm(form: HTMLFormElement): CanvasStepBasicsInput {
  const formData = new FormData(form);

  return {
    choiceDisplayMode: String(formData.get("choiceDisplayMode") ?? "buttons"),
    contactAttributeFieldKey: String(
      formData.get("contactAttributeFieldKey") ?? "",
    ),
    contactAttributeKey: String(formData.get("contactAttributeKey") ?? ""),
    contactAttributeValue: String(formData.get("contactAttributeValue") ?? ""),
    contactAttributeValueSource: String(
      formData.get("contactAttributeValueSource") ?? "field",
    ),
    contactTagNames: String(formData.get("contactTagNames") ?? ""),
    connectedActionId: String(formData.get("connectedActionId") ?? ""),
    connectFlowMode: String(formData.get("connectFlowMode") ?? "jump"),
    contentBlocks: String(formData.get("contentBlocks") ?? "[]"),
    contentBlocksChanged: formData.get("contentBlocksChanged") === "true",
    fieldKey: String(formData.get("fieldKey") ?? ""),
    handoffNotifyTeam: formData.get("handoffNotifyTeam") === "on",
    handoffPriority: String(formData.get("handoffPriority") ?? "normal"),
    handoffQueue: String(formData.get("handoffQueue") ?? ""),
    inputType: String(formData.get("inputType") ?? "text"),
    isEnabled: formData.get("isEnabled") === "on",
    isRequired: formData.get("isRequired") === "on",
    label: String(formData.get("label") ?? ""),
    operationExecutionMode: String(
      formData.get("operationExecutionMode") ?? "post_submit",
    ),
    operationFailureStepId: String(
      formData.get("operationFailureStepId") ?? "",
    ),
    operationId: String(formData.get("operationId") ?? ""),
    operationSuccessStepId: String(
      formData.get("operationSuccessStepId") ?? "",
    ),
    options: String(formData.get("options") ?? ""),
    optionsChanged: formData.get("optionsChanged") === "true",
    prompt: String(formData.get("prompt") ?? ""),
    waitAmount: String(formData.get("waitAmount") ?? ""),
    waitUnit: String(formData.get("waitUnit") ?? "minutes"),
  };
}

function formatStepOptions(options: unknown[]) {
  return options
    .map((option) => {
      if (!option || typeof option !== "object" || Array.isArray(option)) {
        return "";
      }

      const optionRecord = option as Record<string, unknown>;
      const label = optionRecord.label ?? optionRecord.value;

      return typeof label === "string" ? label : "";
    })
    .filter(Boolean)
    .join("\n");
}

function getStepChoiceDisplayMode(step?: FlowStep) {
  const mode = step?.settings.choiceDisplayMode;

  return typeof mode === "string" ? mode : "buttons";
}

function getStepOperationExecutionMode(step?: FlowStep) {
  return step?.settings.operationExecutionMode === "inline"
    ? "inline"
    : "post_submit";
}

function getStepMediaAssetId(step?: FlowStep) {
  const value = step?.settings.mediaAssetId;
  return typeof value === "number" ? String(value) : "";
}

function getStepProductCatalogId(step?: FlowStep) {
  const value = step?.settings.productCatalogId;
  return typeof value === "number" ? String(value) : "";
}

function getStepProductIds(step?: FlowStep) {
  const value = step?.settings.productIds;
  return Array.isArray(value)
    ? value
        .filter((item): item is number => typeof item === "number")
        .map(String)
    : [];
}

function getStepProductDisplayLayout(step?: FlowStep) {
  const layout = step?.settings.productDisplayLayout;

  return layout === "featured" || layout === "list" || layout === "grid"
    ? layout
    : "grid";
}

function getStepProductSelectionAllowQuantity(step?: FlowStep) {
  return step?.settings.productSelectionAllowQuantity === true;
}

function getStepProductSelectionAllowMultiple(step?: FlowStep) {
  return step?.settings.productSelectionAllowMultiple === true;
}

function getStepTemplateCategory(step?: FlowStep) {
  const category = step?.settings.whatsappTemplateCategory;

  return category === "authentication" ||
    category === "marketing" ||
    category === "utility"
    ? category
    : "utility";
}

function getStepTemplateStatus(step?: FlowStep) {
  const status = step?.settings.whatsappTemplateStatus;

  return status === "approved" ||
    status === "draft" ||
    status === "pending" ||
    status === "rejected"
    ? status
    : "draft";
}

function getStepTemplateVariables(step?: FlowStep) {
  const variables = step?.settings.whatsappTemplateVariables;

  return Array.isArray(variables)
    ? variables.filter((item): item is string => typeof item === "string")
    : [];
}

function getStepHandoffPriority(step?: FlowStep) {
  const priority = step?.settings.handoffPriority;

  return priority === "urgent" ||
    priority === "high" ||
    priority === "normal" ||
    priority === "low"
    ? priority
    : "normal";
}

function getStepConnectedActionId(step?: FlowStep) {
  const value = step?.settings.connectedActionId;
  return typeof value === "number" ? String(value) : "";
}

function getStepConnectFlowMode(step?: FlowStep) {
  return step?.settings.connectFlowMode === "return" ? "return" : "jump";
}

function getOperationRoutePresetTargetId(
  branchRules: BranchRule[],
  stepId: number | undefined,
  preset: "failure" | "success",
) {
  if (!stepId) {
    return "";
  }

  return String(
    branchRules.find(
      (rule) =>
        rule.sourceStepId === stepId &&
        rule.settings.operationRoutePreset === preset,
    )?.targetStepId ?? "",
  );
}

function getStepSettingText(step: FlowStep | undefined, key: string) {
  const value = step?.settings[key];
  return typeof value === "string" ? value : "";
}

function getStepSettingNumber(step: FlowStep | undefined, key: string) {
  const value = step?.settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

function getComponentGroupLabel(group: FlowComponentGroup) {
  return group === "message" ? "Message types" : "Actions";
}

function groupFlowComponents(components: readonly FlowComponentDefinition[]) {
  return {
    action: components.filter((component) => component.group === "action"),
    message: components.filter((component) => component.group === "message"),
  };
}

function FlowComponentPalette({
  onSelectStepType,
  selectedStepType,
}: {
  onSelectStepType: (stepType: string) => void;
  selectedStepType: string;
}) {
  const enabledGroups = groupFlowComponents(listEnabledStepFlowComponents());
  const plannedGroups = groupFlowComponents(listPlannedFlowComponents());
  const groups: FlowComponentGroup[] = ["message", "action"];

  return (
    <aside className="h-full overflow-hidden rounded-md border bg-white">
      <div className="border-b px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Wand2 className="h-4 w-4" />
          Blocks
        </p>
      </div>
      <div className="h-[716px] space-y-5 overflow-y-auto p-3">
        {groups.map((group) => (
          <div key={group} className="space-y-2">
            <p className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
              {getComponentGroupLabel(group)}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {enabledGroups[group].map((component) => (
                <button
                  key={component.key}
                  type="button"
                  onClick={() =>
                    component.stepType && onSelectStepType(component.stepType)
                  }
                  className={`min-h-24 w-full rounded-md border px-2 py-2 text-center transition-colors hover:bg-gray-50 ${
                    selectedStepType === component.stepType
                      ? "border-gray-900 bg-gray-50"
                      : "border-gray-200"
                  }`}
                >
                  <span className="flex h-full flex-col items-center justify-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: component.color }}
                    />
                    <span className="min-w-0 space-y-1">
                      <span className="block text-sm font-medium leading-tight">
                        {component.label}
                      </span>
                      <span className="line-clamp-2 text-xs leading-tight text-muted-foreground">
                        {component.description}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="border-t pt-4">
          <p className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
            Planned
          </p>
          <div className="mt-2 space-y-4">
            {groups.map((group) => (
              <div key={group} className="space-y-2">
                <p className="px-1 text-xs font-medium text-muted-foreground">
                  {getComponentGroupLabel(group)}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {plannedGroups[group].map((component) => (
                    <div
                      key={component.key}
                      title={component.disabledReason ?? component.description}
                      className="min-h-24 rounded-md border border-dashed px-2 py-2 text-center opacity-75"
                    >
                      <span className="flex h-full flex-col items-center justify-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: component.color }}
                        />
                        <span className="min-w-0 space-y-1">
                          <span className="block text-sm font-medium leading-tight">
                            {component.label}
                          </span>
                          <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-600">
                            Planned
                          </span>
                          <span className="line-clamp-2 text-xs leading-tight text-muted-foreground">
                            {component.disabledReason ?? component.description}
                          </span>
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function CanvasToolbar({
  actionId,
  branchRuleCount,
  defaultRouteCount,
  hasUnsavedLayout,
  isPending,
  onSaveLayout,
  routeIssueCount,
  routeWarningCount,
  stepCount,
}: {
  actionId: number;
  branchRuleCount: number;
  defaultRouteCount: number;
  hasUnsavedLayout: boolean;
  isPending: boolean;
  onSaveLayout: () => void;
  routeIssueCount: number;
  routeWarningCount: number;
  stepCount: number;
}) {
  return (
    <div className="rounded-md border bg-white px-4 py-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid gap-2 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Nodes
            </p>
            <p className="font-medium">{stepCount}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Branches
            </p>
            <p className="font-medium">{branchRuleCount}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Default Routes
            </p>
            <p className="font-medium">{defaultRouteCount}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Blockers
            </p>
            <p
              className={
                routeIssueCount > 0
                  ? "font-medium text-amber-700"
                  : "font-medium"
              }
            >
              {routeIssueCount}
            </p>
            {routeWarningCount > 0 && (
              <p className="text-xs text-amber-700">
                {routeWarningCount} warning(s)
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!hasUnsavedLayout || isPending}
            onClick={onSaveLayout}
          >
            {isPending && hasUnsavedLayout ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Layout
          </Button>
          <Button asChild variant="outline">
            <Link href={`/projects/actions/${actionId}`}>
              <Workflow className="h-4 w-4" />
              Overview
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/projects/actions/${actionId}/export`}>
              <FileDown className="h-4 w-4" />
              Export
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function RouteValidationPanel({
  routeIssues,
}: {
  routeIssues: ActionFlowRouteValidationIssue[];
}) {
  const errorCount = countBlockingDiagnostics(routeIssues);
  const warningCount = countWarningDiagnostics(routeIssues);

  function getIssueLabel(issue: ActionFlowRouteValidationIssue) {
    if (issue.source === "graph_cycle") {
      return "Loop";
    }
    if (issue.source === "graph_reachability") {
      return "Unreachable step";
    }
    if (issue.source === "graph_terminal") {
      return "Finish path";
    }
    if (
      issue.source === "branch_condition" ||
      issue.source === "branch_rule" ||
      issue.source === "default_next_step"
    ) {
      return "Route";
    }
    if (issue.source === "channel_capability") {
      return "Channel";
    }
    return "Step setup";
  }

  return (
    <div className="rounded-md border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4" />
            Flow checks
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Publishing uses these same route and finish-path checks.
          </p>
        </div>
        {routeIssues.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-800">
              {errorCount} error{errorCount === 1 ? "" : "s"}
            </span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">
              {warningCount} warning{warningCount === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>
      {routeIssues.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" />
          Flow compiled. Every reachable path can finish.
        </p>
      ) : (
        <div className="space-y-2">
          {routeIssues.map((issue, index) => (
            <div
              key={`${issue.code ?? issue.source}-${issue.stepId ?? issue.ruleId ?? index}`}
              className={`rounded-md border px-3 py-2 text-sm ${
                isWarningDiagnostic(issue)
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              <p className="flex gap-2">
                <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                  {getIssueLabel(issue)}
                </span>
                <span>{issue.message}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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

function StepCreateForm({
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
            defaultMaxLength={getStepSettingNumber(step, "validationMaxLength")}
            defaultMaxNumber={getStepSettingNumber(step, "validationMaxNumber")}
            defaultMinDate={getStepSettingText(step, "validationMinDate")}
            defaultMinLength={getStepSettingNumber(step, "validationMinLength")}
            defaultMinNumber={getStepSettingNumber(step, "validationMinNumber")}
            defaultRegex={getStepSettingText(step, "validationRegex")}
            defaultRequiredMessage={getStepSettingText(step, "requiredMessage")}
            idPrefix="canvas-input"
            inputType={selectedInputType}
            stepType={selectedStepType}
          />
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

function createFlowContentBlock(input: {
  catalogProducts: CatalogProductOption[];
  mediaAssets: MediaAssetOption[];
  productCatalogs: ProductCatalogOption[];
  type: FlowContentComponentKey;
}): FlowContentBlock | null {
  const id = `content-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const component = getFlowContentComponent(input.type);

  if (
    !component ||
    component.target !== "content_block" ||
    !component.blockType
  ) {
    return null;
  }

  if (component.blockType === "choice") {
    return {
      displayMode: component.defaultChoiceDisplayMode ?? "buttons",
      id,
      options: ["Option 1"],
      text: "Choose an option",
      type: "choice",
    };
  }

  if (component.blockType === "text") {
    return {
      id,
      text: "New message",
      type: "text",
    };
  }

  if (component.blockType === "media") {
    const mediaAsset = input.mediaAssets[0];
    return mediaAsset
      ? {
          id,
          media: null,
          mediaAssetId: mediaAsset.id,
          text: "",
          type: "media",
        }
      : null;
  }

  const displayMode = component.defaultProductDisplayMode ?? "catalog";
  const defaultCatalogId =
    displayMode === "catalog"
      ? input.productCatalogs[0]?.id
      : input.catalogProducts[0]?.catalogId;
  const catalog = input.productCatalogs.find(
    (item) => item.id === defaultCatalogId,
  );
  if (!catalog) {
    return null;
  }

  const catalogProductIds = input.catalogProducts
    .filter((product) => product.catalogId === catalog.id)
    .map((product) => product.id);
  return {
    catalog: null,
    catalogId: catalog.id,
    displayMode,
    id,
    layout: "grid",
    productIds:
      displayMode === "catalog"
        ? []
        : displayMode === "single_product"
          ? catalogProductIds.slice(0, 1)
          : catalogProductIds.slice(0, 3),
    products: [],
    text: "Here are some products you may like.",
    type: "catalog",
  };
}

function duplicateFlowContentBlock(block: FlowContentBlock): FlowContentBlock {
  const id = `content-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  if (block.type === "choice") {
    return { ...block, id, options: [...block.options] };
  }

  if (block.type === "catalog") {
    return {
      ...block,
      id,
      productIds: [...block.productIds],
      products: [...block.products],
    };
  }

  return { ...block, id };
}

function moveFlowContentBlock(
  blocks: FlowContentBlock[],
  fromIndex: number,
  toIndex: number,
) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= blocks.length ||
    toIndex >= blocks.length
  ) {
    return blocks;
  }

  const nextBlocks = [...blocks];
  const [movedBlock] = nextBlocks.splice(fromIndex, 1);
  nextBlocks.splice(toIndex, 0, movedBlock);
  return nextBlocks;
}

function FlowContentBlocksEditor({
  allowsAnswerCollection,
  blocks,
  catalogProducts,
  mediaAssets,
  onChange,
  productCatalogs,
}: {
  allowsAnswerCollection: boolean;
  blocks: FlowContentBlock[];
  catalogProducts: CatalogProductOption[];
  mediaAssets: MediaAssetOption[];
  onChange: (blocks: FlowContentBlock[]) => void;
  productCatalogs: ProductCatalogOption[];
}) {
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const hasChoiceBlock = blocks.some((block) => block.type === "choice");

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
                    disabled={blocks.length >= 10}
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
              allowsAnswerCollection,
              blockCount: blocks.length,
              catalogProductCount: catalogProducts.length,
              hasChoiceBlock,
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
  const allowsAnswerCollection =
    collectsAnswer &&
    !hasDynamicOptions &&
    step.stepType !== "choice" &&
    storedOptions.length === 0;
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
        allowsAnswerCollection={allowsAnswerCollection}
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
            {FLOW_ANSWER_FORMATS.map((format) => (
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

function StepBasicsForm({
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

function BranchRuleForm({
  branchRules,
  isPending,
  mode,
  onDelete,
  onSubmit,
  rule,
  sourceStep,
  steps,
}: {
  branchRules: BranchRule[];
  isPending: boolean;
  mode: "create" | "edit";
  onDelete?: () => void;
  onSubmit: (input: CanvasBranchRuleInput) => void;
  rule?: BranchRule;
  sourceStep: FlowStep;
  steps: FlowStep[];
}) {
  const targetSteps = getStepOptions(steps, sourceStep.id);
  const availableFieldOptions = getBranchFieldOptions(steps);
  const defaultSourceFieldKey =
    rule?.sourceFieldKey ??
    sourceStep.fieldKey ??
    availableFieldOptions[0]?.fieldKey ??
    "";
  const parsedGroup = rule ? getStoredActionFlowConditionGroup(rule) : null;
  const initialGroup = parsedGroup?.group ?? {
    combinator: "and" as const,
    conditions: [
      {
        comparisonValue: rule?.comparisonValue ?? "",
        fieldKey: defaultSourceFieldKey,
        operator: (rule?.operator ?? "equals") as ActionBranchOperator,
      },
    ],
    schemaVersion: 1 as const,
  };
  const fieldOptions = [...availableFieldOptions];
  for (const condition of initialGroup.conditions) {
    if (
      condition.fieldKey &&
      !fieldOptions.some((option) => option.fieldKey === condition.fieldKey)
    ) {
      fieldOptions.push({
        fieldKey: condition.fieldKey,
        inputType: "text",
        label: condition.fieldKey,
      });
    }
  }
  const [branchLabel, setBranchLabel] = useState(
    rule ? getBranchRuleSettingText(rule, "branchLabel") : "",
  );
  const [combinator, setCombinator] = useState<"and" | "or">(
    initialGroup.combinator,
  );
  const [conditions, setConditions] = useState<BranchConditionDraft[]>(
    initialGroup.conditions.map((condition, index) => ({
      comparisonValue: condition.comparisonValue ?? "",
      fieldKey: condition.fieldKey,
      id: `condition-${rule?.id ?? sourceStep.id}-${index}`,
      operator: condition.operator,
    })),
  );
  const [targetStepId, setTargetStepId] = useState(
    rule?.targetStepId ? String(rule.targetStepId) : "",
  );
  const firstCondition = conditions[0] ?? {
    comparisonValue: "",
    fieldKey: defaultSourceFieldKey,
    id: "condition-fallback",
    operator: "equals",
  };
  const storedConditionGroup: StoredActionFlowConditionGroup = {
    combinator,
    conditions: conditions.map((condition) => ({
      comparisonValue: branchOperatorNeedsComparison(condition.operator)
        ? condition.comparisonValue
        : null,
      fieldKey: condition.fieldKey,
      operator: condition.operator as ActionBranchOperator,
    })),
    schemaVersion: 1,
  };
  const conditionDescriptions = conditions.map((condition) => {
    const field = fieldOptions.find(
      (option) => option.fieldKey === condition.fieldKey,
    );
    const comparison = branchOperatorNeedsComparison(condition.operator)
      ? ` ${condition.comparisonValue || "value"}`
      : "";
    return `${field?.label || condition.fieldKey || "Answer"} ${formatBranchOperator(
      condition.operator,
    ).toLowerCase()}${comparison}`;
  });
  const conditionPreview = conditionDescriptions.join(
    combinator === "and" ? " and " : " or ",
  );
  const routePreviewLabel = branchLabel.trim() || conditionPreview;
  const targetPreview = targetStepId
    ? getStepRouteLabel(steps, Number(targetStepId))
    : "Select target step";

  function updateCondition(
    conditionId: string,
    updates: Partial<BranchConditionDraft>,
  ) {
    setConditions((current) =>
      current.map((condition) =>
        condition.id === conditionId ? { ...condition, ...updates } : condition,
      ),
    );
  }

  function getAvailableOperators(condition: BranchConditionDraft) {
    const field = fieldOptions.find(
      (option) => option.fieldKey === condition.fieldKey,
    );
    const inputType = field?.inputType ?? "text";
    const compatible = CANVAS_BRANCH_OPERATORS.filter((candidate) => {
      if (candidate === "contains") {
        return inputType === "text";
      }
      if (candidate === "greater_than" || candidate === "less_than") {
        return inputType !== "text";
      }
      return true;
    });

    return compatible.includes(
      condition.operator as (typeof CANVAS_BRANCH_OPERATORS)[number],
    )
      ? compatible
      : [
          condition.operator as (typeof CANVAS_BRANCH_OPERATORS)[number],
          ...compatible,
        ];
  }

  return (
    <form
      key={`${mode}-${rule?.id ?? sourceStep.id}`}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(readBranchRuleForm(event.currentTarget));
      }}
    >
      <input type="hidden" name="sourceStepId" value={sourceStep.id} />
      <input
        type="hidden"
        name="sourceFieldKey"
        value={firstCondition.fieldKey}
      />
      <input type="hidden" name="operator" value={firstCondition.operator} />
      <input
        type="hidden"
        name="comparisonValue"
        value={
          branchOperatorNeedsComparison(firstCondition.operator)
            ? firstCondition.comparisonValue
            : ""
        }
      />
      <input
        type="hidden"
        name="conditionGroup"
        value={JSON.stringify(storedConditionGroup)}
      />

      <div className="rounded-md border bg-gray-50 p-3 text-sm">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Condition preview
        </p>
        <p className="mt-1 font-medium">{routePreviewLabel}</p>
        <p className="mt-1 text-muted-foreground">
          When {conditionPreview || "the conditions match"}, go to{" "}
          {targetPreview}.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-branch-label`}>
          Route name
        </label>
        <input
          id={`${mode}-branch-label`}
          name="branchLabel"
          value={branchLabel}
          onChange={(event) => setBranchLabel(event.currentTarget.value)}
          placeholder="Qualified lead"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          Optional name shown on the canvas line. Leave blank to use the
          condition.
        </p>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Match</p>
            <p className="text-xs text-muted-foreground">
              Check an answer collected by this flow.
            </p>
          </div>
          {conditions.length > 1 && (
            <select
              aria-label="Condition matching"
              value={combinator}
              onChange={(event) =>
                setCombinator(event.currentTarget.value as "and" | "or")
              }
              className="flex h-9 rounded-md border border-input bg-white px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="and">All conditions</option>
              <option value="or">Any condition</option>
            </select>
          )}
        </div>

        {conditions.map((condition, index) => {
          const field = fieldOptions.find(
            (option) => option.fieldKey === condition.fieldKey,
          );
          const needsComparison = branchOperatorNeedsComparison(
            condition.operator,
          );

          return (
            <div
              key={condition.id}
              className="space-y-3 rounded-md border bg-gray-50/60 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Condition {index + 1}
                </p>
                {conditions.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="Remove condition"
                    onClick={() =>
                      setConditions((current) =>
                        current.filter((item) => item.id !== condition.id),
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Remove condition</span>
                  </Button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`${mode}-${condition.id}-field`}
                  >
                    Answer
                  </label>
                  <select
                    id={`${mode}-${condition.id}-field`}
                    required
                    value={condition.fieldKey}
                    onChange={(event) =>
                      updateCondition(condition.id, {
                        fieldKey: event.currentTarget.value,
                        operator: "equals",
                      })
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {fieldOptions.length === 0 ? (
                      <option value="">Create an answer field first</option>
                    ) : (
                      fieldOptions.map((option) => (
                        <option key={option.fieldKey} value={option.fieldKey}>
                          {option.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`${mode}-${condition.id}-operator`}
                  >
                    Comparison
                  </label>
                  <select
                    id={`${mode}-${condition.id}-operator`}
                    required
                    value={condition.operator}
                    onChange={(event) =>
                      updateCondition(condition.id, {
                        operator: event.currentTarget.value,
                      })
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {getAvailableOperators(condition).map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {formatBranchOperator(candidate)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {needsComparison && (
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`${mode}-${condition.id}-value`}
                  >
                    Value
                  </label>
                  <input
                    id={`${mode}-${condition.id}-value`}
                    type={field?.inputType ?? "text"}
                    required
                    value={condition.comparisonValue}
                    onChange={(event) =>
                      updateCondition(condition.id, {
                        comparisonValue: event.currentTarget.value,
                      })
                    }
                    placeholder="Value to match"
                    className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {getBranchOperatorHint(condition.operator)}
              </p>
            </div>
          );
        })}

        <Button
          type="button"
          variant="outline"
          disabled={fieldOptions.length === 0 || conditions.length >= 10}
          onClick={() => {
            const fieldKey = fieldOptions[0]?.fieldKey ?? "";
            setConditions((current) => [
              ...current,
              {
                comparisonValue: "",
                fieldKey,
                id: `condition-new-${Date.now()}`,
                operator: "equals",
              },
            ]);
          }}
        >
          <Plus className="h-4 w-4" />
          Add condition
        </Button>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-target`}>
          Go to
        </label>
        <select
          id={`${mode}-target`}
          name="targetStepId"
          required
          value={targetStepId}
          onChange={(event) => setTargetStepId(event.currentTarget.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">Select step</option>
          {targetSteps.map((step) => (
            <option key={step.id} value={step.id}>
              {step.sortOrder}. {getStepLabel(step)}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isEnabled"
          defaultChecked={rule?.isEnabled ?? true}
        />
        Route active
      </label>

      <details className="group rounded-md border bg-gray-50/50">
        <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium">
          Advanced route order
        </summary>
        <div className="space-y-2 border-t p-3">
          <label className="text-sm font-medium" htmlFor={`${mode}-sort-order`}>
            Priority order
          </label>
          <input
            id={`${mode}-sort-order`}
            name="sortOrder"
            type="number"
            min="1"
            required
            defaultValue={
              rule?.sortOrder ??
              getNextBranchSortOrder(branchRules, sourceStep.id)
            }
            className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Lower numbers are checked first when several routes can match.
          </p>
        </div>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending || targetSteps.length === 0}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === "create" ? (
            <Plus className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {mode === "create" ? "Add route" : "Save route"}
        </Button>
        {mode === "edit" && onDelete && (
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}

export function ActionFlowCanvas({
  actionId,
  branchRules,
  catalogProducts,
  mediaAssets,
  operations,
  productCatalogs,
  projectActions,
  routeIssues,
  steps,
}: ActionFlowCanvasProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState("");
  const [hasUnsavedLayout, setHasUnsavedLayout] = useState(false);
  const [isCreateStepDialogOpen, setIsCreateStepDialogOpen] = useState(false);
  const [paletteStepType, setPaletteStepType] = useState("collect_input");
  const [selection, setSelection] = useState<InspectorSelection>(null);
  const [isPending, startTransition] = useTransition();
  const quickSaveStep = useCallback(
    async (stepId: number, input: CanvasStepBasicsInput) => {
      setFeedback("");
      const result = await updateCanvasStepBasicsAction({
        actionId,
        stepId,
        ...input,
      });

      setFeedback(result.message);
      if (result.ok) {
        router.refresh();
      }

      return result;
    },
    [actionId, router],
  );
  const initialNodes = useMemo(
    () =>
      buildNodes({
        catalogProducts,
        mediaAssets,
        onQuickSave: quickSaveStep,
        productCatalogs,
        routeIssues,
        steps,
      }),
    [
      catalogProducts,
      mediaAssets,
      productCatalogs,
      quickSaveStep,
      routeIssues,
      steps,
    ],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const edges = useMemo(
    () => buildEdges({ branchRules, routeIssues, steps }),
    [branchRules, routeIssues, steps],
  );
  const defaultRoutes = useMemo(
    () =>
      steps
        .filter((step) => step.nextStepId !== null)
        .map((step) => ({
          sourceStep: step,
          targetStep: getStepById(steps, step.nextStepId),
        })),
    [steps],
  );
  const selectedStep =
    selection?.type === "node"
      ? getStepById(steps, Number(selection.id))
      : null;
  const selectedBranchRule =
    selection?.type === "edge" && selection.id.startsWith("branch-")
      ? (branchRules.find((rule) => `branch-${rule.id}` === selection.id) ??
        null)
      : null;
  const selectedDefaultRoute =
    selection?.type === "edge" && selection.id.startsWith("default-")
      ? (defaultRoutes.find(
          ({ sourceStep }) =>
            `default-${sourceStep.id}-${sourceStep.nextStepId}` ===
            selection.id,
        ) ?? null)
      : null;
  const selectedOrderedRoute =
    selection?.type === "edge" && selection.id.startsWith("ordered-")
      ? edges.find((edge) => edge.id === selection.id)
      : null;
  const activeBranchRuleCount = branchRules.filter(
    (rule) => rule.isEnabled,
  ).length;
  const defaultRouteCount = steps.filter(
    (step) => step.nextStepId !== null,
  ).length;
  const blockingRouteIssueCount = countBlockingDiagnostics(routeIssues);
  const routeWarningCount = countWarningDiagnostics(routeIssues);

  useEffect(() => {
    setNodes(initialNodes);
    setHasUnsavedLayout(false);
  }, [initialNodes, setNodes]);

  const createStep = useCallback(
    (input: CanvasStepInput) => {
      setFeedback("");
      startTransition(async () => {
        const result = await createCanvasStepAction({
          actionId,
          ...input,
        });

        setFeedback(result.message);
        if (result.ok) {
          router.refresh();
        }
      });
    },
    [actionId, router],
  );

  const updateStep = useCallback(
    (stepId: number, input: CanvasStepInput) => {
      setFeedback("");
      startTransition(async () => {
        const result = await updateCanvasStepAction({
          actionId,
          stepId,
          ...input,
        });

        setFeedback(result.message);
        if (result.ok) {
          router.refresh();
        }
      });
    },
    [actionId, router],
  );

  const updateStepBasics = useCallback(
    (stepId: number, input: CanvasStepBasicsInput) => {
      setFeedback("");
      startTransition(async () => {
        const result = await updateCanvasStepBasicsAction({
          actionId,
          stepId,
          ...input,
        });

        setFeedback(result.message);
        if (result.ok) {
          setSelection(null);
          router.refresh();
        }
      });
    },
    [actionId, router],
  );

  const saveLayout = useCallback(() => {
    setFeedback("");
    startTransition(async () => {
      const result = await saveCanvasStepPositionsAction({
        actionId,
        positions: nodes.map((node) => ({
          stepId: Number(node.id),
          x: node.position.x,
          y: node.position.y,
        })),
      });

      setFeedback(result.message);
      if (result.ok) {
        setHasUnsavedLayout(false);
        router.refresh();
      }
    });
  }, [actionId, nodes, router]);

  const saveDefaultRoute = useCallback(
    (sourceStepId: number, targetStepId: number) => {
      setFeedback("");
      startTransition(async () => {
        const result = await setCanvasDefaultRouteAction({
          actionId,
          sourceStepId,
          targetStepId,
        });

        setFeedback(result.message);
        if (result.ok) {
          router.refresh();
        }
      });
    },
    [actionId, router],
  );

  const clearDefaultRoute = useCallback(
    (sourceStepId: number) => {
      setFeedback("");
      startTransition(async () => {
        const result = await clearCanvasDefaultRouteAction({
          actionId,
          sourceStepId,
        });

        setFeedback(result.message);
        if (result.ok) {
          router.refresh();
        }
      });
    },
    [actionId, router],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const sourceStepId = Number(connection.source);
      const targetStepId = Number(connection.target);

      if (!Number.isInteger(sourceStepId) || !Number.isInteger(targetStepId)) {
        setFeedback("Invalid canvas route.");
        return;
      }

      saveDefaultRoute(sourceStepId, targetStepId);
    },
    [saveDefaultRoute],
  );

  const createBranchRule = useCallback(
    (input: CanvasBranchRuleInput) => {
      setFeedback("");
      startTransition(async () => {
        const result = await createCanvasBranchRuleAction({
          actionId,
          ...input,
        });

        setFeedback(result.message);
        if (result.ok) {
          router.refresh();
        }
      });
    },
    [actionId, router],
  );

  const updateBranchRule = useCallback(
    (ruleId: number, input: CanvasBranchRuleInput) => {
      setFeedback("");
      startTransition(async () => {
        const result = await updateCanvasBranchRuleAction({
          actionId,
          ruleId,
          ...input,
        });

        setFeedback(result.message);
        if (result.ok) {
          router.refresh();
        }
      });
    },
    [actionId, router],
  );

  const deleteBranchRule = useCallback(
    (ruleId: number) => {
      setFeedback("");
      startTransition(async () => {
        const result = await deleteCanvasBranchRuleAction({
          actionId,
          ruleId,
        });

        setFeedback(result.message);
        if (result.ok) {
          setSelection(null);
          router.refresh();
        }
      });
    },
    [actionId, router],
  );

  return (
    <div className="space-y-3">
      <CanvasToolbar
        actionId={actionId}
        branchRuleCount={activeBranchRuleCount}
        defaultRouteCount={defaultRouteCount}
        hasUnsavedLayout={hasUnsavedLayout}
        isPending={isPending}
        onSaveLayout={saveLayout}
        routeIssueCount={blockingRouteIssueCount}
        routeWarningCount={routeWarningCount}
        stepCount={steps.length}
      />

      {feedback && (
        <p
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
            feedback.toLowerCase().includes("saved") ||
            feedback.toLowerCase().includes("cleared") ||
            feedback.toLowerCase().includes("created") ||
            feedback.toLowerCase().includes("updated") ||
            feedback.toLowerCase().includes("deleted")
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          <CheckCircle2 className="h-4 w-4" />
          {feedback}
        </p>
      )}

      <div className="grid min-h-[760px] grid-cols-[260px_minmax(760px,1fr)] gap-3 overflow-x-auto">
        <FlowComponentPalette
          onSelectStepType={(stepType) => {
            setPaletteStepType(stepType);
            setSelection(null);
            setIsCreateStepDialogOpen(true);
          }}
          selectedStepType={paletteStepType}
        />

        <div className="relative h-[760px] min-w-[760px] overflow-hidden rounded-md border bg-white">
          <ReactFlow
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.25}
            nodes={nodes}
            onConnect={handleConnect}
            onEdgeClick={(_, edge) => {
              setIsCreateStepDialogOpen(false);
              setSelection({ id: edge.id, type: "edge" });
            }}
            onNodeClick={(_, node) => {
              setIsCreateStepDialogOpen(false);
              setSelection({ id: node.id, type: "node" });
            }}
            onNodeDragStop={() => setHasUnsavedLayout(true)}
            onNodesChange={onNodesChange}
            onPaneClick={() => setSelection(null)}
            nodesDraggable={!isPending}
            nodesConnectable={!isPending}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
          {steps.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-md border bg-white px-4 py-3 text-center shadow-sm">
                <p className="text-sm font-medium">No Steps Yet</p>
                <p className="text-xs text-muted-foreground">
                  Choose a block from the left panel to create the first step.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={isCreateStepDialogOpen}
        onOpenChange={setIsCreateStepDialogOpen}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create Step
            </DialogTitle>
            <DialogDescription>
              Configure the selected block and add it to this flow.
            </DialogDescription>
          </DialogHeader>
          <StepCreateForm
            branchRules={branchRules}
            catalogProducts={catalogProducts}
            defaultStepType={paletteStepType}
            isPending={isPending}
            mediaAssets={mediaAssets}
            onSubmit={createStep}
            operations={operations}
            productCatalogs={productCatalogs}
            projectActions={projectActions}
            steps={steps}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={selection !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelection(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedStep ? (
                <>
                  <Pencil className="h-5 w-5" />
                  Edit Step
                </>
              ) : selectedBranchRule ? (
                <>
                  <GitBranch className="h-5 w-5" />
                  Edit Branch
                </>
              ) : (
                <>
                  <Route className="h-5 w-5" />
                  Route Details
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {selectedStep
                ? "Update the visitor-facing content and common behavior."
                : selectedBranchRule
                  ? "Update this conditional route."
                  : "Review or clear this route."}
            </DialogDescription>
          </DialogHeader>

          {isPending && (
            <p className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving changes
            </p>
          )}

          {selectedStep && (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4 rounded-md border bg-gray-50 p-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Step {selectedStep.sortOrder}
                  </p>
                  <p className="mt-1 font-medium">
                    {getStepLabel(selectedStep)}
                  </p>
                </div>
                <span className="rounded-full border bg-white px-2.5 py-1 text-xs text-muted-foreground">
                  {getFlowComponentLabel(selectedStep.stepType)}
                </span>
              </div>

              <StepBasicsForm
                branchRules={branchRules}
                catalogProducts={catalogProducts}
                isPending={isPending}
                mediaAssets={mediaAssets}
                onSubmit={(input) => updateStepBasics(selectedStep.id, input)}
                operations={operations}
                productCatalogs={productCatalogs}
                projectActions={projectActions}
                step={selectedStep}
                steps={steps}
              />

              {!isFlowActionStepType(selectedStep.stepType) && (
                <details className="group rounded-md border bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <Wand2 className="h-4 w-4" />
                      Advanced settings
                    </span>
                    <span className="text-xs font-normal text-muted-foreground group-open:hidden">
                      Validation, integrations, and channel controls
                    </span>
                  </summary>
                  <div className="border-t p-4">
                    <StepCreateForm
                      branchRules={branchRules}
                      catalogProducts={catalogProducts}
                      isPending={isPending}
                      mediaAssets={mediaAssets}
                      onSubmit={(input) => updateStep(selectedStep.id, input)}
                      operations={operations}
                      productCatalogs={productCatalogs}
                      projectActions={projectActions}
                      step={selectedStep}
                      steps={steps}
                      submitLabel="Save Advanced Settings"
                    />
                  </div>
                </details>
              )}

              <details className="group rounded-md border bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
                  <span className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    Branching
                  </span>
                  <span className="text-xs font-normal text-muted-foreground group-open:hidden">
                    Add a conditional route from this step
                  </span>
                </summary>
                <div className="border-t p-4">
                  <BranchRuleForm
                    key={`create-branch-${selectedStep.id}`}
                    branchRules={branchRules}
                    isPending={isPending}
                    mode="create"
                    onSubmit={createBranchRule}
                    sourceStep={selectedStep}
                    steps={steps}
                  />
                </div>
              </details>
            </div>
          )}

          {selectedBranchRule && (
            <div className="space-y-5">
              <div className="rounded-md border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Selected Branch
                </p>
                <p className="font-medium">
                  {getBranchLabel(selectedBranchRule)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  When {getBranchConditionText(selectedBranchRule)}, go to{" "}
                  {getStepRouteLabel(steps, selectedBranchRule.targetStepId)}.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedBranchRule.isEnabled ? "Enabled" : "Disabled"}
                </p>
              </div>

              <BranchRuleForm
                key={`edit-branch-${selectedBranchRule.id}`}
                branchRules={branchRules}
                isPending={isPending}
                mode="edit"
                onDelete={() => deleteBranchRule(selectedBranchRule.id)}
                onSubmit={(input) =>
                  updateBranchRule(selectedBranchRule.id, input)
                }
                rule={selectedBranchRule}
                sourceStep={
                  getStepById(steps, selectedBranchRule.sourceStepId) ??
                  steps[0]
                }
                steps={steps}
              />
            </div>
          )}

          {selectedDefaultRoute && (
            <div className="space-y-4">
              <div className="rounded-md border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Selected Default Route
                </p>
                <p className="font-medium">
                  {selectedDefaultRoute.sourceStep.sortOrder}.{" "}
                  {getStepLabel(selectedDefaultRoute.sourceStep)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedDefaultRoute.targetStep
                    ? `Routes to ${selectedDefaultRoute.targetStep.sortOrder}. ${getStepLabel(
                        selectedDefaultRoute.targetStep,
                      )}`
                    : `Routes to missing step #${selectedDefaultRoute.sourceStep.nextStepId}`}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  clearDefaultRoute(selectedDefaultRoute.sourceStep.id)
                }
                disabled={isPending}
              >
                <Unlink className="h-4 w-4" />
                Clear Default Route
              </Button>
            </div>
          )}

          {selectedOrderedRoute && (
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Ordered Fallback
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                This dashed route is implicit runtime behavior. Connect nodes to
                save an explicit default route.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <RouteValidationPanel routeIssues={routeIssues} />

      <div className="rounded-md border bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              <Link2 className="h-4 w-4" />
              Default Route Editing
            </p>
            {feedback && (
              <p
                className={`mt-1 text-sm ${
                  feedback.toLowerCase().includes("saved") ||
                  feedback.toLowerCase().includes("cleared")
                    ? "text-green-700"
                    : "text-red-700"
                }`}
              >
                {feedback}
              </p>
            )}
          </div>
          {isPending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving
            </p>
          )}
        </div>

        {defaultRoutes.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No explicit default routes are configured.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {defaultRoutes.map(({ sourceStep, targetStep }) => (
              <div
                key={sourceStep.id}
                className="flex flex-col gap-3 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {sourceStep.sortOrder}. {getStepLabel(sourceStep)}
                  </p>
                  <p className="text-muted-foreground">
                    {targetStep
                      ? `Routes to ${targetStep.sortOrder}. ${getStepLabel(
                          targetStep,
                        )}`
                      : `Routes to missing step #${sourceStep.nextStepId}`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => clearDefaultRoute(sourceStep.id)}
                  disabled={isPending}
                >
                  <Unlink className="h-4 w-4" />
                  Clear
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded-md border bg-white p-4">
          <p className="flex items-center gap-2 font-medium">
            <Route className="h-4 w-4" />
            Default route
          </p>
          <p className="mt-1 text-muted-foreground">
            Solid dark edges use a step's configured next step.
          </p>
        </div>
        <div className="rounded-md border bg-white p-4">
          <p className="flex items-center gap-2 font-medium">
            <GitBranch className="h-4 w-4" />
            Branch route
          </p>
          <p className="mt-1 text-muted-foreground">
            Blue edges represent enabled conditional branch rules.
          </p>
        </div>
        <div className="rounded-md border bg-white p-4">
          <p className="flex items-center gap-2 font-medium">
            <Workflow className="h-4 w-4" />
            Ordered fallback
          </p>
          <p className="mt-1 text-muted-foreground">
            Dashed edges show the runtime's next enabled step fallback.
          </p>
        </div>
      </div>
    </div>
  );
}
