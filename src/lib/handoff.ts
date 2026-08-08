import { addActionSubmissionEvent } from "@/lib/action-flows";
import {
  getActionStepHandoffConfig,
  type RuntimeAction,
  type RuntimeActionStep,
} from "@/lib/action-runtime";
import type { SelectActionSubmission } from "@/lib/db-schema";
import { runOperationForSubmission } from "@/lib/operations";

const HANDOFF_FIELD_LIMIT = 20;
const HANDOFF_KEY_LIMIT = 80;
const HANDOFF_STRING_LIMIT = 500;
const HANDOFF_ARRAY_LIMIT = 10;
const HANDOFF_OBJECT_LIMIT = 10;
const HANDOFF_VALUE_DEPTH_LIMIT = 2;
const SECRET_FIELD_PATTERN =
  /(?:authorization|password|secret|token|api[_-]?key)/i;

function boundHandoffValue(value: unknown, depth = 0): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return value.slice(0, HANDOFF_STRING_LIMIT);
  }

  if (depth >= HANDOFF_VALUE_DEPTH_LIMIT) {
    return null;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, HANDOFF_ARRAY_LIMIT)
      .map((item) => boundHandoffValue(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET_FIELD_PATTERN.test(key))
        .slice(0, HANDOFF_OBJECT_LIMIT)
        .map(([key, item]) => [
          key.slice(0, HANDOFF_KEY_LIMIT),
          boundHandoffValue(item, depth + 1),
        ]),
    );
  }

  return null;
}

export function buildBoundedHandoffContext(input: {
  actionId: number;
  actionName: string;
  fields: Record<string, unknown>;
  reason: string;
  stepId: number;
  stepLabel: string;
}) {
  const validatedFields = Object.fromEntries(
    Object.entries(input.fields)
      .filter(
        ([key]) => !key.startsWith("__") && !SECRET_FIELD_PATTERN.test(key),
      )
      .slice(0, HANDOFF_FIELD_LIMIT)
      .map(([key, value]) => [
        key.slice(0, HANDOFF_KEY_LIMIT),
        boundHandoffValue(value),
      ]),
  );

  return {
    intent: input.actionName.slice(0, 160),
    priorActions: [
      {
        actionId: input.actionId,
        actionName: input.actionName.slice(0, 160),
        stepId: input.stepId,
        stepLabel: input.stepLabel.slice(0, 160),
      },
    ],
    reason: input.reason.slice(0, 240),
    validatedFields,
  };
}

export function buildHandoffMetadata(input: {
  action: RuntimeAction;
  step: RuntimeActionStep;
  submission: SelectActionSubmission;
}) {
  const handoffConfig = getActionStepHandoffConfig(input.step);
  const context = buildBoundedHandoffContext({
    actionId: input.action.id,
    actionName: input.action.name,
    fields: input.submission.fields,
    reason: input.step.prompt || input.step.label || "Human support requested.",
    stepId: input.step.id,
    stepLabel: input.step.label || "Human handoff",
  });

  return {
    actionId: input.action.id,
    actionName: input.action.name,
    notifyTeam: handoffConfig.notifyTeam,
    notificationOperationId: input.step.operationId,
    priority: handoffConfig.priority,
    queue: handoffConfig.queue,
    requestedAt: new Date().toISOString(),
    source: input.submission.source,
    stepId: input.step.id,
    stepLabel: input.step.label,
    context,
  };
}

export async function runHandoffNotification(input: {
  action: RuntimeAction;
  handoff: ReturnType<typeof buildHandoffMetadata>;
  projectId: number;
  step: RuntimeActionStep;
  submissionId: number;
}) {
  if (!input.handoff.notifyTeam || !input.step.operationId) {
    return null;
  }

  const result = await runOperationForSubmission({
    actionId: input.action.id,
    fields: {
      ...input.handoff.context.validatedFields,
      handoffActionName: input.handoff.actionName,
      handoffPriority: input.handoff.priority,
      handoffQueue: input.handoff.queue,
      handoffRequestedAt: input.handoff.requestedAt,
      handoffSource: input.handoff.source,
      handoffStepLabel: input.handoff.stepLabel,
      handoffSubmissionId: input.submissionId,
      handoffContext: input.handoff.context,
    },
    idempotencyKey: `submission:${input.submissionId}:handoff:${input.step.id}`,
    operationId: input.step.operationId,
    projectId: input.projectId,
    submissionId: input.submissionId,
  });

  await addActionSubmissionEvent({
    eventType: result
      ? "flow.handoff_notification_sent"
      : "flow.handoff_notification_skipped",
    message: result
      ? "Handoff notification operation ran."
      : "Handoff notification operation was unavailable.",
    payload: {
      attemptId: result?.attempt.id ?? null,
      operationId: input.step.operationId,
      status: result?.attempt.status ?? "skipped",
    },
    projectId: input.projectId,
    submissionId: input.submissionId,
  });

  return result;
}
