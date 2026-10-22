import { expect, test } from "@playwright/test";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import {
  type ConversationalTaskDefinitionV1,
  conversationalTaskSnapshotV1Schema,
} from "../../src/lib/conversation-contracts";
import type { TurnResultV1 } from "../../src/lib/conversation-turn-contracts";
import { findTaskFieldReferences } from "../../src/lib/conversational-task-builder";
import {
  createCollectionTaskConfirmationProposal,
  getTaskRuntimeInputRequest,
  reconcileTaskSideQuestionWithRuntime,
  reconcileTaskTurnWithRuntime,
  shouldAnswerTaskSideQuestion,
} from "../../src/lib/hybrid-flow-runtime";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";
import {
  appendTaskFollowUpQuestion,
  hasTaskFollowUpDestination,
  isPendingTaskFollowUp,
  parseTaskFollowUpConsent,
  shouldOfferTaskFollowUp,
  validateTaskFollowUp,
} from "../../src/lib/task-follow-up";
import type {
  CompiledHybridFlowGraphV1,
  HybridFlowNodeV1,
} from "../../src/lib/hybrid-flow-contracts";

function fixture() {
  const definition: ConversationalTaskDefinitionV1 = {
    ...structuredClone(REFERENCE_BOOKING_TASK_DEFINITION),
    tools: [],
    fieldTransferWhitelist: [],
    followUp: {
      consentField: "helpWanted",
      reasonField: "question",
      nameField: "customer",
      contactField: "email",
    },
    fields: (
      [
        ["date", "date", true],
        ["helpWanted", "boolean", false],
        ["question", "text", false],
        ["customer", "text", true],
        ["email", "email", true],
      ] as const
    ).map(([key, type, required], index) => ({
      ...REFERENCE_BOOKING_TASK_DEFINITION.fields[0],
      id: `10000000-0000-4000-8000-00000000000${index + 1}`,
      key,
      label: key,
      type,
      required,
      dependsOn: [],
      optionSource: null,
      requiredWhen: null,
      prompt: `Please provide ${key}.`,
    })),
  };
  const snapshot = conversationalTaskSnapshotV1Schema.parse({
    schemaVersion: 1,
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    assistantPolicy: REFERENCE_BOOKING_PROJECT_POLICY.assistant,
    conversationPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
    task: {
      id: 1,
      schemaVersion: 1,
      name: "Service enquiry",
      objective: "Collect an enquiry",
      description: null,
      definition,
    },
  });
  const fields = definition.fields.map((field) => ({
    fieldKey: field.key,
    isRequired: field.required,
    state: field.key === "date" ? "valid" : "missing",
    canonicalValue: field.key === "date" ? ("2026-11-01" as unknown) : null,
    validation: {},
  }));
  const proposal: TurnResultV1 = {
    schemaVersion: 1,
    turnKind: "field_answer",
    reply: "Noted.",
    ambiguity: { requiresClarification: false, question: null },
    grounding: { status: "not_needed", excerptIds: [] },
    fieldCandidates: [],
    nextAction: "ask",
    outcomeRecommendation: null,
    toolRequest: null,
    routeRecommendation: null,
    taskRecommendation: null,
    safety: { decision: "allow", reasonCode: null },
    decisionSummary: "Test",
  };
  return { definition, snapshot, fields, proposal };
}

test("follow-up is configured by field roles and rejects broken bindings", () => {
  const { definition } = fixture();
  expect(validateTaskFollowUp(definition)).toEqual([]);
  expect(findTaskFieldReferences(definition, "question")).toContain(
    "team follow-up",
  );
  definition.followUp!.contactField = "missing";
  expect(validateTaskFollowUp(definition).join(" ")).toContain(
    "phone or email",
  );
  definition.followUp!.contactField = "customer";
  expect(validateTaskFollowUp(definition).join(" ")).toContain(
    "different fields",
  );
});

