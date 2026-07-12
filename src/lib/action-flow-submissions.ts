import {
  addActionSubmissionEvent,
  createActionSubmission,
  getActionSubmission,
  getProjectAction,
  listActionFlowSteps,
  updateActionSubmission,
} from "@/lib/action-flows";
import {
  isRunnableActionStep,
  type RuntimeActionStep,
} from "@/lib/action-runtime";
import { runSubmissionOperations } from "@/lib/operations";

type StartActionFlowSubmissionInput = {
  projectId: number;
  actionId: number;
  contactId?: number | null;
  conversationId?: string | null;
  fields?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  source: string;
};

type RecordActionFlowProgressInput = {
  projectId: number;
  submissionId: number;
  currentStepId?: number | null;
  fields: Record<string, unknown>;
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
};

type CancelActionFlowSubmissionInput = {
  projectId: number;
  submissionId: number;
};

function getFirstRuntimeStepId(
  steps: Awaited<ReturnType<typeof listActionFlowSteps>>,
) {
  return (
    steps.find((step) => isRunnableActionStep(step as RuntimeActionStep))?.id ??
    null
  );
}

export async function startActionFlowSubmission(
  input: StartActionFlowSubmissionInput,
) {
  const action = await getProjectAction(input.projectId, input.actionId);

  if (!action || action.status !== "active") {
    return null;
  }

  const steps = await listActionFlowSteps(input.projectId, action.id);
  const submission = await createActionSubmission({
    projectId: input.projectId,
    actionId: action.id,
    currentStepId: getFirstRuntimeStepId(steps),
    conversationId: input.conversationId ?? null,
    source: input.source,
    status: "in_progress",
    fields: input.fields ?? {},
    metadata: {
      ...(input.metadata ?? {}),
      actionName: action.name,
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
      conversationId: input.conversationId ?? null,
      contactId: input.contactId ?? null,
      source: input.source,
    },
  });

  await addActionSubmissionEvent({
    projectId: input.projectId,
    submissionId: submission.id,
    eventType: "flow.started",
    message: `Started ${action.name}.`,
    payload: {
      actionId: action.id,
      actionName: action.name,
      firstStepId: submission.currentStepId,
    },
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

  const updatedSubmission = await updateActionSubmission({
    projectId: input.projectId,
    submissionId: submission.id,
    currentStepId: input.currentStepId ?? null,
    status: "in_progress",
    fields: input.fields,
    metadata: submission.metadata,
  });

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

  const updatedSubmission = await updateActionSubmission({
    projectId: input.projectId,
    submissionId: submission.id,
    currentStepId: null,
    status: "submitted",
    fields: input.fields,
    metadata: submission.metadata,
  });

  if (!updatedSubmission) {
    return null;
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

  const updatedSubmission = await updateActionSubmission({
    projectId: input.projectId,
    submissionId: submission.id,
    currentStepId: null,
    status: "cancelled",
    fields: submission.fields,
    metadata: submission.metadata,
  });

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
