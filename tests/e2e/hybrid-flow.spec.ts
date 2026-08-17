import { expect, test } from "@playwright/test";
import {
  type ActionFlowCompilerBranchRule,
  type ActionFlowCompilerStep,
  needsExplicitPublishTerminalStep,
} from "../../src/lib/action-flow-compiler";
import { getProjectActionStatusAfterPublish } from "../../src/lib/action-flow-constants";
import type { ActionFlowVersionSnapshot } from "../../src/lib/action-flows";
import {
  findActionForTaskRecommendation,
  getActionStartControlText,
  isExactActionTrigger,
  type RuntimeAction,
  type RuntimeActionStep,
} from "../../src/lib/action-runtime";
import { buildChannelFlowResumeReplies } from "../../src/lib/channel-flow-runtime";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import {
  conversationalTaskSnapshotV1Schema,
  DEFAULT_CONVERSATIONAL_TASK_DEFINITION,
  type ToolDefinitionV1,
} from "../../src/lib/conversation-contracts";
import type { SelectActionSubmission } from "../../src/lib/db-schema";
import { runAutomatedHybridFlowTest } from "../../src/lib/hybrid-flow-automated-test";
import { runBehavioralHybridFlowTest } from "../../src/lib/hybrid-flow-behavioral-test";
import { runCombinationHybridFlowTest } from "../../src/lib/hybrid-flow-combination-test";
import { compileHybridFlowGraph } from "../../src/lib/hybrid-flow-compiler";
import {
  compiledHybridFlowGraphV1Schema,
  getHybridNodeId,
  hybridGraphTaskReturnTargetV1Schema,
  parseHybridGraphTaskReturnTarget,
  taskSuspensionReturnTargetV1Schema,
} from "../../src/lib/hybrid-flow-contracts";
import { runOperationHybridFlowTest } from "../../src/lib/hybrid-flow-operation-test";
import { runResourceBackedHybridFlowTest } from "../../src/lib/hybrid-flow-resource-test";
import {
  bindRequestedTaskSelection,
  bindRequestedTaskTextAnswer,
  buildHybridGraphTaskReturnTarget,
  buildKnowledgeBoundarySignals,
  createMismatchedTaskSelectionProposal,
  createRequestedTaskSelectionProposal,
  dispatchHybridFlowBoundary,
  getRequiredCompletionOperationDefinition,
  getResumedTaskRuntimeInputRequest,
  getTaskRuntimeInputRequest,
  matchesHybridGraphTaskReturnTarget,
  normalizeActiveTaskQuestion,
  prepareHybridTaskEntry,
  reconcileTaskSideQuestionWithRuntime,
  reconcileTaskTurnWithAvailability,
  reconcileTaskTurnWithRuntime,
  resolveHybridBoundaryNode,
  resolveHybridDeterministicContinuation,
  resolveHybridRuntimeResponseOwner,
  resolveHybridTaskOutcomeResume,
  resolveHybridTaskOutcomeRoute,
  selectHybridFlowEntryNode,
  selectHybridFlowTransition,
  shouldCheckTaskAvailability,
} from "../../src/lib/hybrid-flow-runtime";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

const outcomes = DEFAULT_CONVERSATIONAL_TASK_DEFINITION.outcomes;

test("exact action triggers are control input, not task content", () => {
  const action = {
    triggerPhrases: ["phase thirteen booking parity"],
  } as RuntimeAction;

  expect(isExactActionTrigger(action, "  Phase Thirteen Booking Parity ")).toBe(
    true,
  );
  expect(
    isExactActionTrigger(
      action,
      "phase thirteen booking parity for a facial tomorrow",
    ),
  ).toBe(false);
  expect(
    getActionStartControlText({
      name: "Phase Thirteen Booking Parity",
      triggerPhrases: ["", "phase thirteen booking parity"],
    } as RuntimeAction),
  ).toBe("phase thirteen booking parity");
});

test("task recommendations resolve only to an action containing that published task", () => {
  const actions = [
    {
      hybridGraph: {
        nodes: [
          {
            kind: "conversational_task",
            settings: { task: { taskId: 40 } },
          },
        ],
      },
    },
    {
      hybridGraph: {
        nodes: [
          {
            kind: "conversational_task",
            settings: { task: { taskId: 41 } },
          },
        ],
      },
    },
  ] as RuntimeAction[];

  expect(findActionForTaskRecommendation(actions, 41)).toBe(actions[1]);
  expect(findActionForTaskRecommendation(actions, 99)).toBeNull();
});

test("publishing activates drafts without reactivating archived actions", () => {
  expect(getProjectActionStatusAfterPublish("draft")).toBe("active");
  expect(getProjectActionStatusAfterPublish("active")).toBe("active");
  expect(getProjectActionStatusAfterPublish("archived")).toBe("archived");
});

test("active hybrid execution owns the next channel boundary", () => {
  const graph = compileHybridFlowGraph({
    branchRules,
    steps,
  }).graph;

  expect(
    resolveHybridBoundaryNode({
      actionVersionId: 500,
      graph,
      requestedNodeId: "step:1",
    })?.id,
  ).toBe("step:1");
  expect(
    resolveHybridBoundaryNode({
      actionVersionId: 500,
      activeActionVersionId: 500,
      activeNodeId: "step:2",
      graph,
      requestedNodeId: "step:1",
    })?.id,
  ).toBe("step:2");
  expect(
    resolveHybridBoundaryNode({
      actionVersionId: 500,
      activeActionVersionId: 499,
      activeNodeId: "step:2",
      graph,
      requestedNodeId: "step:1",
    }),
  ).toBeNull();
});

test("closed hybrid execution does not own a restarted task boundary", () => {
  expect(
    resolveHybridRuntimeResponseOwner({
      executionStatus: "active",
      fallback: "task",
      responseOwner: "knowledge",
    }),
  ).toBe("knowledge");
  expect(
    resolveHybridRuntimeResponseOwner({
      executionStatus: "closed",
      fallback: "task",
      responseOwner: "knowledge",
    }),
  ).toBe("task");
});

test("hybrid graphs use compiled terminal validation for publish readiness", () => {
  expect(
    needsExplicitPublishTerminalStep([
      "knowledge_conversation",
      "conversational_task",
      "message",
    ]),
  ).toBe(false);
  expect(needsExplicitPublishTerminalStep(["message"])).toBe(true);
  expect(needsExplicitPublishTerminalStep(["message", "confirmation"])).toBe(
    false,
  );
});

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

const branchRules: ActionFlowCompilerBranchRule[] = [];
const steps = [
  createStep(1, 1, {
    settings: {
      knowledgeConversation: {
        answeredRoute: 3,
        handoffRoute: "end",
        noAnswerRoute: 3,
        recommendationTargetStepIds: [2],
        remainActiveAfterAnswer: false,
        schemaVersion: 1,
        stageMode: "goal_driven",
      },
      knowledgeGoal: "Answer service questions and recommend booking.",
      nodeLabel: "Service questions",
    },
    stepType: "knowledge_conversation",
  }),
  createStep(2, 2, {
    settings: {
      conversationalTask: {
        outcomeRoutes: {
          cancelled: "end",
          completed: 3,
        },
        schemaVersion: 1,
        task: {
          name: "Book a service",
          outcomes,
          schemaVersion: 1,
          taskId: 40,
          taskVersionId: 80,
          versionNumber: 2,
        },
        transferContextKeys: ["lia_timezone"],
        transferFieldKeys: ["serviceId"],
      },
      nodeLabel: "Book a service",
    },
    stepType: "conversational_task",
  }),
  createStep(3, 3, {
    settings: { nodeLabel: "Save request" },
    stepType: "submit",
  }),
];

const taskSnapshot = conversationalTaskSnapshotV1Schema.parse({
  schemaVersion: 1,
  assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
  assistantPolicy: REFERENCE_BOOKING_PROJECT_POLICY.assistant,
  conversationPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
  task: {
    id: 40,
    schemaVersion: 1,
    name: "Book a service",
    objective: "Submit a service request.",
    description: null,
    definition: {
      ...REFERENCE_BOOKING_TASK_DEFINITION,
      fieldTransferWhitelist: [
        {
          allowSensitive: false,
          allowedSources: ["visitor"],
          fieldKey: "serviceId",
          maximumAgeMinutes: null,
          minimumValidationState: "candidate",
          requireProvenance: true,
        },
        {
          allowSensitive: true,
          allowedSources: ["visitor"],
          fieldKey: "guestEmail",
          maximumAgeMinutes: null,
          minimumValidationState: "candidate",
          requireProvenance: true,
        },
      ],
    },
  },
});

