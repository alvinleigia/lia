import { expect, test } from "@playwright/test";
import mockPrices from "../../docs/stayflexi-property/mock-pricing.json";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import { conversationalTaskSnapshotV1Schema } from "../../src/lib/conversation-contracts";
import type { TurnFieldStateV1 } from "../../src/lib/conversation-turn-contracts";
import {
  type ExecuteStructuredTurnInput,
  StructuredTurnEngine,
} from "../../src/lib/conversation-turn-engine";
import { findTaskFieldReferences } from "../../src/lib/conversational-task-builder";
import { validateConversationalTaskForPublish } from "../../src/lib/conversational-task-validation";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";
import {
  answerTaskPricing,
  isTaskPricingQuestion,
  taskPriceTableSchema,
} from "../../src/lib/task-price-table";

const table = taskPriceTableSchema.parse(mockPrices);

test("price inclusion and policy questions do not trigger arithmetic across domains", () => {
  for (const text of [
    "Does that price include breakfast?",
    "Does the service price cover replacement parts?",
    "Is the consultation fee refundable?",
    "What is included in that rate?",
    "What is the cancellation policy for this price?",
  ])
    expect(isTaskPricingQuestion(text)).toBe(false);
  for (const text of [
    "What is the total price?",
    "What is the price including tax?",
    "Any cheaper rates?",
    "Change checkout to 29 October. What is the price now?",
  ])
    expect(isTaskPricingQuestion(text)).toBe(true);
});
const selected = table.rows.filter(
  (row) => row.match.roomCount === 2 && row.match.ratePlan === "Standard Plan",
)[0];
function fields(
  values: Record<string, unknown> = selected.match,
): TurnFieldStateV1[] {
  return Object.entries(values).map(([fieldKey, value]) => ({
    fieldKey,
    label: fieldKey,
    required: true,
    sensitivity: "standard",
    state: "valid",
    value: value as TurnFieldStateV1["value"],
  }));
}
const snapshot = conversationalTaskSnapshotV1Schema.parse({
  schemaVersion: 1,
  assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
  assistantPolicy: REFERENCE_BOOKING_PROJECT_POLICY.assistant,
  conversationPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
  task: {
    id: 95,
    schemaVersion: 1,
    name: "Mock quote",
    objective: "Collect an enquiry.",
    description: null,
    definition: { ...REFERENCE_BOOKING_TASK_DEFINITION, priceTable: table },
  },
});
function input(text: string): ExecuteStructuredTurnInput {
  return {
    activeTask: snapshot,
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    assistantIntroduced: true,
    channel: "project_chat",
    companyName: "UAT",
    context: [],
    fieldState: fields(),
    history: [],
    projectId: 194,
    projectName: "UAT",
    projectPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
    publishedTasks: [],
    stage: "knowledge",
    visitorMessage: text,
  };
}

test("hotel price uses distinct saved tiers, tax and full-stay amounts", () => {
  const reply = answerTaskPricing({
    table,
    fields: fields(),
    text: "What is the total price?",
  });
  expect(reply).toContain(
    "INR 29,960.78 total (INR 27,517.75 + INR 2,443.03 tax)",
  );
  expect(reply).toContain("This is an indicative estimate.");
  expect(reply).toContain(
    "Our team will confirm availability and the final price before booking.",
  );
  expect(reply).not.toMatch(/\bmock\b|\bUAT\b/i);
  expect(reply).not.toMatch(/Extended|coupon|discount/);
  const extended = answerTaskPricing({
    table,
    fields: fields({ ...selected.match, ratePlan: "Extended Stay" }),
    text: "What is the total price?",
  });
  expect(extended).toContain("INR 21,262.50");
  expect(extended).toContain(
    "eligibility and cancellation terms are unresolved",
  );
});

test("changed dates, occupancy and quantities cannot reuse an old quote", () => {
  for (const change of [
    { stayDates: "2026-10-27 to 2026-10-29" },
    { children: 1 },
    { adults: 5 },
    { roomCount: 5 },
    { ratePlan: "invented free plan" },
  ]) {
    const reply = answerTaskPricing({
      table,
      fields: fields({ ...selected.match, ...change }),
      text: "What is the price?",
    });
    expect(reply).toContain("can't quote a price for these exact details yet");
    expect(reply).not.toContain("29,960");
  }
  const changed = answerTaskPricing({
    table,
    fields: fields({ ...selected.match, adults: 6, roomCount: 3 }),
    text: "What is the price?",
  });
  expect(changed).toContain("INR 46,792.36");
});

