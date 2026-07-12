"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  ACTION_SUBMISSION_STATUSES,
  type ActionSubmissionStatus,
  addActionSubmissionEvent,
  createActionSubmission,
  getActionSubmission,
  getProjectAction,
  listActionFlowSteps,
  setActionSubmissionStatus,
  updateActionSubmission,
} from "@/lib/action-flows";
import {
  buildStepAnswerResult,
  getActionStepOptions,
  type RuntimeActionStep,
} from "@/lib/action-runtime";
import { resolveUserAndProject } from "@/lib/auth-project";
import {
  type FlowMediaUploadValue,
  isFlowMediaUploadValue,
} from "@/lib/flow-media-values";
import { runSubmissionOperations } from "@/lib/operations";
import { importWhatsAppMediaReference } from "@/lib/whatsapp";

const submissionStatusSchema = z.object({
  submissionId: z.coerce.number().int().positive(),
  status: z.enum(ACTION_SUBMISSION_STATUSES),
});

const testSubmissionSchema = z.object({
  actionId: z.coerce.number().int().positive(),
});

const importSubmissionMediaSchema = z.object({
  fieldKey: z.string().min(1).max(200),
  submissionId: z.coerce.number().int().positive(),
});

const handoffAssignmentSchema = z.object({
  assignmentAction: z.enum(["claim", "release"]),
  returnTo: z.enum(["/projects/handoffs"]).optional(),
  submissionId: z.coerce.number().int().positive(),
});

const handoffQueueBulkActions = [
  "claim_selected",
  "release_selected",
  "mark_under_review",
  "mark_completed",
  "mark_rejected",
] as const;

const handoffQueueSingleActions = [
  "claim",
  "release",
  "mark_under_review",
  "mark_completed",
  "mark_rejected",
] as const;

type HandoffQueueBulkAction = (typeof handoffQueueBulkActions)[number];
type HandoffQueueSingleAction = (typeof handoffQueueSingleActions)[number];
type HandoffQueueAction = HandoffQueueBulkAction | HandoffQueueSingleAction;

function getHandoffRecord(metadata: Record<string, unknown>) {
  const handoff = metadata.handoff;

  if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) {
    return null;
  }

  return handoff as Record<string, unknown>;
}

function isHandoffQueueBulkAction(
  value: string,
): value is HandoffQueueBulkAction {
  return handoffQueueBulkActions.includes(value as HandoffQueueBulkAction);
}

function isHandoffQueueSingleAction(
  value: string,
): value is HandoffQueueSingleAction {
  return handoffQueueSingleActions.includes(value as HandoffQueueSingleAction);
}

function getQueueActionStatus(action: HandoffQueueAction) {
  switch (action) {
    case "mark_completed":
      return "completed";
    case "mark_rejected":
      return "rejected";
    case "mark_under_review":
      return "under_review";
    default:
      return null;
  }
}

