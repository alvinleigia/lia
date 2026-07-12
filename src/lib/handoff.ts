import { addActionSubmissionEvent } from "@/lib/action-flows";
import {
  getActionStepHandoffConfig,
  type RuntimeAction,
  type RuntimeActionStep,
} from "@/lib/action-runtime";
import type { SelectActionSubmission } from "@/lib/db-schema";
import { runOperationForSubmission } from "@/lib/operations";

export function buildHandoffMetadata(input: {
  action: RuntimeAction;
  step: RuntimeActionStep;
  submission: SelectActionSubmission;
}) {
  const handoffConfig = getActionStepHandoffConfig(input.step);

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
  };
}

export async function runHandoffNotification(input: {
  action: RuntimeAction;
  fields: Record<string, unknown>;
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
      ...input.fields,
      handoffActionName: input.handoff.actionName,
      handoffPriority: input.handoff.priority,
      handoffQueue: input.handoff.queue,
      handoffRequestedAt: input.handoff.requestedAt,
      handoffSource: input.handoff.source,
      handoffStepLabel: input.handoff.stepLabel,
      handoffSubmissionId: input.submissionId,
    },
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
