import { expect, test } from "@playwright/test";
import { REFERENCE_BOOKING_PROJECT_POLICY } from "../../src/lib/conversation-contract-fixtures";
import { conversationalTaskSnapshotV1Schema } from "../../src/lib/conversation-contracts";
import {
  createConversationalTaskDefinitionFromTemplate,
  getConversationalTaskTemplate,
} from "../../src/lib/conversational-task-templates";
import { StructuredTurnEngine } from "../../src/lib/conversation-turn-engine";
import { AiSdkStructuredTurnProvider } from "../../src/lib/model-provider";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";
import { validateTaskFollowUp } from "../../src/lib/task-follow-up";
import { createCollectionTaskConfirmationProposal } from "../../src/lib/hybrid-flow-runtime";
import { shouldAnswerTaskSideQuestion } from "../../src/lib/hybrid-flow-runtime";

const definition =
  createConversationalTaskDefinitionFromTemplate("team_follow_up");
const template = getConversationalTaskTemplate("team_follow_up")!;
const snapshot = conversationalTaskSnapshotV1Schema.parse({
  schemaVersion: 1,
  assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
  assistantPolicy: REFERENCE_BOOKING_PROJECT_POLICY.assistant,
  conversationPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
  task: {
    id: 95,
    schemaVersion: 1,
    name: template.defaultName,
    objective: template.defaultObjective,
    description: null,
    definition,
  },
});

test("callback template requires question and contact details without booking inputs", () => {
  expect(validateTaskFollowUp(definition)).toEqual([]);
  expect(definition.fields.filter((f) => f.required).map((f) => f.key)).toEqual(
    ["contactName", "contactNumber", "followUpQuestion"],
  );
  expect(definition.tools).toEqual([]);
  expect(
    createCollectionTaskConfirmationProposal({
      snapshot,
      fields: [],
      text: "Confirm",
    }),
  ).toBeNull();
});

for (const scenario of [
  {
    domain: "hotel",
    question: "Will the Wi-Fi be good enough for my Google Meets?",
    request: "can u confirm with them?",
    topic: /wi.fi|google meet|video call/i,
  },
  {
    domain: "service",
    question: "Can you repair a cracked ceramic basin?",
    request: "please check with your technician and get back to me",
    topic: /basin|ceramic/i,
  },
  {
    domain: "appointment",
    question: "Can the specialist review my previous scans?",
    request: "could you ask the team about that?",
    topic: /scan/i,
  },
]) {
  test(`@live-openai contextual ${scenario.domain} follow-up routes and retains its question`, async () => {
    test.skip(
      process.env.LIA_LIVE_KNOWLEDGE_UAT !== "1",
      "Opt-in metered semantic verification.",
    );
    test.setTimeout(120_000);
    const engine = new StructuredTurnEngine({
      provider: new AiSdkStructuredTurnProvider(),
    });
    const input = {
      activeTask: null,
      assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
      assistantIntroduced: true,
      channel: "whatsapp" as const,
      companyName: "Test Business",
      projectName: "Follow-up Test",
      projectId: 194,
      projectPolicy: {
        ...REFERENCE_BOOKING_PROJECT_POLICY,
        assistant: {
          ...REFERENCE_BOOKING_PROJECT_POLICY.assistant,
          modelPolicy: {
            ...REFERENCE_BOOKING_PROJECT_POLICY.assistant.modelPolicy,
            timeoutMs: 45000,
          },
        },
      },
      context: [],
      fieldState: [],
      history: [
        { role: "user" as const, content: "Cancel this enquiry." },
        { role: "assistant" as const, content: "Your enquiry was cancelled." },
        { role: "user" as const, content: scenario.question },
        {
          role: "assistant" as const,
          content: "I can't confirm that. Our team can check this for you.",
        },
      ],
      publishedTasks: [
        {
          id: 95,
          name: template.defaultName,
          objective: template.defaultObjective,
          candidateFieldKeys: definition.fields.map((f) => f.key),
        },
        {
          id: 96,
          name: "Booking Enquiry",
          objective:
            "Collect dates, requirements and contact details for a booking.",
        },
      ],
      stage: "knowledge" as const,
      visitorMessage: scenario.request,
    };
    const routing = await engine.execute(input);
    expect(routing.source).toBe("model");
    expect(routing.proposal.taskRecommendation?.taskId).toBe(95);
    expect(routing.proposal.answerSelections ?? null).toBeNull();
    expect(routing.proposal.nextAction).toBe("ask");
    expect(routing.proposal.ambiguity.requiresClarification).toBe(false);
    const extraction = await engine.execute({
      ...input,
      activeTask: snapshot,
      publishedTasks: [],
      stage: "extraction",
      requestedFieldKey: "contactName",
    });
    const fields = extraction.proposal.fieldCandidates;
    expect(extraction.proposal.turnKind).toBe("follow_up_request");
    expect(
      shouldAnswerTaskSideQuestion({
        proposal: extraction.proposal,
        text: scenario.request,
        availabilityHandled: false,
      }),
    ).toBe(false);
    expect(
      fields.find((f) => f.fieldKey === "followUpQuestion")?.naturalValue,
    ).toMatch(scenario.topic);
    expect(
      String(
        fields.find((f) => f.fieldKey === "callbackRequested")?.naturalValue,
      ),
    ).toMatch(/^(true|yes)$/i);
    expect(
      fields.some(
        (f) => f.fieldKey === "contactName" || f.fieldKey === "contactNumber",
      ),
    ).toBe(false);
    expect(extraction.proposal.nextAction).toBe("ask");
    expect(extraction.proposal.outcomeRecommendation).toBeNull();

    const declined = await engine.execute({
      ...input,
      visitorMessage:
        "No need to contact anyone. What information do you already have about that?",
    });
    expect(declined.proposal.taskRecommendation).toBeNull();
    const factual = await engine.execute({
      ...input,
      history: [
        ...input.history,
        { role: "user", content: scenario.request },
        { role: "assistant", content: "What is your name for the callback?" },
        { role: "user", content: "Cancel this request." },
        { role: "assistant", content: "The callback request was cancelled." },
      ],
      visitorMessage: scenario.question,
    });
    expect(factual.proposal.taskRecommendation).toBeNull();
  });
}