function parseSubmissionIds(values: FormDataEntryValue[]) {
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function parseHandoffQueueCommand(formData: FormData) {
  const command = formData.get("queueAction");

  if (typeof command !== "string") {
    return null;
  }

  if (command.startsWith("single:")) {
    const [, action, submissionId] = command.split(":");
    const parsedSubmissionId = Number(submissionId);

    if (
      !isHandoffQueueSingleAction(action) ||
      !Number.isInteger(parsedSubmissionId) ||
      parsedSubmissionId <= 0
    ) {
      return null;
    }

    return {
      action,
      submissionIds: [parsedSubmissionId],
    };
  }

  if (!isHandoffQueueBulkAction(command)) {
    return null;
  }

  return {
    action: command,
    submissionIds: parseSubmissionIds(formData.getAll("submissionIds")),
  };
}

function getHandoffAssignmentRedirect(
  returnTo: "/projects/handoffs" | undefined,
  submissionId: number,
  query: string,
) {
  if (returnTo === "/projects/handoffs") {
    return `/projects/handoffs?${query}`;
  }

  return `/projects/submissions/${submissionId}?${query}`;
}

function getExampleValue(inputType: string | null, label: string) {
  switch (inputType) {
    case "date":
      return new Date().toISOString().slice(0, 10);
    case "email":
      return "guest@example.com";
    case "number":
      return 1;
    case "phone":
      return "+1 555 0100";
    case "time":
      return "10:00";
    default:
      return `Test ${label}`;
  }
}

function getOptionExampleValue(
  step: RuntimeActionStep,
  fields: Record<string, unknown>,
) {
  const options = getActionStepOptions(step, fields);

  if (options.length === 0) {
    return null;
  }

  const [firstOption] = options;
  return firstOption.value;
}

function getStepExampleValue(
  step: RuntimeActionStep,
  fields: Record<string, unknown>,
) {
  return (
    getOptionExampleValue(step, fields) ??
    getExampleValue(step.inputType, step.label ?? step.fieldKey ?? "value")
  );
}

function toRuntimeStep(
  step: Awaited<ReturnType<typeof listActionFlowSteps>>[number],
) {
  return {
    id: step.id,
    sortOrder: step.sortOrder,
    stepType: step.stepType,
    fieldKey: step.fieldKey,
    label: step.label,
    prompt: step.prompt,
    inputType: step.inputType,
    isRequired: step.isRequired,
    isEnabled: step.isEnabled,
    operationId: step.operationId,
    nextStepId: step.nextStepId,
    options: step.options,
    settings: step.settings,
  };
}

export async function createTestActionSubmissionAction(formData: FormData) {
  const parsed = testSubmissionSchema.safeParse({
    actionId: formData.get("actionId"),
  });

  if (!parsed.success) {
    redirect("/projects/actions?error=Invalid%20action.");
  }

  const { project } = await resolveUserAndProject();
  const action = await getProjectAction(project.id, parsed.data.actionId);

  if (!action) {
    redirect("/projects/actions?error=Action%20not%20found.");
  }

  const steps = await listActionFlowSteps(project.id, action.id);
  const fields: Record<string, unknown> = {};

  for (const step of steps) {
    const runtimeStep = toRuntimeStep(step);

    if (!runtimeStep.isEnabled || !runtimeStep.fieldKey) {
      continue;
    }

    const value = getStepExampleValue(runtimeStep, fields);
    const answerResult = buildStepAnswerResult(
      runtimeStep,
      runtimeStep.fieldKey,
      value,
      fields,
    );

    for (const [key, fieldValue] of Object.entries(answerResult.fields)) {
      fields[key] = fieldValue;
    }
  }

  const submission = await createActionSubmission({
    projectId: project.id,
    actionId: action.id,
    status: "submitted",
    source: "admin_test",
    fields,
    metadata: {
      createdFrom: "admin_action_builder",
      actionName: action.name,
    },
  });

  await addActionSubmissionEvent({
    projectId: project.id,
    submissionId: submission.id,
    eventType: "submission.created",
    message: "Test submission created from the action builder.",
    payload: { actionId: action.id, source: "admin_test" },
  });

  await addActionSubmissionEvent({
    projectId: project.id,
    submissionId: submission.id,
    eventType: "submission.submitted",
    message: "Submission marked as submitted.",
    payload: { fields },
  });
  await runSubmissionOperations(project.id, submission.id);

  revalidatePath("/projects/submissions");
  revalidatePath(`/projects/actions/${action.id}`);
  redirect(`/projects/submissions/${submission.id}?created=1`);
}

export async function updateActionSubmissionStatusAction(formData: FormData) {
  const parsed = submissionStatusSchema.safeParse({
    submissionId: formData.get("submissionId"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    redirect("/projects/submissions?error=Invalid%20submission%20status.");
  }

  const { project } = await resolveUserAndProject();
  const existingSubmission = await getActionSubmission(
    project.id,
    parsed.data.submissionId,
  );

  if (!existingSubmission) {
    redirect("/projects/submissions?error=Submission%20not%20found.");
  }

  const submission = await setActionSubmissionStatus(
    project.id,
    parsed.data.submissionId,
    parsed.data.status as ActionSubmissionStatus,
  );

  if (!submission) {
    redirect("/projects/submissions?error=Submission%20not%20found.");
  }

  await addActionSubmissionEvent({
    projectId: project.id,
    submissionId: submission.id,
    eventType: "submission.status_changed",
    message: `Status changed from ${existingSubmission.status} to ${submission.status}.`,
    payload: {
      previousStatus: existingSubmission.status,
      status: submission.status,
    },
  });

  revalidatePath("/projects/submissions");
  revalidatePath(`/projects/submissions/${submission.id}`);
  redirect(`/projects/submissions/${submission.id}?updated=1`);
}

export async function updateHandoffAssignmentAction(formData: FormData) {
  const parsed = handoffAssignmentSchema.safeParse({
    assignmentAction: formData.get("assignmentAction"),
    returnTo: formData.get("returnTo") || undefined,
    submissionId: formData.get("submissionId"),
  });

  if (!parsed.success) {
    redirect("/projects/submissions?error=Invalid%20handoff%20assignment.");
  }

  const { project, user } = await resolveUserAndProject();
  const existingSubmission = await getActionSubmission(
    project.id,
    parsed.data.submissionId,
  );

  if (!existingSubmission) {
    redirect("/projects/submissions?error=Submission%20not%20found.");
  }

  const handoff = getHandoffRecord(existingSubmission.metadata);
  if (!handoff) {
    redirect(
      getHandoffAssignmentRedirect(
        parsed.data.returnTo,
        existingSubmission.id,
        "assignmentError=No%20handoff%20found.",
      ),
    );
  }

  const nextHandoff = { ...handoff };

  if (parsed.data.assignmentAction === "claim") {
    nextHandoff.assignedAt = new Date().toISOString();
    nextHandoff.assignedUserEmail = user.email;
    nextHandoff.assignedUserId = user.id;
    nextHandoff.assignedUserName = user.name ?? user.email;
  } else {
    delete nextHandoff.assignedAt;
    delete nextHandoff.assignedUserEmail;
    delete nextHandoff.assignedUserId;
    delete nextHandoff.assignedUserName;
  }

  const submission = await updateActionSubmission({
    projectId: project.id,
    submissionId: existingSubmission.id,
    currentStepId: existingSubmission.currentStepId,
    fields: existingSubmission.fields,
    metadata: {
      ...existingSubmission.metadata,
      handoff: nextHandoff,
    },
    status: existingSubmission.status as ActionSubmissionStatus,
  });

  if (!submission) {
    redirect("/projects/submissions?error=Submission%20not%20found.");
  }

  await addActionSubmissionEvent({
    projectId: project.id,
    submissionId: submission.id,
    eventType:
      parsed.data.assignmentAction === "claim"
        ? "handoff.assigned"
        : "handoff.released",
    message:
      parsed.data.assignmentAction === "claim"
        ? `Handoff assigned to ${user.name ?? user.email}.`
        : "Handoff assignment released.",
    payload: {
      assignedUserEmail:
        parsed.data.assignmentAction === "claim" ? user.email : null,
      assignedUserId: parsed.data.assignmentAction === "claim" ? user.id : null,
    },
  });

  revalidatePath("/projects/submissions");
  revalidatePath("/projects/handoffs");
  revalidatePath(`/projects/submissions/${submission.id}`);
  redirect(
    getHandoffAssignmentRedirect(
      parsed.data.returnTo,
      submission.id,
      "assignmentUpdated=1",
    ),
  );
}

export async function updateHandoffQueueAction(formData: FormData) {
  const command = parseHandoffQueueCommand(formData);

  if (!command || command.submissionIds.length === 0) {
    redirect("/projects/handoffs?error=Select%20at%20least%20one%20handoff.");
  }

  const { project, user } = await resolveUserAndProject();
  let updatedCount = 0;

  for (const submissionId of command.submissionIds) {
    const existingSubmission = await getActionSubmission(
      project.id,
      submissionId,
    );

    if (!existingSubmission) {
      continue;
    }

    const handoff = getHandoffRecord(existingSubmission.metadata);

    if (!handoff) {
      continue;
    }

    const nextStatus = getQueueActionStatus(command.action);

    if (nextStatus) {
      const submission = await setActionSubmissionStatus(
        project.id,
        existingSubmission.id,
        nextStatus,
      );

      if (!submission) {
        continue;
      }

      await addActionSubmissionEvent({
        projectId: project.id,
        submissionId: submission.id,
        eventType: "handoff.status_changed",
        message: `Handoff status changed from ${existingSubmission.status} to ${submission.status}.`,
        payload: {
          previousStatus: existingSubmission.status,
          status: submission.status,
        },
      });

      updatedCount += 1;
      revalidatePath(`/projects/submissions/${submission.id}`);
      continue;
    }

    const nextHandoff = { ...handoff };

    if (command.action === "claim" || command.action === "claim_selected") {
      nextHandoff.assignedAt = new Date().toISOString();
      nextHandoff.assignedUserEmail = user.email;
      nextHandoff.assignedUserId = user.id;
      nextHandoff.assignedUserName = user.name ?? user.email;
    } else {
      delete nextHandoff.assignedAt;
      delete nextHandoff.assignedUserEmail;
      delete nextHandoff.assignedUserId;
      delete nextHandoff.assignedUserName;
    }

    const submission = await updateActionSubmission({
      projectId: project.id,
      submissionId: existingSubmission.id,
      currentStepId: existingSubmission.currentStepId,
      fields: existingSubmission.fields,
      metadata: {
        ...existingSubmission.metadata,
        handoff: nextHandoff,
      },
      status: existingSubmission.status as ActionSubmissionStatus,
    });

    if (!submission) {
      continue;
    }

    const isClaim =
      command.action === "claim" || command.action === "claim_selected";

    await addActionSubmissionEvent({
      projectId: project.id,
      submissionId: submission.id,
      eventType: isClaim ? "handoff.assigned" : "handoff.released",
      message: isClaim
        ? `Handoff assigned to ${user.name ?? user.email}.`
        : "Handoff assignment released.",
      payload: {
        assignedUserEmail: isClaim ? user.email : null,
        assignedUserId: isClaim ? user.id : null,
      },
    });

    updatedCount += 1;
    revalidatePath(`/projects/submissions/${submission.id}`);
  }

  revalidatePath("/projects/submissions");
  revalidatePath("/projects/handoffs");
  redirect(`/projects/handoffs?updated=${updatedCount}`);
}

export async function importSubmissionMediaAction(formData: FormData) {
  const parsed = importSubmissionMediaSchema.safeParse({
    fieldKey: formData.get("fieldKey"),
    submissionId: formData.get("submissionId"),
  });

  if (!parsed.success) {
    redirect("/projects/submissions?error=Invalid%20media%20import.");
  }

  const { project } = await resolveUserAndProject();
  const submission = await getActionSubmission(
    project.id,
    parsed.data.submissionId,
  );

  if (!submission) {
    redirect("/projects/submissions?error=Submission%20not%20found.");
  }

  const mediaValue = submission.fields[parsed.data.fieldKey];

  if (
    !isFlowMediaUploadValue(mediaValue) ||
    (mediaValue as FlowMediaUploadValue).provider !== "whatsapp"
  ) {
    redirect(
      `/projects/submissions/${submission.id}?mediaImportError=Unsupported%20media%20reference.`,
    );
  }

  try {
    const asset = await importWhatsAppMediaReference({
      media: mediaValue as FlowMediaUploadValue,
      projectId: project.id,
    });
    const updatedMedia: FlowMediaUploadValue = {
      mediaAssetId: asset.id,
      mediaType: asset.mediaType,
      mimeType: asset.mimeType,
      originalName: asset.originalName,
      provider: "local",
      publicPath: asset.publicPath,
      sizeBytes: asset.sizeBytes,
      metadata: {
        importedFrom: "whatsapp",
        originalMediaReference: mediaValue,
      },
    };
    const fields = {
      ...submission.fields,
      [parsed.data.fieldKey]: updatedMedia,
    };
    const updatedSubmission = await updateActionSubmission({
      projectId: project.id,
      submissionId: submission.id,
      currentStepId: submission.currentStepId,
      fields,
      metadata: submission.metadata,
    });

    if (!updatedSubmission) {
      throw new Error("Submission update failed.");
    }

    await addActionSubmissionEvent({
      projectId: project.id,
      submissionId: submission.id,
      eventType: "flow.media_imported",
      message: `Imported ${asset.originalName} into the project media library.`,
      payload: {
        fieldKey: parsed.data.fieldKey,
        mediaAssetId: asset.id,
        originalMediaReference: mediaValue,
        value: updatedMedia,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Media import failed.";
    redirect(
      `/projects/submissions/${submission.id}?mediaImportError=${encodeURIComponent(
        message,
      )}`,
    );
  }

  revalidatePath("/projects/media");
  revalidatePath("/projects/submissions");
  revalidatePath(`/projects/submissions/${submission.id}`);
  redirect(`/projects/submissions/${submission.id}?mediaImported=1`);
}
