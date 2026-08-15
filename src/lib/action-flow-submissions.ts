import { and, eq, inArray, sql } from "drizzle-orm";
import {
  addActionSubmissionEvent,
  createActionSubmission,
  getActionSubmission,
  updateActionSubmission,
} from "@/lib/action-flows";
import {
  ACTION_RESPONSE_POLICY_STATE_METADATA_KEY,
  type ActionResponsePolicyState,
} from "@/lib/action-response-policy";
import { isRunnableActionStep } from "@/lib/action-runtime";
import { db } from "@/lib/db-config";
import {
  actionSubmissionEvents,
  actionSubmissions,
  durableJobs,
} from "@/lib/db-schema";
import { resolveTraceId } from "@/lib/execution-trace";
import { runSubmissionOperations } from "@/lib/operations";
import { getRuntimeProjectAction } from "@/lib/runtime-actions";

export const FLOW_WAIT_METADATA_KEY = "flowWait";

type StartActionFlowSubmissionInput = {
  projectId: number;
  actionId: number;
  actionVersionId?: number | null;
  contactId?: number | null;
  conversationId?: string | null;
  fields?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  source: string;
  startStepId?: number | null;
  traceId?: string | null;
};

type RecordActionFlowProgressInput = {
  projectId: number;
  submissionId: number;
  currentStepId?: number | null;
  fields: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  expectedRevision: number;
  event?: {
    eventType: string;
    message: string;
    payload?: Record<string, unknown>;
  };
};

type SubmitActionFlowSubmissionInput = {
  projectId: number;
  submissionId: number;
  fields: Record<string, unknown>;
  expectedRevision: number;
};

type CancelActionFlowSubmissionInput = {
  projectId: number;
  submissionId: number;
  expectedRevision: number;
};

type PauseActionFlowSubmissionInput = {
  channelType: string;
  conversationId: string;
  currentStepId: number | null;
  expectedRevision: number;
  externalUserId?: string | null;
  fields: Record<string, unknown>;
  metadata: Record<string, unknown>;
  projectId: number;
  source: string;
  submissionId: number;
  traceId?: string | null;
  waitDurationMs: number;
  waitStepId: number;
};

type AwaitActionFlowResponseInput = {
  actionVersionId: number | null;
  channelType: string;
  conversationId: string;
  expectedRevision: number;
  externalUserId?: string | null;
  fields: Record<string, unknown>;
  metadata: Record<string, unknown>;
  projectId: number;
  responseState: ActionResponsePolicyState;
  source: string;
  submissionId: number;
  traceId?: string | null;
};

export class ActionSubmissionConflictError extends Error {
  constructor() {
    super("This flow changed before the command could be saved.");
    this.name = "ActionSubmissionConflictError";
  }
}

function getFirstRuntimeStepId(
  action: Awaited<ReturnType<typeof getRuntimeProjectAction>>,
) {
  return action?.steps.find(isRunnableActionStep)?.id ?? null;
}

export async function startActionFlowSubmission(
  input: StartActionFlowSubmissionInput,
) {
  const action = await getRuntimeProjectAction(
    input.projectId,
    input.actionId,
    { versionId: input.actionVersionId },
  );

  if (!action) {
    return null;
  }
  const startStepId =
    input.startStepId === undefined
      ? getFirstRuntimeStepId(action)
      : (action.steps.find(
          (step) => step.isEnabled && step.id === input.startStepId,
        )?.id ?? null);

  if (input.startStepId !== undefined && startStepId === null) {
    return null;
  }

  const submission = await createActionSubmission({
    projectId: input.projectId,
    actionId: action.id,
    actionVersionId: action.versionId,
    currentStepId: startStepId,
    conversationId: input.conversationId ?? null,
    source: input.source,
    traceId: input.traceId,
    status: "in_progress",
    fields: input.fields ?? {},
    metadata: {
      ...(input.metadata ?? {}),
      actionName: action.name,
      actionVersionNumber: action.versionNumber,
      contactId: input.contactId ?? null,
    },
  });

  await addActionSubmissionEvent({
    projectId: input.projectId,
    submissionId: submission.id,
    eventType: "submission.created",
    message: "Flow submission created.",
    payload: {
      actionId: action.id,
      actionVersionId: action.versionId,
      actionVersionNumber: action.versionNumber,
      conversationId: input.conversationId ?? null,
      contactId: input.contactId ?? null,
      source: input.source,
    },
    traceId: submission.traceId,
  });

  await addActionSubmissionEvent({
    projectId: input.projectId,
    submissionId: submission.id,
    eventType: "flow.started",
    message: `Started ${action.name}.`,
    payload: {
      actionId: action.id,
      actionName: action.name,
      actionVersionId: action.versionId,
      actionVersionNumber: action.versionNumber,
      firstStepId: submission.currentStepId,
    },
    traceId: submission.traceId,
  });

  return submission;
}

