"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { writeAuditLog } from "@/lib/audit";
import { resolveStrictUserAndProject } from "@/lib/auth-project";
import {
  contextVariableDefinitionV1Schema,
  conversationProjectPolicyV1Schema,
  normalizeConversationProjectPolicy,
  taskFieldV1Schema,
  toolBindingV1Schema,
} from "@/lib/conversation-contracts";
import {
  getConversationProjectPolicy,
  saveConversationProjectPolicy,
} from "@/lib/conversation-project-policies";
import {
  conversationalTaskDetailsSchema,
  conversationalTaskIdSchema,
} from "@/lib/conversational-task-schema";
import {
  createProjectConversationalTask,
  getProjectConversationalTask,
  readConversationalTaskDefinition,
  setProjectConversationalTaskArchived,
  updateProjectConversationalTask,
  updateProjectConversationalTaskDefinition,
} from "@/lib/conversational-tasks";
import { getProjectOperation } from "@/lib/operations";

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

export async function updateConversationProjectPolicyAction(
  formData: FormData,
) {
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
  if (!task || task.isArchived) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  const current = await getConversationProjectPolicy(context.project.id);
  const parsed = conversationProjectPolicyV1Schema.safeParse({
    ...normalizeConversationProjectPolicy(current),
    assistant: {
      ...current.assistant,
      baseInstructions: formData.get("baseInstructions") || null,
      greeting: formData.get("greeting") || null,
      greetingStrategy: formData.get("greetingStrategy"),
      language: formData.get("language"),
    },
    entry: {
      ...current.entry,
      allowTaskRecommendation: formData.get("allowTaskRecommendation") === "on",
      mode: formData.get("entryMode"),
    },
    identity: {
      ...current.identity,
      crossChannelLinkRule: formData.get("crossChannelLinkRule"),
      sessionMode: formData.get("sessionMode"),
    },
    knowledge: {
      ...current.knowledge,
      noAnswerBehavior: formData.get("noAnswerBehavior"),
    },
  });

  const destination = `/projects/tasks/${task.id}/configure/assistant`;
  if (!parsed.success) {
    redirect(`${destination}?error=Please%20check%20the%20policy.`);
  }

  await saveConversationProjectPolicy(context.project.id, parsed.data);
  await writeAuditLog({
    ...context,
    action: "conversation_project_policy.updated",
    targetType: "conversation_project_policy",
    targetId: context.project.id,
    metadata: { schemaVersion: parsed.data.schemaVersion },
  });
  revalidatePath(destination);
  redirect(`${destination}?saved=1`);
}

export async function addConversationalTaskFieldAction(formData: FormData) {
  const context = await resolveTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/fields`;
  if (context.task.isArchived) {
    redirect(`${destination}?error=Restore%20the%20task%20before%20editing.`);
  }

  const parsed = taskFieldV1Schema.safeParse({
    id: crypto.randomUUID(),
    key: formData.get("key"),
    label: formData.get("label"),
    type: formData.get("type"),
    required: formData.get("required") === "on",
    requiredWhen: formData.get("requiredWhen") || null,
    validation: formData.get("validation") || null,
    normalization: formData.get("normalization") || null,
    sensitivity: formData.get("sensitivity"),
    confirmation: formData.get("confirmation"),
    sourcePriority: ["visitor", "profile", "project_resource", "tool"],
    dependsOn: String(formData.get("dependsOn") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  });

  const definition = readConversationalTaskDefinition(context.task.definition);
  if (
    !parsed.success ||
    definition.fields.some((field) => field.key === parsed.data.key)
  ) {
    redirect(`${destination}?error=Use%20a%20valid%2C%20unique%20field%20key.`);
  }

  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    {
      ...definition,
      fields: [...definition.fields, parsed.data],
    },
  );
  revalidatePath(destination);
  redirect(`${destination}?fieldAdded=1`);
}

export async function removeConversationalTaskFieldAction(formData: FormData) {
  const context = await resolveTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/fields`;
  const fieldId = z.string().uuid().safeParse(formData.get("fieldId"));
  if (!fieldId.success || context.task.isArchived) {
    redirect(`${destination}?error=Field%20not%20found.`);
  }

  const definition = readConversationalTaskDefinition(context.task.definition);
  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    {
      ...definition,
      fieldTransferWhitelist: definition.fieldTransferWhitelist.filter(
        (key) =>
          !definition.fields.some(
            (field) => field.id === fieldId.data && field.key === key,
          ),
      ),
      fields: definition.fields.filter((field) => field.id !== fieldId.data),
    },
  );
  revalidatePath(destination);
  redirect(`${destination}?fieldRemoved=1`);
}