const availabilityDefinition = {
  access: "read",
  description: "Read service availability for a requested date and time.",
  execution: {
    adapter: "built_in",
    cancellation: "unsupported",
    handler: "catalog.service_availability",
    mode: "synchronous",
    retryAttempts: 0,
    retryDelayMs: 0,
    timeoutMs: 5_000,
  },
  id: "catalog.service_availability",
  inputSchema: {
    fields: ["serviceId", "preferredDate", "preferredTime"].map((key) => ({
      key,
      required: key === "serviceId",
      source: { kind: "field" as const, key },
      type:
        key === "preferredDate"
          ? ("date" as const)
          : key === "preferredTime"
            ? ("time" as const)
            : ("project_resource" as const),
    })),
  },
  name: "Service Availability",
  outputSchema: {
    fields: [{ path: "available", required: true, type: "boolean" as const }],
  },
  projectId: 1,
  requiredForCompletion: false,
  resultMappings: [
    {
      freshnessMinutes: 5,
      modelVisible: true,
      sourcePath: "available",
      target: "context",
      targetKey: "serviceAvailable",
      toolVisible: true,
      type: "boolean" as const,
    },
  ],
  schemaVersion: 1,
  version: 1,
} satisfies ToolDefinitionV1;

const requiredOperationDefinition = {
  access: "write",
  description: "Queue the booking for manual review.",
  execution: {
    adapter: "operation",
    cancellation: "unsupported",
    handler: "operation.manual_review",
    mode: "asynchronous",
    retryAttempts: 0,
    retryDelayMs: 0,
    timeoutMs: 15_000,
  },
  id: "manual_review",
  inputSchema: { fields: [] },
  name: "Manual Review",
  outputSchema: { fields: [] },
  projectId: 1,
  requiredForCompletion: true,
  resultMappings: [],
  schemaVersion: 1,
  version: 1,
} satisfies ToolDefinitionV1;

const taskSnapshotWithRequiredOperation =
  conversationalTaskSnapshotV1Schema.parse({
    ...taskSnapshot,
    toolDefinitions: [requiredOperationDefinition],
    task: {
      ...taskSnapshot.task,
      definition: {
        ...taskSnapshot.task.definition,
        tools: [
          {
            access: "write",
            allowedStages: ["operation"],
            tool: { id: requiredOperationDefinition.id, version: 1 },
          },
        ],
      },
    },
  });

test("compiler publishes a reachable knowledge-task-deterministic graph", () => {
  const result = compileHybridFlowGraph({
    actionSettings: {
      hybridEntryPolicy: {
        campaignRoutes: { summer: 2 },
        channelRoutes: { whatsapp: 1 },
        deepLinkRoutes: { book: 2 },
        normalStepId: 1,
        schemaVersion: 1,
      },
    },
    branchRules,
    steps,
  });

  expect(result.baseIssues).toEqual([]);
  expect(result.issues).toEqual([]);
  expect(result.graph.entryPolicy).toEqual({
    campaignRoutes: { summer: "step:2" },
    channelRoutes: { whatsapp: "step:1" },
    deepLinkRoutes: { book: "step:2" },
    normalNodeId: "step:1",
  });
  expect(result.graph.nodes.map(({ kind }) => kind)).toEqual([
    "knowledge",
    "conversational_task",
    "deterministic",
  ]);
  expect(result.graph.transitions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "semantic",
        sourceNodeId: "step:1",
        targetNodeId: "step:2",
        triggerKey: "task:40",
      }),
      expect.objectContaining({
        kind: "task_outcome",
        sourceNodeId: "step:2",
        targetNodeId: "step:3",
        triggerKey: "completed",
      }),
    ]),
  );
});

test("automated flow test covers every published node and route", () => {
  const graph = compileHybridFlowGraph({ branchRules, steps }).graph;

  expect(runAutomatedHybridFlowTest(graph)).toMatchObject({
    entriesTested: 1,
    errors: [],
    nodesTested: graph.nodes.length,
    routesTested: graph.transitions.length,
    status: "passed",
  });
});

test("combination flow test covers published task outcomes without side effects", () => {
  const graph = compileHybridFlowGraph({ branchRules, steps }).graph;
  const snapshot: ActionFlowVersionSnapshot = {
    action: {
      description: "Combination test action",
      id: 1,
      name: "Combination test action",
      settings: {},
      status: "active",
      triggerPhrases: ["test combinations"],
    },
    branchRules: [],
    hybridGraph: graph,
    publishedAt: "2030-06-15T00:00:00.000Z",
    schemaVersion: 1,
    steps: steps.map((step) => ({
      ...step,
      isRequired: false,
      label: `Step ${step.id}`,
      operationId: null,
      options: [],
      prompt: null,
    })),
  };

  const report = runCombinationHybridFlowTest({
    graph,
    snapshot,
    versionId: 1,
    versionNumber: 1,
  });

  expect(report).toMatchObject({
    branchesTested: 0,
    casesFailed: 0,
    routesTested: graph.transitions.length,
    sideEffectsSuppressed: true,
    status: "passed",
  });
  expect(report.cases).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        group: "route",
        label: "Task outcome: cancelled",
        status: "passed",
      }),
      expect.objectContaining({
        group: "route",
        label: "Task outcome: completed",
        status: "passed",
      }),
      expect.objectContaining({ group: "submit", status: "passed" }),
    ]),
  );
});

test("combination flow test exercises branch, confirmation, and handoff contracts", () => {
  const lifecycleSteps: ActionFlowVersionSnapshot["steps"] = [
    {
      fieldKey: "priority",
      id: 101,
      inputType: "text",
      isEnabled: true,
      isRequired: true,
      label: "Priority",
      nextStepId: 103,
      operationId: null,
      options: [],
      prompt: "What is the priority?",
      settings: {},
      sortOrder: 1,
      stepType: "collect_input",
    },
    {
      fieldKey: null,
      id: 102,
      inputType: null,
      isEnabled: true,
      isRequired: false,
      label: "Human handoff",
      nextStepId: null,
      operationId: null,
      options: [],
      prompt: "A person will help.",
      settings: { handoff: { priority: "high", queue: "support" } },
      sortOrder: 2,
      stepType: "handoff",
    },
    {
      fieldKey: null,
      id: 103,
      inputType: null,
      isEnabled: true,
      isRequired: false,
      label: "Review request",
      nextStepId: null,
      operationId: null,
      options: [],
      prompt: "Review and confirm.",
      settings: {},
      sortOrder: 3,
      stepType: "confirmation",
    },
  ];
  const lifecycleBranchRules: ActionFlowVersionSnapshot["branchRules"] = [
    {
      comparisonValue: "urgent",
      id: 201,
      isEnabled: true,
      operator: "equals",
      settings: {},
      sortOrder: 1,
      sourceFieldKey: "priority",
      sourceStepId: 101,
      targetStepId: 102,
    },
  ];
  const graph = compileHybridFlowGraph({
    branchRules: lifecycleBranchRules,
    steps: lifecycleSteps,
  }).graph;
  const snapshot: ActionFlowVersionSnapshot = {
    action: {
      description: "Lifecycle combination test",
      id: 2,
      name: "Lifecycle combination test",
      settings: {},
      status: "active",
      triggerPhrases: ["test lifecycle"],
    },
    branchRules: lifecycleBranchRules,
    hybridGraph: graph,
    publishedAt: "2030-06-15T00:00:00.000Z",
    schemaVersion: 1,
    steps: lifecycleSteps,
  };

  const report = runCombinationHybridFlowTest({
    graph,
    snapshot,
    versionId: 2,
    versionNumber: 1,
  });

  expect(report).toMatchObject({
    branchesTested: 1,
    casesFailed: 0,
    lifecycleStepsTested: 2,
    sideEffectsSuppressed: true,
    status: "passed",
  });
  expect(report.cases).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ group: "branch", status: "passed" }),
      expect.objectContaining({ group: "confirmation", status: "passed" }),
      expect.objectContaining({ group: "handoff", status: "passed" }),
    ]),
  );
});

