import { expect, test } from "@playwright/test";
import {
  type ActionFlowCompilerBranchRule,
  type ActionFlowCompilerStep,
  compileActionFlowGraph,
  evaluateCompiledActionFlowConditionGroup,
  type StoredActionFlowConditionGroup,
} from "../../src/lib/action-flow-compiler";
import { buildStoredActionOptionRoute } from "../../src/lib/action-option-routing";
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

test("compiler keeps an option route valid when its label changes", () => {
  const graph = compileActionFlowGraph({
    branchRules: [
      createRule(33, 1, 3, {
        comparisonValue: "service_deep_tissue",
        settings: {
          optionRoute: buildStoredActionOptionRoute("service-option-2"),
        },
        sourceFieldKey: "service",
      }),
    ],
    steps: [
      createStep(1, 1, {
        fieldKey: "service",
        options: [
          {
            id: "service-option-2",
            label: "Massage des tissus profonds",
            value: "service_deep_tissue",
          },
        ],
        stepType: "choice",
      }),
      createStep(2, 2, { stepType: "submit" }),
      createStep(3, 3, { stepType: "submit" }),
    ],
  });

  expect(graph.issues).toEqual([]);
  expect(graph.edges).toContainEqual(
    expect.objectContaining({
      ruleId: 33,
      sourceStepId: 1,
      targetStepId: 3,
      type: "branch",
    }),
  );
});

test("compiler routes first-class boolean outputs as typed values", () => {
  const graph = compileActionFlowGraph({
    branchRules: [
      createRule(41, 1, 3, {
        comparisonValue: "true",
        settings: {
          optionRoute: buildStoredActionOptionRoute("boolean-true"),
        },
        sourceFieldKey: "acceptedTerms",
      }),
    ],
    steps: [
      createStep(1, 1, {
        fieldKey: "acceptedTerms",
        stepType: "boolean",
      }),
      createStep(2, 2, { stepType: "submit" }),
      createStep(3, 3, { stepType: "submit" }),
    ],
  });

  expect(graph.issues).toEqual([]);
  expect(graph.branchConditions[41]?.conditions[0]).toMatchObject({
    comparisonValue: true,
    fieldKey: "acceptedTerms",
  });
  expect(graph.edges).toContainEqual(
    expect.objectContaining({
      ruleId: 41,
      sourceStepId: 1,
      targetStepId: 3,
      type: "branch",
    }),
  );
});

test("compiler includes valid response-policy outputs and blocks stale targets", () => {
  const graph = compileActionFlowGraph({
    branchRules: [],
    steps: [
      createStep(1, 1, {
        fieldKey: "email",
        settings: {
          responsePolicy: {
            cancellationStepId: 2,
            noReplyTimeoutStepId: 99,
            retryExhaustedStepId: 2,
            schemaVersion: 1,
          },
        },
        stepType: "email",
      }),
      createStep(2, 2, { stepType: "submit" }),
    ],
  });

  expect(graph.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        outputPort: "cancelled",
        sourceStepId: 1,
        targetStepId: 2,
        type: "policy",
      }),
      expect.objectContaining({
        outputPort: "retry_exhausted",
        sourceStepId: 1,
        targetStepId: 2,
        type: "policy",
      }),
    ]),
  );
  expect(graph.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "response_policy_target_missing",
        stepId: 1,
      }),
    ]),
  );
});

test("compiler blocks missing and stale option route identities", () => {
  const graph = compileActionFlowGraph({
    branchRules: [
      createRule(34, 1, 2, {
        comparisonValue: "service_facial",
        settings: {
          optionRoute: buildStoredActionOptionRoute("missing-option"),
        },
        sourceFieldKey: "service",
      }),
      createRule(35, 1, 2, {
        comparisonValue: "old_value",
        settings: {
          optionRoute: buildStoredActionOptionRoute("service-option-1"),
        },
        sortOrder: 2,
        sourceFieldKey: "service",
      }),
    ],
    steps: [
      createStep(1, 1, {
        fieldKey: "service",
        options: [
          {
            id: "service-option-1",
            label: "Classic Facial",
            value: "service_facial",
          },
        ],
        stepType: "choice",
      }),
      createStep(2, 2, { stepType: "submit" }),
    ],
  });

  expect(graph.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "option_route_option_missing",
        ruleId: 34,
      }),
      expect.objectContaining({
        code: "option_route_value_mismatch",
        ruleId: 35,
      }),
    ]),
  );
});

test("compiler blocks duplicate and conflicting option destinations", () => {
  const settings = {
    optionRoute: buildStoredActionOptionRoute("service-option-1"),
  };
  const graph = compileActionFlowGraph({
    branchRules: [
      createRule(36, 1, 2, {
        comparisonValue: "service_facial",
        settings,
        sourceFieldKey: "service",
      }),
      createRule(37, 1, 2, {
        comparisonValue: "service_facial",
        settings,
        sortOrder: 2,
        sourceFieldKey: "service",
      }),
      createRule(38, 1, 3, {
        comparisonValue: "service_facial",
        settings,
        sortOrder: 3,
        sourceFieldKey: "service",
      }),
    ],
    steps: [
      createStep(1, 1, {
        fieldKey: "service",
        options: [
          {
            id: "service-option-1",
            label: "Classic Facial",
            value: "service_facial",
          },
        ],
        stepType: "choice",
      }),
      createStep(2, 2, { stepType: "submit" }),
      createStep(3, 3, { stepType: "submit" }),
    ],
  });

  expect(graph.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "option_route_duplicate",
        ruleId: 37,
      }),
      expect.objectContaining({
        code: "option_route_conflict",
        ruleId: 38,
      }),
    ]),
  );
});

test("compiler validates dynamic catalogue and product option identities", () => {
  const dynamicGraph = compileActionFlowGraph({
    branchRules: [
      createRule(39, 1, 2, {
        comparisonValue: "spa_deep_tissue_massage",
        settings: {
          optionRoute: buildStoredActionOptionRoute("spa_deep_tissue_massage"),
        },
        sourceFieldKey: "service",
      }),
    ],
    steps: [
      createStep(1, 1, {
        fieldKey: "service",
        settings: {
          sourceConfig: { catalogId: "cat_spa_services" },
          sourceType: "catalog_items",
        },
        stepType: "choice",
      }),
      createStep(2, 2, { stepType: "submit" }),
    ],
  });
  const productGraph = compileActionFlowGraph({
    branchRules: [
      createRule(40, 1, 2, {
        comparisonValue: "42",
        settings: {
          optionRoute: buildStoredActionOptionRoute("product-42"),
        },
        sourceFieldKey: "product",
      }),
    ],
    steps: [
      createStep(1, 1, {
        fieldKey: "product",
        settings: { products: [{ id: 42, name: "Classic Facial" }] },
        stepType: "product_selection",
      }),
      createStep(2, 2, { stepType: "submit" }),
    ],
  });

  expect(dynamicGraph.issues).toEqual([]);
  expect(productGraph.issues).toEqual([]);
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
