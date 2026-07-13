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
  CheckCircle2,
  FileDown,
  GitBranch,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Route,
  Save,
  Trash2,
  Unlink,
  Wand2,
  Workflow,
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
} from "@/app/projects/actions/canvas-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  ActionFlowRouteValidationIssue,
  listActionFlowBranchRules,
  listActionFlowSteps,
} from "@/lib/action-flows";
import {
  type FlowComponentDefinition,
  type FlowComponentGroup,
  formatFlowComponentLabel,
  getFlowComponentColor,
  getFlowComponentLabel,
  listEnabledStepFlowComponents,
  listPlannedFlowComponents,
} from "@/lib/flow-components";

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

type CanvasBranchRuleInput = {
  branchLabel: string;
  comparisonValue: string;
  isEnabled: boolean;
  operator: string;
  sortOrder: number;
  sourceFieldKey: string;
  sourceStepId: number;
  targetStepId: number;
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
  whatsappTemplateBody: string;
  whatsappTemplateCategory: string;
  whatsappTemplateLanguage: string;
  whatsappTemplateName: string;
  whatsappTemplateStatus: string;
  whatsappTemplateVariables: string;
};

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

  const comparison = rule.comparisonValue?.trim();
  const condition = comparison
    ? `${formatBranchOperator(rule.operator)} ${comparison}`
    : formatBranchOperator(rule.operator);

  return `${rule.sourceFieldKey}: ${condition}`;
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

