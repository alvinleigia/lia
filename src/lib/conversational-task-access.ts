import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { resolveStrictUserAndProject } from "@/lib/auth-project";
import { conversationalTaskIdSchema } from "@/lib/conversational-task-schema";
import { getProjectConversationalTask } from "@/lib/conversational-tasks";

const projectIdSchema = z.coerce.number().int().positive();

export async function resolveConversationalTaskMutation(formData: FormData) {
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
