import { expect, test } from "@playwright/test";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import {
  conversationalTaskDefinitionV1Schema,
  conversationProjectPolicyV1Schema,
  taskIntentRecommendationV1Schema,
} from "../../src/lib/conversation-contracts";
import {
  conversationalTaskDetailsSchema,
  conversationalTaskIdSchema,
} from "../../src/lib/conversational-task-schema";
import { validateConversationalTaskForPublish } from "../../src/lib/conversational-task-validation";

test("conversational task details normalize a valid draft", () => {
  const parsed = conversationalTaskDetailsSchema.parse({
    description: "  Used by the booking team.  ",
    name: "  Book a Spa Service  ",
    objective: "  Help a visitor submit an appointment request.  ",
  });

  expect(parsed).toEqual({
    description: "Used by the booking team.",
    name: "Book a Spa Service",
    objective: "Help a visitor submit an appointment request.",
  });
});

test("conversational task details require a name and objective", () => {
  expect(
    conversationalTaskDetailsSchema.safeParse({
      description: "",
      name: " ",
      objective: " ",
    }).success,
  ).toBe(false);
});

test("conversational task details enforce draft field limits", () => {
  expect(
    conversationalTaskDetailsSchema.safeParse({
      name: "n".repeat(121),
      objective: "o".repeat(601),
    }).success,
  ).toBe(false);
});

test("conversational task ids accept only positive integers", () => {
  expect(conversationalTaskIdSchema.parse("42")).toBe(42);
  expect(conversationalTaskIdSchema.safeParse("0").success).toBe(false);
  expect(conversationalTaskIdSchema.safeParse("1.5").success).toBe(false);
});

test("reference booking fixture satisfies the universal contracts", () => {
  expect(
    conversationProjectPolicyV1Schema.safeParse(
      REFERENCE_BOOKING_PROJECT_POLICY,
    ).success,
  ).toBe(true);
  expect(
    conversationalTaskDefinitionV1Schema.safeParse(
      REFERENCE_BOOKING_TASK_DEFINITION,
    ).success,
  ).toBe(true);
  expect(
    validateConversationalTaskForPublish({
      definition: REFERENCE_BOOKING_TASK_DEFINITION,
      projectPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
    }),
  ).toEqual({ issues: [], ready: true });
});

test("task recommendation accepts only a stable published task candidate", () => {
  expect(
    taskIntentRecommendationV1Schema.safeParse({
      schemaVersion: 1,
      taskId: 42,
      candidateFieldMappings: { guestEmail: "visitor@example.com" },
    }).success,
  ).toBe(true);
  expect(
    taskIntentRecommendationV1Schema.safeParse({
      schemaVersion: 1,
      taskId: "book-now",
      candidateFieldMappings: {},
    }).success,
  ).toBe(false);
});

test("publish validation catches missing dependencies and terminal outcomes", () => {
  const invalid = {
    ...REFERENCE_BOOKING_TASK_DEFINITION,
    fields: [
      {
        ...REFERENCE_BOOKING_TASK_DEFINITION.fields[0],
        dependsOn: ["missingField"],
      },
    ],
    outcomes: [],
  };
  const result = validateConversationalTaskForPublish({
    definition: invalid,
    projectPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
  });

  expect(result.ready).toBe(false);
  expect(result.issues).toContain("Add a completed outcome.");
  expect(result.issues).toContain("Add a cancelled outcome.");
  expect(result.issues).toContain(
    "Service Category depends on missing field missingField.",
  );
});
