import { z } from "zod";
import {
  type ActionFlowConditionValueType,
  type CompiledActionFlowCondition,
  type CompiledActionFlowConditionGroup,
  evaluateCompiledActionFlowConditionGroup,
} from "@/lib/action-flow-compiler";
import type { ActionFlowVersionSnapshot } from "@/lib/action-flows";
import {
  type ActiveActionFlow,
  compileRuntimeActionGraph,
  getActionStepConnectedActionId,
  getActionStepConnectFlowMode,
  getActionStepHandoffConfig,
  getFlowEditSectionOptions,
  isActionConfirmationStep,
  isActionConnectFlowStep,
  isActionSubmitStep,
  prepareFlowSectionEdit,
  type RuntimeAction,
} from "@/lib/action-runtime";
import {
  type CompiledHybridFlowGraphV1,
  getHybridNodeId,
} from "@/lib/hybrid-flow-contracts";
import { selectHybridFlowTransition } from "@/lib/hybrid-flow-runtime";

const combinationFlowTestCaseV1Schema = z.object({
  detail: z.string(),
  group: z.enum([
    "branch",
    "confirmation",
    "handoff",
    "connected_flow",
    "route",
    "submit",
  ]),
  key: z.string(),
  label: z.string(),
  status: z.enum(["failed", "passed"]),
});

export const combinationFlowTestReportV1Schema = z.object({
  branchesTested: z.number().int().nonnegative(),
  cases: z.array(combinationFlowTestCaseV1Schema),
  casesFailed: z.number().int().nonnegative(),
  casesPassed: z.number().int().nonnegative(),
  casesRun: z.number().int().nonnegative(),
  errors: z.array(z.string()),
  lifecycleStepsTested: z.number().int().nonnegative(),
  routesTested: z.number().int().nonnegative(),
  schemaVersion: z.literal(1),
  sideEffectsSuppressed: z.literal(true),
  status: z.enum(["failed", "passed"]),
  warnings: z.array(z.string()),
});

export type CombinationFlowTestReportV1 = z.infer<
  typeof combinationFlowTestReportV1Schema
>;

function getStepLabel(action: RuntimeAction, stepId: number) {
  const step = action.steps.find((candidate) => candidate.id === stepId);
  return step?.label?.trim() || step?.prompt?.trim() || `Step ${stepId}`;
}

function getNonEmptyFixture(valueType: ActionFlowConditionValueType) {
  if (valueType === "number") {
    return 1;
  }
  if (valueType === "boolean") {
    return true;
  }
  if (valueType === "date") {
    return "2030-06-15";
  }
  if (valueType === "time") {
    return "14:30";
  }
  return "automated-test-value";
}

function getOrderedFixture(
  condition: CompiledActionFlowCondition,
  direction: "greater" | "less",
) {
  const comparisonValue = condition.comparisonValue;
  if (typeof comparisonValue === "number") {
    return comparisonValue + (direction === "greater" ? 1 : -1);
  }
  if (condition.valueType === "date" && typeof comparisonValue === "string") {
    const date = new Date(`${comparisonValue}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) {
      date.setUTCDate(date.getUTCDate() + (direction === "greater" ? 1 : -1));
      return date.toISOString().slice(0, 10);
    }
  }
  if (condition.valueType === "time" && typeof comparisonValue === "string") {
    const [hours, minutes] = comparisonValue.split(":").map(Number);
    if (Number.isInteger(hours) && Number.isInteger(minutes)) {
      const total = hours * 60 + minutes + (direction === "greater" ? 1 : -1);
      const bounded = Math.max(0, Math.min(23 * 60 + 59, total));
      return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(
        bounded % 60,
      ).padStart(2, "0")}`;
    }
  }
  return direction === "greater" ? "z-automated-test" : "0-automated-test";
}