function buildNodes(input: {
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
      data: {
        label: (
          <div className="w-full text-left">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase leading-none text-muted-foreground">
                  Step {step.sortOrder}
                </p>
                <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-gray-950">
                  {getStepLabel(step)}
                </p>
              </div>
              {issueCount > 0 && (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span
                className="max-w-full truncate rounded-full px-2.5 py-1 font-medium leading-none text-white"
                style={{ backgroundColor: stepColor }}
              >
                {formatLabel(step.stepType)}
              </span>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 leading-none text-gray-700">
                {step.isEnabled ? "Enabled" : "Disabled"}
              </span>
              {step.fieldKey && (
                <span className="max-w-[240px] truncate rounded-full bg-gray-100 px-2.5 py-1 leading-none text-gray-700">
                  {step.fieldKey}
                </span>
              )}
            </div>
            {step.prompt && (
              <p className="mt-3 line-clamp-2 break-words text-xs leading-snug text-muted-foreground">
                {step.prompt}
              </p>
            )}
          </div>
        ),
      },
      position: savedPosition ?? {
        x: column * 460,
        y: row * 230,
      },
      sourcePosition: Position.Right,
      style: {
        backgroundColor: "#ffffff",
        borderColor: issueCount > 0 ? "#d97706" : stepColor,
        borderRadius: 8,
        borderWidth: 1.5,
        boxSizing: "border-box",
        boxShadow: "0 12px 24px rgba(15, 23, 42, 0.07)",
        minHeight: 152,
        opacity: step.isEnabled ? 1 : 0.68,
        padding: 18,
        width: 320,
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

function readBranchRuleForm(form: HTMLFormElement): CanvasBranchRuleInput {
  const formData = new FormData(form);

  return {
    branchLabel: String(formData.get("branchLabel") ?? ""),
    comparisonValue: String(formData.get("comparisonValue") ?? ""),
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
                            {component.description}
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
  return (
    <div className="rounded-md border bg-white p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4" />
        Diagnostics
      </p>
      {routeIssues.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" />
          Routes are valid and no capability warnings were found.
        </p>
      ) : (
        <div className="space-y-2">
          {routeIssues.map((issue, index) => (
            <div
              key={`${issue.source}-${issue.stepId ?? issue.ruleId ?? index}`}
              className={`rounded-md border px-3 py-2 text-sm ${
                isWarningDiagnostic(issue)
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              <p className="flex gap-2">
                <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                  {isWarningDiagnostic(issue) ? "Warning" : "Error"}
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
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {stepComponents.map((component) => (
            <option key={component.key} value={component.stepType}>
              {component.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="canvas-step-label">
            Label
          </label>
          <input
            id="canvas-step-label"
            name="label"
            defaultValue={step?.label ?? ""}
            placeholder="Customer name"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>

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
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="canvas-step-prompt">
          Prompt
        </label>
        <textarea
          id="canvas-step-prompt"
          name="prompt"
          rows={3}
          defaultValue={step?.prompt ?? ""}
          placeholder="What should the chatbot ask or say?"
          className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="canvas-input-type">
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
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isEnabled"
              defaultChecked={step?.isEnabled ?? true}
            />
            Enabled
          </label>
        </div>
      </div>

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
              defaultValue={getStepSettingNumber(step, "validationMinLength")}
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
              defaultValue={getStepSettingNumber(step, "validationMaxLength")}
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
              defaultValue={getStepSettingNumber(step, "validationMinNumber")}
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
              defaultValue={getStepSettingNumber(step, "validationMaxNumber")}
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

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="canvas-media-asset-id">
          Media Asset
        </label>
        <select
          id="canvas-media-asset-id"
          name="mediaAssetId"
          defaultValue={getStepMediaAssetId(step)}
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
          Used by Media message steps.
        </p>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Template Content</p>
        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor="canvas-whatsapp-template-body"
          >
            Meta Body Sample
          </label>
          <textarea
            id="canvas-whatsapp-template-body"
            name="whatsappTemplateBody"
            rows={4}
            defaultValue={getStepSettingText(step, "whatsappTemplateBody")}
            placeholder="Hello {{1}}, your appointment is confirmed for {{2}}."
            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Paste the approved Meta body with numbered placeholders so variable
            compatibility can be checked.
          </p>
        </div>
        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor="canvas-whatsapp-template-name"
          >
            WhatsApp Template Name
          </label>
          <input
            id="canvas-whatsapp-template-name"
            name="whatsappTemplateName"
            defaultValue={getStepSettingText(step, "whatsappTemplateName")}
            placeholder="appointment_reminder"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor="canvas-whatsapp-template-language"
            >
              Language
            </label>
            <input
              id="canvas-whatsapp-template-language"
              name="whatsappTemplateLanguage"
              defaultValue={
                getStepSettingText(step, "whatsappTemplateLanguage") || "en_US"
              }
              placeholder="en_US"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor="canvas-whatsapp-template-category"
            >
              Category
            </label>
            <select
              id="canvas-whatsapp-template-category"
              name="whatsappTemplateCategory"
              defaultValue={getStepTemplateCategory(step)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="utility">Utility</option>
              <option value="marketing">Marketing</option>
              <option value="authentication">Authentication</option>
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor="canvas-whatsapp-template-status"
          >
            Approval Status
          </label>
          <select
            id="canvas-whatsapp-template-status"
            name="whatsappTemplateStatus"
            defaultValue={getStepTemplateStatus(step)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="draft">Draft</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor="canvas-whatsapp-template-variables"
          >
            Body Variables
          </label>
          <textarea
            id="canvas-whatsapp-template-variables"
            name="whatsappTemplateVariables"
            rows={4}
            defaultValue={getStepTemplateVariables(step).join("\n")}
            placeholder={"{{guestName}}\n{{preferredDate}}"}
            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Add one body parameter per line. Use {" {{fieldKey}} "} to fill from
            collected fields.
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Product Content</p>
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
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            name="productSelectionAllowMultiple"
            defaultChecked={getStepProductSelectionAllowMultiple(step)}
          />
          Allow multiple products as a cart for Product Selection blocks
        </label>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            name="productSelectionAllowQuantity"
            defaultChecked={getStepProductSelectionAllowQuantity(step)}
          />
          Collect quantity for Product Selection blocks
        </label>
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
          <label className="text-sm font-medium" htmlFor="canvas-product-ids">
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
            Used by Catalogue, Single Product, Multiple Products, and Product
            Selection blocks.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="canvas-operation-id">
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
          Operation blocks can run workflow actions. Request Intervention blocks
          can use this as the staff notification operation.
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
          <option value="return">Return after connected flow submits</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Jump ends this flow. Return uses the connected flow as a reusable
          subflow, then resumes here.
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
          For inline operation steps, these create completed/failed branch rules
          from the operation status field.
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
              defaultValue={getStepSettingText(step, "contactAttributeKey")}
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
              defaultValue={getStepSettingText(step, "contactAttributeValue")}
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
          Request Intervention blocks move the live submission to Under Review.
        </p>
      </div>

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
  const fieldKeys = getInputFieldKeys(steps);
  const defaultSourceFieldKey =
    rule?.sourceFieldKey ?? sourceStep.fieldKey ?? fieldKeys[0] ?? "";
  const defaultOperator = rule?.operator ?? "equals";
  const defaultComparisonValue = rule?.comparisonValue ?? "";
  const [branchLabel, setBranchLabel] = useState(
    rule ? getBranchRuleSettingText(rule, "branchLabel") : "",
  );
  const [sourceFieldKey, setSourceFieldKey] = useState(defaultSourceFieldKey);
  const [operator, setOperator] = useState(defaultOperator);
  const [comparisonValue, setComparisonValue] = useState(
    defaultComparisonValue,
  );
  const [targetStepId, setTargetStepId] = useState(
    rule?.targetStepId ? String(rule.targetStepId) : "",
  );
  const fieldKeyOptions = Array.from(
    new Set([defaultSourceFieldKey, ...fieldKeys].filter(Boolean)),
  );
  const needsComparison = branchOperatorNeedsComparison(operator);
  const conditionPreview = needsComparison
    ? `${sourceFieldKey || "field"} ${formatBranchOperator(
        operator,
      ).toLowerCase()} ${comparisonValue || "value"}`
    : `${sourceFieldKey || "field"} ${formatBranchOperator(
        operator,
      ).toLowerCase()}`;
  const routePreviewLabel = branchLabel.trim() || conditionPreview;
  const targetPreview = targetStepId
    ? getStepRouteLabel(steps, Number(targetStepId))
    : "Select target step";

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

      <div className="rounded-md border bg-gray-50 p-3 text-sm">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Branch Preview
        </p>
        <p className="mt-1 font-medium">{routePreviewLabel}</p>
        <p className="mt-1 text-muted-foreground">
          When {conditionPreview}, go to {targetPreview}.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-sort-order`}>
          Order
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
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-branch-label`}>
          Branch Label
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
          Optional label shown on the canvas edge. Leave blank to use the
          condition.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-field-key`}>
          Source field
        </label>
        <select
          id={`${mode}-field-key`}
          name="sourceFieldKey"
          required
          value={sourceFieldKey}
          onChange={(event) => setSourceFieldKey(event.currentTarget.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {fieldKeyOptions.length === 0 ? (
            <option value="">Create a field first</option>
          ) : (
            fieldKeyOptions.map((fieldKey) => (
              <option key={fieldKey} value={fieldKey}>
                {fieldKey}
              </option>
            ))
          )}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-operator`}>
          Operator
        </label>
        <select
          id={`${mode}-operator`}
          name="operator"
          required
          value={operator}
          onChange={(event) => setOperator(event.currentTarget.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {CANVAS_BRANCH_OPERATORS.map((operator) => (
            <option key={operator} value={operator}>
              {formatBranchOperator(operator)}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {getBranchOperatorHint(operator)}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-compare`}>
          Compare
        </label>
        <input
          id={`${mode}-compare`}
          name="comparisonValue"
          value={needsComparison ? comparisonValue : ""}
          onChange={(event) => setComparisonValue(event.currentTarget.value)}
          placeholder="value"
          required={needsComparison}
          disabled={!needsComparison}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        {!needsComparison && (
          <p className="text-xs text-muted-foreground">
            This operator does not need a comparison value.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-target`}>
          Target step
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
        Enabled
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending || targetSteps.length === 0}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === "create" ? (
            <Plus className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {mode === "create" ? "Create Branch" : "Save Branch"}
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
  const initialNodes = useMemo(
    () => buildNodes({ routeIssues, steps }),
    [routeIssues, steps],
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
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
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
                ? "Update this step or create a branch from it."
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
              <div className="rounded-md border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Selected Step
                </p>
                <p className="font-medium">
                  {selectedStep.sortOrder}. {getStepLabel(selectedStep)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {getFlowComponentLabel(selectedStep.stepType)}
                  {selectedStep.fieldKey ? ` - ${selectedStep.fieldKey}` : ""}
                </p>
              </div>

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
                submitLabel="Save Step"
              />

              <div className="border-t pt-5">
                <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <GitBranch className="h-4 w-4" />
                  Create Branch
                </p>
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
