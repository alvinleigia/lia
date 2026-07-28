import { expect, test } from "@playwright/test";
import {
  type ActionFlowCompilerBranchRule,
  type ActionFlowCompilerStep,
  needsExplicitPublishTerminalStep,
} from "../../src/lib/action-flow-compiler";
import { getProjectActionStatusAfterPublish } from "../../src/lib/action-flow-constants";
import type { RuntimeAction } from "../../src/lib/action-runtime";
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
import { compileHybridFlowGraph } from "../../src/lib/hybrid-flow-compiler";
import {
  compiledHybridFlowGraphV1Schema,
  getHybridNodeId,
  hybridGraphTaskReturnTargetV1Schema,
  parseHybridGraphTaskReturnTarget,
  taskSuspensionReturnTargetV1Schema,
} from "../../src/lib/hybrid-flow-contracts";
import {
  buildHybridGraphTaskReturnTarget,
  buildKnowledgeBoundarySignals,
  dispatchHybridFlowBoundary,
  matchesHybridGraphTaskReturnTarget,
  prepareHybridTaskEntry,
  reconcileTaskTurnWithAvailability,
  reconcileTaskTurnWithRuntime,
  resolveHybridBoundaryNode,
  resolveHybridTaskOutcomeResume,
  resolveHybridTaskOutcomeRoute,
  selectHybridFlowEntryNode,
  selectHybridFlowTransition,
  shouldCheckTaskAvailability,
} from "../../src/lib/hybrid-flow-runtime";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

const outcomes = DEFAULT_CONVERSATIONAL_TASK_DEFINITION.outcomes;

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