export async function recordActionFlowProgress(
  input: RecordActionFlowProgressInput,
) {
  const submission = await getActionSubmission(
    input.projectId,
    input.submissionId,
  );

  if (!submission || submission.status !== "in_progress") {
    return null;
  }

  if (submission.revision !== input.expectedRevision) {
    throw new ActionSubmissionConflictError();
  }

  const updatedSubmission = await updateActionSubmission({
    projectId: input.projectId,
    submissionId: submission.id,
    currentStepId: input.currentStepId ?? null,
    status: "in_progress",
    fields: input.fields,
    metadata: input.metadata ?? submission.metadata,
    expectedRevision: input.expectedRevision,
  });

  if (!updatedSubmission) {
    throw new ActionSubmissionConflictError();
  }

  if (input.event) {
    await addActionSubmissionEvent({
      projectId: input.projectId,
      submissionId: submission.id,
      eventType: input.event.eventType,
      message: input.event.message,
      payload: input.event.payload ?? {},
    });
  }

  return updatedSubmission;
}

export async function pauseActionFlowSubmission(
  input: PauseActionFlowSubmissionInput,
) {
  const traceId = resolveTraceId(input.traceId);
  const nextRevision = input.expectedRevision + 1;

  return db.transaction(async (tx) => {
    const [job] = await tx
      .insert(durableJobs)
      .values({
        availableAt: sql`CURRENT_TIMESTAMP + (${input.waitDurationMs} * INTERVAL '1 millisecond')`,
        dedupeKey: `submission:${input.submissionId}:revision:${nextRevision}`,
        jobType: "flow_resume",
        payload: {
          channelType: input.channelType,
          conversationId: input.conversationId,
          expectedRevision: nextRevision,
          externalUserId: input.externalUserId ?? null,
          source: input.source,
        },
        projectId: input.projectId,
        submissionId: input.submissionId,
        traceId,
      })
      .onConflictDoNothing()
      .returning();

    if (!job) {
      throw new Error("Could not schedule the flow resume job.");
    }

    const [submission] = await tx
      .update(actionSubmissions)
      .set({
        currentStepId: input.currentStepId,
        fields: input.fields,
        metadata: {
          ...input.metadata,
          [FLOW_WAIT_METADATA_KEY]: {
            availableAt: job.availableAt.toISOString(),
            stepId: input.waitStepId,
          },
        },
        revision: sql`${actionSubmissions.revision} + 1`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(actionSubmissions.projectId, input.projectId),
          eq(actionSubmissions.id, input.submissionId),
          eq(actionSubmissions.status, "in_progress"),
          eq(actionSubmissions.revision, input.expectedRevision),
        ),
      )
      .returning();

    if (!submission) {
      throw new ActionSubmissionConflictError();
    }

    await tx.insert(actionSubmissionEvents).values({
      eventType: "flow.paused",
      message: "Flow paused for a scheduled wait.",
      payload: {
        availableAt: job.availableAt.toISOString(),
        nextStepId: input.currentStepId,
        waitStepId: input.waitStepId,
      },
      projectId: input.projectId,
      submissionId: input.submissionId,
      traceId,
    });

    return { job, submission };
  });
}

