import { expect, test } from "@playwright/test";
import { aggregatePhase17Analytics } from "../../src/lib/phase17-analytics";

test("aggregates lifecycle, model, field, route, and tool telemetry", () => {
  const analytics = aggregatePhase17Analytics({
    actions: [{ id: 1, name: "Support request" }],
    actionVersions: [{ id: 11, actionId: 1, versionNumber: 2 }],
    submissions: [
      {
        id: 21,
        actionId: 1,
        actionVersionId: 11,
        source: "project_chat",
        status: "completed",
      },
      {
        id: 22,
        actionId: 1,
        actionVersionId: 11,
        source: "widget_chat",
        status: "cancelled",
      },
    ],
    submissionEvents: [
      {
        submissionId: 21,
        eventType: "flow.validation_failed",
        payload: { fieldKey: "email" },
      },
      {
        submissionId: 21,
        eventType: "field.collected",
        payload: { fieldKey: "email" },
      },
      {
        submissionId: 21,
        eventType: "flow.handoff_requested",
        payload: {},
      },
      {
        submissionId: 21,
        eventType: "flow.branch_decision",
        payload: { sourceStepId: 7, targetStepId: 9 },
      },
    ],
    tasks: [{ id: 2, name: "Book service" }],
    taskVersions: [{ id: 12, taskId: 2, versionNumber: 3 }],
    taskRuns: [
      {
        id: 31,
        conversationId: 41,
        taskId: 2,
        taskVersionId: 12,
        status: "completed",
      },
    ],
    taskFields: [{ fieldKey: "email", state: "confirmed", attemptCount: 2 }],
    conversations: [{ id: 41, channelType: "whatsapp_chat" }],
    turnAudits: [
      {
        action: "structured_turn.decided",
        metadata: {
          schemaVersion: 2,
          source: "model",
          attempts: 2,
          latencyMs: 500,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          estimatedCostUnits: 180,
          safetyDecision: "block",
          groundingStatus: "grounded",
          turnKind: "field_correction",
          hasToolRequest: true,
        },
      },
      {
        action: "unrelated.audit",
        metadata: { source: "model", attempts: 99 },
      },
      {
        action: "structured_turn.decided",
        metadata: {
          schemaVersion: 2,
          source: "deterministic",
          attempts: 0,
          safetyDecision: "allow",
          groundingStatus: "not_required",
          turnKind: "field_value",
          hasToolRequest: false,
        },
      },
    ],
    toolRequests: [
      { toolId: "lookup:availability", status: "success", errorCode: null },
      { toolId: "lookup:availability", status: "failed", errorCode: "timeout" },
    ],
    attempts: [
      { operationId: 1, status: "completed" },
      { operationId: 1, status: "failed" },
    ],
  });

  expect(analytics.lifecycle).toMatchObject({
    starts: 3,
    completed: 2,
    cancelled: 1,
    corrections: 1,
    retriedFields: 1,
    validationFailures: 1,
    handoffs: 1,
    successfulOperations: 1,
    failedOperations: 1,
  });
  expect(analytics.lifecycle.completionRate).toBeCloseTo(66.67, 1);
  expect(analytics.model).toMatchObject({
    structuredTurns: 2,
    modelTurns: 1,
    deterministicTurns: 1,
    modelAttempts: 2,
    modelTurnRate: 50,
    deterministicAvoidanceRate: 50,
    attemptsPerModelTurn: 2,
    attemptsPerCompletion: 1,
    multiAttemptTurns: 1,
    multiAttemptRate: 100,
    averageLatencyMs: 500,
    totalTokens: 120,
    estimatedCostUnits: 180,
    safetyBlocks: 1,
    groundedTurns: 1,
    toolRecommendations: 1,
  });
  expect(analytics.byTask).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: "Support request", starts: 2 }),
      expect.objectContaining({ label: "Book service", starts: 1 }),
    ]),
  );
  expect(analytics.byVersion.map((row) => row.label)).toEqual(
    expect.arrayContaining(["Support request - v2", "Book service - v3"]),
  );
  expect(analytics.fields).toContainEqual({
    fieldKey: "email",
    collected: 2,
    validationFailures: 1,
    retried: 1,
  });
  expect(analytics.routes).toContainEqual({
    route: "Support request: 7 -> 9",
    count: 1,
  });
  expect(analytics.tools).toContainEqual({
    toolId: "lookup:availability",
    requested: 2,
    succeeded: 1,
    failed: 1,
  });
});
