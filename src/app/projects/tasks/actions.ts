"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { listProjectReusableActionFields } from "@/lib/action-flows";
import type { ActionFormState } from "@/lib/action-form-state";
import { writeAuditLog } from "@/lib/audit";
import { resolveStrictUserAndProject } from "@/lib/auth-project";
import {
  evaluateContextVariableRemoval,
  isProtectedContextVariable,
} from "@/lib/context-variable-dependencies";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "@/lib/conversation-contract-fixtures";
import {
  CUSTOM_CONTEXT_SOURCES,
  contextVariableDefinitionV1Schema,
  conversationProjectPolicyV1Schema,
  FIELD_TYPES,
  normalizeConversationProjectPolicy,
  TURN_MODEL_STAGES,
  taskFieldV1Schema,
  taskOutcomeV1Schema,
  toolBindingV1Schema,
} from "@/lib/conversation-contracts";
import { isAllowedConversationLanguage } from "@/lib/conversation-languages";
import {
  getConversationProjectPolicy,
  saveConversationProjectPolicy,
} from "@/lib/conversation-project-policies";
import { resolveConversationalTaskMutation } from "@/lib/conversational-task-access";
import {
  buildFriendlyValidation,
  buildRequiredWhen,
  createStableFieldKey,
  createUniqueFieldKey,
  findTaskFieldReferences,
  moveTaskField,
  type TaskField,
  taskFieldTypeFromActionInputTypes,
} from "@/lib/conversational-task-builder";
import {
  conversationalTaskDetailsSchema,
  conversationalTaskIdSchema,
} from "@/lib/conversational-task-schema";
import {
  CONVERSATIONAL_TASK_TEMPLATE_KEYS,
  createConversationalTaskDefinitionFromTemplate,
} from "@/lib/conversational-task-templates";
import {
  getMissingTaskToolSourceKeys,
  resolveProjectTaskToolDefinition,
} from "@/lib/conversational-task-tools";
import { validateConversationalTaskForPublish } from "@/lib/conversational-task-validation";
import {
  createProjectConversationalTask,
  getProjectConversationalTask,
  publishConversationalTask,
  readConversationalTaskDefinition,
  setProjectConversationalTaskArchived,
  updateProjectConversationalTask,
  updateProjectConversationalTaskDefinition,
} from "@/lib/conversational-tasks";
import { normalizeProjectAiSettings } from "@/lib/project-ai-settings";

const projectIdSchema = z.coerce.number().int().positive();
const taskCompletionActionSchema = z.enum(["return_to_knowledge", "end"]);
const taskFieldRequirementSchema = z.enum([
  "always",
  "optional",
  "conditional",
]);
const guidedConditionOperatorSchema = z.enum([
  "present",
  "missing",
  "equals",
  "not_equals",
]);
const friendlyValidationKindSchema = z.enum([
  "none",
  "minimum_length",
  "maximum_length",
  "existing",
]);

function parseFieldOptionSource(formData: FormData) {
  const kind = formData.get("optionSourceKind");
  if (kind === "static") {
    return {
      kind,
      options: String(formData.get("staticOptions") ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [value, ...labelParts] = line.split("|");
          return {
            value: value.trim(),
            label: labelParts.join("|").trim() || value.trim(),
          };
        }),
    };
  }
  if (kind === "project_resource") {
    return {
      kind,
      resourceType: formData.get("resourceType"),
      collectionKey: formData.get("collectionKey") || null,
      filterByField: formData.get("filterByField") || null,
    };
  }
  return null;
}

