import { resolveActionDataSourceOptions } from "@/lib/action-data-sources";
import {
  ACTION_BRANCH_OPERATORS,
  type ActionBranchOperator,
} from "@/lib/action-flow-constants";
import {
  ACTION_OPTION_ROUTE_SETTINGS_KEY,
  getActionOptionBehavior,
  getActionOptionIdentity,
  getStoredActionOptionRoute,
  getStoredActionOptions,
} from "@/lib/action-option-routing";
import {
  ACTION_RESPONSE_POLICY_OUTPUTS,
  getActionResponsePolicy,
  getActionResponsePolicyTarget,
} from "@/lib/action-response-policy";
import { getFlowChoiceContentBlock } from "@/lib/flow-content-blocks";

export const ACTION_FLOW_CONDITION_VALUE_TYPES = [
  "string",
  "number",
  "date",
  "time",
  "boolean",
] as const;

export type ActionFlowConditionValueType =
  (typeof ACTION_FLOW_CONDITION_VALUE_TYPES)[number];
export type ActionFlowConditionCombinator = "and" | "or";

export type StoredActionFlowCondition = {
  comparisonValue?: string | null;
  fieldKey: string;
  operator: ActionBranchOperator;
  valueType?: ActionFlowConditionValueType;
};

export type StoredActionFlowConditionGroup = {
  combinator: ActionFlowConditionCombinator;
  conditions: StoredActionFlowCondition[];
  schemaVersion: 1;
};

export type CompiledActionFlowCondition = {
  comparisonValue: boolean | number | string | null;
  fieldKey: string;
  operator: ActionBranchOperator;
  valueType: ActionFlowConditionValueType;
};

export type CompiledActionFlowConditionGroup = {
  combinator: ActionFlowConditionCombinator;
  conditions: CompiledActionFlowCondition[];
  schemaVersion: 1;
};

export type ActionFlowCompilerStep = {
  fieldKey: string | null;
  id: number;
  inputType: string | null;
  isEnabled: boolean;
  nextStepId: number | null;
  options?: unknown;
  settings: Record<string, unknown>;
  sortOrder: number;
  stepType: string;
};

export type ActionFlowCompilerBranchRule = {
  comparisonValue: string | null;
  id: number;
  isEnabled: boolean;
  operator: string;
  settings: Record<string, unknown>;
  sortOrder: number;
  sourceFieldKey: string;
  sourceStepId: number;
  targetStepId: number;
};

export type ActionFlowCompilerIssueSource =
  | "branch_condition"
  | "branch_rule"
  | "default_next_step"
  | "graph_cycle"
  | "graph_entry"
  | "graph_reachability"
  | "graph_terminal"
  | "option_route"
  | "response_policy";

export type ActionFlowCompilerIssueCode =
  | "branch_condition_group_invalid"
  | "branch_comparison_invalid"
  | "branch_operator_incompatible"
  | "branch_operator_unknown"
  | "branch_source_field_unknown"
  | "branch_source_step_missing"
  | "branch_source_step_not_runnable"
  | "branch_source_step_terminal"
  | "branch_target_step_missing"
  | "branch_target_step_not_runnable"
  | "branch_value_type_mismatch"
  | "default_source_step_terminal"
  | "default_target_step_missing"
  | "default_target_step_not_runnable"
  | "graph_cycle_detected"
  | "graph_entry_missing"
  | "graph_terminal_unreachable"
  | "graph_step_unreachable"
  | "option_route_conflict"
  | "option_route_duplicate"
  | "option_route_option_missing"
  | "option_route_settings_invalid"
  | "option_route_source_field_mismatch"
  | "option_route_value_mismatch"
  | "response_policy_target_missing"
  | "response_policy_target_not_runnable"
  | "response_policy_timing_invalid";

export type ActionFlowCompilerIssue = {
  code: ActionFlowCompilerIssueCode;
  message: string;
  ruleId?: number;
  severity: "error" | "warning";
  source: ActionFlowCompilerIssueSource;
  stepId?: number;
};

