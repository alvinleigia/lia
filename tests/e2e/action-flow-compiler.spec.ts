import { expect, test } from "@playwright/test";
import {
  type ActionFlowCompilerBranchRule,
  type ActionFlowCompilerStep,
  compileActionFlowGraph,
  evaluateCompiledActionFlowConditionGroup,
  type StoredActionFlowConditionGroup,
} from "../../src/lib/action-flow-compiler";
import {
  getNextActionStepDecision,
  type RuntimeAction,
} from "../../src/lib/action-runtime";

function createStep(
  id: number,
  sortOrder: number,
  input: Partial<ActionFlowCompilerStep> = {},
): ActionFlowCompilerStep {
  return {
    fieldKey: null,
    id,
    inputType: null,
    isEnabled: true,
    nextStepId: null,
    settings: {},
    sortOrder,
    stepType: "message",
    ...input,
  };
}

function createRule(
  id: number,
  sourceStepId: number,
  targetStepId: number,
  input: Partial<ActionFlowCompilerBranchRule> = {},
): ActionFlowCompilerBranchRule {
  return {
    comparisonValue: "yes",
    id,
    isEnabled: true,
    operator: "equals",
    settings: {},
    sortOrder: 1,
    sourceFieldKey: "answer",
    sourceStepId,
    targetStepId,
    ...input,
  };
}

test("compiler mirrors ordered runtime flow and terminal boundaries", () => {
  const graph = compileActionFlowGraph({
    branchRules: [],
    steps: [
      createStep(1, 1),
      createStep(2, 2, {
        fieldKey: "guestCount",
        inputType: "int",
        stepType: "number",
      }),
      createStep(3, 3, { stepType: "submit" }),
    ],
  });

  expect(graph.entryStepId).toBe(1);
  expect(graph.edges).toEqual([
    { sourceStepId: 1, targetStepId: 2, type: "ordered" },
    { sourceStepId: 2, targetStepId: 3, type: "ordered" },
  ]);
  expect(graph.terminalStepIds).toEqual([3]);
  expect(graph.issues).toEqual([]);
});

test("compiler keeps wait steps on a reachable terminal path", () => {
  const graph = compileActionFlowGraph({
    branchRules: [],
    steps: [
      createStep(1, 1),
      createStep(2, 2, {
        settings: { waitAmount: 5, waitUnit: "minutes" },
        stepType: "wait",
      }),
      createStep(3, 3, { stepType: "submit" }),
    ],
  });

  expect(graph.edges).toEqual([
    { sourceStepId: 1, targetStepId: 2, type: "ordered" },
    { sourceStepId: 2, targetStepId: 3, type: "ordered" },
  ]);
  expect(graph.terminalStepIds).toEqual([3]);
  expect(graph.issues).toEqual([]);
});

test("compiler types numeric conditions and evaluates them consistently", () => {
  const graph = compileActionFlowGraph({
    branchRules: [
      createRule(10, 1, 3, {
        comparisonValue: "10",
        operator: "greater_than",
        sourceFieldKey: "guestCount",
      }),
    ],
    steps: [
      createStep(1, 1, {
        fieldKey: "guestCount",
        inputType: "int",
        stepType: "number",
      }),
      createStep(2, 2, { stepType: "submit" }),
      createStep(3, 3, { stepType: "submit" }),
    ],
  });
  const condition = graph.branchConditions[10];

  expect(condition.conditions[0]).toMatchObject({
    comparisonValue: 10,
    fieldKey: "guestCount",
    valueType: "number",
  });
  expect(
    evaluateCompiledActionFlowConditionGroup(condition, { guestCount: 12 }),
  ).toBe(true);
  expect(
    evaluateCompiledActionFlowConditionGroup(condition, { guestCount: 8 }),
  ).toBe(false);
});