test("interpreted team requests collect contact details without repeating knowledge or submitting", () => {
  const { snapshot, fields, proposal } = fixture();
  const request = { ...proposal, turnKind: "follow_up_request" as const };
  expect(
    shouldAnswerTaskSideQuestion({
      proposal: request,
      text: "Can you check with them?",
      availabilityHandled: false,
    }),
  ).toBe(false);
  for (const field of fields) {
    if (field.fieldKey === "question") {
      field.state = "valid";
      field.canonicalValue = "Can you check compatibility with my equipment?";
    }
    if (field.fieldKey === "helpWanted") {
      field.state = "valid";
      field.canonicalValue = true;
    }
  }
  const response = reconcileTaskTurnWithRuntime({
    snapshot,
    fields,
    proposal: request,
  });
  expect(response.reply).toMatch(/name.*follow up/i);
  expect(response.nextAction).toBe("ask");
  expect(response.outcomeRecommendation).toBeNull();
  for (const field of fields) field.state = "valid";
  expect(
    reconcileTaskTurnWithRuntime({ snapshot, fields, proposal: request })
      .nextAction,
  ).toBe("confirm");
  expect(
    shouldAnswerTaskSideQuestion({
      proposal: { ...proposal, turnKind: "side_question" },
      text: "What are your opening hours?",
      availabilityHandled: false,
    }),
  ).toBe(true);
});

test("unknown answers and generic referrals qualify across domains, ordinary facts and refusals do not", () => {
  const { proposal } = fixture();
  for (const reply of [
    "Our team can clarify this if you need it for video calls.",
    "Our support team can verify compatibility with your equipment.",
    "Our team needs to confirm eligibility before booking.",
    "Any extra discount needs approval. I can request a callback for the best available price.",
  ])
    expect(shouldOfferTaskFollowUp({ ...proposal, reply })).toBe(true);
  expect(
    shouldOfferTaskFollowUp({
      ...proposal,
      grounding: { status: "no_answer", excerptIds: [] },
    }),
  ).toBe(true);
  expect(
    shouldOfferTaskFollowUp({
      ...proposal,
      reply: "Yes, we offer Wi-Fi and have a swimming pool.",
    }),
  ).toBe(false);
  expect(
    shouldOfferTaskFollowUp({
      ...proposal,
      reply: "Our team is available 9–5.",
    }),
  ).toBe(false);
  expect(
    shouldOfferTaskFollowUp({
      ...proposal,
      grounding: { status: "no_answer", excerptIds: [] },
      safety: { decision: "refuse", reasonCode: "unsafe" },
    }),
  ).toBe(false);
});

test("pending consent survives interruptions and cannot become final submission", () => {
  const { snapshot, fields, proposal } = fixture();
  const reason = fields.find((field) => field.fieldKey === "question")!;
  reason.state = "valid";
  reason.canonicalValue = "Can the team check compatibility?";
  expect(
    isPendingTaskFollowUp({
      definition: snapshot.task.definition,
      fields,
      requestedFieldKey: "helpWanted",
    }),
  ).toBe(true);
  expect(
    reconcileTaskTurnWithRuntime({ snapshot, fields, proposal }).reply,
  ).toBe(
    "Would you like our team to follow up on your earlier unanswered question?",
  );
  expect(
    getTaskRuntimeInputRequest({ snapshot, fields, proposal })?.fieldKey,
  ).toBe("helpWanted");
  for (const field of fields.filter((field) => field.isRequired))
    field.state = "valid";
  expect(
    createCollectionTaskConfirmationProposal({ snapshot, fields, text: "Yes" }),
  ).toBeNull();
  const side = reconcileTaskSideQuestionWithRuntime({
    snapshot,
    fields,
    requestedFieldKey: "helpWanted",
    proposal: { ...proposal, reply: "We open at 9 am." },
  });
  expect(side.reply).toBe(
    "We open at 9 am.\n\nWould you like our team to follow up on your earlier unanswered question?",
  );
  expect(parseTaskFollowUpConsent("Yes please")).toBe(true);
  expect(parseTaskFollowUpConsent("No thanks")).toBe(false);
  expect(parseTaskFollowUpConsent("Maybe, what does it cost?")).toBeNull();
  expect(
    parseTaskFollowUpConsent("Yes, change the date to tomorrow"),
  ).toBeNull();
});