test("automated flow test records invalid references and unreachable nodes", () => {
  const graph = compiledHybridFlowGraphV1Schema.parse({
    entryNodeId: "step:1",
    entryPolicy: {
      campaignRoutes: {},
      channelRoutes: {},
      deepLinkRoutes: {},
      normalNodeId: "step:1",
    },
    maxTraversalDepth: 20,
    nodes: [
      {
        id: "step:1",
        kind: "deterministic",
        label: "Opening",
        responseOwner: "deterministic",
        sourceStepId: 1,
        stepType: "message",
      },
      {
        id: "step:2",
        kind: "deterministic",
        label: "Save",
        responseOwner: "deterministic",
        sourceStepId: 2,
        stepType: "submit",
      },
    ],
    schemaVersion: 1,
    transitions: [
      {
        id: "broken-route",
        kind: "default",
        priority: 0,
        sourceNodeId: "step:1",
        sourceRuleId: null,
        targetNodeId: "step:404",
        triggerKey: null,
      },
    ],
  });
  const report = runAutomatedHybridFlowTest(graph);

  expect(report.status).toBe("failed");
  expect(report.errors).toEqual(
    expect.arrayContaining([
      expect.stringContaining("missing node step:404"),
      expect.stringContaining("Save (step:2) is not reachable"),
      expect.stringContaining("Opening (step:1) cannot reach a terminal path"),
    ]),
  );
});

test("automated flow test records reachable route cycles", () => {
  const graph = compiledHybridFlowGraphV1Schema.parse({
    entryNodeId: "step:1",
    entryPolicy: {
      campaignRoutes: {},
      channelRoutes: {},
      deepLinkRoutes: {},
      normalNodeId: "step:1",
    },
    maxTraversalDepth: 20,
    nodes: [1, 2].map((id) => ({
      id: `step:${id}`,
      kind: "deterministic" as const,
      label: `Step ${id}`,
      responseOwner: "deterministic" as const,
      sourceStepId: id,
      stepType: "message",
    })),
    schemaVersion: 1,
    transitions: [
      {
        id: "step:1:default",
        kind: "default",
        priority: 0,
        sourceNodeId: "step:1",
        sourceRuleId: null,
        targetNodeId: "step:2",
        triggerKey: null,
      },
      {
        id: "step:2:default",
        kind: "default",
        priority: 0,
        sourceNodeId: "step:2",
        sourceRuleId: null,
        targetNodeId: "step:1",
        triggerKey: null,
      },
    ],
  });
  const report = runAutomatedHybridFlowTest(graph);

  expect(report.status).toBe("failed");
  expect(report.errors).toContain("A reachable route cycle was detected.");
});

function createRuntimeInputStep(
  id: number,
  stepType: string,
  input: Partial<RuntimeActionStep> = {},
): RuntimeActionStep {
  return {
    fieldKey: `field${id}`,
    id,
    inputType: null,
    isEnabled: true,
    isRequired: true,
    label: `Input ${id}`,
    nextStepId: null,
    operationId: null,
    options: [],
    prompt: null,
    settings: {},
    sortOrder: id,
    stepType,
    ...input,
  };
}

test("behavioral flow test exercises production validators for core inputs", () => {
  const report = runBehavioralHybridFlowTest([
    createRuntimeInputStep(1, "collect_input", {
      fieldKey: "customerName",
      inputType: "text",
      label: "Full name",
    }),
    createRuntimeInputStep(2, "email", { label: "Email address" }),
    createRuntimeInputStep(3, "phone", { label: "Phone number" }),
    createRuntimeInputStep(4, "collect_input", {
      inputType: "int",
      label: "Number of guests",
      settings: { validationMaxNumber: 8, validationMinNumber: 1 },
    }),
    createRuntimeInputStep(5, "date", { label: "Visit date" }),
    createRuntimeInputStep(6, "time", { label: "Visit time" }),
    createRuntimeInputStep(7, "boolean", { label: "Email updates" }),
    createRuntimeInputStep(8, "date_range", { label: "Travel dates" }),
    createRuntimeInputStep(9, "address", { label: "Contact address" }),
    createRuntimeInputStep(10, "location", { label: "Location" }),
  ]);

  expect(report).toMatchObject({
    casesFailed: 0,
    errors: [],
    skippedSteps: [],
    status: "passed",
    stepsConsidered: 10,
    stepsTested: 10,
  });
  expect(report.cases).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        actualValid: false,
        caseType: "invalid",
        stepLabel: "Email address",
      }),
      expect.objectContaining({
        actualValid: false,
        input: "12345",
        stepLabel: "Full name",
      }),
      expect.objectContaining({
        actualValid: true,
        caseType: "option",
        stepLabel: "Email updates",
      }),
    ]),
  );
});

test("behavioral flow test delegates resource-backed inputs", () => {
  const report = runBehavioralHybridFlowTest([
    createRuntimeInputStep(1, "file_upload", { label: "Attachment" }),
    createRuntimeInputStep(2, "product_selection", { label: "Product" }),
  ]);

  expect(report).toMatchObject({
    casesRun: 0,
    skippedSteps: [
      expect.objectContaining({ stepLabel: "Attachment" }),
      expect.objectContaining({ stepLabel: "Product" }),
    ],
    status: "passed",
    stepsConsidered: 2,
    stepsTested: 0,
  });
});

const resourceProduct = {
  currency: "USD",
  description: "Automated product fixture",
  id: 101,
  imageUrl: "https://example.com/product.png",
  name: "Test Product",
  priceAmount: 2500,
  productUrl: "https://example.com/product",
  sku: "TEST-101",
  whatsappRetailerId: "retailer-101",
};

test("resource-backed flow test exercises published file, product, media, template, and catalog contracts", () => {
  const report = runResourceBackedHybridFlowTest([
    createRuntimeInputStep(1, "file_upload", {
      fieldKey: "attachment",
      label: "Attachment",
      settings: { validationAllowedFileTypes: "image/*,.pdf" },
    }),
    createRuntimeInputStep(2, "product_selection", {
      fieldKey: "productId",
      label: "Product",
      settings: {
        productCatalog: {
          externalId: "catalog-1",
          id: 1,
          name: "Test Catalog",
          providerType: "meta",
        },
        products: [resourceProduct],
        productSelectionAllowMultiple: true,
        productSelectionAllowQuantity: true,
      },
    }),
    createRuntimeInputStep(3, "media", {
      fieldKey: null,
      isRequired: false,
      label: "Media",
      settings: {
        mediaAsset: {
          id: 1,
          mediaType: "image",
          mimeType: "image/png",
          originalName: "test.png",
          publicPath: "https://example.com/test.png",
        },
      },
    }),
    createRuntimeInputStep(4, "template_message", {
      fieldKey: null,
      isRequired: false,
      label: "Template",
      settings: {
        whatsappTemplateBody: "Hello",
        whatsappTemplateLanguage: "en",
        whatsappTemplateName: "test_template",
        whatsappTemplateStatus: "approved",
        whatsappTemplateVariables: [],
      },
    }),
    createRuntimeInputStep(5, "single_product", {
      fieldKey: null,
      isRequired: false,
      label: "Single product",
      settings: {
        productCatalog: {
          externalId: "catalog-1",
          id: 1,
          name: "Test Catalog",
          providerType: "meta",
        },
        products: [resourceProduct],
      },
    }),
  ]);

  expect(report).toMatchObject({
    checksFailed: 0,
    errors: [],
    status: "passed",
    stepsConsidered: 5,
    stepsTested: 5,
  });
  expect(report.checks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "1:file-match", status: "passed" }),
      expect.objectContaining({
        key: "2:product-answer",
        status: "passed",
      }),
      expect.objectContaining({ key: "3:media-asset", status: "passed" }),
      expect.objectContaining({ key: "4:template", status: "passed" }),
      expect.objectContaining({
        key: "5:catalog-products",
        status: "passed",
      }),
    ]),
  );
});

test("resource-backed flow test records invalid published resource contracts", () => {
  const report = runResourceBackedHybridFlowTest([
    createRuntimeInputStep(1, "file_upload", {
      label: "Attachment",
      settings: { validationAllowedFileTypes: "not-a-file-type" },
    }),
    createRuntimeInputStep(2, "product_selection", {
      label: "Product",
      settings: { products: [] },
    }),
  ]);

  expect(report.status).toBe("failed");
  expect(report.checksFailed).toBeGreaterThanOrEqual(2);
  expect(report.errors).toEqual(
    expect.arrayContaining([
      expect.stringContaining("Invalid allowed file types"),
      expect.stringContaining("No published product options resolved"),
    ]),
  );
});

