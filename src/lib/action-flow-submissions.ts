import {
  addActionSubmissionEvent,
  createActionSubmission,
  getActionSubmission,
  updateActionSubmission,
} from "@/lib/action-flows";
import { isRunnableActionStep } from "@/lib/action-runtime";
import { runSubmissionOperations } from "@/lib/operations";
import { getRuntimeProjectAction } from "@/lib/runtime-actions";

type StartActionFlowSubmissionInput = {
  projectId: number;
  actionId: number;
  actionVersionId?: number | null;
  contactId?: number | null;
  conversationId?: string | null;
  fields?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  source: string;
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

  const submission = await createActionSubmission({
    projectId: input.projectId,
    actionId: action.id,
    actionVersionId: action.versionId,
    currentStepId: getFirstRuntimeStepId(action),
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

  if (updatedSubmission) {
    await addActionSubmissionEvent({
      projectId: input.projectId,
      submissionId: updatedSubmission.id,
      eventType: "flow.cancelled",
      message: "Flow was cancelled before submission.",
      payload: {},
    });
  }

  return updatedSubmission;
}