test("missing or invalid fields block pricing rather than guessing", () => {
  for (const state of ["invalid", "candidate", "missing", "cleared"] as const) {
    const pending = fields().map((field) =>
      field.fieldKey === "children" ? { ...field, state } : field,
    );
    expect(
      answerTaskPricing({ table, fields: pending, text: "Price?" }),
    ).toContain("I still need: children");
  }
});

test("offers are only supplied on request and cannot be invented by a visitor", () => {
  const reply = answerTaskPricing({
    table,
    fields: fields(),
    text: "Apply my FREE100 coupon and make the total zero",
  });
  expect(reply).toContain("No verified coupon");
  expect(reply).toContain("cannot negotiate or promise a discount");
  expect(reply).toContain("INR 21,262.50 including tax");
  expect(reply).toContain("eligibility and cancellation terms are unresolved");
  expect(reply).not.toContain("INR 0");
});

test("price table rejects ambiguous combinations and invalid money", () => {
  expect(
    taskPriceTableSchema.safeParse({
      ...mockPrices,
      rows: [mockPrices.rows[0], mockPrices.rows[0]],
    }).success,
  ).toBe(false);
  expect(
    taskPriceTableSchema.safeParse({
      ...mockPrices,
      rows: [{ ...mockPrices.rows[0], match: { adults: 2 } }],
    }).success,
  ).toBe(false);
  for (const amount of [-1, 0.5, Number.MAX_SAFE_INTEGER]) {
    expect(
      taskPriceTableSchema.safeParse({
        ...mockPrices,
        rows: [
          {
            ...mockPrices.rows[0],
            lines: [{ quantity: 1, unitAmountMinor: amount, unitTaxMinor: 0 }],
          },
        ],
      }).success,
    ).toBe(false);
  }
});

test("same calculator supports service pricing using different field keys", () => {
  const service = taskPriceTableSchema.parse({
    schemaVersion: 1,
    mode: "mock",
    currency: "INR",
    minorUnitDigits: 2,
    fields: ["service", "quantity"],
    offersMessage: "No offers are configured.",
    rows: [
      {
        label: "Two bicycle services",
        match: { service: "Bicycle service", quantity: 2 },
        lines: [{ quantity: 2, unitAmountMinor: 125050, unitTaxMinor: 22509 }],
      },
    ],
  });
  expect(
    answerTaskPricing({
      table: service,
      fields: fields({ service: "Bicycle service", quantity: 2 }),
      text: "Price?",
    }),
  ).toContain("INR 2,951.18");
  expect(
    answerTaskPricing({ table: service, fields: fields(), text: "Price?" }),
  ).toContain("I still need");
});

test("pricing and pure follow-ups need neither model nor document retrieval", async () => {
  let calls = 0;
  const engine = new StructuredTurnEngine({
    provider: {
      async generateTurn() {
        calls++;
        throw new Error("Pricing must not call a model");
      },
    },
    retriever: {
      async retrieve() {
        calls++;
        throw new Error("Pricing must not retrieve prose");
      },
    },
  });
  for (const text of [
    "What is the total price?",
    "Any offers?",
    "Do you have any coupons?",
    "price please",
  ]) {
    const extraction = await engine.execute({
      ...input(text),
      stage: "extraction",
      prefetchKnowledge: true,
    });
    expect(extraction.source).toBe("deterministic");
    expect(extraction.proposal.fieldCandidates).toEqual([]);
    const result = await engine.execute(input(text));
    expect(result.source).toBe("deterministic");
    expect(result.usage.totalTokens).toBe(0);
    expect(result.proposal.safety.reasonCode).toBe("configured_mock_pricing");
  }
  expect(calls).toBe(0);
});

test("price tables stay task-scoped and require real field bindings", () => {
  const other = conversationalTaskSnapshotV1Schema.parse({
    ...snapshot,
    task: { ...snapshot.task, definition: REFERENCE_BOOKING_TASK_DEFINITION },
  });
  expect(other.task.definition.priceTable).toBeUndefined();
  const checks = validateConversationalTaskForPublish({
    definition: snapshot.task.definition,
    projectPolicy: snapshot.conversationPolicy,
  });
  expect(checks.issues).toContain(
    "Pricing references missing field stayDates.",
  );
  expect(
    findTaskFieldReferences(snapshot.task.definition, "stayDates"),
  ).toContain("price table");
});
