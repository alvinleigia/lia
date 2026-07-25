"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionFormState } from "@/lib/action-form-state";
import { getOrCreateChannelConversation } from "@/lib/channels";
import { resolveConversationalTaskMutation } from "@/lib/conversational-task-access";
import {
  applyConversationalTaskEvent,
  deleteConversationRuntimeData,
  startConversationalTaskRun,
  switchConversationalTaskRun,
} from "@/lib/conversational-task-runtime";
import {
  getConversationTaskRuntimeSession,
  getTaskRuntimeTestConversationId,
  runtimeResultMessage,
} from "@/lib/conversational-task-runtime-session";

const fieldInputSchema = z.object({
  fieldKey: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-zA-Z0-9_]*$/),
  value: z.string().trim().min(1).max(2000),
});
const lifecycleSchema = z.enum([
  "cancel",
  "complete",
  "pause",
  "restart",
  "resume",
  "rotate_session",
  "side_question",
  "side_question_resolved",
]);

function runtimePath(taskId: number) {
  return `/projects/tasks/${taskId}/configure/review/runtime`;
}

function runtimeChannelIdentity(userId: number) {
  return { purpose: "task_runtime_test", userId };
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

async function resolveRuntimeTest(formData: FormData) {
  const context = await resolveConversationalTaskMutation(formData);
  const externalConversationId = getTaskRuntimeTestConversationId(
    context.user.id,
  );
  const session = await getConversationTaskRuntimeSession({
    channelType: "project_chat",
    externalConversationId,
    projectId: context.project.id,
  });

  return { ...context, externalConversationId, session };
}

function requireActiveRuntime(
  test: Awaited<ReturnType<typeof resolveRuntimeTest>>,
) {
  const { execution, runtime, snapshot } = test.session;
  if (
    !execution?.activeTaskRunId ||
    !runtime ||
    !snapshot ||
    execution.activeTaskRunId !== runtime.run.id
  ) {
    throw new Error("Start a task run before applying this test step.");
  }
  return { execution, runtime, snapshot };
}

function eventEnvelope(test: Awaited<ReturnType<typeof resolveRuntimeTest>>) {
  const { execution, runtime } = requireActiveRuntime(test);
  const now = new Date().toISOString();

  return {
    authentication: null,
    channelIdentity: runtimeChannelIdentity(test.user.id),
    channelType: "project_chat" as const,
    conversationId: runtime.run.conversationId,
    eventId: crypto.randomUUID(),
    expectedRevision: execution.revision,
    occurredAt: now,
    projectId: test.project.id,
    providerSequence: null,
    receivedAt: now,
    schemaVersion: 1 as const,
    taskRunId: runtime.run.id,
  };
}

function parseFieldValue(input: {
  cardinality: "single" | "multiple";
  fieldType: string;
  value: string;
}) {
  const values =
    input.cardinality === "multiple"
      ? input.value
          .split(/\r?\n|,/)
          .map((value) => value.trim())
          .filter(Boolean)
      : null;
  if (values) {
    return values;
  }
  if (input.fieldType === "number") {
    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      throw new Error("Enter a valid number.");
    }
    return value;
  }
  if (input.fieldType === "boolean") {
    const value = input.value.toLowerCase();
    if (["true", "yes", "1"].includes(value)) return true;
    if (["false", "no", "0"].includes(value)) return false;
    throw new Error("Enter yes or no.");
  }
  return input.value;
}

function redirectWithResult(
  taskId: number,
  result: Awaited<ReturnType<typeof applyConversationalTaskEvent>>,
  event: string,
): never {
  const error = runtimeResultMessage(result);
  if (error) {
    redirect(`${runtimePath(taskId)}?error=${encodeURIComponent(error)}`);
  }
  redirect(`${runtimePath(taskId)}?event=${encodeURIComponent(event)}`);
}