export async function addTaskContextVariableAction(formData: FormData) {
  const context = await resolveTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/fields`;
  const expires = String(formData.get("expiresAfterMinutes") ?? "").trim();
  const parsed = contextVariableDefinitionV1Schema.safeParse({
    key: formData.get("contextKey"),
    type: formData.get("contextType"),
    source: formData.get("contextSource"),
    defaultValue: formData.get("defaultValue") || null,
    sensitivity: formData.get("contextSensitivity"),
    expiresAfterMinutes: expires ? Number(expires) : null,
    modelVisible: formData.get("modelVisible") === "on",
    toolVisible: formData.get("toolVisible") === "on",
  });

  const definition = readConversationalTaskDefinition(context.task.definition);
  const invalidSystemKey =
    parsed.success &&
    parsed.data.key.startsWith("lia_") &&
    parsed.data.source !== "system";
  if (
    !parsed.success ||
    invalidSystemKey ||
    context.task.isArchived ||
    definition.contextVariables.some(
      (variable) => variable.key === parsed.data.key,
    )
  ) {
    redirect(
      `${destination}?error=Use%20a%20valid%2C%20unique%20context%20key.`,
    );
  }

  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    {
      ...definition,
      contextVariables: [...definition.contextVariables, parsed.data],
    },
  );
  revalidatePath(destination);
  redirect(`${destination}?contextAdded=1`);
}

export async function removeTaskContextVariableAction(formData: FormData) {
  const context = await resolveTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/fields`;
  const key = z.string().min(1).safeParse(formData.get("contextKey"));
  if (!key.success || context.task.isArchived) {
    redirect(`${destination}?error=Context%20variable%20not%20found.`);
  }

  const definition = readConversationalTaskDefinition(context.task.definition);
  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    {
      ...definition,
      contextVariables: definition.contextVariables.filter(
        (variable) => variable.key !== key.data,
      ),
    },
  );
  revalidatePath(destination);
  redirect(`${destination}?contextRemoved=1`);
}

export async function bindConversationalTaskToolAction(formData: FormData) {
  const context = await resolveTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/tools`;
  const operationId = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(formData.get("operationId"));
  if (!operationId.success || context.task.isArchived) {
    redirect(`${destination}?error=Operation%20not%20found.`);
  }
  const operation = await getProjectOperation(
    context.project.id,
    operationId.data,
  );
  const parsed = toolBindingV1Schema.safeParse({
    tool: { id: `operation:${operationId.data}`, version: 1 },
    access: formData.get("access"),
    allowedStages: ["extraction", "lookup", "confirmation", "operation"].filter(
      (stage) => formData.get(`stage_${stage}`) === "on",
    ),
  });
  const definition = readConversationalTaskDefinition(context.task.definition);
  if (
    !operation ||
    operation.operation.status !== "active" ||
    !parsed.success ||
    parsed.data.allowedStages.length === 0 ||
    definition.tools.some((binding) => binding.tool.id === parsed.data.tool.id)
  ) {
    redirect(`${destination}?error=Choose%20an%20active%2C%20unbound%20tool.`);
  }

  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    { ...definition, tools: [...definition.tools, parsed.data] },
  );
  revalidatePath(destination);
  redirect(`${destination}?bound=1`);
}

export async function unbindConversationalTaskToolAction(formData: FormData) {
  const context = await resolveTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/tools`;
  const toolId = z.string().min(1).safeParse(formData.get("toolId"));
  if (!toolId.success || context.task.isArchived) {
    redirect(`${destination}?error=Tool%20binding%20not%20found.`);
  }
  const definition = readConversationalTaskDefinition(context.task.definition);
  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    {
      ...definition,
      tools: definition.tools.filter(
        (binding) => binding.tool.id !== toolId.data,
      ),
    },
  );
  revalidatePath(destination);
  redirect(`${destination}?unbound=1`);
}
