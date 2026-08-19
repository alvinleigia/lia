"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import type { ActionFormState } from "@/lib/action-form-state";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndProject } from "@/lib/auth-project";
import {
  addReusableTemplateVersion,
  approveReusableTemplate,
  createReusableField,
  createReusableTemplate,
  duplicateReusableTemplate,
  REUSABLE_FIELD_TYPES,
  REUSABLE_TEMPLATE_KINDS,
  retireReusableField,
} from "@/lib/reuse-registry";

const scopeSchema = z.enum(["company", "project"]);
const fieldSchema = z.object({
  fieldType: z.enum(REUSABLE_FIELD_TYPES),
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  scope: scopeSchema,
});
const templateSchema = z.object({
  description: z.string().trim().max(500).optional(),
  key: z.string().trim().min(1).max(120),
  kind: z.enum(REUSABLE_TEMPLATE_KINDS),
  name: z.string().trim().min(1).max(160),
  payload: z.string().trim().min(2),
  scope: scopeSchema,
});

function parseId(value: FormDataEntryValue | null) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0)
    throw new Error("Invalid registry item.");
  return id;
}

function parsePayload(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error();
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Payload must be a valid JSON object.");
  }
}

function actionError(error: unknown) {
  if (error instanceof Error && error.message.startsWith("Payload")) {
    return error.message;
  }
  if (error instanceof z.ZodError)
    return "Please check the reusable item details.";
  return "The reusable item could not be saved. Check that its key is unique in this scope.";
}

export async function createReusableFieldAction(
  _state: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  try {
    const data = fieldSchema.parse(Object.fromEntries(formData));
    const context = await resolveUserAndProject();
    assertPermission(context.membership, "company.project.manage");
    const field = await createReusableField({
      companyId: context.company.id,
      createdByUserId: context.user.id,
      fieldType: data.fieldType,
      key: data.key,
      label: data.label,
      projectId: data.scope === "project" ? context.project.id : null,
    });
    await writeAuditLog({
      ...context,
      action: "reusable_field.created",
      targetId: field.id,
      targetType: "reusable_field_definition",
      metadata: {
        fieldType: field.fieldType,
        key: field.key,
        scope: data.scope,
      },
    });
    revalidatePath("/projects/templates");
    return {};
  } catch (error) {
    return { error: actionError(error) };
  }
}

export async function retireReusableFieldAction(formData: FormData) {
  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.project.manage");
  const field = await retireReusableField({
    companyId: context.company.id,
    fieldId: parseId(formData.get("fieldId")),
    projectId: context.project.id,
  });
  if (!field) throw new Error("Reusable field not found.");
  await writeAuditLog({
    ...context,
    action: "reusable_field.retired",
    targetId: field.id,
    targetType: "reusable_field_definition",
    metadata: { key: field.key },
  });
  revalidatePath("/projects/templates");
}

export async function createReusableTemplateAction(
  _state: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  try {
    const data = templateSchema.parse(Object.fromEntries(formData));
    const context = await resolveUserAndProject();
    assertPermission(context.membership, "company.project.manage");
    const result = await createReusableTemplate({
      companyId: context.company.id,
      createdByUserId: context.user.id,
      description: data.description,
      key: data.key,
      kind: data.kind,
      name: data.name,
      payload: parsePayload(data.payload),
      projectId: data.scope === "project" ? context.project.id : null,
    });
    await writeAuditLog({
      ...context,
      action: "reusable_template.created",
      targetId: result.template.id,
      targetType: "reusable_template",
      metadata: {
        key: result.template.key,
        kind: result.template.kind,
        scope: data.scope,
      },
    });
    revalidatePath("/projects/templates");
    return {};
  } catch (error) {
    return { error: actionError(error) };
  }
}

export async function addReusableTemplateVersionAction(
  _state: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  try {
    const context = await resolveUserAndProject();
    assertPermission(context.membership, "company.project.manage");
    const version = await addReusableTemplateVersion({
      companyId: context.company.id,
      createdByUserId: context.user.id,
      payload: parsePayload(String(formData.get("payload") ?? "")),
      projectId: context.project.id,
      templateId: parseId(formData.get("templateId")),
    });
    await writeAuditLog({
      ...context,
      action: "reusable_template.version_created",
      targetId: version.templateId,
      targetType: "reusable_template",
      metadata: { version: version.versionNumber },
    });
    revalidatePath("/projects/templates");
    return {};
  } catch (error) {
    return { error: actionError(error) };
  }
}

export async function approveReusableTemplateAction(formData: FormData) {
  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.project.manage");
  const template = await approveReusableTemplate({
    companyId: context.company.id,
    projectId: context.project.id,
    templateId: parseId(formData.get("templateId")),
    userId: context.user.id,
  });
  await writeAuditLog({
    ...context,
    action: "reusable_template.approved",
    targetId: template.id,
    targetType: "reusable_template",
    metadata: { version: template.currentVersion },
  });
  revalidatePath("/projects/templates");
}

export async function duplicateReusableTemplateAction(formData: FormData) {
  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.project.manage");
  const result = await duplicateReusableTemplate({
    companyId: context.company.id,
    createdByUserId: context.user.id,
    projectId: context.project.id,
    templateId: parseId(formData.get("templateId")),
  });
  await writeAuditLog({
    ...context,
    action: "reusable_template.duplicated",
    targetId: result.template.id,
    targetType: "reusable_template",
    metadata: { sourceTemplateId: parseId(formData.get("templateId")) },
  });
  revalidatePath("/projects/templates");
}