export type CompiledActionFlowEdge = {
  condition?: CompiledActionFlowConditionGroup;
  ruleId?: number;
  sourceStepId: number;
  targetStepId: number;
  outputPort?: string;
  type: "branch" | "default" | "ordered" | "policy";
};

export type CompiledActionFlowGraph = {
  branchConditions: Record<number, CompiledActionFlowConditionGroup>;
  edges: CompiledActionFlowEdge[];
  entryStepId: number | null;
  fieldTypes: Record<string, ActionFlowConditionValueType>;
  issues: ActionFlowCompilerIssue[];
  reachableStepIds: number[];
  runnableStepIds: number[];
  terminalStepIds: number[];
  unreachableStepIds: number[];
};

type ParsedConditionGroup =
  | { group: StoredActionFlowConditionGroup; message?: never }
  | { group?: never; message: string };

const TERMINAL_STEP_TYPES = new Set([
  "confirmation",
  "connect_flow",
  "handoff",
  "submit",
]);
const HYBRID_RUNTIME_STEP_TYPES = new Set([
  "conversational_task",
  "knowledge_conversation",
]);
const COMPARISON_FREE_OPERATORS = new Set<ActionBranchOperator>([
  "is_empty",
  "is_not_empty",
]);
const ORDERED_OPERATORS = new Set<ActionBranchOperator>([
  "greater_than",
  "less_than",
]);