test("compiler supports versioned AND and OR condition groups", () => {
  const conditionGroup: StoredActionFlowConditionGroup = {
    combinator: "or",
    conditions: [
      {
        comparisonValue: "vip",
        fieldKey: "customerType",
        operator: "equals",
      },
      {
        comparisonValue: "500",
        fieldKey: "orderValue",
        operator: "greater_than",
      },
    ],
    schemaVersion: 1,
  };
  const graph = compileActionFlowGraph({
    branchRules: [
      createRule(20, 2, 3, {
        settings: { conditionGroup },
        sourceFieldKey: "customerType",
      }),
    ],
    steps: [
      createStep(1, 1, {
        fieldKey: "customerType",
        inputType: "text",
        stepType: "collect_input",
      }),
      createStep(2, 2, {
        fieldKey: "orderValue",
        inputType: "float",
        stepType: "number",
      }),
      createStep(3, 3, { stepType: "submit" }),
    ],
  });
  const condition = graph.branchConditions[20];

  expect(condition.combinator).toBe("or");
  expect(
    evaluateCompiledActionFlowConditionGroup(condition, {
      customerType: "standard",
      orderValue: 700,
    }),
  ).toBe(true);
  expect(
    evaluateCompiledActionFlowConditionGroup(condition, {
      customerType: "standard",
      orderValue: 300,
    }),
  ).toBe(false);
});

test("compiler warns about enabled steps skipped by explicit routing", () => {
  const graph = compileActionFlowGraph({
    branchRules: [],
    steps: [
      createStep(1, 1, { nextStepId: 3 }),
      createStep(2, 2),
      createStep(3, 3, { stepType: "submit" }),
    ],
  });

  expect(graph.unreachableStepIds).toEqual([2]);
  expect(graph.issues).toContainEqual(
    expect.objectContaining({
      code: "graph_step_unreachable",
      severity: "warning",
      stepId: 2,
    }),
  );
});

test("compiler blocks reachable routing cycles without a terminal path", () => {
  const graph = compileActionFlowGraph({
    branchRules: [],
    steps: [
      createStep(1, 1, { nextStepId: 2 }),
      createStep(2, 2, { nextStepId: 1 }),
    ],
  });

  expect(graph.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "graph_cycle_detected" }),
      expect.objectContaining({ code: "graph_terminal_unreachable" }),
    ]),
  );
});

test("compiler blocks invalid typed comparison values", () => {
  const graph = compileActionFlowGraph({
    branchRules: [
      createRule(30, 1, 2, {
        comparisonValue: "many",
        operator: "greater_than",
        sourceFieldKey: "guestCount",
      }),
    ],
    steps: [
      createStep(1, 1, {
        fieldKey: "guestCount",
        inputType: "int",
        stepType: "number",
      }),
      createStep(2, 2, { stepType: "submit" }),
    ],
  });

  expect(graph.issues).toContainEqual(
    expect.objectContaining({ code: "branch_comparison_invalid", ruleId: 30 }),
  );
});

test("compiler blocks non-runnable route targets", () => {
  const graph = compileActionFlowGraph({
    branchRules: [createRule(31, 1, 2)],
    steps: [
      createStep(1, 1, {
        fieldKey: "answer",
        nextStepId: 2,
        stepType: "collect_input",
      }),
      createStep(2, 2, { isEnabled: false, stepType: "submit" }),
    ],
  });

  expect(graph.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "branch_target_step_not_runnable" }),
      expect.objectContaining({ code: "default_target_step_not_runnable" }),
    ]),
  );
});

test("compiler blocks routes that start from terminal steps", () => {
  const graph = compileActionFlowGraph({
    branchRules: [createRule(32, 1, 2)],
    steps: [
      createStep(1, 1, {
        fieldKey: "answer",
        nextStepId: 2,
        stepType: "submit",
      }),
      createStep(2, 2),
    ],
  });

  expect(graph.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "branch_source_step_terminal" }),
      expect.objectContaining({ code: "default_source_step_terminal" }),
    ]),
  );
});

