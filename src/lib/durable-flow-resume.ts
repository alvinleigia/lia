import { getActionSubmission } from "@/lib/action-flows";
import { runBrowserFlowText } from "@/lib/browser-flow-runtime";
import { CHANNEL_TYPES, type ChannelType } from "@/lib/channels";
import {
  claimNextDurableJob,
  completeDurableJob,
  failDurableJob,
} from "@/lib/durable-jobs";

type FlowResumePayload = {
  channelType: ChannelType;
  conversationId: string;
  expectedRevision: number;
  externalUserId: string | null;
  source: string;
};

function parseFlowResumePayload(
  payload: Record<string, unknown>,
): FlowResumePayload | null {
  const channelType = payload.channelType;
  const conversationId = payload.conversationId;
  const expectedRevision = payload.expectedRevision;
  const externalUserId = payload.externalUserId;
  const source = payload.source;

  if (
    typeof channelType !== "string" ||
    !CHANNEL_TYPES.includes(channelType as ChannelType) ||
    typeof conversationId !== "string" ||
    !conversationId.trim() ||
    typeof expectedRevision !== "number" ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0 ||
    (externalUserId !== null && typeof externalUserId !== "string") ||
    typeof source !== "string" ||
    !source.trim()
  ) {
    return null;
  }

  return {
    channelType: channelType as ChannelType,
    conversationId,
    expectedRevision,
    externalUserId,
    source,
  };
}

export async function processProjectFlowResumeQueue(input: {
  maxJobs?: number;
  projectId: number;
  workerId: string;
}) {
  const maxJobs = Math.max(1, Math.min(Math.trunc(input.maxJobs ?? 5), 25));
  let completed = 0;
  let failed = 0;
  let processed = 0;
  let rescheduled = 0;

  for (let index = 0; index < maxJobs; index += 1) {
    const job = await claimNextDurableJob({
      jobTypes: ["flow_resume"],
      projectId: input.projectId,
      workerId: input.workerId,
    });

    if (!job) {
      break;
    }

    processed += 1;
    const payload = parseFlowResumePayload(job.payload);
    const submission = job.submissionId
      ? await getActionSubmission(input.projectId, job.submissionId)
      : null;
    const permanentError = !payload
      ? "Flow resume job has an invalid payload."
      : !submission
        ? "Flow resume submission was not found."
        : submission.status !== "in_progress"
          ? "Flow resume submission is no longer active."
          : submission.revision !== payload.expectedRevision
            ? "Flow resume job is stale because the submission changed."
            : null;

    if (permanentError) {
      await failDurableJob({
        errorMessage: permanentError,
        jobId: job.id,
        permanent: true,
        projectId: input.projectId,
        workerId: input.workerId,
      });
      failed += 1;
      continue;
    }

    if (!payload || !submission) {
      continue;
    }

    try {
      const result = await runBrowserFlowText({
        channelType: payload.channelType,
        conversationId: payload.conversationId,
        expectedRevision: payload.expectedRevision,
        externalUserId: payload.externalUserId,
        projectId: input.projectId,
        resume: true,
        resumeExecution: true,
        source: payload.source,
        traceId: job.traceId,
      });
      await completeDurableJob({
        jobId: job.id,
        projectId: input.projectId,
        result: {
          handled: result.handled,
          submissionId: job.submissionId,
        },
        workerId: input.workerId,
      });
      completed += 1;
    } catch (error) {
      const failedJob = await failDurableJob({
        errorMessage:
          error instanceof Error ? error.message : "Flow resume failed.",
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
  };
}
