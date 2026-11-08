import { expect, test } from "@playwright/test";
import {
  detectConversationQuality,
  qualityNextStep,
} from "../../src/lib/conversation-quality";
import {
  ConversationRecovery,
  getRecoveryFailure,
  recoveryReportSchema,
} from "../../src/lib/conversation-recovery";

test("repair, fallback and refresh share a bounded recovery budget", () => {
  const recovery = new ConversationRecovery({ maxAutomaticSteps: 2 });
  expect(recovery.plan("invalid_output", { canRepair: true }).action).toBe(
    "repair_output",
  );
  expect(recovery.plan("output_limit", { hasFallback: true }).action).toBe(
    "fallback_model",
  );
  expect(recovery.plan("missing_evidence", { canRetry: true })).toMatchObject({
    action: "clarify",
    automatic: false,
    reason: "limit_reached",
  });
  expect(recovery.report("review_required")).toMatchObject({
    validated: false,
    automaticSteps: 2,
    outcome: "review_required",
  });
});

for (const failure of [
  "safety",
  "budget",
  "configuration",
  "deadline",
] as const)
  test(`${failure} never causes an automatic retry`, () => {
    const recovery = new ConversationRecovery({ maxAutomaticSteps: 3 });
    expect(
      recovery.plan(failure, {
        canRepair: true,
        canRetry: true,
        hasFallback: true,
      }).automatic,
    ).toBe(false);
    expect(recovery.report("recovered")?.validated).toBe(false);
  });

test("unknown writes require reconciliation unless an adapter guarantees protected replay", () => {
  const recovery = new ConversationRecovery({ maxAutomaticSteps: 1 });
  expect(recovery.plan("unknown_operation", { canRetry: true })).toMatchObject({
    action: "reconcile_operation",
    automatic: false,
  });
  expect(
    recovery.plan("unknown_operation", { canRetry: true, protectedWrite: true })
      .action,
  ).toBe("retry_operation");
  expect(
    recovery.plan("unknown_operation", { canRetry: true, protectedWrite: true })
      .action,
  ).toBe("reconcile_operation");
});

test("state recovery selects reload, never replay of the visitor's stale command", () => {
  const recovery = new ConversationRecovery({ maxAutomaticSteps: 1 });
  expect(recovery.plan("state_conflict", { canRetry: true }).action).toBe(
    "reload_state",
  );
  expect(recovery.plan("state_conflict", { canRetry: true }).automatic).toBe(
    false,
  );
});

test("read recovery respects the shared deadline", async () => {
  const recovery = new ConversationRecovery({
    maxAutomaticSteps: 1,
    deadlineAt: Date.now() + 15,
  });
  await expect(
    recovery.read(() => new Promise<never>(() => {})),
  ).rejects.toThrow("Turn deadline exceeded");
  expect(
    recovery.plan("retrieval_unavailable", { canRetry: true }).automatic,
  ).toBe(false);
});

test("provider diagnosis follows nested status codes without storing exception contents", () => {
  expect(
    getRecoveryFailure(
      { cause: { statusCode: 401, message: "secret" } },
      "model",
    ),
  ).toBe("configuration");
  expect(getRecoveryFailure({ statusCode: 503 }, "model")).toBe(
    "provider_transient",
  );
  expect(getRecoveryFailure(new Error("secret"), "retrieval")).toBe(
    "retrieval_unavailable",
  );
  expect(getRecoveryFailure({ code: "insufficient_quota" }, "model")).toBe(
    "budget",
  );
});

test("operational reports strip arbitrary data and flag exhausted recovery for review", () => {
  const recovery = new ConversationRecovery({ maxAutomaticSteps: 0 });
  recovery.plan("provider_transient");
  const report = recovery.report("clarification_required");
  if (!report) throw new Error("Missing recovery report");
  expect(report.outcome).toBe("review_required");
  const safe = recoveryReportSchema.parse({
    ...report,
    prompt: "secret",
    decisions: report.decisions.map((decision) => ({
      ...decision,
      customerEmail: "private@example.test",
    })),
  });
  expect(JSON.stringify(safe)).not.toMatch(/secret|private@example/);
  const flags = detectConversationQuality({
    messages: [],
    lastMessageAt: null,
    activeTask: true,
    recoveryFailures: 1,
  });
  expect(flags[0].code).toBe("recovery_review");
  expect(qualityNextStep(flags[0].code)).toContain("Reconcile");
});
