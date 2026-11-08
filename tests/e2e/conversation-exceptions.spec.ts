import { expect, test } from "@playwright/test";
import { DEFAULT_CONVERSATION_PROJECT_POLICY } from "../../src/lib/conversation-contracts";
import {
  ASSISTANCE_OFFER,
  applyConversationExceptionDecision,
  EXCEPTION_METADATA_KEY,
  exceptionStateSchema,
  hasPendingExceptionOffer,
  planConversationException,
  readConversationException,
} from "../../src/lib/conversation-exceptions";
import { createAssistanceDecisionExecution } from "../../src/lib/conversation-turn-engine";
import {
  AiSdkStructuredTurnProvider,
  PLATFORM_EXTRACTION_MODEL_ID,
} from "../../src/lib/model-provider";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

const scope = "a".repeat(64);
const now = new Date("2026-11-08T08:00:00.000Z");
const base = {
  scope,
  messageId: 10,
  reason: "ambiguity" as const,
  previous: null,
  limit: 1,
  canHandoff: true,
  now,
};

test("@live-openai assistance accepts and declines paraphrases without treating facts as consent", async () => {
  test.skip(
    process.env.LIA_LIVE_KNOWLEDGE_UAT !== "1",
    "Opt-in metered verification only",
  );
  test.setTimeout(90_000);
  (await import("dotenv")).config({ path: ".env.local", quiet: true });
  const provider = new AiSdkStructuredTurnProvider();
  for (const [text, expected] of [
    ["Could someone take over and sort this out for me?", "accept"],
    [
      "I'd appreciate it if a member of your team could look into this.",
      "accept",
    ],
    [
      "Please don't get anyone else involved; I'd rather finish this here.",
      "decline",
    ],
    ["Before we go further, is parking included?", "other"],
    ["My name is Alex.", "other"],
  ] as const) {
    const result = await provider.reviewInterpretation({
      kind: "exception_assistance",
      modelId: PLATFORM_EXTRACTION_MODEL_ID,
      timeoutMs: 15_000,
      messages: [
        { role: "assistant", content: ASSISTANCE_OFFER },
        { role: "user", content: text },
      ],
      selected: [],
    });
    expect(result.assistanceDecision, text).toBe(expected);
    expect(result.matches).toBe(expected === "accept");
  }
});

test("one focused clarification precedes a configured assistance offer", () => {
  const first = planConversationException(base);
  expect(first?.action).toBe("clarify");
  expect(
    planConversationException({ ...base, messageId: 11, previous: first })
      ?.action,
  ).toBe("offer_assistance");
});
for (const limit of [0, 1, 2, 3])
  test(`published clarification limit ${limit} is enforced`, () => {
    let previous = null as ReturnType<typeof planConversationException>;
    for (let index = 0; index <= limit; index++) {
      previous = planConversationException({
        ...base,
        limit,
        messageId: 10 + index,
        previous,
      });
      expect(previous?.action).toBe(
        index < limit ? "clarify" : "offer_assistance",
      );
    }
  });
test("missing handoff configuration sends the case to review without promising assistance", () => {
  const state = planConversationException({
    ...base,
    limit: 0,
    canHandoff: false,
  });
  expect(state?.action).toBe("review");
});
test("duplicate and older messages cannot inflate the clarification counter", () => {
  const state = planConversationException(base);
  expect(planConversationException({ ...base, previous: state })).toBe(state);
  expect(
    planConversationException({
      ...base,
      messageId: 9,
      scope: "b".repeat(64),
      previous: state,
    }),
  ).toBe(state);
});
test("consent applies only to the current offer and a still configured destination", () => {
  const offer = planConversationException({ ...base, limit: 0 });
  expect(
    planConversationException({
      ...base,
      previous: offer,
      messageId: 11,
      consent: true,
      offeredMessageId: 10,
    })?.action,
  ).toBe("handoff");
  expect(
    planConversationException({
      ...base,
      previous: offer,
      messageId: 11,
      consent: true,
      offeredMessageId: 9,
    })?.action,
  ).toBe("review");
  expect(
    planConversationException({
      ...base,
      previous: offer,
      messageId: 11,
      consent: true,
      offeredMessageId: 10,
      canHandoff: false,
    })?.action,
  ).toBe("review");
});
test("declining preserves the request and prevents repeated assistance offers", () => {
  const offer = planConversationException({ ...base, limit: 0 });
  const declined = planConversationException({
    ...base,
    previous: offer,
    messageId: 11,
    consent: false,
    offeredMessageId: 10,
  });
  expect(declined).toMatchObject({
    action: "resume",
    assistanceDeclined: true,
  });
  expect(
    planConversationException({ ...base, previous: declined, messageId: 12 })
      ?.action,
  ).toBe("review");
  const resolved = planConversationException({
    ...base,
    previous: declined,
    messageId: 12,
    reason: null,
  });
  expect(resolved).toMatchObject({
    action: "resolved",
    failures: 0,
    assistanceDeclined: false,
  });
});
test("scope changes and successful progress reset prior difficulty", () => {
  const offer = planConversationException({ ...base, limit: 0 });
  expect(
    planConversationException({
      ...base,
      previous: offer,
      messageId: 11,
      scope: "b".repeat(64),
    }),
  ).toMatchObject({ failures: 1, action: "clarify" });
  expect(
    planConversationException({
      ...base,
      previous: offer,
      messageId: 11,
      reason: null,
    }),
  ).toMatchObject({ action: "resolved", failures: 0 });
});
test("offer state expires and its allowlist excludes arbitrary customer data", () => {
  const state = planConversationException({ ...base, limit: 0 });
  expect(
    hasPendingExceptionOffer(
      { [EXCEPTION_METADATA_KEY]: state },
      now.getTime() + 31 * 60_000,
    ),
  ).toBe(false);
  expect(
    readConversationException({ [EXCEPTION_METADATA_KEY]: state })?.action,
  ).toBe("offer_assistance");
  expect(
    JSON.stringify(
      exceptionStateSchema.parse({
        ...state,
        customer: "private@example.test",
      }),
    ),
  ).not.toContain("private@example.test");
});
test("assistance replies cannot carry business writes or field candidates from consent", async () => {
  const input = {
    activeTask: null,
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    assistantIntroduced: true,
    channel: "project_chat" as const,
    companyName: "Test",
    context: [],
    fieldState: [],
    history: [],
    projectId: 194,
    projectName: "Test",
    projectPolicy: DEFAULT_CONVERSATION_PROJECT_POLICY,
    publishedTasks: [],
    stage: "extraction" as const,
    visitorMessage: "I need a person to help",
  };
  const execution = createAssistanceDecisionExecution();
  const offer = planConversationException({ ...base, limit: 0 });
  if (!offer) throw new Error("Missing offer");
  const offered = applyConversationExceptionDecision(execution, offer, input);
  expect(offered.proposal.reply).toBe(ASSISTANCE_OFFER);
  const declined = planConversationException({
    ...base,
    previous: offer,
    messageId: 11,
    consent: false,
    offeredMessageId: 10,
  });
  if (!declined) throw new Error("Missing decline");
  const resumed = applyConversationExceptionDecision(
    execution,
    declined,
    input,
  );
  expect(resumed.proposal.nextAction).toBe("clarify");
  expect(resumed.proposal.fieldCandidates).toEqual([]);
  expect(resumed.proposal.toolRequest).toBeNull();
  expect(resumed.proposal.outcomeRecommendation).toBeNull();
});