export async function startTaskRuntimeTestAction(formData: FormData) {
  const test = await resolveRuntimeTest(formData);
  const destination = runtimePath(test.task.id);
  if (test.task.isArchived) {
    redirect(`${destination}?error=Restore%20the%20task%20before%20testing.`);
  }
  if (test.session.execution?.activeTaskRunId) {
    redirect(`${destination}?error=A%20task%20run%20is%20already%20active.`);
  }

  const conversation = await getOrCreateChannelConversation({
    channelType: "project_chat",
    externalConversationId: test.externalConversationId,
    externalUserId: `runtime-test-user-${test.user.id}`,
    metadata: { purpose: "task_runtime_test" },
    projectId: test.project.id,
  });
  const now = new Date();
  const result = await startConversationalTaskRun({
    anonymousVisitorId: null,
    authenticatedUserId: test.user.id,
    channelIdentity: runtimeChannelIdentity(test.user.id),
    channelType: "project_chat",
    conversationId: conversation.id,
    eventId: crypto.randomUUID(),
    identityKind: "authenticated_user",
    initializationContext: {
      lia_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    occurredAt: now.toISOString(),
    projectId: test.project.id,
    providerSequence: null,
    receivedAt: now.toISOString(),
    sessionExpiresAt: addHours(now, 24).toISOString(),
    sessionId: crypto.randomUUID(),
    taskId: test.task.id,
    verifiedContactId: null,
  });
  redirectWithResult(test.task.id, result, "started");
}

export async function updateTaskRuntimeTestFieldAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = fieldInputSchema.safeParse({
    fieldKey: formData.get("fieldKey"),
    value: formData.get("value"),
  });
  if (!parsed.success) {
    return { error: "Choose a field and enter a test value." };
  }

  const test = await resolveRuntimeTest(formData);
  let active: ReturnType<typeof requireActiveRuntime>;
  try {
    active = requireActiveRuntime(test);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Run not found." };
  }
  const field = active.snapshot.task.definition.fields.find(
    (candidate) => candidate.key === parsed.data.fieldKey,
  );
  const current = active.runtime.fields.find(
    (candidate) => candidate.fieldKey === parsed.data.fieldKey,
  );
  if (!field || !current) {
    return { error: "The selected field is not part of this published task." };
  }

  let canonicalValue: unknown;
  try {
    canonicalValue = parseFieldValue({
      cardinality: field.cardinality,
      fieldType: field.type,
      value: parsed.data.value,
    });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Enter a valid value.",
    };
  }

  const result = await applyConversationalTaskEvent({
    ...eventEnvelope(test),
    candidates: [
      {
        canonicalValue,
        fieldKey: field.key,
        naturalValue: parsed.data.value,
        provenance: { source: "visitor", sourceReference: null },
        state: "valid",
        validation: { code: null, message: null, valid: true },
      },
    ],
    correction: current.state !== "missing" && current.state !== "cleared",
    type: "field.candidates",
  });
  const error = runtimeResultMessage(result);
  if (error) return { error };

  revalidatePath(runtimePath(test.task.id));
  redirect(
    `${runtimePath(test.task.id)}?event=${encodeURIComponent(
      current.state === "missing" || current.state === "cleared"
        ? "field_saved"
        : "field_corrected",
    )}`,
  );
}

export async function requestTaskRuntimeTestFieldAction(formData: FormData) {
  const test = await resolveRuntimeTest(formData);
  const fieldKey = fieldInputSchema.shape.fieldKey.safeParse(
    formData.get("fieldKey"),
  );
  if (!fieldKey.success) {
    redirect(`${runtimePath(test.task.id)}?error=Choose%20a%20valid%20field.`);
  }
  const result = await applyConversationalTaskEvent({
    ...eventEnvelope(test),
    fieldKey: fieldKey.data,
    type: "field.requested",
  });
  redirectWithResult(test.task.id, result, "field_requested");
}

export async function clearTaskRuntimeTestFieldAction(formData: FormData) {
  const test = await resolveRuntimeTest(formData);
  const fieldKey = fieldInputSchema.shape.fieldKey.safeParse(
    formData.get("fieldKey"),
  );
  if (!fieldKey.success) {
    redirect(`${runtimePath(test.task.id)}?error=Choose%20a%20valid%20field.`);
  }
  const result = await applyConversationalTaskEvent({
    ...eventEnvelope(test),
    fieldKey: fieldKey.data,
    reason: "visitor_correction",
    type: "field.clear",
  });
  redirectWithResult(test.task.id, result, "field_cleared");
}