test("compiler accepts a terminal business-task channel wrapper", () => {
  const taskStep = createStep(1, 1, {
    settings: {
      conversationalTask: {
        outcomeRoutes: Object.fromEntries(
          outcomes.map((outcome) => [outcome.outputPort, "end"]),
        ),
        schemaVersion: 1,
        task: {
          name: "Book a service",
          outcomes,
          schemaVersion: 1,
          taskId: 40,
          taskVersionId: 80,
          versionNumber: 2,
        },
        transferContextKeys: [],
        transferFieldKeys: [],
      },
      nodeLabel: "Run channel booking",
    },
    stepType: "conversational_task",
  });

  const result = compileHybridFlowGraph({
    actionSettings: {},
    branchRules: [],
    steps: [taskStep],
  });

  expect(result.baseIssues).toEqual([]);
  expect(result.issues).toEqual([]);
  expect(result.graph.nodes).toEqual([
    expect.objectContaining({
      id: "step:1",
      kind: "conversational_task",
    }),
  ]);
  expect(result.graph.transitions).toEqual(
    outcomes.map((outcome) =>
      expect.objectContaining({
        kind: "task_outcome",
        sourceNodeId: "step:1",
        targetNodeId: null,
        triggerKey: outcome.outputPort,
      }),
    ),
  );
});

test("automated operation fixtures classify and route published provider outcomes", () => {
  const operationSteps: ActionFlowVersionSnapshot["steps"] = [
    {
      fieldKey: "ticketStatus",
      id: 101,
      inputType: null,
      isEnabled: true,
      isRequired: false,
      label: "Create external ticket",
      nextStepId: 102,
      operationId: 40,
      options: [],
      prompt: null,
      settings: { operationExecutionMode: "inline" },
      sortOrder: 1,
      stepType: "operation",
    },
    ...[102, 103, 104, 105].map((id, index) => ({
      fieldKey: null,
      id,
      inputType: null,
      isEnabled: true,
      isRequired: false,
      label: `Finish ${index + 1}`,
      nextStepId: null,
      operationId: null,
      options: [],
      prompt: null,
      settings: {},
      sortOrder: index + 2,
      stepType: "submit",
    })),
  ];
  const outcomes = [
    [201, "success", 102],
    [202, "server_error", 103],
    [203, "timeout", 104],
    [204, "status_409", 105],
  ] as const;
  const operationRules: ActionFlowVersionSnapshot["branchRules"] = outcomes.map(
    ([id, outcome, targetStepId], index) => ({
      comparisonValue: outcome,
      id,
      isEnabled: true,
      operator: "equals",
      settings: { operationOutcomeRoute: outcome },
      sortOrder: index + 1,
      sourceFieldKey: "ticketStatus_outcome",
      sourceStepId: 101,
      targetStepId,
    }),
  );
  const snapshot: ActionFlowVersionSnapshot = {
    action: {
      description: null,
      id: 50,
      name: "Provider fixture UAT",
      settings: {},
      status: "active",
      triggerPhrases: ["provider fixture"],
    },
    branchRules: operationRules,
    publishedAt: "2030-01-01T00:00:00.000Z",
    schemaVersion: 1,
    steps: operationSteps,
  };
  const graph = compileHybridFlowGraph({
    actionSettings: snapshot.action.settings,
    branchRules: operationRules,
    steps: operationSteps,
  }).graph;

  const report = runOperationHybridFlowTest({
    graph,
    snapshot,
    versionId: 70,
    versionNumber: 3,
  });

  expect(report.status).toBe("passed");
  expect(report.sideEffectsSuppressed).toBe(true);
  expect(report.stepsConsidered).toBe(1);
  expect(report.stepsTested).toBe(1);
  expect(report.casesRun).toBe(5);
  expect(report.casesFailed).toBe(0);
  expect(report.cases.map((testCase) => testCase.outcome)).toEqual([
    "success",
    "server_error",
    "success",
    "timeout",
    "status_409",
  ]);
  expect(report.cases.map((testCase) => testCase.fixture)).toEqual([
    "success",
    "failure",
    "retry",
    "timeout",
    "provider_response",
  ]);
});

test("resuming a hybrid boundary does not expose its internal prompt", () => {
  const graph = compileHybridFlowGraph({
    actionSettings: {},
    branchRules,
    steps,
  }).graph;
  const action = {
    branchRules: [],
    description: null,
    hybridGraph: graph,
    id: 1,
    name: "Hybrid booking",
    steps: [
      {
        fieldKey: null,
        id: 1,
        inputType: null,
        isEnabled: true,
        isRequired: false,
        label: "Service questions",
        nextStepId: null,
        operationId: null,
        options: [],
        prompt: "Answer verified project questions.",
        settings: steps[0].settings,
        sortOrder: 1,
        stepType: "knowledge_conversation",
      },
    ],
    triggerPhrases: [],
    versionId: 1,
    versionNumber: 1,
  } satisfies RuntimeAction;
  const submission = {
    currentStepId: 1,
    fields: {},
  } as SelectActionSubmission;

  expect(buildChannelFlowResumeReplies({ action, submission })).toEqual([]);
});

test("knowledge boundaries emit one dominant transition signal", () => {
  const baseProposal = {
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: "Test decision.",
    fieldCandidates: [],
    grounding: { excerptIds: ["chunk:1"], status: "grounded" as const },
    nextAction: "ask" as const,
    outcomeRecommendation: null,
    reply: "Answer.",
    routeRecommendation: null,
    safety: { decision: "allow" as const, reasonCode: null },
    schemaVersion: 1 as const,
    taskRecommendation: null,
    toolRequest: null,
    turnKind: "ordinary_question" as const,
  };

  expect(buildKnowledgeBoundarySignals(baseProposal)).toEqual([
    { kind: "semantic", triggerKey: "answered" },
  ]);
  expect(
    buildKnowledgeBoundarySignals({
      ...baseProposal,
      grounding: { excerptIds: [], status: "no_answer" },
    }),
  ).toEqual([{ kind: "semantic", triggerKey: "no_answer" }]);
  expect(
    buildKnowledgeBoundarySignals({
      ...baseProposal,
      taskRecommendation: {
        confidence: 0.9,
        reason: "The visitor wants to book.",
        taskId: 40,
      },
    }),
  ).toEqual([{ kind: "semantic", triggerKey: "task:40" }]);
  expect(
    buildKnowledgeBoundarySignals({
      ...baseProposal,
      safety: { decision: "handoff", reasonCode: "human_help" },
    }),
  ).toEqual([{ kind: "tool_result", triggerKey: "handoff" }]);
});

test("task turns cannot claim progress past invalid canonical fields", () => {
  const proposal = {
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: "The visitor supplied a date.",
    fieldCandidates: [
      {
        confidence: 0.99,
        fieldKey: "preferredDate",
        naturalValue: "tomorrow",
        source: "visitor" as const,
      },
    ],
    grounding: { excerptIds: [], status: "not_needed" as const },
    nextAction: "confirm" as const,
    outcomeRecommendation: null,
    reply: "I will use tomorrow. Please confirm the booking.",
    routeRecommendation: null,
    safety: { decision: "allow" as const, reasonCode: null },
    schemaVersion: 1 as const,
    taskRecommendation: null,
    toolRequest: {
      arguments: [],
      stage: "lookup" as const,
      toolId: "catalog.service_availability",
    },
    turnKind: "field_answer" as const,
  };

  const result = reconcileTaskTurnWithRuntime({
    fields: taskSnapshot.task.definition.fields.map((field) => ({
      fieldKey: field.key,
      isRequired: true,
      state: field.key === "preferredDate" ? "invalid" : "valid",
      validation:
        field.key === "preferredDate"
          ? {
              code: "invalid_date",
              message: "Enter a date such as 2026-08-15.",
            }
          : {},
    })),
    proposal,
    snapshot: taskSnapshot,
  });

  expect(result).toMatchObject({
    fieldCandidates: [],
    nextAction: "ask",
    outcomeRecommendation: null,
    reply: "Enter a date such as 2026-08-15.",
    routeRecommendation: null,
    toolRequest: null,
    turnKind: "field_correction",
  });
});

