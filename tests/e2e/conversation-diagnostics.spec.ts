import { expect, test } from "@playwright/test";
import {
  getDiagnosticSubmissionSource,
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