export function needsExplicitPublishTerminalStep(stepTypes: readonly string[]) {
  return (
    stepTypes.length > 0 &&
    !stepTypes.some((stepType) => HYBRID_RUNTIME_STEP_TYPES.has(stepType)) &&
    !stepTypes.some((stepType) => ["confirmation", "submit"].includes(stepType))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isConditionValueType(
  value: unknown,
): value is ActionFlowConditionValueType {
  return ACTION_FLOW_CONDITION_VALUE_TYPES.includes(
    value as ActionFlowConditionValueType,
  );
}

function isBranchOperator(value: unknown): value is ActionBranchOperator {
  return ACTION_BRANCH_OPERATORS.includes(value as ActionBranchOperator);
}

function isRunnableStep(step: ActionFlowCompilerStep) {
  return (
    step.isEnabled &&
    (step.stepType !== "operation" ||
      step.settings.operationExecutionMode === "inline")
  );
}

function getCompilerStepOptions(step: ActionFlowCompilerStep) {
  if (step.stepType === "boolean") {
    return [
      {
        ...getActionOptionIdentity({
          fallbackId: "boolean-true",
          id: "boolean-true",
        }),
        label: "Yes",
        value: true,
      },
      {
        ...getActionOptionIdentity({
          fallbackId: "boolean-false",
          id: "boolean-false",
        }),
        label: "No",
        value: false,
      },
    ];
  }

  const contentChoice = getFlowChoiceContentBlock(step.settings);
  if (contentChoice) {
    return contentChoice.options
      .filter(
        (option) => getActionOptionBehavior(option.actionType) === "reply",
      )
      .map((option) => ({
        ...getActionOptionIdentity({
          fallbackId: `content-option-${option.value}`,
          id: option.id,
        }),
        label: option.label,
        value: option.value,
      }));
  }

  const storedOptions = getStoredActionOptions(step.options);
  if (storedOptions.length > 0) {
    return storedOptions;
  }

  const dynamicOptions = resolveActionDataSourceOptions(step.settings);
  if (dynamicOptions.length > 0) {
    return dynamicOptions.map((option, index) => ({
      ...getActionOptionIdentity({
        fallbackId: `source-option-${index + 1}`,
        id: option.value,
      }),
      label: option.label,
      value: option.value,
    }));
  }

  const products = step.settings.products;
  if (!Array.isArray(products)) {
    return [];
  }

  return products.flatMap((product) => {
    if (!product || typeof product !== "object" || Array.isArray(product)) {
      return [];
    }

    const record = product as Record<string, unknown>;
    if (
      typeof record.id !== "number" ||
      typeof record.name !== "string" ||
      !record.name.trim()
    ) {
      return [];
    }

    return [
      {
        ...getActionOptionIdentity({
          fallbackId: `product-${record.id}`,
          id: `product-${record.id}`,
        }),
        label: record.name.trim(),
        value: String(record.id),
      },
    ];
  });
}

function inferStepFieldType(
  step: ActionFlowCompilerStep,
): ActionFlowConditionValueType | null {
  if (step.stepType === "boolean") {
    return "boolean";
  }

  if (
    step.stepType === "product_selection" &&
    step.settings.productSelectionAllowMultiple !== true &&
    step.settings.productSelectionAllowQuantity !== true
  ) {
    return "string";
  }

  if (step.stepType === "number") {
    return "number";
  }

  if (step.stepType === "date") {
    return "date";
  }

  if (step.stepType === "time") {
    return "time";
  }

  if (step.inputType === "float" || step.inputType === "int") {
    return "number";
  }

  if (step.inputType === "date") {
    return "date";
  }

  if (step.inputType === "time") {
    return "time";
  }

  if (
    step.fieldKey &&
    !["address", "date_range", "location", "product_selection"].includes(
      step.stepType,
    )
  ) {
    return "string";
  }

  return null;
}

export function getActionFlowFieldTypes(steps: ActionFlowCompilerStep[]) {
  const fieldTypes: Record<string, ActionFlowConditionValueType> = {};

  for (const step of steps) {
    if (!step.isEnabled) {
      continue;
    }

    if (step.stepType === "operation") {
      if (step.settings.operationExecutionMode === "inline") {
        const statusFieldKey = step.fieldKey || `operation_${step.id}_status`;
        fieldTypes[statusFieldKey] = "string";
        fieldTypes[`${statusFieldKey}_outcome`] = "string";
      }
      continue;
    }

    if (step.fieldKey) {
      const fieldType = inferStepFieldType(step);
      if (fieldType) {
        fieldTypes[step.fieldKey] = fieldType;
      }
    }
  }

  return fieldTypes;
}

function parseCondition(value: unknown): StoredActionFlowCondition | null {
  if (!isRecord(value)) {
    return null;
  }

  const fieldKey =
    typeof value.fieldKey === "string" ? value.fieldKey.trim() : "";
  if (!fieldKey || !isBranchOperator(value.operator)) {
    return null;
  }

  if (value.valueType !== undefined && !isConditionValueType(value.valueType)) {
    return null;
  }

  return {
    comparisonValue:
      typeof value.comparisonValue === "string" ? value.comparisonValue : null,
    fieldKey,
    operator: value.operator,
    valueType: value.valueType,
  };
}

export function parseStoredActionFlowConditionGroup(
  value: unknown,
): ParsedConditionGroup {
  if (!isRecord(value)) {
    return { message: "The saved condition group is not an object." };
  }

  if (
    value.schemaVersion !== 1 ||
    (value.combinator !== "and" && value.combinator !== "or") ||
    !Array.isArray(value.conditions) ||
    value.conditions.length === 0 ||
    value.conditions.length > 10
  ) {
    return { message: "The saved condition group has an unsupported format." };
  }

  const conditions = value.conditions.map(parseCondition);
  if (conditions.some((condition) => condition === null)) {
    return {
      message: "The saved condition group contains an invalid condition.",
    };
  }

  return {
    group: {
      combinator: value.combinator,
      conditions: conditions as StoredActionFlowCondition[],
      schemaVersion: 1,
    },
  };
}

export function getStoredActionFlowConditionGroup(
  rule: ActionFlowCompilerBranchRule,
): ParsedConditionGroup {
  if (rule.settings.conditionGroup !== undefined) {
    return parseStoredActionFlowConditionGroup(rule.settings.conditionGroup);
  }

  if (!isBranchOperator(rule.operator)) {
    return { message: "The branch uses an unsupported comparison." };
  }

  return {
    group: {
      combinator: "and",
      conditions: [
        {
          comparisonValue: rule.comparisonValue,
          fieldKey: rule.sourceFieldKey,
          operator: rule.operator,
        },
      ],
      schemaVersion: 1,
    },
  };
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isValidTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

function parseBoolean(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }
  return null;
}

function compileComparisonValue(
  condition: StoredActionFlowCondition,
  valueType: ActionFlowConditionValueType,
): { message?: string; value: boolean | number | string | null } {
  if (COMPARISON_FREE_OPERATORS.has(condition.operator)) {
    return { value: null };
  }

  const rawValue = condition.comparisonValue?.trim() ?? "";
  if (!rawValue) {
    return { message: "Add a comparison value.", value: null };
  }

  if (valueType === "number") {
    const value = Number(rawValue);
    return Number.isFinite(value)
      ? { value }
      : { message: "Enter a valid number for this comparison.", value: null };
  }

  if (valueType === "boolean") {
    const value = parseBoolean(rawValue);
    return value === null
      ? { message: "Use true or false for this comparison.", value: null }
      : { value };
  }

  if (valueType === "date" && !isValidDate(rawValue)) {
    return { message: "Enter a date in YYYY-MM-DD format.", value: null };
  }

  if (valueType === "time" && !isValidTime(rawValue)) {
    return { message: "Enter a time in HH:MM format.", value: null };
  }

  return { value: rawValue };
}

function isOperatorCompatible(
  operator: ActionBranchOperator,
  valueType: ActionFlowConditionValueType,
) {
  if (operator === "contains") {
    return valueType === "string";
  }

  if (ORDERED_OPERATORS.has(operator)) {
    return ["date", "number", "time"].includes(valueType);
  }

  return true;
}

function compileConditionGroup(input: {
  fieldTypes: Record<string, ActionFlowConditionValueType>;
  rule: ActionFlowCompilerBranchRule;
}) {
  const parsed = getStoredActionFlowConditionGroup(input.rule);
  if (!parsed.group) {
    return {
      issues: [
        {
          code: "branch_condition_group_invalid",
          message: `Route #${input.rule.id} has an invalid condition group. ${parsed.message}`,
          ruleId: input.rule.id,
          severity: "error",
          source: "branch_condition",
        } satisfies ActionFlowCompilerIssue,
      ],
    };
  }

  const issues: ActionFlowCompilerIssue[] = [];
  const conditions: CompiledActionFlowCondition[] = [];

  for (const condition of parsed.group.conditions) {
    const valueType = input.fieldTypes[condition.fieldKey];
    if (!valueType) {
      issues.push({
        code: "branch_source_field_unknown",
        message: `Route #${input.rule.id} checks unknown answer "${condition.fieldKey}".`,
        ruleId: input.rule.id,
        severity: "error",
        source: "branch_condition",
      });
      continue;
    }

    if (condition.valueType && condition.valueType !== valueType) {
      issues.push({
        code: "branch_value_type_mismatch",
        message: `Route #${input.rule.id} expects ${condition.fieldKey} to be ${condition.valueType}, but the answer is ${valueType}.`,
        ruleId: input.rule.id,
        severity: "error",
        source: "branch_condition",
      });
      continue;
    }

    const resolvedValueType = valueType;
    if (!isOperatorCompatible(condition.operator, resolvedValueType)) {
      issues.push({
        code: "branch_operator_incompatible",
        message: `Route #${input.rule.id} cannot use ${condition.operator.replaceAll("_", " ")} with a ${resolvedValueType} answer.`,
        ruleId: input.rule.id,
        severity: "error",
        source: "branch_condition",
      });
      continue;
    }

    const comparison = compileComparisonValue(condition, resolvedValueType);
    if (comparison.message) {
      issues.push({
        code: "branch_comparison_invalid",
        message: `Route #${input.rule.id}: ${comparison.message}`,
        ruleId: input.rule.id,
        severity: "error",
        source: "branch_condition",
      });
      continue;
    }

    conditions.push({
      comparisonValue: comparison.value,
      fieldKey: condition.fieldKey,
      operator: condition.operator,
      valueType: resolvedValueType,
    });
  }

  return {
    group:
      issues.length === 0
        ? {
            combinator: parsed.group.combinator,
            conditions,
            schemaVersion: 1 as const,
          }
        : undefined,
    issues,
  };
}

function normalizeRuntimeValue(
  value: unknown,
  valueType: ActionFlowConditionValueType,
) {
  if (valueType === "number") {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
  }

  if (valueType === "boolean") {
    if (typeof value === "boolean") {
      return value;
    }
    return parseBoolean(String(value ?? ""));
  }

  return String(value ?? "").trim();
}

export function evaluateCompiledActionFlowCondition(
  condition: CompiledActionFlowCondition,
  fields: Record<string, unknown>,
) {
  const fieldValue = fields[condition.fieldKey];
  const isEmpty =
    fieldValue === undefined ||
    fieldValue === null ||
    String(fieldValue).trim() === "";

  if (condition.operator === "is_empty") {
    return isEmpty;
  }
  if (condition.operator === "is_not_empty") {
    return !isEmpty;
  }
  if (isEmpty) {
    return false;
  }

  const left = normalizeRuntimeValue(fieldValue, condition.valueType);
  const right = condition.comparisonValue;
  if (left === null || right === null) {
    return false;
  }

  if (condition.operator === "contains") {
    return String(left).toLowerCase().includes(String(right).toLowerCase());
  }
  if (condition.operator === "equals") {
    return condition.valueType === "string"
      ? String(left).toLowerCase() === String(right).toLowerCase()
      : left === right;
  }
  if (condition.operator === "not_equals") {
    return condition.valueType === "string"
      ? String(left).toLowerCase() !== String(right).toLowerCase()
      : left !== right;
  }
  if (condition.operator === "greater_than") {
    return left > right;
  }
  if (condition.operator === "less_than") {
    return left < right;
  }

  return false;
}

export function evaluateCompiledActionFlowConditionGroup(
  group: CompiledActionFlowConditionGroup,
  fields: Record<string, unknown>,
) {
  const results = group.conditions.map((condition) =>
    evaluateCompiledActionFlowCondition(condition, fields),
  );
  return group.combinator === "and"
    ? results.every(Boolean)
    : results.some(Boolean);
}

function findStronglyConnectedComponents(
  stepIds: number[],
  outgoing: Map<number, number[]>,
) {
  let index = 0;
  const indexes = new Map<number, number>();
  const lowLinks = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const components: number[][] = [];

  function visit(stepId: number) {
    indexes.set(stepId, index);
    lowLinks.set(stepId, index);
    index += 1;
    stack.push(stepId);
    onStack.add(stepId);

    for (const targetStepId of outgoing.get(stepId) ?? []) {
      if (!indexes.has(targetStepId)) {
        visit(targetStepId);
        lowLinks.set(
          stepId,
          Math.min(lowLinks.get(stepId) ?? 0, lowLinks.get(targetStepId) ?? 0),
        );
      } else if (onStack.has(targetStepId)) {
        lowLinks.set(
          stepId,
          Math.min(lowLinks.get(stepId) ?? 0, indexes.get(targetStepId) ?? 0),
        );
      }
    }

    if (lowLinks.get(stepId) !== indexes.get(stepId)) {
      return;
    }

    const component: number[] = [];
    let currentStepId: number | undefined;
    do {
      currentStepId = stack.pop();
      if (currentStepId !== undefined) {
        onStack.delete(currentStepId);
        component.push(currentStepId);
      }
    } while (currentStepId !== stepId);
    components.push(component);
  }

  for (const stepId of stepIds) {
    if (!indexes.has(stepId)) {
      visit(stepId);
    }
  }

  return components;
}

export function compileActionFlowGraph(input: {
  branchRules: ActionFlowCompilerBranchRule[];
  steps: ActionFlowCompilerStep[];
}): CompiledActionFlowGraph {
  const issues: ActionFlowCompilerIssue[] = [];
  const orderedSteps = input.steps
    .filter(isRunnableStep)
    .sort(
      (left, right) => left.sortOrder - right.sortOrder || left.id - right.id,
    );
  const runnableStepIds = orderedSteps.map((step) => step.id);
  const runnableStepIdSet = new Set(runnableStepIds);
  const allStepIds = new Set(input.steps.map((step) => step.id));
  const stepById = new Map(input.steps.map((step) => [step.id, step]));
  const fieldTypes = getActionFlowFieldTypes(input.steps);
  const branchConditions: Record<number, CompiledActionFlowConditionGroup> = {};
  const edges: CompiledActionFlowEdge[] = [];
  const outgoing = new Map<number, number[]>();
  const hasFallback = new Set<number>();
  const optionRouteTargets = new Map<string, number>();

  function addEdge(edge: CompiledActionFlowEdge) {
    edges.push(edge);
    outgoing.set(edge.sourceStepId, [
      ...(outgoing.get(edge.sourceStepId) ?? []),
      edge.targetStepId,
    ]);
  }

  for (const rule of input.branchRules
    .filter((candidate) => candidate.isEnabled)
    .sort(
      (left, right) =>
        left.sourceStepId - right.sourceStepId ||
        left.sortOrder - right.sortOrder ||
        left.id - right.id,
    )) {
    if (!allStepIds.has(rule.sourceStepId)) {
      issues.push({
        code: "branch_source_step_missing",
        message: `Route #${rule.id} starts from a missing step.`,
        ruleId: rule.id,
        severity: "error",
        source: "branch_rule",
      });
      continue;
    }
    if (!runnableStepIdSet.has(rule.sourceStepId)) {
      issues.push({
        code: "branch_source_step_not_runnable",
        message: `Route #${rule.id} starts from a disabled or deferred step.`,
        ruleId: rule.id,
        severity: "error",
        source: "branch_rule",
      });
      continue;
    }
    if (
      TERMINAL_STEP_TYPES.has(stepById.get(rule.sourceStepId)?.stepType ?? "")
    ) {
      issues.push({
        code: "branch_source_step_terminal",
        message: `Route #${rule.id} starts from a terminal step and would never run.`,
        ruleId: rule.id,
        severity: "error",
        source: "branch_rule",
      });
      continue;
    }
    if (!allStepIds.has(rule.targetStepId)) {
      issues.push({
        code: "branch_target_step_missing",
        message: `Route #${rule.id} points to a missing step.`,
        ruleId: rule.id,
        severity: "error",
        source: "branch_rule",
      });
      continue;
    }
    if (!runnableStepIdSet.has(rule.targetStepId)) {
      issues.push({
        code: "branch_target_step_not_runnable",
        message: `Route #${rule.id} points to a disabled or deferred step.`,
        ruleId: rule.id,
        severity: "error",
        source: "branch_rule",
      });
      continue;
    }

    if (ACTION_OPTION_ROUTE_SETTINGS_KEY in rule.settings) {
      const optionRoute = getStoredActionOptionRoute(rule.settings);
      const sourceStep = stepById.get(rule.sourceStepId);

      if (!optionRoute) {
        issues.push({
          code: "option_route_settings_invalid",
          message: `Option route #${rule.id} has invalid option identity metadata.`,
          ruleId: rule.id,
          severity: "error",
          source: "option_route",
          stepId: rule.sourceStepId,
        });
        continue;
      }

      if (
        !sourceStep?.fieldKey ||
        rule.sourceFieldKey !== sourceStep.fieldKey ||
        rule.operator !== "equals"
      ) {
        issues.push({
          code: "option_route_source_field_mismatch",
          message: `Option route #${rule.id} must compare the source step field with equals.`,
          ruleId: rule.id,
          severity: "error",
          source: "option_route",
          stepId: rule.sourceStepId,
        });
        continue;
      }

      const sourceOptions = getCompilerStepOptions(sourceStep);
      const sourceOption = sourceOptions.find(
        (option) => option.id === optionRoute.sourceOptionId,
      );
      if (!sourceOption) {
        issues.push({
          code: "option_route_option_missing",
          message: `Option route #${rule.id} points to an option that no longer exists.`,
          ruleId: rule.id,
          severity: "error",
          source: "option_route",
          stepId: rule.sourceStepId,
        });
        continue;
      }

      if (rule.comparisonValue !== String(sourceOption.value)) {
        issues.push({
          code: "option_route_value_mismatch",
          message: `Option route #${rule.id} no longer matches its stored option value.`,
          ruleId: rule.id,
          severity: "error",
          source: "option_route",
          stepId: rule.sourceStepId,
        });
        continue;
      }

      const routeKey = `${rule.sourceStepId}:${optionRoute.sourceOptionId}`;
      const existingTarget = optionRouteTargets.get(routeKey);
      if (existingTarget !== undefined) {
        issues.push({
          code:
            existingTarget === rule.targetStepId
              ? "option_route_duplicate"
              : "option_route_conflict",
          message:
            existingTarget === rule.targetStepId
              ? `Option route #${rule.id} duplicates an existing route for the same option.`
              : `Option route #${rule.id} conflicts with another destination for the same option.`,
          ruleId: rule.id,
          severity: "error",
          source: "option_route",
          stepId: rule.sourceStepId,
        });
        continue;
      }
      optionRouteTargets.set(routeKey, rule.targetStepId);
    }

    const compiled = compileConditionGroup({ fieldTypes, rule });
    issues.push(...compiled.issues);
    if (compiled.group) {
      branchConditions[rule.id] = compiled.group;
      addEdge({
        condition: compiled.group,
        ruleId: rule.id,
        sourceStepId: rule.sourceStepId,
        targetStepId: rule.targetStepId,
        type: "branch",
      });
    }
  }

  for (const [stepIndex, step] of orderedSteps.entries()) {
    const policy = getActionResponsePolicy(step.settings);
    if (
      policy.noReplyReminderMinutes !== null &&
      policy.noReplyTimeoutMinutes !== null &&
      policy.noReplyReminderMinutes >= policy.noReplyTimeoutMinutes
    ) {
      issues.push({
        code: "response_policy_timing_invalid",
        message: `Step ${step.sortOrder} no-reply reminder must run before its timeout.`,
        severity: "error",
        source: "response_policy",
        stepId: step.id,
      });
    }
    for (const output of ACTION_RESPONSE_POLICY_OUTPUTS) {
      const targetStepId = getActionResponsePolicyTarget(policy, output);
      if (targetStepId === null) {
        continue;
      }

      if (!allStepIds.has(targetStepId)) {
        issues.push({
          code: "response_policy_target_missing",
          message: `Step ${step.sortOrder} ${output} output points to a missing step.`,
          severity: "error",
          source: "response_policy",
          stepId: step.id,
        });
      } else if (!runnableStepIdSet.has(targetStepId)) {
        issues.push({
          code: "response_policy_target_not_runnable",
          message: `Step ${step.sortOrder} ${output} output points to a disabled or deferred step.`,
          severity: "error",
          source: "response_policy",
          stepId: step.id,
        });
      } else {
        addEdge({
          outputPort: output,
          sourceStepId: step.id,
          targetStepId,
          type: "policy",
        });
      }
    }

    if (TERMINAL_STEP_TYPES.has(step.stepType)) {
      if (step.nextStepId !== null) {
        issues.push({
          code: "default_source_step_terminal",
          message: `Step ${step.sortOrder} is terminal and cannot have a default next step.`,
          severity: "error",
          source: "default_next_step",
          stepId: step.id,
        });
      }
      continue;
    }

    if (step.nextStepId !== null) {
      if (!allStepIds.has(step.nextStepId)) {
        issues.push({
          code: "default_target_step_missing",
          message: `Step ${step.sortOrder} points to a missing default next step.`,
          severity: "error",
          source: "default_next_step",
          stepId: step.id,
        });
      } else if (!runnableStepIdSet.has(step.nextStepId)) {
        issues.push({
          code: "default_target_step_not_runnable",
          message: `Step ${step.sortOrder} points to a disabled or deferred default step.`,
          severity: "error",
          source: "default_next_step",
          stepId: step.id,
        });
      } else {
        addEdge({
          sourceStepId: step.id,
          targetStepId: step.nextStepId,
          type: "default",
        });
        hasFallback.add(step.id);
      }
      continue;
    }

    const orderedNextStep = orderedSteps[stepIndex + 1];
    if (orderedNextStep) {
      addEdge({
        sourceStepId: step.id,
        targetStepId: orderedNextStep.id,
        type: "ordered",
      });
      hasFallback.add(step.id);
    }
  }

  const entryStepId = orderedSteps[0]?.id ?? null;
  if (entryStepId === null) {
    issues.push({
      code: "graph_entry_missing",
      message: "Enable at least one runnable step before publishing.",
      severity: "error",
      source: "graph_entry",
    });
  }

  const reachable = new Set<number>();
  const pending = entryStepId === null ? [] : [entryStepId];
  while (pending.length > 0) {
    const stepId = pending.pop();
    if (stepId === undefined || reachable.has(stepId)) {
      continue;
    }
    reachable.add(stepId);
    pending.push(...(outgoing.get(stepId) ?? []));
  }

  const unreachableStepIds = runnableStepIds.filter(
    (stepId) => !reachable.has(stepId),
  );
  for (const stepId of unreachableStepIds) {
    const step = stepById.get(stepId);
    issues.push({
      code: "graph_step_unreachable",
      message: `Step ${step?.sortOrder ?? stepId} cannot be reached from the start of the flow.`,
      severity: "warning",
      source: "graph_reachability",
      stepId,
    });
  }

  const terminalStepIds = runnableStepIds.filter((stepId) => {
    const step = stepById.get(stepId);
    return (
      (step ? TERMINAL_STEP_TYPES.has(step.stepType) : false) ||
      !hasFallback.has(stepId)
    );
  });
  const reverse = new Map<number, number[]>();
  for (const edge of edges) {
    reverse.set(edge.targetStepId, [
      ...(reverse.get(edge.targetStepId) ?? []),
      edge.sourceStepId,
    ]);
  }
  const canReachTerminal = new Set<number>();
  const terminalPending = [...terminalStepIds];
  while (terminalPending.length > 0) {
    const stepId = terminalPending.pop();
    if (stepId === undefined || canReachTerminal.has(stepId)) {
      continue;
    }
    canReachTerminal.add(stepId);
    terminalPending.push(...(reverse.get(stepId) ?? []));
  }

  const terminalBlocked = [...reachable].filter(
    (stepId) => !canReachTerminal.has(stepId),
  );
  if (terminalBlocked.length > 0) {
    const labels = terminalBlocked
      .map((stepId) => stepById.get(stepId)?.sortOrder ?? stepId)
      .sort((left, right) => left - right)
      .join(", ");
    issues.push({
      code: "graph_terminal_unreachable",
      message: `Steps ${labels} do not have a path to a terminal outcome.`,
      severity: "error",
      source: "graph_terminal",
    });
  }

  const components = findStronglyConnectedComponents([...reachable], outgoing);
  for (const component of components) {
    const hasSelfLoop =
      component.length === 1 &&
      (outgoing.get(component[0]) ?? []).includes(component[0]);
    if (component.length < 2 && !hasSelfLoop) {
      continue;
    }

    const labels = component
      .map((stepId) => stepById.get(stepId)?.sortOrder ?? stepId)
      .sort((left, right) => left - right)
      .join(", ");
    issues.push({
      code: "graph_cycle_detected",
      message: `Steps ${labels} form a routing cycle. Remove the loop before publishing.`,
      severity: "error",
      source: "graph_cycle",
      stepId: component[0],
    });
  }

  return {
    branchConditions,
    edges,
    entryStepId,
    fieldTypes,
    issues,
    reachableStepIds: [...reachable].sort((left, right) => left - right),
    runnableStepIds,
    terminalStepIds,
    unreachableStepIds,
  };
}