test("the server requires confirmation after the last field correction", () => {
  const proposal = {
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: "The visitor corrected the email address.",
    fieldCandidates: [],
    grounding: { excerptIds: [], status: "not_needed" as const },
    nextAction: "ask" as const,
    outcomeRecommendation: null,
    reply: "Your email has been corrected.",
    routeRecommendation: null,
    safety: { decision: "allow" as const, reasonCode: null },
    schemaVersion: 1 as const,
    taskRecommendation: null,
    toolRequest: null,
    turnKind: "field_correction" as const,
  };

  expect(
    getRequiredCompletionOperationDefinition(taskSnapshotWithRequiredOperation)
      ?.id,
  ).toBe("manual_review");
  expect(
    reconcileTaskTurnWithRuntime({
      fields: taskSnapshotWithRequiredOperation.task.definition.fields.map(
        (field) => ({
          fieldKey: field.key,
          isRequired: field.required,
          state: "valid",
          validation: {},
        }),
      ),
      proposal,
      snapshot: taskSnapshotWithRequiredOperation,
    }),
  ).toMatchObject({
    fieldCandidates: [],
    nextAction: "confirm",
    outcomeRecommendation: null,
    routeRecommendation: null,
    toolRequest: null,
    turnKind: "field_correction",
  });
});

test("explicit task selections override model-rewritten resource IDs", () => {
  const proposal = {
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: "The visitor selected a service.",
    fieldCandidates: [
      {
        confidence: 0.99,
        fieldKey: "serviceId",
        naturalValue: "catalog:71",
        source: "visitor" as const,
      },
    ],
    grounding: { excerptIds: [], status: "not_needed" as const },
    nextAction: "ask" as const,
    outcomeRecommendation: null,
    reply: "Please provide Service.",
    routeRecommendation: null,
    safety: { decision: "allow" as const, reasonCode: null },
    schemaVersion: 1 as const,
    taskRecommendation: null,
    toolRequest: null,
    turnKind: "field_answer" as const,
  };

  expect(
    bindRequestedTaskSelection({
      proposal,
      requestedFieldKey: "serviceId",
      selectionValue: "product:71",
    }).fieldCandidates,
  ).toEqual([
    {
      confidence: 1,
      fieldKey: "serviceId",
      naturalValue: "product:71",
      source: "visitor",
    },
  ]);
});

test("direct answers fill the requested text field when extraction returns no candidate", () => {
  const proposal = {
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: "The visitor answered the requested field.",
    fieldCandidates: [],
    grounding: { excerptIds: [], status: "not_needed" as const },
    nextAction: "ask" as const,
    outcomeRecommendation: null,
    reply: "Please provide Guest Name.",
    routeRecommendation: null,
    safety: { decision: "allow" as const, reasonCode: null },
    schemaVersion: 1 as const,
    taskRecommendation: null,
    toolRequest: null,
    turnKind: "field_answer" as const,
  };

  expect(
    bindRequestedTaskTextAnswer({
      proposal,
      requestedFieldKey: "guestName",
      text: "  Phase 14 Release Guest  ",
    }).fieldCandidates,
  ).toEqual([
    {
      confidence: 1,
      fieldKey: "guestName",
      naturalValue: "Phase 14 Release Guest",
      source: "visitor",
    },
  ]);
  expect(
    bindRequestedTaskTextAnswer({
      proposal: { ...proposal, turnKind: "side_question" },
      requestedFieldKey: "guestName",
      text: "Why do you need my name?",
    }),
  ).toEqual({ ...proposal, turnKind: "side_question" });
});

test("requested project-resource selections can skip the model", () => {
  expect(
    createRequestedTaskSelectionProposal({
      requestedFieldKey: "serviceId",
      selectionValue: "product:71",
    }),
  ).toMatchObject({
    fieldCandidates: [
      {
        confidence: 1,
        fieldKey: "serviceId",
        naturalValue: "product:71",
        source: "visitor",
      },
    ],
    nextAction: "ask",
    safety: { decision: "allow", reasonCode: null },
    turnKind: "field_answer",
  });
  expect(
    createRequestedTaskSelectionProposal({
      requestedFieldKey: null,
      selectionValue: "product:71",
    }),
  ).toBeNull();
});

test("stale task selections re-prompt without proposing a field mutation", () => {
  expect(
    createMismatchedTaskSelectionProposal({
      requestedFieldPrompt: "Please provide Preferred Date.",
    }),
  ).toMatchObject({
    fieldCandidates: [],
    nextAction: "ask",
    reply: "That option is no longer active. Please provide Preferred Date.",
    safety: { decision: "allow", reasonCode: null },
    turnKind: "field_correction",
  });
});

test("task turns ask for the next unresolved field before confirmation", () => {
  const proposal = {
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: "The visitor confirmed.",
    fieldCandidates: [],
    grounding: { excerptIds: [], status: "not_needed" as const },
    nextAction: "confirm" as const,
    outcomeRecommendation: null,
    reply: "Ready to place the booking.",
    routeRecommendation: null,
    safety: { decision: "allow" as const, reasonCode: null },
    schemaVersion: 1 as const,
    taskRecommendation: null,
    toolRequest: null,
    turnKind: "field_answer" as const,
  };

  const result = reconcileTaskTurnWithRuntime({
    fields: taskSnapshot.task.definition.fields.map((field) => ({
      fieldKey: field.key,
      isRequired: true,
      state: field.key === "serviceCategoryId" ? "invalid" : "valid",
      validation:
        field.key === "serviceCategoryId"
          ? {
              code: "project_resource_not_found",
              message: "Choose an available item from this project.",
            }
          : {},
    })),
    proposal,
    snapshot: taskSnapshot,
  });

  expect(result.reply).toBe("Which service category would you like?");
  expect(result.nextAction).toBe("ask");
});

test("task entry asks for the first unresolved field", () => {
  const proposal = {
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: "Matched one explicit published task request.",
    fieldCandidates: [],
    grounding: { excerptIds: [], status: "not_needed" as const },
    nextAction: "ask" as const,
    outcomeRecommendation: null,
    reply: "I'll help you with that now.",
    routeRecommendation: null,
    safety: { decision: "allow" as const, reasonCode: null },
    schemaVersion: 1 as const,
    taskRecommendation: {
      confidence: 1,
      reason: "The visitor explicitly requested this published task.",
      taskId: taskSnapshot.task.id,
    },
    toolRequest: null,
    turnKind: "task_recommendation" as const,
  };

  const result = reconcileTaskTurnWithRuntime({
    fields: taskSnapshot.task.definition.fields.map((field) => ({
      fieldKey: field.key,
      isRequired: field.required,
      state: "missing",
      validation: {},
    })),
    proposal,
    snapshot: taskSnapshot,
  });

  expect(result).toMatchObject({
    nextAction: "ask",
    reply: "Which service category would you like?",
    taskRecommendation: null,
    turnKind: "field_answer",
  });
});

test("task runtime exposes a typed request for its unresolved date field", () => {
  const proposal = {
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: "The visitor supplied a service.",
    fieldCandidates: [],
    grounding: { excerptIds: [], status: "not_needed" as const },
    nextAction: "ask" as const,
    outcomeRecommendation: null,
    reply: "What date would you prefer?",
    routeRecommendation: null,
    safety: { decision: "allow" as const, reasonCode: null },
    schemaVersion: 1 as const,
    taskRecommendation: null,
    toolRequest: null,
    turnKind: "field_answer" as const,
  };

  expect(
    getTaskRuntimeInputRequest({
      fields: taskSnapshot.task.definition.fields.map((field) => ({
        fieldKey: field.key,
        isRequired: field.required,
        state: field.key === "preferredDate" ? "missing" : "valid",
        validation: {},
      })),
      proposal,
      snapshot: taskSnapshot,
    }),
  ).toEqual({
    fieldKey: "preferredDate",
    inputKind: "date",
    label: "Preferred Date",
    options: [],
    required: true,
  });
});

