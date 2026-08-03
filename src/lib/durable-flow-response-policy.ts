import { getActionSubmission } from "@/lib/action-flows";
import { getActionResponsePolicyState } from "@/lib/action-response-policy";
import { processChannelFlowResponsePolicy } from "@/lib/channel-flow-runtime";
import { CHANNEL_TYPES, type ChannelType } from "@/lib/channels";
import { deliverDurableFlowReplies } from "@/lib/durable-flow-delivery";
import {
  claimNextDurableJob,
  completeDurableJob,
  failDurableJob,
} from "@/lib/durable-jobs";
import { getRuntimeProjectActionForSubmission } from "@/lib/runtime-actions";

type FlowResponsePolicyPayload = {
  actionVersionId: number | null;
  channelType: ChannelType;
  conversationId: string;
  expectedRevision: number;
  externalUserId: string | null;
  kind: "reminder" | "timeout";
  source: string;
  stepId: number;
};

function parsePayload(
  payload: Record<string, unknown>,
): FlowResponsePolicyPayload | null {
  const actionVersionId = payload.actionVersionId;
  const channelType = payload.channelType;
  const conversationId = payload.conversationId;
  const expectedRevision = payload.expectedRevision;
  const externalUserId = payload.externalUserId;
  const kind = payload.kind;
  const source = payload.source;
  const stepId = payload.stepId;

  if (
    (actionVersionId !== null &&
      (typeof actionVersionId !== "number" ||
        !Number.isInteger(actionVersionId) ||
        actionVersionId < 1)) ||
    typeof channelType !== "string" ||
    !CHANNEL_TYPES.includes(channelType as ChannelType) ||
    typeof conversationId !== "string" ||
    !conversationId.trim() ||
    typeof expectedRevision !== "number" ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0 ||
    (externalUserId !== null && typeof externalUserId !== "string") ||
    (kind !== "reminder" && kind !== "timeout") ||
    typeof source !== "string" ||
    !source.trim() ||
    typeof stepId !== "number" ||
    !Number.isInteger(stepId) ||
    stepId < 1
  ) {
    return null;
  }

  return {
    actionVersionId,
    channelType: channelType as ChannelType,
    conversationId,
    expectedRevision,
    externalUserId,
    kind,
    source,
    stepId,
  };
}

export async function processProjectFlowResponsePolicyQueue(input: {
  maxJobs?: number;
  projectId: number;
  workerId: string;
}) {
  const maxJobs = Math.max(1, Math.min(Math.trunc(input.maxJobs ?? 5), 25));
  let completed = 0;
  let failed = 0;
  let processed = 0;
  let rescheduled = 0;
  let skipped = 0;

  for (let index = 0; index < maxJobs; index += 1) {
    const job = await claimNextDurableJob({
      jobTypes: ["flow_response_policy"],
      projectId: input.projectId,
      workerId: input.workerId,
    });
    if (!job) {
      break;
    }

    processed += 1;
    const payload = parsePayload(job.payload);
    const submission = job.submissionId
      ? await getActionSubmission(input.projectId, job.submissionId)
      : null;

    if (!payload || !submission) {
      await failDurableJob({
        errorMessage: payload
          ? "Flow response-policy submission was not found."
          : "Flow response-policy job has an invalid payload.",
        jobId: job.id,
        permanent: true,
        projectId: input.projectId,
        workerId: input.workerId,
      });
      failed += 1;
      continue;
    }

    const state = getActionResponsePolicyState(submission.metadata);
    const staleReason =
      submission.status !== "in_progress"
        ? "submission_inactive"
        : submission.revision !== payload.expectedRevision
          ? "submission_changed"
          : submission.currentStepId !== payload.stepId
            ? "step_changed"
            : submission.actionVersionId !== payload.actionVersionId
              ? "version_changed"
              : !state ||
                  state.stepId !== payload.stepId ||
                  state.actionVersionId !== payload.actionVersionId
                ? "response_state_changed"
                : null;

    if (staleReason) {
      await completeDurableJob({
        jobId: job.id,
        projectId: input.projectId,
        result: { reason: staleReason, skipped: true },
        workerId: input.workerId,
      });
      completed += 1;
      skipped += 1;
      continue;
    }

    const action = await getRuntimeProjectActionForSubmission(
      input.projectId,
      submission,
    );
    if (!action) {
      await failDurableJob({
        errorMessage: "The pinned action version is no longer available.",
        jobId: job.id,
        permanent: true,
        projectId: input.projectId,
        workerId: input.workerId,
      });
      failed += 1;
      continue;
    }

    try {
      const result = await processChannelFlowResponsePolicy({
        action,
        kind: payload.kind,
        projectId: input.projectId,
        submission,
      });
      await deliverDurableFlowReplies({
        channelType: payload.channelType,
        conversationId: payload.conversationId,
        externalUserId: payload.externalUserId,
        projectId: input.projectId,
        replies: result.replies,
        traceId: job.traceId,
      });
      await completeDurableJob({
        jobId: job.id,
        projectId: input.projectId,
        result: {
          kind: payload.kind,
          submissionId: submission.id,
        },
        workerId: input.workerId,
      });
      completed += 1;
    } catch (error) {
      const failedJob = await failDurableJob({
        errorMessage:
          error instanceof Error
            ? error.message
            : "Flow response-policy execution failed.",
        jobId: job.id,
        projectId: input.projectId,
        workerId: input.workerId,
      });
      if (failedJob?.status === "failed") {
        failed += 1;
      } else {
        rescheduled += 1;
      }
    }
  }

  return {
    completed,
    failed,
    idle: processed === 0,
    processed,
    rescheduled,
    skipped,
  };
}