export async function awaitActionFlowResponse(
  input: AwaitActionFlowResponseInput,
) {
  const traceId = resolveTraceId(input.traceId);
  const nextRevision = input.expectedRevision + 1;
  const metadata = {
    ...input.metadata,
    [ACTION_RESPONSE_POLICY_STATE_METADATA_KEY]: input.responseState,
  };

  return db.transaction(async (tx) => {
    const [submission] = await tx
      .update(actionSubmissions)
      .set({
        currentStepId: input.responseState.stepId,
        fields: input.fields,
        metadata,
        revision: sql`${actionSubmissions.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(actionSubmissions.projectId, input.projectId),
          eq(actionSubmissions.id, input.submissionId),
          eq(actionSubmissions.status, "in_progress"),
          eq(actionSubmissions.revision, input.expectedRevision),
        ),
      )
      .returning();

    if (!submission) {
      throw new ActionSubmissionConflictError();
    }

    const jobs = [
      input.responseState.reminderAt
        ? {
            availableAt: new Date(input.responseState.reminderAt),
            kind: "reminder" as const,
          }
        : null,
      input.responseState.timeoutAt
        ? {
            availableAt: new Date(input.responseState.timeoutAt),
            kind: "timeout" as const,
          }
        : null,
    ].filter(
      (job): job is { availableAt: Date; kind: "reminder" | "timeout" } =>
        job !== null,
    );

    if (jobs.length > 0) {
      await tx
        .insert(durableJobs)
        .values(
          jobs.map((job) => ({
            availableAt: job.availableAt,
            dedupeKey: `submission:${input.submissionId}:revision:${nextRevision}:response:${job.kind}`,
            jobType: "flow_response_policy",
            payload: {
              actionVersionId: input.actionVersionId,
              channelType: input.channelType,
              conversationId: input.conversationId,
              expectedRevision: nextRevision,
              externalUserId: input.externalUserId ?? null,
              kind: job.kind,
              source: input.source,
              stepId: input.responseState.stepId,
            },
            projectId: input.projectId,
            submissionId: input.submissionId,
            traceId,
          })),
        )
        .onConflictDoNothing();
    }

    await tx.insert(actionSubmissionEvents).values({
      eventType: "flow.awaiting_response",
      message: "Flow is waiting for a visitor response.",
      payload: {
        actionVersionId: input.actionVersionId,
        attemptCount: input.responseState.attemptCount,
        reminderAt: input.responseState.reminderAt,
        stepId: input.responseState.stepId,
        timeoutAt: input.responseState.timeoutAt,
      },
      projectId: input.projectId,
      submissionId: input.submissionId,
      traceId,
    });

    return submission;
  });
}

export async function submitActionFlowSubmission(
  input: SubmitActionFlowSubmissionInput,
) {
  const submission = await getActionSubmission(
    input.projectId,
    input.submissionId,
  );

  if (!submission || submission.status !== "in_progress") {
    return null;
  }

  if (submission.revision !== input.expectedRevision) {
    throw new ActionSubmissionConflictError();
  }

  const updatedSubmission = await updateActionSubmission({
    projectId: input.projectId,
    submissionId: submission.id,
    currentStepId: null,
    status: "submitted",
    fields: input.fields,
    metadata: submission.metadata,
    expectedRevision: input.expectedRevision,
  });

  if (!updatedSubmission) {
    throw new ActionSubmissionConflictError();
  }

  await addActionSubmissionEvent({
    projectId: input.projectId,
    submissionId: updatedSubmission.id,
    eventType: "submission.submitted",
    message: "Submission marked as submitted.",
    payload: { fields: input.fields },
  });

  await runSubmissionOperations(input.projectId, updatedSubmission.id);

  return updatedSubmission;
}

export async function cancelActionFlowSubmission(
  input: CancelActionFlowSubmissionInput,
) {
  const submission = await getActionSubmission(
    input.projectId,
    input.submissionId,
  );

  if (!submission || submission.status !== "in_progress") {
    return null;
  }

  if (submission.revision !== input.expectedRevision) {
    throw new ActionSubmissionConflictError();
  }

  const updatedSubmission = await updateActionSubmission({
    projectId: input.projectId,
    submissionId: submission.id,
    currentStepId: null,
    status: "cancelled",
    fields: submission.fields,
    metadata: submission.metadata,
    expectedRevision: input.expectedRevision,
  });

  if (!updatedSubmission) {
    throw new ActionSubmissionConflictError();
  }

  const now = new Date();
  await db
    .update(durableJobs)
    .set({
      cancelledAt: now,
      leaseExpiresAt: null,
      leaseOwner: null,
      status: "cancelled",
      updatedAt: now,
    })
    .where(
      and(
        eq(durableJobs.projectId, input.projectId),
        eq(durableJobs.submissionId, updatedSubmission.id),
        inArray(durableJobs.jobType, ["flow_resume", "flow_response_policy"]),
        inArray(durableJobs.status, ["queued", "processing"]),
      ),
    );

  await addActionSubmissionEvent({
    projectId: input.projectId,
    submissionId: updatedSubmission.id,
    eventType: "flow.cancelled",
    message: "Flow was cancelled before submission.",
    payload: {},
  });

  return updatedSubmission;
}