test("side questions resume the exact requested task field without mutations", () => {
  const proposal = {
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: "Answered a question about business hours.",
    fieldCandidates: [
      {
        confidence: 0.99,
        fieldKey: "guestName",
        naturalValue: "Do not save this",
        source: "visitor" as const,
      },
    ],
    grounding: {
      excerptIds: ["document:12"],
      status: "grounded" as const,
    },
    nextAction: "complete" as const,
    outcomeRecommendation: {
      confidence: 0.8,
      outcomeKey: "completed",
    },
    reply: "The spa is open from 9 am to 6 pm.",
    routeRecommendation: {
      confidence: 0.8,
      outputPort: "completed",
    },
    safety: { decision: "allow" as const, reasonCode: null },
    schemaVersion: 1 as const,
    taskRecommendation: {
      confidence: 0.8,
      reason: "Unsafe side-turn recommendation.",
      taskId: taskSnapshot.task.id,
    },
    toolRequest: {
      arguments: [],
      stage: "operation" as const,
      toolId: "manual_review",
    },
    turnKind: "side_question" as const,
  };
  const fields = taskSnapshot.task.definition.fields.map((field) => ({
    fieldKey: field.key,
    isRequired: field.required,
    state: field.key === "preferredTime" ? "missing" : "valid",
    validation: {},
  }));

  expect(
    normalizeActiveTaskQuestion({
      ...proposal,
      fieldCandidates: [],
      turnKind: "ordinary_question",
    }).turnKind,
  ).toBe("side_question");
  expect(
    normalizeActiveTaskQuestion({
      ...proposal,
      fieldCandidates: [],
      safety: { decision: "refuse", reasonCode: "policy_refusal" },
      turnKind: "ordinary_question",
    }).turnKind,
  ).toBe("ordinary_question");

  const result = reconcileTaskSideQuestionWithRuntime({
    fields,
    proposal,
    requestedFieldKey: "preferredTime",
    snapshot: taskSnapshot,
  });

  expect(result).toMatchObject({
    fieldCandidates: [],
    grounding: {
      excerptIds: ["document:12"],
      status: "grounded",
    },
    nextAction: "ask",
    outcomeRecommendation: null,
    routeRecommendation: null,
    taskRecommendation: null,
    toolRequest: null,
    turnKind: "side_question",
  });
  expect(result.reply).toBe(
    "The spa is open from 9 am to 6 pm.\n\nWhat time would you prefer?",
  );
  expect(
    getResumedTaskRuntimeInputRequest({
      fields,
      requestedFieldKey: "preferredTime",
      snapshot: taskSnapshot,
    }),
  ).toEqual({
    fieldKey: "preferredTime",
    inputKind: "time",
    label: "Preferred Time",
    options: [],
    required: true,
  });
});

test("task reconciliation preserves cancellation with unresolved fields", () => {
  const proposal = {
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: "The visitor cancelled the task.",
    fieldCandidates: [],
    grounding: { excerptIds: [], status: "not_needed" as const },
    nextAction: "cancel" as const,
    outcomeRecommendation: null,
    reply: "The booking request has been cancelled.",
    routeRecommendation: null,
    safety: { decision: "allow" as const, reasonCode: null },
    schemaVersion: 1 as const,
    taskRecommendation: null,
    toolRequest: null,
    turnKind: "cancellation" as const,
  };

  const result = reconcileTaskTurnWithRuntime({
    fields: taskSnapshot.task.definition.fields.map((field) => ({
      fieldKey: field.key,
      isRequired: true,
      state: "missing",
      validation: {},
    })),
    proposal,
    snapshot: taskSnapshot,
  });

  expect(result).toEqual(proposal);
});

test("task availability gates confirmation and completion", () => {
  const proposal = {
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: "The visitor supplied all booking details.",
    fieldCandidates: [],
    grounding: { excerptIds: [], status: "not_needed" as const },
    nextAction: "confirm" as const,
    outcomeRecommendation: null,
    reply: "Confirm the appointment?",
    routeRecommendation: null,
    safety: { decision: "allow" as const, reasonCode: null },
    schemaVersion: 1 as const,
    taskRecommendation: null,
    toolRequest: null,
    turnKind: "field_answer" as const,
  };

  expect(
    reconcileTaskTurnWithAvailability({
      availability: true,
      proposal,
    }),
  ).toEqual(proposal);
  expect(
    reconcileTaskTurnWithAvailability({
      availability: false,
      proposal,
    }),
  ).toMatchObject({
    nextAction: "ask",
    reply:
      "That service is not available for the requested date and time. Please choose another date or time.",
    toolRequest: null,
  });
  expect(
    reconcileTaskTurnWithAvailability({
      availability: null,
      proposal: { ...proposal, nextAction: "complete" },
    }),
  ).toMatchObject({
    nextAction: "ask",
    reply:
      "I could not verify availability for that date and time, so I cannot place the appointment. Please choose another date or time or ask the team for help.",
    toolRequest: null,
  });
});

test("task availability is checked when the last required field is collected", () => {
  const proposal = {
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: "The visitor supplied the last booking detail.",
    fieldCandidates: [
      {
        confidence: 0.99,
        fieldKey: "preferredTime",
        naturalValue: "15:00",
        source: "visitor" as const,
      },
    ],
    grounding: { excerptIds: [], status: "not_needed" as const },
    nextAction: "ask" as const,
    outcomeRecommendation: null,
    reply: "Confirm the appointment?",
    routeRecommendation: null,
    safety: { decision: "allow" as const, reasonCode: null },
    schemaVersion: 1 as const,
    taskRecommendation: null,
    toolRequest: null,
    turnKind: "field_answer" as const,
  };
  const fields = taskSnapshot.task.definition.fields.map((field) => ({
    fieldKey: field.key,
    isRequired: true,
    state: "valid",
    validation: {},
  }));
  expect(
    shouldCheckTaskAvailability({
      definition: availabilityDefinition,
      fields,
      proposal,
    }),
  ).toBe(true);
  expect(
    reconcileTaskTurnWithAvailability({
      availability: false,
      proposal,
    }),
  ).toMatchObject({
    nextAction: "ask",
    reply:
      "That service is not available for the requested date and time. Please choose another date or time.",
  });
  expect(
    shouldCheckTaskAvailability({
      definition: availabilityDefinition,
      fields: fields.map((field) =>
        field.fieldKey === "preferredTime"
          ? { ...field, state: "missing" }
          : field,
      ),
      proposal,
    }),
  ).toBe(false);
});

test("task availability is checked before collecting contact details", () => {
  const fields = [
    "serviceId",
    "preferredDate",
    "preferredTime",
    "guestName",
    "guestEmail",
  ].map((fieldKey) => ({
    fieldKey,
    isRequired: true,
    state:
      fieldKey === "guestName" || fieldKey === "guestEmail"
        ? "missing"
        : "valid",
    validation: {},
  }));
  const proposal = {
    ambiguity: { question: null, requiresClarification: false },
    decisionSummary: "The visitor supplied a requested date and time.",
    fieldCandidates: [
      {
        confidence: 0.99,
        fieldKey: "preferredTime",
        naturalValue: "15:00",
        source: "visitor" as const,
      },
    ],
    grounding: { excerptIds: [], status: "not_needed" as const },
    nextAction: "ask" as const,
    outcomeRecommendation: null,
    reply: "What is your name?",
    routeRecommendation: null,
    safety: { decision: "allow" as const, reasonCode: null },
    schemaVersion: 1 as const,
    taskRecommendation: null,
    toolRequest: null,
    turnKind: "field_answer" as const,
  };

  const reconciledProposal = reconcileTaskTurnWithRuntime({
    fields,
    proposal,
    snapshot: taskSnapshot,
  });
  expect(reconciledProposal.fieldCandidates).toEqual([]);
  expect(
    shouldCheckTaskAvailability({
      definition: availabilityDefinition,
      fields,
      proposal: reconciledProposal,
    }),
  ).toBe(false);
  expect(
    shouldCheckTaskAvailability({
      definition: availabilityDefinition,
      fields,
      proposal,
    }),
  ).toBe(true);
});

test("compiler blocks a task output without an explicit route", () => {
  const taskStep = steps[1];
  const settings = structuredClone(taskStep.settings);
  if (
    typeof settings.conversationalTask !== "object" ||
    !settings.conversationalTask
  ) {
    throw new Error("Expected task settings.");
  }
  settings.conversationalTask = {
    ...settings.conversationalTask,
    outcomeRoutes: { completed: 3 },
  };

  const result = compileHybridFlowGraph({
    branchRules,
    steps: [steps[0], { ...taskStep, settings }, steps[2]],
  });

  expect(result.issues).toContainEqual(
    expect.objectContaining({
      code: "hybrid_route_invalid",
      message: expect.stringContaining('task output "cancelled"'),
      stepId: 2,
    }),
  );
});

