import { type Edge, MarkerType } from "@xyflow/react";
import type {
  BranchFieldOption,
  BranchRule,
  CanvasBranchRuleInput,
  CanvasStepBasicsInput,
  CanvasStepInput,
  CatalogProductOption,
  FlowStep,
  MediaAssetOption,
  ProductCatalogOption,
} from "@/components/action-flow-canvas/types";
import { getStoredActionFlowConditionGroup } from "@/lib/action-flow-compiler";
import type { ActionFlowRouteValidationIssue } from "@/lib/action-flows";
import {
  formatFlowComponentLabel,
  getFlowComponentColor,
  getFlowComponentLabel,
} from "@/lib/flow-components";
import type { FlowContentBlock } from "@/lib/flow-content-blocks";
import {
  type FlowContentComponentKey,
  getFlowContentComponent,
} from "@/lib/flow-content-components";
import {
  readConversationalTaskFlowNodeSettings,
  readKnowledgeFlowNodeSettings,
} from "@/lib/hybrid-flow-compiler";

export const CANVAS_INPUT_TYPES = [
  "text",
  "email",
  "phone",
  "date",
  "time",
  "int",
  "float",
] as const;

export const CANVAS_BRANCH_OPERATORS = [
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

export function formatLabel(value: string) {
  return formatFlowComponentLabel(value);
}

export function formatBranchOperator(operator: string) {
  return operator in BRANCH_OPERATOR_COPY
    ? BRANCH_OPERATOR_COPY[operator as keyof typeof BRANCH_OPERATOR_COPY].label
    : formatLabel(operator);
}

export function getBranchOperatorHint(operator: string) {
  return operator in BRANCH_OPERATOR_COPY
    ? BRANCH_OPERATOR_COPY[operator as keyof typeof BRANCH_OPERATOR_COPY].hint
    : "";
}

export function branchOperatorNeedsComparison(operator: string) {
  return operator in BRANCH_OPERATOR_COPY
    ? BRANCH_OPERATOR_COPY[operator as keyof typeof BRANCH_OPERATOR_COPY]
        .needsComparison
    : true;
}

export function getStepLabel(step: FlowStep) {
  return step.label || step.fieldKey || getFlowComponentLabel(step.stepType);
}

export function isWarningDiagnostic(issue: ActionFlowRouteValidationIssue) {
  return issue.severity === "warning";
}

export function countBlockingDiagnostics(
  issues: ActionFlowRouteValidationIssue[],
) {
  return issues.filter((issue) => !isWarningDiagnostic(issue)).length;
}

export function countWarningDiagnostics(
  issues: ActionFlowRouteValidationIssue[],
) {
  return issues.filter(isWarningDiagnostic).length;
}

export function getStepColor(step: FlowStep) {
  if (!step.isEnabled) {
    return "#9ca3af";
  }

  return getFlowComponentColor(step.stepType);
}

export function getCanvasPosition(settings: Record<string, unknown>) {
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

export function getStepById(steps: FlowStep[], stepId: number | null) {
  if (stepId === null) {
    return null;
  }

  return steps.find((step) => step.id === stepId) ?? null;
}

export function getBranchRuleSettingText(rule: BranchRule, key: string) {
  const value = rule.settings[key];
  return typeof value === "string" ? value : "";
}

export function getBranchConditionText(rule: BranchRule) {
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

export function getBranchLabel(rule: BranchRule) {
  return (
    getBranchRuleSettingText(rule, "branchLabel") ||
    getBranchConditionText(rule)
  );
}

export function getStepRouteLabel(steps: FlowStep[], stepId: number) {
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
    if (
      !nextStep ||
      step.nextStepId !== null ||
      ["conversational_task", "knowledge_conversation", "submit"].includes(
        step.stepType,
      )
    ) {
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

function buildHybridEdges(steps: FlowStep[]) {
  const edges: Edge[] = [];
  const availableStepIds = new Set(steps.map((step) => step.id));

  function addEdge(input: {
    id: string;
    label: string;
    sourceStepId: number;
    target: number | "end" | null;
    color: string;
  }) {
    if (
      typeof input.target !== "number" ||
      !availableStepIds.has(input.target)
    ) {
      return;
    }
    edges.push({
      id: input.id,
      label: input.label,
      markerEnd: { type: MarkerType.ArrowClosed },
      source: String(input.sourceStepId),
      style: {
        stroke: input.color,
        strokeWidth: 1.8,
      },
      target: String(input.target),
      type: "smoothstep",
      ...CANVAS_EDGE_LABEL_PROPS,
    });
  }

  for (const step of steps) {
    const knowledge = readKnowledgeFlowNodeSettings(step.settings);
    if (knowledge) {
      addEdge({
        color: "#7c3aed",
        id: `hybrid-answered-${step.id}`,
        label: "answered",
        sourceStepId: step.id,
        target: knowledge.answeredRoute,
      });
      addEdge({
        color: "#dc2626",
        id: `hybrid-handoff-${step.id}`,
        label: "handoff",
        sourceStepId: step.id,
        target: knowledge.handoffRoute,
      });
      addEdge({
        color: "#d97706",
        id: `hybrid-no-answer-${step.id}`,
        label: "no answer",
        sourceStepId: step.id,
        target: knowledge.noAnswerRoute,
      });
      for (const targetStepId of knowledge.recommendationTargetStepIds) {
        addEdge({
          color: "#2563eb",
          id: `hybrid-recommend-${step.id}-${targetStepId}`,
          label: "recommend task",
          sourceStepId: step.id,
          target: targetStepId,
        });
      }
      continue;
    }

    const task = readConversationalTaskFlowNodeSettings(step.settings);
    if (!task) {
      continue;
    }
    for (const [outputPort, target] of Object.entries(task.outcomeRoutes)) {
      addEdge({
        color: "#059669",
        id: `hybrid-outcome-${step.id}-${outputPort}`,
        label: outputPort,
        sourceStepId: step.id,
        target,
      });
    }
  }

  return edges;
}

export function buildEdges(input: {
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
    ...buildHybridEdges(input.steps),
    ...buildOrderedFallbackEdges(input.steps),
  ];
}

export function getNextBranchSortOrder(
  branchRules: BranchRule[],
  sourceStepId: number,
) {
  return (
    branchRules
      .filter((rule) => rule.sourceStepId === sourceStepId)
      .reduce((max, rule) => Math.max(max, rule.sortOrder), 0) + 1
  );
}

export function getStepOptions(steps: FlowStep[], sourceStepId: number) {
  return steps.filter((step) => step.id !== sourceStepId);
}

export function getInputFieldKeys(steps: FlowStep[]) {
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

export function getBranchFieldOptions(steps: FlowStep[]): BranchFieldOption[] {
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

export function readBranchRuleForm(
  form: HTMLFormElement,
): CanvasBranchRuleInput {
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

export function readStepForm(form: HTMLFormElement): CanvasStepInput {
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

export function readStepBasicsForm(
  form: HTMLFormElement,
): CanvasStepBasicsInput {
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

export function formatStepOptions(options: unknown[]) {
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

export function getStepChoiceDisplayMode(step?: FlowStep) {
  const mode = step?.settings.choiceDisplayMode;

  return typeof mode === "string" ? mode : "buttons";
}

export function getStepOperationExecutionMode(step?: FlowStep) {
  return step?.settings.operationExecutionMode === "inline"
    ? "inline"
    : "post_submit";
}

export function getStepMediaAssetId(step?: FlowStep) {
  const value = step?.settings.mediaAssetId;
  return typeof value === "number" ? String(value) : "";
}

export function getStepProductCatalogId(step?: FlowStep) {
  const value = step?.settings.productCatalogId;
  return typeof value === "number" ? String(value) : "";
}

export function getStepProductIds(step?: FlowStep) {
  const value = step?.settings.productIds;
  return Array.isArray(value)
    ? value
        .filter((item): item is number => typeof item === "number")
        .map(String)
    : [];
}

export function getStepProductDisplayLayout(step?: FlowStep) {
  const layout = step?.settings.productDisplayLayout;

  return layout === "featured" || layout === "list" || layout === "grid"
    ? layout
    : "grid";
}

export function getStepProductSelectionAllowQuantity(step?: FlowStep) {
  return step?.settings.productSelectionAllowQuantity === true;
}

export function getStepProductSelectionAllowMultiple(step?: FlowStep) {
  return step?.settings.productSelectionAllowMultiple === true;
}

export function getStepTemplateCategory(step?: FlowStep) {
  const category = step?.settings.whatsappTemplateCategory;

  return category === "authentication" ||
    category === "marketing" ||
    category === "utility"
    ? category
    : "utility";
}

export function getStepTemplateStatus(step?: FlowStep) {
  const status = step?.settings.whatsappTemplateStatus;

  return status === "approved" ||
    status === "draft" ||
    status === "pending" ||
    status === "rejected"
    ? status
    : "draft";
}

export function getStepTemplateVariables(step?: FlowStep) {
  const variables = step?.settings.whatsappTemplateVariables;

  return Array.isArray(variables)
    ? variables.filter((item): item is string => typeof item === "string")
    : [];
}

export function getStepHandoffPriority(step?: FlowStep) {
  const priority = step?.settings.handoffPriority;

  return priority === "urgent" ||
    priority === "high" ||
    priority === "normal" ||
    priority === "low"
    ? priority
    : "normal";
}

export function getStepConnectedActionId(step?: FlowStep) {
  const value = step?.settings.connectedActionId;
  return typeof value === "number" ? String(value) : "";
}

export function getStepConnectFlowMode(step?: FlowStep) {
  return step?.settings.connectFlowMode === "return" ? "return" : "jump";
}

export function getOperationRoutePresetTargetId(
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

export function getStepSettingText(step: FlowStep | undefined, key: string) {
  const value = step?.settings[key];
  return typeof value === "string" ? value : "";
}

export function getStepSettingNumber(step: FlowStep | undefined, key: string) {
  const value = step?.settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

export function createFlowContentBlock(input: {
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

export function duplicateFlowContentBlock(
  block: FlowContentBlock,
): FlowContentBlock {
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

export function moveFlowContentBlock(
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