function parseTaskFieldFormData(
  formData: FormData,
  input: {
    existing?: TaskField;
    key: string;
  },
) {
  const requirement = taskFieldRequirementSchema.safeParse(
    formData.get("requirementMode"),
  );
  const validationKind = friendlyValidationKindSchema.safeParse(
    formData.get("validationKind"),
  );
  if (!requirement.success || !validationKind.success) {
    return { error: "Please check the field settings." } as const;
  }

  const isConditional = requirement.data === "conditional";
  const conditionOperator = guidedConditionOperatorSchema.safeParse(
    isConditional ? formData.get("conditionOperator") : "present",
  );
  if (!conditionOperator.success) {
    return { error: "Please check the field settings." } as const;
  }

  const conditionField = isConditional
    ? String(formData.get("conditionField") ?? "").trim()
    : "";
  const guidedRequiredWhen =
    isConditional && conditionField
      ? buildRequiredWhen({
          fieldKey: conditionField,
          operator: conditionOperator.data,
          value: String(formData.get("conditionValue") ?? ""),
        })
      : null;
  const requiredWhen = isConditional
    ? guidedRequiredWhen || input.existing?.requiredWhen || null
    : null;
  if (isConditional && !requiredWhen) {
    return {
      error: "Choose when this field should become required.",
    } as const;
  }

  const validation =
    validationKind.data === "existing"
      ? (input.existing?.validation ?? null)
      : buildFriendlyValidation(
          validationKind.data,
          String(formData.get("validationValue") ?? ""),
        );
  if (
    validationKind.data !== "none" &&
    validationKind.data !== "existing" &&
    !validation
  ) {
    return { error: "Enter a valid character limit." } as const;
  }

  const dependsOn = Array.from(
    new Set(
      formData
        .getAll("dependsOn")
        .map(String)
        .map((value) => value.trim())
        .filter(Boolean)
        .concat(conditionField || []),
    ),
  );
  const parsed = taskFieldV1Schema.safeParse({
    id: input.existing?.id ?? crypto.randomUUID(),
    key: input.key,
    label: formData.get("label"),
    type: formData.get("type"),
    cardinality: formData.get("cardinality") || "single",
    prompt: formData.get("prompt") || null,
    optionSource: parseFieldOptionSource(formData),
    required: requirement.data === "always",
    requiredWhen,
    validation,
    normalization: formData.get("normalization") || null,
    sensitivity: formData.get("sensitivity") || "standard",
    confirmation: formData.get("confirmation") || "when_changed",
    sourcePriority: input.existing?.sourcePriority ?? [
      "visitor",
      "profile",
      "project_resource",
      "tool",
    ],
    dependsOn,
  });

  return parsed.success
    ? ({ field: parsed.data } as const)
    : ({
        error: "Please check the field details and answer source.",
      } as const);
}

function parseTaskDetails(formData: FormData) {
  return conversationalTaskDetailsSchema.safeParse({
    description: formData.get("description"),
    name: formData.get("name"),
    objective: formData.get("objective"),
  });
}

