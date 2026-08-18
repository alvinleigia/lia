import { expect, test } from "@playwright/test";
import {
  getDiagnosticSubmissionSource,
  redactDiagnosticMessage,
  redactDiagnosticText,
  summarizeDiagnosticEvents,
} from "../../src/lib/conversation-diagnostics";

test("diagnostics map channel conversations to their submission source", () => {
  expect(getDiagnosticSubmissionSource("project_chat")).toBe("project_chat");
  expect(getDiagnosticSubmissionSource("widget")).toBe("widget_chat");
  expect(getDiagnosticSubmissionSource("whatsapp")).toBe("whatsapp_chat");
});

test("diagnostics redact collected values without changing ordinary text", () => {
  const collectedFields = [
    { fieldKey: "customerName", value: "Phase Sixteen Widget Tester" },
    { fieldKey: "customerEmail", value: "phase16.widget@example.com" },
    { fieldKey: "guestPhone", value: "+919876543211" },
    {
      fieldKey: "issueDescription",
      value: "Unable to access the billing dashboard.",
    },
  ];

  expect(
    redactDiagnosticText("Phase Sixteen Widget Tester", collectedFields),
  ).toBe("[redacted name]");
  expect(
    redactDiagnosticText(
      "Name: Phase Sixteen Widget Tester; email: phase16.widget@example.com; phone: +919876543211",
      collectedFields,
    ),
  ).toBe(
    "Name: [redacted name]; email: [redacted email]; phone: [redacted phone]",
  );
  expect(
    redactDiagnosticText(
      "Unable to access the billing dashboard.",
      collectedFields,
    ),
  ).toBe("[redacted collected value]");
  expect(
    redactDiagnosticText("Please describe the issue.", collectedFields),
  ).toBe("Please describe the issue.");
});

test("diagnostics redact email and phone patterns not present in collected fields", () => {
  expect(
    redactDiagnosticText("Contact fallback@example.com or +1 (555) 192-3328."),
  ).toBe("Contact [redacted email] or [redacted phone].");
});

test("diagnostics preserve public option menus while redacting selected values", () => {
  const collectedFields = [
    { fieldKey: "issueCategory", value: "Billing" },
    { fieldKey: "issueCategoryName", value: "Billing" },
    { fieldKey: "priority", value: "Normal" },
    { fieldKey: "priorityName", value: "Normal" },
  ];
  const optionMenu = [
    "What kind of issue do you need help with?",
    "1. Billing",
    "2. Technical issue",
    "3. Account access",
    "4. Other",
  ].join("\n");

  expect(
    redactDiagnosticMessage(
      { direction: "outbound", messageType: "buttons", text: optionMenu },
      collectedFields,
    ),
  ).toBe(optionMenu);
  expect(
    redactDiagnosticMessage(
      { direction: "inbound", messageType: "selection", text: "Billing" },
      collectedFields,
    ),
  ).toBe("[redacted collected value]");
  expect(redactDiagnosticText("priority: Normal", collectedFields)).toBe(
    "priority: [redacted collected value]",
  );
});

test("diagnostics summarize validation, handoff, and cancellation events", () => {
  expect(
    summarizeDiagnosticEvents([
      { eventType: "flow.validation_failed" },
      { eventType: "flow.handoff_requested" },
      { eventType: "handoff.assigned" },
      { eventType: "flow.cancelled" },
      { eventType: "submission.created" },
    ]),
  ).toEqual({
    cancellations: 1,
    handoffs: 2,
    validationFailures: 1,
  });
});