function getMatchingConditionValue(condition: CompiledActionFlowCondition) {
  if (condition.operator === "is_empty") {
    return undefined;
  }
  if (condition.operator === "is_not_empty") {
    return getNonEmptyFixture(condition.valueType);
  }
  if (condition.operator === "equals") {
    return condition.comparisonValue;
  }
  if (condition.operator === "not_equals") {
    if (typeof condition.comparisonValue === "boolean") {
      return !condition.comparisonValue;
    }
    if (typeof condition.comparisonValue === "number") {
      return condition.comparisonValue + 1;
    }
    return `${condition.comparisonValue ?? "value"}-different`;
  }
  if (condition.operator === "contains") {
    return `prefix ${condition.comparisonValue ?? "value"} suffix`;
  }
  return getOrderedFixture(
    condition,
    condition.operator === "greater_than" ? "greater" : "less",
  );
}

function buildMatchingFields(group: CompiledActionFlowConditionGroup) {
  const conditions =
    group.combinator === "or" ? group.conditions.slice(0, 1) : group.conditions;
  return Object.fromEntries(
    conditions.map((condition) => [
      condition.fieldKey,
      getMatchingConditionValue(condition),
    ]),
  );
}

function toRuntimeAction(input: {
  graph: CompiledHybridFlowGraphV1;
  snapshot: ActionFlowVersionSnapshot;
  versionId: number;
  versionNumber: number;
}): RuntimeAction {
  return {
    ...input.snapshot.action,
    branchRules: input.snapshot.branchRules,
    hybridGraph: input.graph,
    steps: input.snapshot.steps,
    versionId: input.versionId,
    versionNumber: input.versionNumber,
  };
}