export async function createConversationalTaskAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const projectId = projectIdSchema.safeParse(formData.get("projectId"));
  const details = parseTaskDetails(formData);
  const templateKey = z
    .enum(CONVERSATIONAL_TASK_TEMPLATE_KEYS)
    .safeParse(formData.get("templateKey"));
  const completionAction = taskCompletionActionSchema.safeParse(
    formData.get("completionAction"),
  );

  if (
    !projectId.success ||
    !details.success ||
    !templateKey.success ||
    !completionAction.success
  ) {
    return { error: "Please check the task details." };
  }

  const context = await resolveStrictUserAndProject(projectId.data);
  assertPermission(context.membership, "company.project.manage");
  const templateDefinition = createConversationalTaskDefinitionFromTemplate(
    templateKey.data,
  );
  const task = await createProjectConversationalTask(
    context.project.id,
    details.data,
    {
      ...templateDefinition,
      returnPolicy: {
        ...templateDefinition.returnPolicy,
        completed: completionAction.data,
      },
    },
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

export async function updateConversationalTaskAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const details = parseTaskDetails(formData);
  const completionAction = taskCompletionActionSchema.safeParse(
    formData.get("completionAction"),
  );

  if (!details.success || !completionAction.success) {
    return { error: "Please check the task details." };
  }

  const context = await resolveConversationalTaskMutation(formData);
  if (context.task.isArchived) {
    return { error: "Restore the task before editing it." };
  }

  const definition = readConversationalTaskDefinition(context.task.definition);
  const task = await updateProjectConversationalTask(
    context.project.id,
    context.task.id,
    details.data,
    {
      ...definition,
      returnPolicy: {
        ...definition.returnPolicy,
        completed: completionAction.data,
      },
    },
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
  const context = await resolveConversationalTaskMutation(formData);
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
  const context = await resolveConversationalTaskMutation(formData);
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
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
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
  const language = String(formData.get("language") ?? "").trim();
  if (!isAllowedConversationLanguage(language, current.assistant.language)) {
    return { error: "Please select a supported language." };
  }
  const stageOverrides = TURN_MODEL_STAGES.flatMap((stage) => {
    const modelId = String(formData.get(`stageModelId:${stage}`) ?? "").trim();
    if (!modelId) {
      return [];
    }

    const fallbackModelId = String(
      formData.get(`stageFallbackModelId:${stage}`) ?? "",
    ).trim();
    return [
      {
        stage,
        modelId,
        fallbackModelId: fallbackModelId || null,
      },
    ];
  });
  const parsed = conversationProjectPolicyV1Schema.safeParse({
    ...normalizeConversationProjectPolicy(current),
    assistant: {
      ...current.assistant,
      baseInstructions: formData.get("baseInstructions") || null,
      greeting: formData.get("greeting") || null,
      greetingStrategy: formData.get("greetingStrategy"),
      language,
      modelPolicy: {
        ...current.assistant.modelPolicy,
        mode: formData.get("modelPolicyMode"),
        primaryModelId: formData.get("primaryModelId"),
        fallbackModelId: formData.get("fallbackModelId") || null,
        timeoutMs: Number(formData.get("timeoutMs")),
        maxOutputTokens: Number(formData.get("maxOutputTokens")),
        maxRetries: Number(formData.get("maxRetries")),
        maxRepairAttempts: Number(formData.get("maxRepairAttempts")),
        maxVisitorCharacters: Number(formData.get("maxVisitorCharacters")),
        maxHistoryMessages: Number(formData.get("maxHistoryMessages")),
        maxTurnsPerMinute: Number(formData.get("maxTurnsPerMinute")),
        maxCostUnitsPerTurn: Number(formData.get("maxCostUnitsPerTurn")),
        stageOverrides,
      },
    },
    entry: {
      ...current.entry,
      allowTaskRecommendation: formData.get("allowTaskRecommendation") === "on",
      maxConnectedFlowDepth: Number(formData.get("maxConnectedFlowDepth")),
      maxHandoffDepth: Number(formData.get("maxHandoffDepth")),
      maxTaskSwitches: Number(formData.get("maxTaskSwitches")),
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
    return { error: "Please check the policy." };
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

export async function updateConversationKnowledgePolicyAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/knowledge`;
  if (context.task.isArchived) {
    return { error: "Restore the task before editing it." };
  }

  const parsed = z
    .object({
      allowTaskRecommendation: z.boolean(),
      noAnswerBehavior: z.enum(["fallback", "handoff", "task_recommendation"]),
    })
    .safeParse({
      allowTaskRecommendation: formData.get("allowTaskRecommendation") === "on",
      noAnswerBehavior: formData.get("noAnswerBehavior"),
    });
  if (!parsed.success) {
    return { error: "Please check the knowledge settings." };
  }

  const policy = await getConversationProjectPolicy(context.project.id);
  await saveConversationProjectPolicy(context.project.id, {
    ...policy,
    entry: {
      ...policy.entry,
      allowTaskRecommendation: parsed.data.allowTaskRecommendation,
    },
    knowledge: {
      ...policy.knowledge,
      noAnswerBehavior: parsed.data.noAnswerBehavior,
    },
  });
  await writeAuditLog({
    ...context,
    action: "conversation_knowledge_policy.updated",
    targetType: "conversation_project_policy",
    targetId: context.project.id,
    metadata: {
      allowTaskRecommendation: parsed.data.allowTaskRecommendation,
      noAnswerBehavior: parsed.data.noAnswerBehavior,
    },
  });
  revalidatePath(destination);
  redirect(`${destination}?saved=1`);
}

export async function addConversationalTaskFieldAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/fields`;
  if (context.task.isArchived) {
    return { error: "Restore the task before editing." };
  }

  const definition = readConversationalTaskDefinition(context.task.definition);
  const label = String(formData.get("label") ?? "").trim();
  const suppliedKey = String(formData.get("key") ?? "").trim();
  const key = suppliedKey || createStableFieldKey(label);
  const parsed = parseTaskFieldFormData(formData, { key });
  if ("error" in parsed) {
    return parsed;
  }
  if (definition.fields.some((field) => field.key === parsed.field.key)) {
    return { error: "Use a valid, unique field key." };
  }

  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    {
      ...definition,
      fields: [...definition.fields, parsed.field],
    },
  );
  revalidatePath(destination);
  redirect(`${destination}?fieldAdded=1`);
}

export async function updateConversationalTaskFieldAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/fields`;
  const fieldId = z.string().uuid().safeParse(formData.get("fieldId"));
  if (!fieldId.success || context.task.isArchived) {
    return { error: "Field not found." };
  }

  const definition = readConversationalTaskDefinition(context.task.definition);
  const existing = definition.fields.find(
    (candidate) => candidate.id === fieldId.data,
  );
  if (!existing) {
    return { error: "Field not found." };
  }

  const parsed = parseTaskFieldFormData(formData, {
    existing,
    key: existing.key,
  });
  if ("error" in parsed) {
    return parsed;
  }

  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    {
      ...definition,
      fields: definition.fields.map((field) =>
        field.id === existing.id ? parsed.field : field,
      ),
    },
  );
  revalidatePath(destination);
  redirect(`${destination}?fieldUpdated=1`);
}

export async function duplicateConversationalTaskFieldAction(
  formData: FormData,
) {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/fields`;
  const fieldId = z.string().uuid().safeParse(formData.get("fieldId"));
  if (!fieldId.success || context.task.isArchived) {
    redirect(`${destination}?error=Field%20not%20found.`);
  }

  const definition = readConversationalTaskDefinition(context.task.definition);
  const index = definition.fields.findIndex(
    (candidate) => candidate.id === fieldId.data,
  );
  const existing = definition.fields[index];
  if (!existing) {
    redirect(`${destination}?error=Field%20not%20found.`);
  }

  const copy: TaskField = {
    ...existing,
    id: crypto.randomUUID(),
    key: createUniqueFieldKey(
      existing.key,
      definition.fields.map((field) => field.key),
    ),
    label: `${existing.label} Copy`.slice(0, 120),
  };
  const fields = [...definition.fields];
  fields.splice(index + 1, 0, copy);

  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    { ...definition, fields },
  );
  revalidatePath(destination);
  redirect(`${destination}?fieldDuplicated=1`);
}

export async function moveConversationalTaskFieldAction(formData: FormData) {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/fields`;
  const fieldId = z.string().uuid().safeParse(formData.get("fieldId"));
  const direction = z.enum(["up", "down"]).safeParse(formData.get("direction"));
  if (!fieldId.success || !direction.success || context.task.isArchived) {
    redirect(`${destination}?error=Field%20not%20found.`);
  }

  const definition = readConversationalTaskDefinition(context.task.definition);
  if (!definition.fields.some((field) => field.id === fieldId.data)) {
    redirect(`${destination}?error=Field%20not%20found.`);
  }

  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    {
      ...definition,
      fields: moveTaskField(definition.fields, fieldId.data, direction.data),
    },
  );
  revalidatePath(destination);
  redirect(`${destination}?fieldMoved=1`);
}

export async function addReusableConversationalTaskFieldAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/fields`;
  if (context.task.isArchived) {
    return { error: "Restore the task before editing." };
  }

  const selectedKey = z
    .string()
    .trim()
    .min(1)
    .safeParse(formData.get("reusableFieldKey"));
  if (!selectedKey.success) {
    return { error: "Choose a reusable field." };
  }

  const definition = readConversationalTaskDefinition(context.task.definition);
  if (definition.fields.some((field) => field.key === selectedKey.data)) {
    return { error: "That field is already part of this task." };
  }

  const available = await listProjectReusableActionFields(context.project.id);
  const reusable = available.find(
    (field) => field.fieldKey === selectedKey.data,
  );
  if (!reusable) {
    return { error: "That reusable field is no longer available." };
  }

  const parsed = taskFieldV1Schema.safeParse({
    id: crypto.randomUUID(),
    key: reusable.fieldKey,
    label: reusable.labels[0] || reusable.fieldKey,
    type: taskFieldTypeFromActionInputTypes(reusable.inputTypes),
    cardinality: "single",
    prompt: null,
    optionSource: null,
    required: false,
    requiredWhen: null,
    validation: null,
    normalization: null,
    sensitivity: "standard",
    confirmation: "when_changed",
    sourcePriority: ["visitor", "profile", "project_resource", "tool"],
    dependsOn: [],
  });
  if (!parsed.success) {
    return { error: "That reusable field has an incompatible key." };
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
  redirect(`${destination}?fieldReused=1`);
}

export async function removeConversationalTaskFieldAction(formData: FormData) {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/fields`;
  const fieldId = z.string().uuid().safeParse(formData.get("fieldId"));
  if (!fieldId.success || context.task.isArchived) {
    redirect(`${destination}?error=Field%20not%20found.`);
  }

  const definition = readConversationalTaskDefinition(context.task.definition);
  const field = definition.fields.find(
    (candidate) => candidate.id === fieldId.data,
  );
  if (!field) {
    redirect(`${destination}?error=Field%20not%20found.`);
  }
  const references = findTaskFieldReferences(definition, field.key);
  if (references.length > 0) {
    redirect(
      `${destination}?error=${encodeURIComponent(
        `${field.label} is used by ${references.join(", ")}. Remove those references first.`,
      )}`,
    );
  }
  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    {
      ...definition,
      fieldTransferWhitelist: definition.fieldTransferWhitelist.filter(
        (rule) => rule.fieldKey !== field.key,
      ),
      fields: definition.fields.filter((field) => field.id !== fieldId.data),
    },
  );
  revalidatePath(destination);
  redirect(`${destination}?fieldRemoved=1`);
}

export async function addTaskContextVariableAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/fields`;
  if (formData.get("contextSource") === "system") {
    return { error: "System context is managed by Lia." };
  }
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
  if (parsed.success && parsed.data.key.startsWith("lia_")) {
    return { error: "The lia_ prefix is reserved for system context." };
  }
  if (
    !parsed.success ||
    context.task.isArchived ||
    definition.contextVariables.some(
      (variable) => variable.key === parsed.data.key,
    )
  ) {
    return { error: "Use a valid, unique context key." };
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

export async function updateTaskContextVariableAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/fields`;
  const parsed = z
    .object({
      key: z.string().trim().min(1).max(80),
      defaultValue: z.string().trim().max(2000).nullable(),
      expiresAfterMinutes: z.number().int().positive().nullable(),
      modelVisible: z.boolean(),
      sensitivity: z.enum(["standard", "personal", "sensitive"]),
      source: z.enum(CUSTOM_CONTEXT_SOURCES),
      toolVisible: z.boolean(),
      type: z.enum(FIELD_TYPES),
    })
    .safeParse({
      key: formData.get("contextKey"),
      defaultValue: formData.get("defaultValue") || null,
      expiresAfterMinutes: String(
        formData.get("expiresAfterMinutes") ?? "",
      ).trim()
        ? Number(formData.get("expiresAfterMinutes"))
        : null,
      modelVisible: formData.get("modelVisible") === "on",
      sensitivity: formData.get("contextSensitivity"),
      source: formData.get("contextSource"),
      toolVisible: formData.get("toolVisible") === "on",
      type: formData.get("contextType"),
    });
  if (!parsed.success || context.task.isArchived) {
    return { error: "Please check the context variable." };
  }

  const definition = readConversationalTaskDefinition(context.task.definition);
  const variable = definition.contextVariables.find(
    (candidate) => candidate.key === parsed.data.key,
  );
  if (!variable) {
    return { error: "Context variable not found." };
  }
  if (isProtectedContextVariable(variable)) {
    return { error: "System context is managed by Lia." };
  }

  const updated = contextVariableDefinitionV1Schema.safeParse({
    ...variable,
    defaultValue: parsed.data.defaultValue,
    expiresAfterMinutes: parsed.data.expiresAfterMinutes,
    modelVisible: parsed.data.modelVisible,
    sensitivity: parsed.data.sensitivity,
    source: parsed.data.source,
    toolVisible: parsed.data.toolVisible,
    type: parsed.data.type,
  });
  if (!updated.success) {
    return { error: "Please check the context variable." };
  }

  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    {
      ...definition,
      contextVariables: definition.contextVariables.map((candidate) =>
        candidate.key === parsed.data.key ? updated.data : candidate,
      ),
    },
  );
  revalidatePath(destination);
  redirect(`${destination}?contextUpdated=1`);
}

export async function removeTaskContextVariableAction(formData: FormData) {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/fields`;
  const key = z.string().min(1).safeParse(formData.get("contextKey"));
  if (!key.success || context.task.isArchived) {
    redirect(`${destination}?error=Context%20variable%20not%20found.`);
  }

  const definition = readConversationalTaskDefinition(context.task.definition);
  const removal = evaluateContextVariableRemoval(definition, key.data);
  if (!removal.allowed) {
    redirect(`${destination}?error=${encodeURIComponent(removal.reason)}`);
  }

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

export async function bindConversationalTaskToolAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/tools`;
  const toolReference = z
    .string()
    .trim()
    .min(3)
    .max(140)
    .safeParse(formData.get("toolRef"));
  const referenceMatch = toolReference.success
    ? toolReference.data.match(/^(.+)@(\d+)$/)
    : null;
  const version = referenceMatch
    ? z.coerce.number().int().positive().safeParse(referenceMatch[2])
    : null;
  if (!referenceMatch || !version?.success || context.task.isArchived) {
    return { error: "Tool not found." };
  }
  const toolId = referenceMatch[1];
  const definition = readConversationalTaskDefinition(context.task.definition);
  const tool = await resolveProjectTaskToolDefinition({
    definition,
    projectId: context.project.id,
    toolId,
    version: version.data,
  });
  const parsed = toolBindingV1Schema.safeParse({
    tool: { id: toolId, version: version.data },
    access: tool?.access,
    allowedStages: ["extraction", "lookup", "confirmation", "operation"].filter(
      (stage) => formData.get(`stage_${stage}`) === "on",
    ),
  });
  if (
    !tool ||
    !parsed.success ||
    parsed.data.allowedStages.length === 0 ||
    getMissingTaskToolSourceKeys({
      definition,
      toolDefinition: tool,
    }).length > 0 ||
    definition.tools.some((binding) => binding.tool.id === parsed.data.tool.id)
  ) {
    return { error: "Choose a ready, unbound tool and at least one stage." };
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
  const context = await resolveConversationalTaskMutation(formData);
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

export async function addConversationalTaskOutcomeAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/outcomes`;
  const definition = readConversationalTaskDefinition(context.task.definition);
  const label = z
    .string()
    .trim()
    .min(1)
    .max(120)
    .safeParse(formData.get("label"));
  if (!label.success || context.task.isArchived) {
    return { error: "Enter an outcome name." };
  }
  const requestedKey = String(formData.get("key") ?? "").trim();
  const key =
    requestedKey ||
    createUniqueFieldKey(
      label.data,
      definition.outcomes.flatMap((outcome) => [
        outcome.key,
        outcome.outputPort,
      ]),
    );
  const parsed = taskOutcomeV1Schema.safeParse({
    id: crypto.randomUUID(),
    key,
    label: label.data,
    type: formData.get("type"),
    condition: formData.get("condition") || null,
    outputPort: formData.get("outputPort") || key,
  });
  if (
    !parsed.success ||
    definition.outcomes.some(
      (outcome) =>
        outcome.key === parsed.data.key ||
        outcome.outputPort === parsed.data.outputPort,
    )
  ) {
    return { error: "Use a valid, unique outcome name and destination." };
  }
  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    { ...definition, outcomes: [...definition.outcomes, parsed.data] },
  );
  revalidatePath(destination);
  redirect(`${destination}?outcomeAdded=1`);
}

export async function removeConversationalTaskOutcomeAction(
  formData: FormData,
) {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/outcomes`;
  const outcomeId = z.string().uuid().safeParse(formData.get("outcomeId"));
  const definition = readConversationalTaskDefinition(context.task.definition);
  if (
    !outcomeId.success ||
    context.task.isArchived ||
    definition.outcomes.length <= 1
  ) {
    redirect(
      `${destination}?error=At%20least%20one%20outcome%20is%20required.`,
    );
  }
  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    {
      ...definition,
      outcomes: definition.outcomes.filter(
        (outcome) => outcome.id !== outcomeId.data,
      ),
    },
  );
  revalidatePath(destination);
  redirect(`${destination}?outcomeRemoved=1`);
}

export async function updateConversationalTaskSafetyAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/outcomes`;
  if (context.task.isArchived) {
    return { error: "Restore the task before editing." };
  }
  const definition = readConversationalTaskDefinition(context.task.definition);
  const parsed = z
    .object({
      responseLength: z.enum(["short", "balanced", "detailed"]),
      language: z
        .string()
        .trim()
        .min(2)
        .max(40)
        .refine((language) =>
          isAllowedConversationLanguage(
            language,
            definition.taskPolicy.language,
          ),
        ),
      fallbackMessage: z.string().trim().max(1000).nullable(),
      handoffMessage: z.string().trim().max(1000).nullable(),
      instructions: z.string().trim().max(2000).nullable(),
      identityRequirement: z.enum([
        "anonymous",
        "verified_contact",
        "authenticated_user",
      ]),
      consentRequirement: z.enum(["inherit", "required"]),
      completed: z.enum(["return_to_knowledge", "end"]),
      cancelled: z.enum(["return_to_knowledge", "end"]),
      failed: z.enum(["return_to_knowledge", "handoff", "end"]),
      noAnswer: z.enum(["return_to_knowledge", "handoff", "end"]),
      handoff: z.enum(["suspend", "end"]),
      model: z.enum(["deterministic_fallback", "handoff", "fail"]),
      retrieval: z.enum(["clarify", "handoff", "fail"]),
      tool: z.enum(["retry", "handoff", "fail"]),
      outboundChannel: z.enum(["retry", "fail"]),
      fieldRetentionDays: z.coerce.number().int().min(1).max(3650),
      messageRetentionDays: z.coerce.number().int().min(1).max(3650),
      consentRequired: z.boolean(),
      deletionMode: z.enum(["on_request", "automatic"]),
      exportAllowed: z.boolean(),
      sensitiveModelVisibility: z.enum(["denied", "task_only"]),
      toolVisibility: z.enum(["binding_only", "denied"]),
    })
    .safeParse({
      responseLength: formData.get("responseLength"),
      language: formData.get("language"),
      fallbackMessage: formData.get("fallbackMessage") || null,
      handoffMessage: formData.get("handoffMessage") || null,
      instructions: formData.get("instructions") || null,
      identityRequirement: formData.get("identityRequirement"),
      consentRequirement: formData.get("consentRequirement"),
      completed: formData.get("completed"),
      cancelled: formData.get("cancelled"),
      failed: formData.get("failed"),
      noAnswer: formData.get("noAnswer"),
      handoff: formData.get("handoff"),
      model: formData.get("model"),
      retrieval: formData.get("retrieval"),
      tool: formData.get("tool"),
      outboundChannel: formData.get("outboundChannel"),
      fieldRetentionDays: formData.get("fieldRetentionDays"),
      messageRetentionDays: formData.get("messageRetentionDays"),
      consentRequired: formData.get("consentRequired") === "on",
      deletionMode: formData.get("deletionMode"),
      exportAllowed: formData.get("exportAllowed") === "on",
      sensitiveModelVisibility: formData.get("sensitiveModelVisibility"),
      toolVisibility: formData.get("toolVisibility"),
    });
  if (!parsed.success) {
    return { error: "Please check the policy values." };
  }

  await updateProjectConversationalTaskDefinition(
    context.project.id,
    context.task.id,
    {
      ...definition,
      taskPolicy: {
        consentRequirement: parsed.data.consentRequirement,
        fallbackMessage: parsed.data.fallbackMessage,
        handoffMessage: parsed.data.handoffMessage,
        identityRequirement: parsed.data.identityRequirement,
        instructions: parsed.data.instructions,
        language: parsed.data.language,
        responseLength: parsed.data.responseLength,
      },
      returnPolicy: {
        schemaVersion: 1,
        completed: parsed.data.completed,
        cancelled: parsed.data.cancelled,
        failed: parsed.data.failed,
        handoff: parsed.data.handoff,
        noAnswer: parsed.data.noAnswer,
      },
      degradedMode: {
        model: parsed.data.model,
        outboundChannel: parsed.data.outboundChannel,
        retrieval: parsed.data.retrieval,
        tool: parsed.data.tool,
      },
    },
  );

  const projectPolicy = await getConversationProjectPolicy(context.project.id);
  await saveConversationProjectPolicy(context.project.id, {
    ...projectPolicy,
    dataHandling: {
      ...projectPolicy.dataHandling,
      consentRequired: parsed.data.consentRequired,
      deletionMode: parsed.data.deletionMode,
      exportAllowed: parsed.data.exportAllowed,
      fieldRetentionDays: parsed.data.fieldRetentionDays,
      messageRetentionDays: parsed.data.messageRetentionDays,
      sensitiveModelVisibility: parsed.data.sensitiveModelVisibility,
      toolVisibility: parsed.data.toolVisibility,
    },
  });
  revalidatePath(destination);
  redirect(`${destination}?saved=1`);
}

export async function publishConversationalTaskAction(formData: FormData) {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/versions`;
  const definition = readConversationalTaskDefinition(context.task.definition);
  const projectPolicy = await getConversationProjectPolicy(context.project.id);
  const validation = validateConversationalTaskForPublish({
    definition,
    projectPolicy,
  });
  if (!validation.ready || context.task.isArchived) {
    redirect(
      `${destination}?error=Resolve%20the%20publish%20blockers%20first.`,
    );
  }
  let version: Awaited<ReturnType<typeof publishConversationalTask>>;
  try {
    version = await publishConversationalTask({
      assistantBehavior: normalizeProjectAiSettings(context.project.aiSettings),
      projectId: context.project.id,
      taskId: context.task.id,
      userId: context.user.id,
      projectPolicy,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Tool validation failed.";
    redirect(`${destination}?error=${encodeURIComponent(message)}`);
  }
  if (!version) {
    redirect(`${destination}?error=Task%20could%20not%20be%20published.`);
  }
  await writeAuditLog({
    ...context,
    action: "conversational_task.published",
    targetType: "conversational_task_version",
    targetId: version.id,
    metadata: {
      taskId: context.task.id,
      versionNumber: version.versionNumber,
    },
  });
  revalidatePath(destination);
  revalidatePath(`/projects/tasks/${context.task.id}`);
  redirect(`${destination}?published=${version.versionNumber}`);
}

export async function applyReferenceBookingTaskAction(formData: FormData) {
  const context = await resolveConversationalTaskMutation(formData);
  const destination = `/projects/tasks/${context.task.id}/configure/fields`;
  if (context.task.isArchived) {
    redirect(`${destination}?error=Restore%20the%20task%20before%20editing.`);
  }
  await Promise.all([
    updateProjectConversationalTaskDefinition(
      context.project.id,
      context.task.id,
      REFERENCE_BOOKING_TASK_DEFINITION,
    ),
    saveConversationProjectPolicy(
      context.project.id,
      REFERENCE_BOOKING_PROJECT_POLICY,
    ),
  ]);
  await writeAuditLog({
    ...context,
    action: "conversational_task.reference_booking_applied",
    targetType: "conversational_task",
    targetId: context.task.id,
    metadata: { schemaVersion: 1 },
  });
  revalidatePath(`/projects/tasks/${context.task.id}`, "layout");
  redirect(`${destination}?templateApplied=1`);
}