export async function applyTaskRuntimeTestLifecycleAction(formData: FormData) {
  const test = await resolveRuntimeTest(formData);
  const transition = lifecycleSchema.safeParse(formData.get("transition"));
  if (!transition.success) {
    redirect(`${runtimePath(test.task.id)}?error=Choose%20a%20valid%20action.`);
  }
  const active = requireActiveRuntime(test);
  const envelope = eventEnvelope(test);
  let result: Awaited<ReturnType<typeof applyConversationalTaskEvent>>;

  switch (transition.data) {
    case "pause":
      result = await applyConversationalTaskEvent({
        ...envelope,
        boundary: "manual",
        reason: "uat_pause",
        resumeAt: null,
        returnTarget: {
          lastRequestedFieldKey: active.runtime.run.lastRequestedFieldKey,
        },
        type: "task.pause",
      });
      break;
    case "resume":
      result = await applyConversationalTaskEvent({
        ...envelope,
        reason: "uat_resume",
        type: "task.resume",
      });
      break;
    case "restart":
      result = await applyConversationalTaskEvent({
        ...envelope,
        type: "task.restart",
      });
      break;
    case "cancel":
      result = await applyConversationalTaskEvent({
        ...envelope,
        outcomeKey: null,
        type: "task.cancel",
      });
      break;
    case "complete": {
      const outcome = active.snapshot.task.definition.outcomes.find(
        (candidate) => candidate.type === "completed",
      );
      if (!outcome) {
        redirect(
          `${runtimePath(test.task.id)}?error=No%20completed%20outcome%20is%20published.`,
        );
      }
      result = await applyConversationalTaskEvent({
        ...envelope,
        outcomeKey: outcome.key,
        type: "task.complete",
      });
      break;
    }
    case "side_question":
      result = await applyConversationalTaskEvent({
        ...envelope,
        category: "uat_business_question",
        type: "task.side_question",
      });
      break;
    case "side_question_resolved":
      result = await applyConversationalTaskEvent({
        ...envelope,
        type: "task.side_question_resolved",
      });
      break;
    case "rotate_session":
      result = await applyConversationalTaskEvent({
        ...envelope,
        sessionExpiresAt: addHours(new Date(), 24).toISOString(),
        sessionId: crypto.randomUUID(),
        type: "session.rotate",
      });
      break;
  }

  redirectWithResult(test.task.id, result, transition.data);
}

export async function switchTaskRuntimeTestAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const targetTaskId = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(formData.get("targetTaskId"));
  if (!targetTaskId.success) {
    return { error: "Choose another published task." };
  }

  const test = await resolveRuntimeTest(formData);
  let active: ReturnType<typeof requireActiveRuntime>;
  try {
    active = requireActiveRuntime(test);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Run not found." };
  }
  if (active.runtime.run.taskId === targetTaskId.data) {
    return { error: "Choose a different task." };
  }

  try {
    const now = new Date().toISOString();
    const result = await switchConversationalTaskRun({
      channelIdentity: runtimeChannelIdentity(test.user.id),
      channelType: "project_chat",
      conversationId: active.runtime.run.conversationId,
      currentTaskRunId: active.runtime.run.id,
      eventId: crypto.randomUUID(),
      initializationContext: {
        lia_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      occurredAt: now,
      projectId: test.project.id,
      receivedAt: now,
      targetTaskId: targetTaskId.data,
    });
    if (!result.start || runtimeResultMessage(result.cancel)) {
      return { error: "The task switch could not be completed." };
    }
    const error = runtimeResultMessage(result.start);
    if (error) return { error };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "The task switch failed.",
    };
  }

  revalidatePath(runtimePath(test.task.id));
  redirect(`${runtimePath(test.task.id)}?event=task_switched`);
}

export async function resetTaskRuntimeTestAction(formData: FormData) {
  const test = await resolveRuntimeTest(formData);
  if (test.session.conversation) {
    await deleteConversationRuntimeData({
      conversationId: test.session.conversation.id,
      projectId: test.project.id,
    });
  }
  revalidatePath(runtimePath(test.task.id));
  redirect(`${runtimePath(test.task.id)}?event=reset`);
}
