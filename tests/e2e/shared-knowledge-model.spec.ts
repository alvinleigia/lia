import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import { conversationalTaskSnapshotV1Schema } from "../../src/lib/conversation-contracts";
import { StructuredTurnEngine } from "../../src/lib/conversation-turn-engine";
import { shouldAnswerTaskSideQuestion } from "../../src/lib/hybrid-flow-runtime";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

config({ path: ".env.local", quiet: true });

for (const [domain, question, evidence, expected] of [
  [
    "hotel",
    "Is there a swimming pool?",
    "A swimming pool is listed. Opening hours and charges are not supplied.",
    /pool/i,
  ],
  [
    "service",
    "Do you offer bike pickup?",
    "Bike pickup is available within five kilometres of the workshop. Other areas need staff approval.",
    /five|5/,
  ],
  [
    "appointment",
    "Where can I park?",
    "Free parking is available behind the clinic, subject to spaces being available.",
    /behind.*clinic/i,
  ],
] as const) {
  const task = conversationalTaskSnapshotV1Schema.parse({
    schemaVersion: 1,
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    assistantPolicy: REFERENCE_BOOKING_PROJECT_POLICY.assistant,
    conversationPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
    task: {
      id: 95,
      schemaVersion: 1,
      name: `${domain} enquiry`,
      objective: "Collect an enquiry",
      description: null,
      definition: {
        ...REFERENCE_BOOKING_TASK_DEFINITION,
        tools: [],
        fields: [
          {
            ...REFERENCE_BOOKING_TASK_DEFINITION.fields[4],
            id: randomUUID(),
            key: "requestedDate",
            label: "Requested Date",
            type: "date",
            prompt: "Which date?",
            normalization: null,
            dependsOn: [],
          },
          {
            ...REFERENCE_BOOKING_TASK_DEFINITION.fields[4],
            id: randomUUID(),
            key: "guestName",
            label: "Guest Name",
            type: "text",
            prompt: "Your name?",
            normalization: null,
            dependsOn: [],
          },
        ],
      },
    },
  });
  const input = {
    activeTask: task,
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    assistantIntroduced: true,
    channel: "project_chat" as const,
    companyName: "Synthetic UAT",
    projectName: "Synthetic UAT",
    projectId: 194,
    projectPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
    context: [],
    fieldState: [],
    history: [],
    publishedTasks: [],
    requestedFieldKey: "guestName",
  };

  test(`@live-openai ${domain}: mixed correction retains a question and answers grounded knowledge`, async () => {
    test.skip(
      process.env.LIA_LIVE_STATEMENT_UAT !== "1",
      "Opt-in synthetic model UAT.",
    );
    test.setTimeout(90_000);
    const engine = new StructuredTurnEngine({
      retriever: {
        async retrieve() {
          return [{ id: "document:1", content: evidence }];
        },
      },
    });
    const message = `Change the requested date to 26 October 2026. ${question}`;
    const extraction = await engine.execute({
      ...input,
      stage: "extraction",
      visitorMessage: message,
    });
    expect(
      extraction.proposal.fieldCandidates.some(
        (c) => c.fieldKey === "requestedDate",
      ),
    ).toBe(true);
    expect(
      shouldAnswerTaskSideQuestion({
        proposal: extraction.proposal,
        text: message,
        availabilityHandled: false,
      }),
    ).toBe(true);
    const result = await engine.execute({
      ...input,
      stage: "knowledge",
      visitorMessage: message,
      fieldState: [
        {
          fieldKey: "requestedDate",
          label: "Requested Date",
          state: "valid",
          required: true,
          sensitivity: "standard",
          value: "2026-10-26",
        },
      ],
    });
    await test.info().attach("mixed-turn", {
      body: JSON.stringify({ extraction, result }),
      contentType: "application/json",
    });
    expect(result.proposal.grounding.status).toBe("grounded");
    expect(result.proposal.reply).toMatch(expected);
    expect(result.proposal.reply).not.toMatch(/document:\d+/i);
    expect(result.proposal.toolRequest).toBeNull();
    expect(result.proposal.outcomeRecommendation).toBeNull();
  });

  test(`@live-openai ${domain}: saved pricing remains an estimate`, async () => {
    test.skip(
      process.env.LIA_LIVE_STATEMENT_UAT !== "1",
      "Opt-in synthetic model UAT.",
    );
    test.setTimeout(60_000);
    const result = await new StructuredTurnEngine({
      retriever: {
        async retrieve() {
          return [
            {
              id: "document:1",
              content: `Saved ${domain} rate snapshot: total INR 1,250 including tax. This is a saved comparison, not a verified current payable quote. Current availability and payable amount require provider confirmation.`,
            },
          ];
        },
      },
    }).execute({
      ...input,
      stage: "knowledge",
      visitorMessage: "What is the total price?",
    });
    await test.info().attach("saved-price", {
      body: JSON.stringify(result),
      contentType: "application/json",
    });
    expect(result.proposal.reply).toMatch(/1,?250/);
    expect(result.proposal.reply).toMatch(/saved|snapshot|historical/i);
    expect(result.proposal.reply).toMatch(
      /not.*(?:confirmed|current|payable)|requires?.*confirm/i,
    );
    expect(result.proposal.toolRequest).toBeNull();
    expect(result.proposal.outcomeRecommendation).toBeNull();
  });

  test(`@live-openai ${domain}: unsupported discount does not invent a coupon`, async () => {
    test.skip(
      process.env.LIA_LIVE_STATEMENT_UAT !== "1",
      "Opt-in synthetic model UAT.",
    );
    test.setTimeout(60_000);
    const result = await new StructuredTurnEngine({
      retriever: {
        async retrieve() {
          return [{ id: "document:1", content: evidence }];
        },
      },
    }).execute({
      ...input,
      stage: "knowledge",
      visitorMessage: "Give me a coupon for an additional 20 percent discount.",
    });
    await test.info().attach("unknown-offer", {
      body: JSON.stringify(result),
      contentType: "application/json",
    });
    expect(result.proposal.reply).not.toMatch(
      /use (?:code|coupon)|applied|guaranteed.*discount/i,
    );
    expect(result.proposal.toolRequest).toBeNull();
    expect(["no_answer", "not_needed"]).toContain(
      result.proposal.grounding.status,
    );
    expect(result.proposal.reply).toMatch(
      /not|no |cannot|can't|unavailable|unconfirmed/i,
    );
  });
}