test("runtime evaluates compiled OR conditions before the ordered fallback", () => {
  const conditionGroup: StoredActionFlowConditionGroup = {
    combinator: "or",
    conditions: [
      {
        comparisonValue: "vip",
        fieldKey: "customerType",
        operator: "equals",
      },
      {
        comparisonValue: "500",
        fieldKey: "orderValue",
        operator: "greater_than",
      },
    ],
    schemaVersion: 1,
  };
  const action: RuntimeAction = {
    branchRules: [
      {
        comparisonValue: "vip",
        id: 40,
        isEnabled: true,
        operator: "equals",
        settings: { conditionGroup },
        sortOrder: 1,
        sourceFieldKey: "customerType",
        sourceStepId: 1,
        targetStepId: 3,
      },
    ],
    description: null,
    id: 1,
    name: "Grouped routing",
    steps: [
      {
        fieldKey: "customerType",
        id: 1,
        inputType: "text",
        isEnabled: true,
        isRequired: true,
        label: "Customer type",
        nextStepId: null,
        operationId: null,
        options: [],
        prompt: null,
        settings: {},
        sortOrder: 1,
        stepType: "collect_input",
      },
      {
        fieldKey: "orderValue",
        id: 2,
        inputType: "float",
        isEnabled: true,
        isRequired: true,
        label: "Order value",
        nextStepId: null,
        operationId: null,
        options: [],
        prompt: null,
        settings: {},
        sortOrder: 2,
        stepType: "number",
      },
      {
        fieldKey: null,
        id: 3,
        inputType: null,
        isEnabled: true,
        isRequired: false,
        label: "Priority route",
        nextStepId: null,
        operationId: null,
        options: [],
        prompt: null,
        settings: {},
        sortOrder: 3,
        stepType: "submit",
      },
    ],
    triggerPhrases: [],
    versionId: null,
    versionNumber: null,
  };

  expect(
    getNextActionStepDecision(action, action.steps[0], 0, {
      customerType: "standard",
      orderValue: 650,
    }),
  ).toMatchObject({
    branchRuleId: 40,
    routeType: "branch",
    targetStepId: 3,
  });
});

test("runtime preserves the legacy preferred time field alias", () => {
  const action: RuntimeAction = {
    branchRules: [
      {
        comparisonValue: "12:00",
        id: 41,
        isEnabled: true,
        operator: "greater_than",
        sortOrder: 1,
        sourceFieldKey: "time",
        sourceStepId: 1,
        targetStepId: 3,
      },
    ],
    description: null,
    id: 2,
    name: "Time alias routing",
    steps: [
      {
        fieldKey: "time",
        id: 1,
        inputType: "time",
        isEnabled: true,
        isRequired: true,
        label: "Time",
        nextStepId: null,
        operationId: null,
        options: [],
        prompt: null,
        settings: {},
        sortOrder: 1,
        stepType: "time",
      },
      {
        fieldKey: null,
        id: 2,
        inputType: null,
        isEnabled: true,
        isRequired: false,
        label: "Morning",
        nextStepId: null,
        operationId: null,
        options: [],
        prompt: null,
        settings: {},
        sortOrder: 2,
        stepType: "submit",
      },
      {
        fieldKey: null,
        id: 3,
        inputType: null,
        isEnabled: true,
        isRequired: false,
        label: "Afternoon",
        nextStepId: null,
        operationId: null,
        options: [],
        prompt: null,
        settings: {},
        sortOrder: 3,
        stepType: "submit",
      },
    ],
    triggerPhrases: [],
    versionId: null,
    versionNumber: null,
  };

  expect(
    getNextActionStepDecision(action, action.steps[0], 0, {
      preferredTime: "14:30",
    }),
  ).toMatchObject({
    branchRuleId: 41,
    routeType: "branch",
    targetStepId: 3,
  });
});