test("entry and transition selection follow explicit precedence", () => {
  const graph = compileHybridFlowGraph({
    actionSettings: {
      hybridEntryPolicy: {
        campaignRoutes: { launch: 2 },
        channelRoutes: { whatsapp: 1 },
        deepLinkRoutes: { booking: 3 },
        normalStepId: 1,
        schemaVersion: 1,
      },
    },
    branchRules,
    steps,
  }).graph;

  expect(
    selectHybridFlowEntryNode({
      campaignKey: "launch",
      channelType: "whatsapp",
      deepLinkKey: "booking",
      graph,
    }),
  ).toBe("step:3");

  const transitionGraph = compiledHybridFlowGraphV1Schema.parse({
    ...graph,
    transitions: [
      {
        id: "semantic",
        kind: "semantic",
        priority: 100,
        sourceNodeId: "step:1",
        sourceRuleId: null,
        targetNodeId: "step:2",
        triggerKey: "book",
      },
      {
        id: "explicit",
        kind: "deterministic",
        priority: 1,
        sourceNodeId: "step:1",
        sourceRuleId: 10,
        targetNodeId: "step:3",
        triggerKey: "button",
      },
    ],
  });
  expect(
    selectHybridFlowTransition({
      graph: transitionGraph,
      signals: [
        { kind: "semantic", triggerKey: "book" },
        {
          kind: "deterministic",
          sourceRuleId: 10,
          triggerKey: "button",
        },
      ],
      sourceNodeId: "step:1",
    })?.id,
  ).toBe("explicit");
});

test("boundary dispatcher invokes one owner and stops at the selected target", async () => {
  const graph = compileHybridFlowGraph({
    branchRules,
    steps,
  }).graph;
  let executions = 0;
  const result = await dispatchHybridFlowBoundary({
    execute: async (node) => {
      executions += 1;
      expect(node.id).toBe("step:1");
      return {
        output: { reply: "Let me help you book that." },
        signals: [{ kind: "semantic", triggerKey: "task:40" }],
      };
    },
    graph,
    responseOwner: "knowledge",
    sourceNodeId: "step:1",
  });

  expect(executions).toBe(1);
  expect(result).toEqual(
    expect.objectContaining({
      responseOwner: "task",
      status: "transitioned",
      targetNode: expect.objectContaining({
        id: "step:2",
        kind: "conversational_task",
      }),
      transition: expect.objectContaining({
        kind: "semantic",
        triggerKey: "task:40",
      }),
    }),
  );
});

test("terminal hybrid outcomes preserve cancellation instead of resuming", async () => {
  const graph = compileHybridFlowGraph({ branchRules, steps }).graph;
  const ended = await dispatchHybridFlowBoundary({
    execute: async () => ({
      output: { nextAction: "cancel", reply: "The task was cancelled." },
      signals: [{ kind: "task_outcome", triggerKey: "cancelled" }],
    }),
    graph,
    responseOwner: "task",
    sourceNodeId: "step:2",
  });
  const resumed = await dispatchHybridFlowBoundary({
    execute: async () => ({
      output: { reply: "The task completed." },
      signals: [{ kind: "task_outcome", triggerKey: "completed" }],
    }),
    graph,
    responseOwner: "task",
    sourceNodeId: "step:2",
  });

  expect(ended.status).toBe("ended");
  expect(resolveHybridDeterministicContinuation(ended)).toEqual({
    kind: "cancel",
  });
  expect(resolveHybridDeterministicContinuation(resumed)).toEqual({
    kind: "resume",
    targetStepId: 3,
  });
});

test("boundary dispatcher suppresses automation while a human owns the turn", async () => {
  const graph = compileHybridFlowGraph({
    branchRules,
    steps,
  }).graph;
  let executions = 0;
  const result = await dispatchHybridFlowBoundary({
    execute: async () => {
      executions += 1;
      return { output: null, signals: [] };
    },
    graph,
    responseOwner: "human",
    sourceNodeId: "step:1",
  });

  expect(executions).toBe(0);
  expect(result).toEqual(
    expect.objectContaining({
      execution: null,
      responseOwner: "human",
      status: "suppressed",
      transition: null,
    }),
  );
});

test("boundary dispatcher keeps ownership when no route is selected", async () => {
  const graph = compileHybridFlowGraph({
    branchRules,
    steps,
  }).graph;
  const result = await dispatchHybridFlowBoundary({
    execute: async () => ({
      output: { reply: "Here are the current service details." },
      signals: [],
    }),
    graph,
    responseOwner: "knowledge",
    sourceNodeId: "step:1",
  });

  expect(result).toEqual(
    expect.objectContaining({
      responseOwner: "knowledge",
      status: "stayed",
      targetNode: expect.objectContaining({ id: "step:1" }),
      transition: null,
    }),
  );
});

test("knowledge-to-task entry pins the task and transfers only intersected allowlists", async () => {
  const graph = compileHybridFlowGraph({
    branchRules,
    steps,
  }).graph;
  const dispatch = await dispatchHybridFlowBoundary({
    execute: async () => ({
      output: {
        fieldCandidates: [
          {
            confidence: 0.95,
            fieldKey: "serviceId",
            naturalValue: "product:71",
            source: "visitor" as const,
          },
          {
            confidence: 0.9,
            fieldKey: "guestEmail",
            naturalValue: "guest@example.com",
            source: "visitor" as const,
          },
          {
            confidence: 0.85,
            fieldKey: "serviceId",
            naturalValue: "product:72",
            source: "visitor" as const,
          },
        ],
        taskRecommendation: {
          confidence: 0.95,
          reason: "The visitor wants to book a service.",
          taskId: 40,
        },
      },
      signals: [{ kind: "semantic" as const, triggerKey: "task:40" }],
    }),
    graph,
    responseOwner: "knowledge",
    sourceNodeId: "step:1",
  });

  const entry = prepareHybridTaskEntry({
    actionVersionId: 500,
    contextValues: {
      lia_locale: "en-IN",
      lia_timezone: "Asia/Kolkata",
      untrusted: "do-not-transfer",
    },
    dispatch,
    graph,
    taskSnapshot,
    taskSnapshotVersionId: 80,
  });

  expect(entry).toEqual(
    expect.objectContaining({
      activeNodeId: "step:2",
      initializationContext: {
        lia_timezone: "Asia/Kolkata",
      },
      taskId: 40,
      taskVersionId: 80,
    }),
  );
  expect(entry?.fieldCandidates).toEqual([
    expect.objectContaining({
      fieldKey: "serviceId",
      naturalValue: "product:71",
      provenance: {
        source: "visitor",
        sourceReference: null,
      },
      state: "candidate",
    }),
  ]);
  expect(entry?.returnTarget).toEqual(
    expect.objectContaining({
      actionVersionId: 500,
      taskNodeId: "step:2",
    }),
  );
});

test("knowledge-to-task entry rejects a stale version or mismatched recommendation", async () => {
  const graph = compileHybridFlowGraph({
    branchRules,
    steps,
  }).graph;
  const createDispatch = (taskId: number) =>
    dispatchHybridFlowBoundary({
      execute: async () => ({
        output: {
          fieldCandidates: [],
          taskRecommendation: {
            confidence: 0.95,
            reason: "The visitor wants to book a service.",
            taskId,
          },
        },
        signals: [{ kind: "semantic" as const, triggerKey: "task:40" }],
      }),
      graph,
      responseOwner: "knowledge" as const,
      sourceNodeId: "step:1",
    });
  const dispatch = await createDispatch(40);

  expect(
    prepareHybridTaskEntry({
      actionVersionId: 500,
      contextValues: {},
      dispatch,
      graph,
      taskSnapshot,
      taskSnapshotVersionId: 81,
    }),
  ).toBeNull();
  expect(
    prepareHybridTaskEntry({
      actionVersionId: 500,
      contextValues: {},
      dispatch: await createDispatch(41),
      graph,
      taskSnapshot,
      taskSnapshotVersionId: 80,
    }),
  ).toBeNull();
});

