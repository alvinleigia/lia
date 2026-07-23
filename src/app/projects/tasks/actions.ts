"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { writeAuditLog } from "@/lib/audit";
import { resolveStrictUserAndProject } from "@/lib/auth-project";
import {
  conversationalTaskDetailsSchema,
  conversationalTaskIdSchema,
} from "@/lib/conversational-task-schema";
import {
  createProjectConversationalTask,
  getProjectConversationalTask,
  setProjectConversationalTaskArchived,
  updateProjectConversationalTask,
} from "@/lib/conversational-tasks";

const projectIdSchema = z.coerce.number().int().positive();

function parseTaskDetails(formData: FormData) {
  return conversationalTaskDetailsSchema.safeParse({
    description: formData.get("description"),
    name: formData.get("name"),
    objective: formData.get("objective"),
  });
}

async function resolveTaskMutation(formData: FormData) {
  const projectId = projectIdSchema.safeParse(formData.get("projectId"));
  const taskId = conversationalTaskIdSchema.safeParse(formData.get("taskId"));

  if (!projectId.success || !taskId.success) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  const context = await resolveStrictUserAndProject(projectId.data);
  assertPermission(context.membership, "company.project.manage");
  const task = await getProjectConversationalTask(
    context.project.id,
    taskId.data,
  );

  if (!task) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  return { ...context, task };
}

export async function createConversationalTaskAction(formData: FormData) {
  const projectId = projectIdSchema.safeParse(formData.get("projectId"));
  const details = parseTaskDetails(formData);

  if (!projectId.success || !details.success) {
    redirect(
      "/projects/tasks/new?error=Please%20check%20the%20task%20details.",
    );
  }

  const context = await resolveStrictUserAndProject(projectId.data);
  assertPermission(context.membership, "company.project.manage");
  const task = await createProjectConversationalTask(
    context.project.id,
    details.data,
  );

  await writeAuditLog({
    ...context,
    action: "conversational_task.created",
    targetType: "conversational_task",
    targetId: task.id,
    metadata: { name: task.name, schemaVersion: task.schemaVersion },
  });

  revalidatePath("/projects/tasks");
  redirect(`/projects/tasks/${task.id}?created=1`);
}

export async function updateConversationalTaskAction(formData: FormData) {
  const details = parseTaskDetails(formData);

  if (!details.success) {
    const taskId = conversationalTaskIdSchema.safeParse(formData.get("taskId"));
    const destination = taskId.success
      ? `/projects/tasks/${taskId.data}`
      : "/projects/tasks";
    redirect(`${destination}?error=Please%20check%20the%20task%20details.`);
  }

  const context = await resolveTaskMutation(formData);
  if (context.task.isArchived) {
    redirect(
      `/projects/tasks/${context.task.id}?error=Restore%20the%20task%20before%20editing%20it.`,
    );
  }

  const task = await updateProjectConversationalTask(
    context.project.id,
    context.task.id,
    details.data,
  );

  if (!task) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  await writeAuditLog({
    ...context,
    action: "conversational_task.updated",
    targetType: "conversational_task",
    targetId: task.id,
    metadata: { name: task.name },
  });

  revalidatePath("/projects/tasks");
  revalidatePath(`/projects/tasks/${task.id}`);
  redirect(`/projects/tasks/${task.id}?updated=1`);
}

export async function archiveConversationalTaskAction(formData: FormData) {
  const context = await resolveTaskMutation(formData);
  const task = await setProjectConversationalTaskArchived(
    context.project.id,
    context.task.id,
    true,
  );

  if (!task) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  await writeAuditLog({
    ...context,
    action: "conversational_task.archived",
    targetType: "conversational_task",
    targetId: task.id,
    metadata: { name: task.name },
  });

  revalidatePath("/projects/tasks");
  revalidatePath(`/projects/tasks/${task.id}`);
  redirect("/projects/tasks?archived=1");
}

export async function unarchiveConversationalTaskAction(formData: FormData) {
  const context = await resolveTaskMutation(formData);
  const task = await setProjectConversationalTaskArchived(
    context.project.id,
    context.task.id,
    false,
  );

  if (!task) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  await writeAuditLog({
    ...context,
    action: "conversational_task.unarchived",
    targetType: "conversational_task",
    targetId: task.id,
    metadata: { name: task.name },
  });

  revalidatePath("/projects/tasks");
  revalidatePath(`/projects/tasks/${task.id}`);
  redirect(`/projects/tasks/${task.id}?restored=1`);
}
