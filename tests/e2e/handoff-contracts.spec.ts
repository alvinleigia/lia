import { expect, test } from "@playwright/test";
import { buildBoundedHandoffContext } from "../../src/lib/handoff";

test("handoff context is bounded and excludes internal or secret fields", () => {
  const fields = Object.fromEntries(
    Array.from({ length: 24 }, (_, index) => [
      `field${index}`,
      `value${index}`,
    ]),
  );

  const context = buildBoundedHandoffContext({
    actionId: 42,
    actionName: "Booking support",
    fields: {
      __runtimeState: "private",
      accessToken: "secret-token",
      guestEmail: "guest@example.com",
      nested: {
        authorization: "Bearer secret",
        service: "Classic Facial",
      },
      ...fields,
    },
    reason: "The visitor requested specialist assistance.",
    stepId: 7,
    stepLabel: "Request human support",
  });

  expect(context).toMatchObject({
    intent: "Booking support",
    priorActions: [
      {
        actionId: 42,
        actionName: "Booking support",
        stepId: 7,
        stepLabel: "Request human support",
      },
    ],
    reason: "The visitor requested specialist assistance.",
  });
  expect(Object.keys(context.validatedFields)).toHaveLength(20);
  expect(context.validatedFields).not.toHaveProperty("__runtimeState");
  expect(context.validatedFields).not.toHaveProperty("accessToken");
  expect(context.validatedFields).toMatchObject({
    guestEmail: "guest@example.com",
    nested: { service: "Classic Facial" },
  });
  expect(context.validatedFields).not.toHaveProperty("nested.authorization");
});

test("handoff context truncates long visitor values", () => {
  const context = buildBoundedHandoffContext({
    actionId: 1,
    actionName: "A".repeat(200),
    fields: { notes: "N".repeat(700) },
    reason: "R".repeat(300),
    stepId: 2,
    stepLabel: "S".repeat(200),
  });

  expect(context.intent).toHaveLength(160);
  expect(context.reason).toHaveLength(240);
  expect(context.priorActions[0]?.stepLabel).toHaveLength(160);
  expect(context.validatedFields.notes).toHaveLength(500);
});