test("boundary dispatcher rejects deterministic or stale boundary identifiers", async () => {
  const graph = compileHybridFlowGraph({
    branchRules,
    steps,
  }).graph;
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return { output: null, signals: [] };
  };

  await expect(
    dispatchHybridFlowBoundary({
      execute,
      graph,
      responseOwner: "deterministic",
      sourceNodeId: "step:3",
    }),
  ).resolves.toEqual(
    expect.objectContaining({
      responseOwner: null,
      status: "invalid",
    }),
  );
  await expect(
    dispatchHybridFlowBoundary({
      execute,
      graph,
      responseOwner: "knowledge",
      sourceNodeId: "step:999",
    }),
  ).resolves.toEqual(
    expect.objectContaining({
      responseOwner: null,
      status: "invalid",
    }),
  );
  await expect(
    dispatchHybridFlowBoundary({
      execute,
      graph,
      responseOwner: "task",
      sourceNodeId: "step:1",
    }),
  ).resolves.toEqual(
    expect.objectContaining({
      responseOwner: null,
      status: "invalid",
    }),
  );
  expect(executions).toBe(0);
});

test("task outcomes and pauses preserve the immutable graph return target", () => {
  const graph = compileHybridFlowGraph({
    branchRules,
    steps,
  }).graph;
  const returnTarget = buildHybridGraphTaskReturnTarget({
    actionVersionId: 500,
    graph,
    taskNodeId: getHybridNodeId(2),
  });

  expect(returnTarget).not.toBeNull();
  if (!returnTarget) {
    throw new Error("Expected the task return target to compile.");
  }
  expect(
    matchesHybridGraphTaskReturnTarget(
      returnTarget,
      hybridGraphTaskReturnTargetV1Schema.parse({
        actionVersionId: returnTarget.actionVersionId,
        kind: returnTarget.kind,
        outcomeRoutes: returnTarget.outcomeRoutes,
        schemaVersion: returnTarget.schemaVersion,
        taskNodeId: returnTarget.taskNodeId,
      }),
    ),
  ).toBe(true);
  expect(
    resolveHybridTaskOutcomeRoute({
      eventType: "completed",
      outcomeKey: "completed",
      outcomes,
      returnTarget,
    }),
  ).toEqual({
    nodeId: "step:3",
    responseOwner: "deterministic",
  });

  const suspension = taskSuspensionReturnTargetV1Schema.parse({
    boundaryReturnTarget: { fieldKey: "serviceId" },
    graphReturnTarget: returnTarget,
    kind: "task_suspension",
    schemaVersion: 1,
  });
  expect(parseHybridGraphTaskReturnTarget(suspension)).toEqual(returnTarget);
});

test("task outcome resume restores only the immutable next boundary", () => {
  const returnTarget = hybridGraphTaskReturnTargetV1Schema.parse({
    actionVersionId: 500,
    kind: "hybrid_graph_task",
    outcomeRoutes: {
      cancelled: {
        nodeId: null,
        responseOwner: "knowledge",
      },
      completed: {
        nodeId: "step:3",
        responseOwner: "deterministic",
      },
      failed: {
        nodeId: "step:1",
        responseOwner: "knowledge",
      },
      handoff: {
        nodeId: "step:1",
        responseOwner: "knowledge",
      },
    },
    schemaVersion: 1,
    taskNodeId: "step:2",
  });
  const taskOutcomes = REFERENCE_BOOKING_TASK_DEFINITION.outcomes;

  expect(
    resolveHybridTaskOutcomeResume({
      eventType: "completed",
      outcomeKey: "completed",
      outcomes: taskOutcomes,
      returnTarget,
    }),
  ).toEqual({
    actionVersionId: 500,
    nodeId: "step:3",
    responseOwner: "deterministic",
    status: "active",
  });
  expect(
    resolveHybridTaskOutcomeResume({
      eventType: "cancelled",
      outcomeKey: null,
      outcomes: taskOutcomes,
      returnTarget,
    }),
  ).toEqual({
    actionVersionId: null,
    nodeId: null,
    responseOwner: "knowledge",
    status: "closed",
  });
  expect(
    resolveHybridTaskOutcomeResume({
      eventType: "failed",
      outcomeKey: null,
      outcomes: taskOutcomes,
      returnTarget,
    }),
  ).toEqual(
    expect.objectContaining({
      nodeId: "step:1",
      responseOwner: "knowledge",
    }),
  );
  expect(
    resolveHybridTaskOutcomeResume({
      eventType: "handoff",
      outcomeKey: "handoff",
      outcomes: taskOutcomes,
      returnTarget,
    }),
  ).toEqual(
    expect.objectContaining({
      nodeId: "step:1",
      responseOwner: "knowledge",
    }),
  );
});

test("task outcome resume rejects outcomes absent from the pinned return target", () => {
  expect(
    resolveHybridTaskOutcomeResume({
      eventType: "completed",
      outcomeKey: "completed",
      outcomes: REFERENCE_BOOKING_TASK_DEFINITION.outcomes,
      returnTarget: hybridGraphTaskReturnTargetV1Schema.parse({
        actionVersionId: 500,
        kind: "hybrid_graph_task",
        outcomeRoutes: {},
        schemaVersion: 1,
        taskNodeId: "step:2",
      }),
    }),
  ).toBeNull();
});

test("knowledge answers can remain owned by the active knowledge node", () => {
  const knowledgeStep = createStep(10, 1, {
    settings: {
      knowledgeConversation: {
        answeredRoute: null,
        handoffRoute: "end",
        noAnswerRoute: "end",
        recommendationTargetStepIds: [],
        remainActiveAfterAnswer: true,
        schemaVersion: 1,
        stageMode: "goal_driven",
      },
      knowledgeGoal: "Answer ordinary project questions.",
      nodeLabel: "Project questions",
    },
    stepType: "knowledge_conversation",
  });
  const result = compileHybridFlowGraph({
    branchRules,
    steps: [knowledgeStep],
  });

  expect(result.issues).toEqual([]);
  expect(result.graph.nodes[0]).toEqual(
    expect.objectContaining({
      id: "step:10",
      kind: "knowledge",
      responseOwner: "knowledge",
    }),
  );
  expect(
    result.graph.transitions.some(
      (transition) =>
        transition.sourceNodeId === "step:10" &&
        transition.triggerKey === "answered",
    ),
  ).toBe(false);
});

test("published task nodes retain exact versions and every named return route", () => {
  const graph = compileHybridFlowGraph({
    branchRules,
    steps,
  }).graph;
  const taskNode = graph.nodes.find(
    (node) => node.kind === "conversational_task",
  );
  const returnTarget = buildHybridGraphTaskReturnTarget({
    actionVersionId: 500,
    graph,
    taskNodeId: getHybridNodeId(2),
  });

  expect(taskNode).toEqual(
    expect.objectContaining({
      settings: expect.objectContaining({
        task: expect.objectContaining({
          taskId: 40,
          taskVersionId: 80,
          versionNumber: 2,
        }),
      }),
    }),
  );
  expect(returnTarget?.outcomeRoutes).toEqual({
    cancelled: {
      nodeId: null,
      responseOwner: "knowledge",
    },
    completed: {
      nodeId: "step:3",
      responseOwner: "deterministic",
    },
  });
});

test("compiler rejects hybrid nodes that no published entry can reach", () => {
  const isolatedTask = {
    ...steps[1],
    settings: {
      ...steps[1].settings,
      conversationalTask: {
        ...(steps[1].settings.conversationalTask as Record<string, unknown>),
        outcomeRoutes: {
          cancelled: "end",
          completed: "end",
        },
      },
    },
  };
  const result = compileHybridFlowGraph({
    actionSettings: {
      hybridEntryPolicy: {
        campaignRoutes: {},
        channelRoutes: {},
        deepLinkRoutes: {},
        normalStepId: 1,
        schemaVersion: 1,
      },
    },
    branchRules,
    steps: [
      {
        ...steps[0],
        settings: {
          ...steps[0].settings,
          knowledgeConversation: {
            answeredRoute: null,
            handoffRoute: "end",
            noAnswerRoute: "end",
            recommendationTargetStepIds: [],
            remainActiveAfterAnswer: true,
            schemaVersion: 1,
            stageMode: "goal_driven",
          },
        },
      },
      isolatedTask,
    ],
  });

  expect(result.issues).toContainEqual(
    expect.objectContaining({
      code: "hybrid_step_unreachable",
      stepId: 2,
    }),
  );
});

test("compiler rejects published paths beyond the traversal depth limit", () => {
  const result = compileHybridFlowGraph({
    branchRules,
    maxTraversalDepth: 1,
    steps,
  });

  expect(result.issues).toContainEqual(
    expect.objectContaining({
      code: "hybrid_depth_exceeded",
      severity: "error",
    }),
  );
});