export function runCombinationHybridFlowTest(input: {
  graph: CompiledHybridFlowGraphV1;
  snapshot: ActionFlowVersionSnapshot;
  versionId: number;
  versionNumber: number;
}): CombinationFlowTestReportV1 {
  const action = toRuntimeAction(input);
  const compiledActionGraph = compileRuntimeActionGraph(action);
  const cases: CombinationFlowTestReportV1["cases"] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  function addCase(
    group: CombinationFlowTestReportV1["cases"][number]["group"],
    key: string,
    label: string,
    passed: boolean,
    detail: string,
  ) {
    cases.push({
      detail,
      group,
      key,
      label,
      status: passed ? "passed" : "failed",
    });
    if (!passed) {
      errors.push(`${label}: ${detail}`);
    }
  }

  for (const transition of input.graph.transitions) {
    const selected = selectHybridFlowTransition({
      graph: input.graph,
      signals: [
        {
          kind: transition.kind,
          sourceRuleId: transition.sourceRuleId,
          triggerKey: transition.triggerKey,
        },
      ],
      sourceNodeId: transition.sourceNodeId,
    });
    const passed = selected?.id === transition.id;
    const routeLabel =
      transition.kind === "task_outcome"
        ? `Task outcome: ${transition.triggerKey}`
        : transition.kind === "tool_result"
          ? `Tool result: ${transition.triggerKey}`
          : transition.kind === "semantic"
            ? `Knowledge route: ${transition.triggerKey}`
            : transition.kind === "deterministic"
              ? `Branch route #${transition.sourceRuleId}`
              : `Default route: ${transition.triggerKey}`;
    addCase(
      "route",
      `route:${transition.id}`,
      routeLabel,
      passed,
      passed
        ? `Production transition selection resolved ${transition.sourceNodeId} to ${transition.targetNodeId ?? "end"}.`
        : `Production transition selection resolved ${selected?.id ?? "no route"} instead of ${transition.id}.`,
    );
  }

  const enabledBranchRules = action.branchRules
    .filter((rule) => rule.isEnabled)
    .sort(
      (left, right) => left.sortOrder - right.sortOrder || left.id - right.id,
    );
  for (const rule of enabledBranchRules) {
    const condition = compiledActionGraph.branchConditions[rule.id];
    const fields = condition ? buildMatchingFields(condition) : {};
    const conditionMatched = condition
      ? evaluateCompiledActionFlowConditionGroup(condition, fields)
      : false;
    const selected = selectHybridFlowTransition({
      graph: input.graph,
      signals: [
        {
          kind: "deterministic",
          sourceRuleId: rule.id,
          triggerKey: "branch",
        },
      ],
      sourceNodeId: getHybridNodeId(rule.sourceStepId),
    });
    const routeMatched =
      selected?.sourceRuleId === rule.id &&
      selected.targetNodeId === getHybridNodeId(rule.targetStepId);
    const passed = conditionMatched && routeMatched;
    addCase(
      "branch",
      `branch:${rule.id}`,
      `${getStepLabel(action, rule.sourceStepId)} branch #${rule.id}`,
      passed,
      !condition
        ? "The published branch condition could not be compiled."
        : !conditionMatched
          ? "A deterministic matching fixture did not satisfy the published condition group."
          : routeMatched
            ? `The condition matched and selected ${getStepLabel(action, rule.targetStepId)}.`
            : "The matching condition did not select the published branch target.",
    );
  }

  const lifecycleSteps = action.steps.filter(
    (step) =>
      step.isEnabled &&
      (isActionConfirmationStep(step) ||
        step.stepType === "handoff" ||
        isActionConnectFlowStep(step) ||
        isActionSubmitStep(step)),
  );
  for (const step of lifecycleSteps) {
    const hasOutgoingRoute = input.graph.transitions.some(
      (transition) => transition.sourceNodeId === getHybridNodeId(step.id),
    );
    const stepLabel = getStepLabel(action, step.id);

    if (isActionConfirmationStep(step)) {
      const editSections = getFlowEditSectionOptions(action);
      const fields = Object.fromEntries(
        action.steps.flatMap((candidate) =>
          candidate.fieldKey ? [[candidate.fieldKey, "automated-value"]] : [],
        ),
      );
      const flow: ActiveActionFlow = {
        actionId: action.id,
        actionName: action.name,
        fields,
        mode: "confirming",
        revision: 1,
        stepIndex: action.steps.findIndex(
          (candidate) => candidate.id === step.id,
        ),
      };
      const editsValid = editSections.every(
        ({ section }) =>
          prepareFlowSectionEdit(action, flow, section).mode === "collecting",
      );
      addCase(
        "confirmation",
        `confirmation:${step.id}`,
        stepLabel,
        !hasOutgoingRoute && editsValid,
        !hasOutgoingRoute && editsValid
          ? `Confirmation is terminal and ${editSections.length} available edit section(s) return safely to collection; no submission was created.`
          : "Confirmation terminal or edit behavior did not match the published runtime contract.",
      );
      continue;
    }

    if (step.stepType === "handoff") {
      const config = getActionStepHandoffConfig(step);
      addCase(
        "handoff",
        `handoff:${step.id}`,
        stepLabel,
        !hasOutgoingRoute,
        !hasOutgoingRoute
          ? `Handoff configuration resolved to ${config.priority} priority${config.queue ? ` in ${config.queue}` : ""}; no handoff was created or notified.`
          : "The terminal handoff step unexpectedly has an outgoing route.",
      );
      continue;
    }

    if (isActionConnectFlowStep(step)) {
      const connectedActionId = getActionStepConnectedActionId(step);
      const mode = getActionStepConnectFlowMode(step);
      const passed =
        !hasOutgoingRoute &&
        connectedActionId !== null &&
        connectedActionId > 0;
      addCase(
        "connected_flow",
        `connected-flow:${step.id}`,
        stepLabel,
        passed,
        passed
          ? `Connected action #${connectedActionId} uses ${mode} mode; the child flow was not executed.`
          : "The connected-flow target or terminal contract is invalid.",
      );
      continue;
    }

    addCase(
      "submit",
      `submit:${step.id}`,
      stepLabel,
      !hasOutgoingRoute,
      !hasOutgoingRoute
        ? "Submit is terminal; no submission or provider operation was executed."
        : "The terminal submit step unexpectedly has an outgoing route.",
    );
  }

  const casesFailed = cases.filter((item) => item.status === "failed").length;
  return combinationFlowTestReportV1Schema.parse({
    branchesTested: enabledBranchRules.length,
    cases,
    casesFailed,
    casesPassed: cases.length - casesFailed,
    casesRun: cases.length,
    errors,
    lifecycleStepsTested: lifecycleSteps.length,
    routesTested: input.graph.transitions.length,
    schemaVersion: 1,
    sideEffectsSuppressed: true,
    status: casesFailed === 0 ? "passed" : "failed",
    warnings,
  });
}
