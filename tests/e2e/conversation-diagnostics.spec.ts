import { expect, test } from "@playwright/test";
import {
  getDiagnosticSubmissionSource,
  summarizeDiagnosticEvents,
} from "../../src/lib/conversation-diagnostics";

test("diagnostics map channel conversations to their submission source", () => {
  expect(getDiagnosticSubmissionSource("project_chat")).toBe("project_chat");
  expect(getDiagnosticSubmissionSource("widget")).toBe("widget_chat");
  expect(getDiagnosticSubmissionSource("whatsapp")).toBe("whatsapp_chat");
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