test("accepted follow-up asks for contact with purpose and reuses known details", () => {
  const { snapshot, fields, proposal } = fixture();
  const before = structuredClone(fields[0]);
  fields.find((field) => field.fieldKey === "helpWanted")!.state = "valid";
  fields.find((field) => field.fieldKey === "helpWanted")!.canonicalValue =
    true;
  expect(
    reconcileTaskTurnWithRuntime({ snapshot, fields, proposal }).reply,
  ).toBe("What is your name so our team can follow up with you?");
  fields.find((field) => field.fieldKey === "customer")!.state = "valid";
  expect(
    reconcileTaskTurnWithRuntime({ snapshot, fields, proposal }).reply,
  ).toBe("Which email address may our team use to follow up with you?");
  expect(fields[0]).toEqual(before);
  fields.find((field) => field.fieldKey === "email")!.state = "valid";
  expect(
    reconcileTaskTurnWithRuntime({ snapshot, fields, proposal }).nextAction,
  ).toBe("confirm");
  expect(
    isPendingTaskFollowUp({
      definition: snapshot.task.definition,
      fields,
      requestedFieldKey: "helpWanted",
    }),
  ).toBe(false);
});

test("declining restores normal collection; cancellation is not swallowed", () => {
  const { snapshot, fields, proposal } = fixture();
  fields.find((field) => field.fieldKey === "helpWanted")!.state = "valid";
  fields.find((field) => field.fieldKey === "helpWanted")!.canonicalValue =
    false;
  expect(
    reconcileTaskTurnWithRuntime({ snapshot, fields, proposal }).reply,
  ).toBe("Please provide customer.");
  expect(
    reconcileTaskTurnWithRuntime({
      snapshot,
      fields,
      proposal: { ...proposal, nextAction: "cancel", turnKind: "cancellation" },
    }).nextAction,
  ).toBe("cancel");
});

test("the team receives the actual question, bounded and without duplicate retries", () => {
  const question = "Is the Wi-Fi fast enough for video calls?";
  expect(appendTaskFollowUpQuestion(null, question)).toBe(question);
  expect(appendTaskFollowUpQuestion(question, question)).toBe(question);
  expect(
    appendTaskFollowUpQuestion(question, "Can you check accessibility too?"),
  ).toContain("accessibility");
  expect(
    appendTaskFollowUpQuestion("x".repeat(500), "y".repeat(1000)).length,
  ).toBeLessThanOrEqual(500);
});

test("follow-up requires an actual published team handoff destination", () => {
  const { definition } = fixture();
  const node: Extract<HybridFlowNodeV1, { kind: "conversational_task" }> = {
    id: "task",
    sourceStepId: 1,
    label: "Enquiry",
    kind: "conversational_task",
    responseOwner: "task",
    settings: {
      schemaVersion: 1,
      transferFieldKeys: [],
      transferContextKeys: [],
      outcomeRoutes: { completed: 2 },
      task: {
        schemaVersion: 1,
        taskId: 1,
        taskVersionId: 1,
        versionNumber: 1,
        name: "Enquiry",
        outcomes: definition.outcomes,
      },
    },
  };
  const graph: CompiledHybridFlowGraphV1 = {
    schemaVersion: 1,
    entryNodeId: "task",
    maxTraversalDepth: 10,
    transitions: [],
    entryPolicy: {
      normalNodeId: "task",
      campaignRoutes: {},
      channelRoutes: {},
      deepLinkRoutes: {},
    },
    nodes: [
      node,
      {
        id: "team",
        sourceStepId: 2,
        label: "Team",
        kind: "deterministic",
        responseOwner: "deterministic",
        stepType: "handoff",
      },
    ],
  };
  expect(hasTaskFollowUpDestination({ definition, node, graph })).toBe(true);
  node.settings.outcomeRoutes.completed = "end";
  expect(hasTaskFollowUpDestination({ definition, node, graph })).toBe(false);
  node.settings.outcomeRoutes.completed = 3;
  expect(hasTaskFollowUpDestination({ definition, node, graph })).toBe(false);
});
