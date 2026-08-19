import { expect, test } from "@playwright/test";
import {
  collectDiagnosticPublicChoiceValues,
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
    { fieldKey: "customerAddress", value: "12 Test Street" },
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
  expect(redactDiagnosticText("12 Test Street", collectedFields)).toBe(
    "[redacted address]",
  );
});

test("diagnostics redact email and phone patterns not present in collected fields", () => {
  expect(
    redactDiagnosticText("Contact fallback@example.com or +1 (555) 192-3328."),
  ).toBe("Contact [redacted email] or [redacted phone].");
});

test("diagnostics preserve configured selections while redacting free text", () => {
  const collectedFields = [
    { fieldKey: "issueCategory", value: "Billing" },
    { fieldKey: "issueCategoryName", value: "Billing" },
    { fieldKey: "priority", value: "Normal" },
    { fieldKey: "priorityName", value: "Normal" },
    {
      fieldKey: "issueDescription",
      value: "Unable to access the billing dashboard.",
    },
  ];
  const optionMenu = [
    "What kind of issue do you need help with?",
    "1. Billing",
    "2. Technical issue",
    "3. Account access",
    "4. Other",
  ].join("\n");
  const priorityMenu = [
    "How urgent is this?",
    "1. Low",
    "2. Normal",
    "3. High",
  ].join("\n");
  const publicChoiceValues = collectDiagnosticPublicChoiceValues([
    { direction: "outbound", messageType: "buttons", text: optionMenu },
    { direction: "outbound", messageType: "buttons", text: priorityMenu },
  ]);

  expect(
    redactDiagnosticMessage(
      { direction: "outbound", messageType: "buttons", text: optionMenu },
      collectedFields,
      publicChoiceValues,
    ),
  ).toBe(optionMenu);
  expect(
    redactDiagnosticMessage(
      { direction: "inbound", messageType: "selection", text: "Billing" },
      collectedFields,
      publicChoiceValues,
    ),
  ).toBe("Billing");
  expect(
    redactDiagnosticText(
      "priority: Normal; issueCategory: Billing; issueDescription: Unable to access the billing dashboard.",
      collectedFields,
      publicChoiceValues,
    ),
  ).toBe(
    "priority: Normal; issueCategory: Billing; issueDescription: [redacted collected value]",
  );
});

test("diagnostics never expose a sensitive field that matches a public choice", () => {
  const publicChoiceValues = new Set(["normal"]);

  expect(
    redactDiagnosticText(
      "Normal",
      [{ fieldKey: "customerName", value: "Normal" }],
      publicChoiceValues,
    ),
  ).toBe("[redacted name]");
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
