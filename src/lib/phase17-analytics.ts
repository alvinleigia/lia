import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db-config";
import {
  actionFlowVersions,
  actionSubmissionEvents,
  actionSubmissions,
  auditLogs,
  channelConversations,
  conversationalTaskFieldValues,
  conversationalTaskRuns,
  conversationalTasks,
  conversationalTaskToolRequests,
  conversationalTaskVersions,
  operationAttempts,
  projectActions,
} from "@/lib/db-schema";

type CountRow = {
  key: string;
  label: string;
  starts: number;
  completed: number;
  cancelled: number;
};

export type Phase17AnalyticsWindow = {
  since: Date;
  until?: Date;
};

export type Phase17AnalyticsInput = {
  actions: Array<{ id: number; name: string }>;
  actionVersions: Array<{
    id: number;
    actionId: number;
    versionNumber: number;
  }>;
  submissions: Array<{
    id: number;
    actionId: number;
    actionVersionId: number | null;
    source: string;
    status: string;
  }>;
  submissionEvents: Array<{
    submissionId: number;
    eventType: string;
    payload: Record<string, unknown>;
  }>;
  tasks: Array<{ id: number; name: string }>;
  taskVersions: Array<{
    id: number;
    taskId: number;
    versionNumber: number;
  }>;
  taskRuns: Array<{
    id: number;
    conversationId: number;
    taskId: number;
    taskVersionId: number;
    status: string;
  }>;
  taskFields: Array<{
    fieldKey: string;
    state: string;
    attemptCount: number;
  }>;
  conversations: Array<{ id: number; channelType: string }>;
  turnAudits: Array<{ action: string; metadata: Record<string, unknown> }>;
  toolRequests: Array<{
    toolId: string;
    status: string;
    errorCode: string | null;
  }>;
  attempts: Array<{ status: string; operationId: number }>;
};

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asLabel(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function increment(map: Map<string, number>, key: string, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function cleanTelemetryLabel(value: string) {
  return value.replace("\u00c2\u00b7", "-").replace("\u00e2\u2020\u2019", "->");
}

function lifecycleRows(
  labels: Map<string, string>,
  starts: Map<string, number>,
  completed: Map<string, number>,
  cancelled: Map<string, number>,
): CountRow[] {
  return [...labels.entries()]
    .map(([key, label]) => ({
      key,
      label: cleanTelemetryLabel(label),
      starts: starts.get(key) ?? 0,
      completed: completed.get(key) ?? 0,
      cancelled: cancelled.get(key) ?? 0,
    }))
    .filter((row) => row.starts > 0)
    .sort((a, b) => b.starts - a.starts || a.label.localeCompare(b.label));
}

export function aggregatePhase17Analytics(input: Phase17AnalyticsInput) {
  const successfulStatuses = new Set(["completed", "submitted", "success"]);
  const cancelledStatuses = new Set(["abandoned", "cancelled", "rejected"]);
  const actionNames = new Map(input.actions.map((row) => [row.id, row.name]));
  const taskNames = new Map(input.tasks.map((row) => [row.id, row.name]));
  const actionVersionsById = new Map(
    input.actionVersions.map((row) => [row.id, row]),
  );
  const taskVersionsById = new Map(
    input.taskVersions.map((row) => [row.id, row]),
  );
  const conversationsById = new Map(
    input.conversations.map((row) => [row.id, row]),
  );
  const submissionsById = new Map(
    input.submissions.map((row) => [row.id, row]),
  );

  const taskLabels = new Map<string, string>();
  const taskStarts = new Map<string, number>();
  const taskCompleted = new Map<string, number>();
  const taskCancelled = new Map<string, number>();
  const channelLabels = new Map<string, string>();
  const channelStarts = new Map<string, number>();
  const channelCompleted = new Map<string, number>();
  const channelCancelled = new Map<string, number>();
  const versionLabels = new Map<string, string>();
  const versionStarts = new Map<string, number>();
  const versionCompleted = new Map<string, number>();
  const versionCancelled = new Map<string, number>();

  for (const submission of input.submissions) {
    const taskKey = `action:${submission.actionId}`;
    const taskLabel = actionNames.get(submission.actionId) ?? taskKey;
    taskLabels.set(taskKey, taskLabel);
    increment(taskStarts, taskKey);

    const channelKey = submission.source || "unknown";
    channelLabels.set(channelKey, channelKey.replaceAll("_", " "));
    increment(channelStarts, channelKey);

    const version = submission.actionVersionId
      ? actionVersionsById.get(submission.actionVersionId)
      : undefined;
    const versionKey = version
      ? `${taskKey}:v${version.versionNumber}`
      : `${taskKey}:unversioned`;
    versionLabels.set(
      versionKey,
      `${taskLabel} - ${version ? `v${version.versionNumber}` : "unversioned"}`,
    );
    increment(versionStarts, versionKey);

    if (successfulStatuses.has(submission.status)) {
      increment(taskCompleted, taskKey);
      increment(channelCompleted, channelKey);
      increment(versionCompleted, versionKey);
    }
    if (cancelledStatuses.has(submission.status)) {
      increment(taskCancelled, taskKey);
      increment(channelCancelled, channelKey);
      increment(versionCancelled, versionKey);
    }
  }

  for (const run of input.taskRuns) {
    const taskKey = `task:${run.taskId}`;
    const taskLabel = taskNames.get(run.taskId) ?? taskKey;
    taskLabels.set(taskKey, taskLabel);
    increment(taskStarts, taskKey);

    const channelKey =
      conversationsById.get(run.conversationId)?.channelType ?? "unknown";
    channelLabels.set(channelKey, channelKey.replaceAll("_", " "));
    increment(channelStarts, channelKey);

    const version = taskVersionsById.get(run.taskVersionId);
    const versionKey = version
      ? `${taskKey}:v${version.versionNumber}`
      : `${taskKey}:unversioned`;
    versionLabels.set(
      versionKey,
      `${taskLabel} - ${version ? `v${version.versionNumber}` : "unversioned"}`,
    );
    increment(versionStarts, versionKey);

    if (successfulStatuses.has(run.status)) {
      increment(taskCompleted, taskKey);
      increment(channelCompleted, channelKey);
      increment(versionCompleted, versionKey);
    }
    if (cancelledStatuses.has(run.status)) {
      increment(taskCancelled, taskKey);
      increment(channelCancelled, channelKey);
      increment(versionCancelled, versionKey);
    }
  }

  const fieldActivity = new Map<
    string,
    { collected: number; validationFailures: number; retried: number }
  >();
  const routeActivity = new Map<string, number>();
  let validationFailures = 0;
  let handoffs = 0;

  for (const event of input.submissionEvents) {
    if (event.eventType === "flow.validation_failed") {
      validationFailures += 1;
      const fieldKey = asString(event.payload.fieldKey) || "unknown field";
      const current = fieldActivity.get(fieldKey) ?? {
        collected: 0,
        validationFailures: 0,
        retried: 0,
      };
      current.validationFailures += 1;
      fieldActivity.set(fieldKey, current);
    }
    if (event.eventType === "field.collected") {
      const fieldKey = asString(event.payload.fieldKey) || "unknown field";
      const current = fieldActivity.get(fieldKey) ?? {
        collected: 0,
        validationFailures: 0,
        retried: 0,
      };
      current.collected += 1;
      fieldActivity.set(fieldKey, current);
    }
    if (event.eventType === "flow.handoff_requested") handoffs += 1;
    if (event.eventType === "flow.branch_decision") {
      const submission = submissionsById.get(event.submissionId);
      const actionLabel = submission
        ? (actionNames.get(submission.actionId) ??
          `Action ${submission.actionId}`)
        : "Unknown action";
      const source =
        asLabel(event.payload.sourceStepId) ||
        asLabel(event.payload.stepId) ||
        "entry";
      const target =
        asLabel(event.payload.targetStepId) ||
        asLabel(event.payload.targetStep) ||
        "finish";
      increment(routeActivity, `${actionLabel}: ${source} -> ${target}`);
    }
  }

  let retriedFields = 0;
  for (const field of input.taskFields) {
    const current = fieldActivity.get(field.fieldKey) ?? {
      collected: 0,
      validationFailures: 0,
      retried: 0,
    };
    if (field.state === "confirmed" || field.state === "valid") {
      current.collected += 1;
    }
    if (field.attemptCount > 1) {
      current.retried += 1;
      retriedFields += 1;
    }
    fieldActivity.set(field.fieldKey, current);
  }

  let modelTurns = 0;
  let deterministicTurns = 0;
  let modelAttempts = 0;
  let multiAttemptTurns = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let estimatedCostUnits = 0;
  let latencyMs = 0;
  let safetyBlocks = 0;
  let groundedTurns = 0;
  let corrections = 0;
  let toolRecommendations = 0;
  const modelEscalations = new Map<string, number>();

  for (const audit of input.turnAudits) {
    if (audit.action !== "structured_turn.decided") continue;
    const metadata = audit.metadata;
    const source = asString(metadata.source);
    const attempts = asNumber(metadata.attempts);
    const modelWasAttempted = source === "model" || attempts > 0;
    if (modelWasAttempted) {
      modelTurns += 1;
      modelAttempts += attempts;
      latencyMs += asNumber(metadata.latencyMs);
      inputTokens += asNumber(metadata.inputTokens);
      outputTokens += asNumber(metadata.outputTokens);
      totalTokens += asNumber(metadata.totalTokens);
      estimatedCostUnits += asNumber(metadata.estimatedCostUnits);
      if (attempts > 1) multiAttemptTurns += 1;
      increment(
        modelEscalations,
        asString(metadata.modelEscalationReason) || "legacy_unspecified",
      );
    } else if (source === "deterministic") {
      deterministicTurns += 1;
    }
    if (metadata.safetyDecision === "block") safetyBlocks += 1;
    if (metadata.groundingStatus === "grounded") groundedTurns += 1;
    if (metadata.turnKind === "field_correction") corrections += 1;
    if (metadata.hasToolRequest === true) toolRecommendations += 1;
  }

  const toolActivity = new Map<
    string,
    { requested: number; succeeded: number; failed: number }
  >();
  for (const request of input.toolRequests) {
    const current = toolActivity.get(request.toolId) ?? {
      requested: 0,
      succeeded: 0,
      failed: 0,
    };
    current.requested += 1;
    if (successfulStatuses.has(request.status)) current.succeeded += 1;
    if (
      request.errorCode ||
      ["failed", "error", "timeout"].includes(request.status)
    ) {
      current.failed += 1;
    }
    toolActivity.set(request.toolId, current);
  }

  let successfulOperations = 0;
  let failedOperations = 0;
  for (const attempt of input.attempts) {
    if (successfulStatuses.has(attempt.status)) successfulOperations += 1;
    if (["failed", "error", "timeout"].includes(attempt.status)) {
      failedOperations += 1;
    }
  }

  const totalStarts = input.submissions.length + input.taskRuns.length;
  const completed =
    input.submissions.filter((row) => successfulStatuses.has(row.status))
      .length +
    input.taskRuns.filter((row) => successfulStatuses.has(row.status)).length;
  const cancelled =
    input.submissions.filter((row) => cancelledStatuses.has(row.status))
      .length +
    input.taskRuns.filter((row) => cancelledStatuses.has(row.status)).length;
  const structuredTurns = modelTurns + deterministicTurns;

  return {
    lifecycle: {
      starts: totalStarts,
      completed,
      cancelled,
      completionRate: totalStarts === 0 ? 0 : (completed / totalStarts) * 100,
      cancellationRate: totalStarts === 0 ? 0 : (cancelled / totalStarts) * 100,
      corrections,
      retriedFields,
      validationFailures,
      handoffs,
      successfulOperations,
      failedOperations,
    },
    model: {
      structuredTurns,
      modelTurns,
      deterministicTurns,
      modelAttempts,
      modelTurnRate:
        structuredTurns === 0 ? 0 : (modelTurns / structuredTurns) * 100,
      deterministicAvoidanceRate:
        structuredTurns === 0
          ? 0
          : (deterministicTurns / structuredTurns) * 100,
      attemptsPerModelTurn: modelTurns === 0 ? 0 : modelAttempts / modelTurns,
      attemptsPerCompletion: completed === 0 ? 0 : modelAttempts / completed,
      multiAttemptTurns,
      multiAttemptRate:
        modelTurns === 0 ? 0 : (multiAttemptTurns / modelTurns) * 100,
      averageLatencyMs: modelTurns === 0 ? 0 : latencyMs / modelTurns,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUnits,
      safetyBlocks,
      groundedTurns,
      toolRecommendations,
    },
    byTask: lifecycleRows(taskLabels, taskStarts, taskCompleted, taskCancelled),
    byChannel: lifecycleRows(
      channelLabels,
      channelStarts,
      channelCompleted,
      channelCancelled,
    ),
    byVersion: lifecycleRows(
      versionLabels,
      versionStarts,
      versionCompleted,
      versionCancelled,
    ),
    fields: [...fieldActivity.entries()]
      .map(([fieldKey, metrics]) => ({ fieldKey, ...metrics }))
      .sort(
        (a, b) =>
          b.validationFailures - a.validationFailures ||
          b.retried - a.retried ||
          a.fieldKey.localeCompare(b.fieldKey),
      ),
    routes: [...routeActivity.entries()]
      .map(([route, count]) => ({ route: cleanTelemetryLabel(route), count }))
      .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route)),
    tools: [...toolActivity.entries()]
      .map(([toolId, metrics]) => ({ toolId, ...metrics }))
      .sort(
        (a, b) => b.requested - a.requested || a.toolId.localeCompare(b.toolId),
      ),
    modelEscalations: [...modelEscalations.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };
}

export async function getPhase17ProjectAnalytics(
  projectId: number,
  window?: Phase17AnalyticsWindow,
) {
  const [
    actions,
    actionVersions,
    submissions,
    submissionEvents,
    tasks,
    taskVersions,
    taskRuns,
    taskFields,
    conversations,
    turnAudits,
    toolRequests,
    attempts,
  ] = await Promise.all([
    db
      .select({ id: projectActions.id, name: projectActions.name })
      .from(projectActions)
      .where(eq(projectActions.projectId, projectId)),
    db
      .select({
        id: actionFlowVersions.id,
        actionId: actionFlowVersions.actionId,
        versionNumber: actionFlowVersions.versionNumber,
      })
      .from(actionFlowVersions)
      .where(eq(actionFlowVersions.projectId, projectId)),
    db
      .select({
        id: actionSubmissions.id,
        actionId: actionSubmissions.actionId,
        actionVersionId: actionSubmissions.actionVersionId,
        source: actionSubmissions.source,
        status: actionSubmissions.status,
      })
      .from(actionSubmissions)
      .where(
        and(
          eq(actionSubmissions.projectId, projectId),
          window ? gte(actionSubmissions.createdAt, window.since) : undefined,
          window?.until
            ? lte(actionSubmissions.createdAt, window.until)
            : undefined,
        ),
      ),
    db
      .select({
        submissionId: actionSubmissionEvents.submissionId,
        eventType: actionSubmissionEvents.eventType,
        payload: actionSubmissionEvents.payload,
      })
      .from(actionSubmissionEvents)
      .where(
        and(
          eq(actionSubmissionEvents.projectId, projectId),
          window
            ? gte(actionSubmissionEvents.createdAt, window.since)
            : undefined,
          window?.until
            ? lte(actionSubmissionEvents.createdAt, window.until)
            : undefined,
        ),
      ),
    db
      .select({ id: conversationalTasks.id, name: conversationalTasks.name })
      .from(conversationalTasks)
      .where(eq(conversationalTasks.projectId, projectId)),
    db
      .select({
        id: conversationalTaskVersions.id,
        taskId: conversationalTaskVersions.taskId,
        versionNumber: conversationalTaskVersions.versionNumber,
      })
      .from(conversationalTaskVersions)
      .where(eq(conversationalTaskVersions.projectId, projectId)),
    db
      .select({
        id: conversationalTaskRuns.id,
        conversationId: conversationalTaskRuns.conversationId,
        taskId: conversationalTaskRuns.taskId,
        taskVersionId: conversationalTaskRuns.taskVersionId,
        status: conversationalTaskRuns.status,
      })
      .from(conversationalTaskRuns)
      .where(
        and(
          eq(conversationalTaskRuns.projectId, projectId),
          window
            ? gte(conversationalTaskRuns.startedAt, window.since)
            : undefined,
          window?.until
            ? lte(conversationalTaskRuns.startedAt, window.until)
            : undefined,
        ),
      ),
    db
      .select({
        fieldKey: conversationalTaskFieldValues.fieldKey,
        state: conversationalTaskFieldValues.state,
        attemptCount: conversationalTaskFieldValues.attemptCount,
      })
      .from(conversationalTaskFieldValues)
      .where(
        and(
          eq(conversationalTaskFieldValues.projectId, projectId),
          window
            ? gte(conversationalTaskFieldValues.updatedAt, window.since)
            : undefined,
          window?.until
            ? lte(conversationalTaskFieldValues.updatedAt, window.until)
            : undefined,
        ),
      ),
    db
      .select({
        id: channelConversations.id,
        channelType: channelConversations.channelType,
      })
      .from(channelConversations)
      .where(eq(channelConversations.projectId, projectId)),
    db
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.projectId, projectId),
          window ? gte(auditLogs.createdAt, window.since) : undefined,
          window?.until ? lte(auditLogs.createdAt, window.until) : undefined,
        ),
      ),
    db
      .select({
        toolId: conversationalTaskToolRequests.toolId,
        status: conversationalTaskToolRequests.status,
        errorCode: conversationalTaskToolRequests.errorCode,
      })
      .from(conversationalTaskToolRequests)
      .where(
        and(
          eq(conversationalTaskToolRequests.projectId, projectId),
          window
            ? gte(conversationalTaskToolRequests.requestedAt, window.since)
            : undefined,
          window?.until
            ? lte(conversationalTaskToolRequests.requestedAt, window.until)
            : undefined,
        ),
      ),
    db
      .select({
        status: operationAttempts.status,
        operationId: operationAttempts.operationId,
      })
      .from(operationAttempts)
      .where(
        and(
          eq(operationAttempts.projectId, projectId),
          window ? gte(operationAttempts.createdAt, window.since) : undefined,
          window?.until
            ? lte(operationAttempts.createdAt, window.until)
            : undefined,
        ),
      ),
  ]);

  return aggregatePhase17Analytics({
    actions,
    actionVersions,
    submissions,
    submissionEvents,
    tasks,
    taskVersions,
    taskRuns,
    taskFields,
    conversations,
    turnAudits: turnAudits.filter(
      (row) =>
        row.action === "structured_turn.decided" &&
        row.metadata.schemaVersion === 2 &&
        (row.metadata.source === "model" ||
          row.metadata.source === "deterministic"),
    ),
    toolRequests,
    attempts,
  });
}
