import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db-config";
import {
  reusableFieldDefinitions,
  reusableTemplates,
  reusableTemplateVersions,
} from "@/lib/db-schema";

export const REUSABLE_FIELD_TYPES = [
  "text",
  "number",
  "email",
  "phone",
  "date",
  "time",
  "boolean",
  "choice",
  "json",
] as const;

export const REUSABLE_TEMPLATE_KINDS = [
  "task",
  "field_set",
  "node",
  "composed_content",
] as const;

export type ReusableFieldType = (typeof REUSABLE_FIELD_TYPES)[number];
export type ReusableTemplateKind = (typeof REUSABLE_TEMPLATE_KINDS)[number];

const fieldReferenceSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
  required: z.boolean().optional(),
  type: z.enum(REUSABLE_FIELD_TYPES),
});

const payloadSchemas = {
  task: z.object({ definition: z.record(z.string(), z.unknown()) }),
  field_set: z.object({ fields: z.array(fieldReferenceSchema).min(1) }),
  node: z.object({ step: z.record(z.string(), z.unknown()) }),
  composed_content: z.object({
    content: z.array(z.record(z.string(), z.unknown())).min(1),
  }),
} satisfies Record<ReusableTemplateKind, z.ZodType>;

export type RegistryField = typeof reusableFieldDefinitions.$inferSelect;

export function resolveReusableFields<
  T extends Pick<RegistryField, "key" | "projectId">,
>(fields: T[]) {
  const resolved = new Map<string, T>();

  for (const field of fields) {
    const existing = resolved.get(field.key);
    if (!existing || field.projectId !== null) resolved.set(field.key, field);
  }

  return [...resolved.values()];
}

export function normalizeRegistryKey(value: string) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function parseReusableTemplatePayload(
  kind: ReusableTemplateKind,
  value: unknown,
) {
  return payloadSchemas[kind].parse(value) as Record<string, unknown>;
}

export function getReusableTemplateFieldReferences(
  payload: Record<string, unknown>,
) {
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  return fields.flatMap((field) => {
    const parsed = fieldReferenceSchema.safeParse(field);
    return parsed.success ? [parsed.data] : [];
  });
}

export function checkReusableTemplateCompatibility(
  payload: Record<string, unknown>,
  fields: Array<Pick<RegistryField, "fieldType" | "key" | "projectId">>,
) {
  const available = new Map(
    resolveReusableFields(fields).map((field) => [field.key, field]),
  );

  const errors: string[] = [];
  for (const reference of getReusableTemplateFieldReferences(payload)) {
    const field = available.get(reference.key);
    if (!field) {
      errors.push(`Field ${reference.key} is not registered in this scope.`);
    } else if (field.fieldType !== reference.type) {
      errors.push(
        `Field ${reference.key} expects ${reference.type}, but the registry defines ${field.fieldType}.`,
      );
    }
  }

  return { compatible: errors.length === 0, errors };
}

export function getReusableTemplateUpgradeGuidance(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  const before = new Map(
    getReusableTemplateFieldReferences(previous).map((field) => [
      field.key,
      field,
    ]),
  );
  const after = new Map(
    getReusableTemplateFieldReferences(next).map((field) => [field.key, field]),
  );
  const added = [...after.keys()].filter((key) => !before.has(key));
  const removed = [...before.keys()].filter((key) => !after.has(key));
  const changed = [...after.keys()].filter(
    (key) => before.has(key) && before.get(key)?.type !== after.get(key)?.type,
  );

  return {
    added,
    changed,
    compatible: removed.length === 0 && changed.length === 0,
    guidance:
      removed.length > 0 || changed.length > 0
        ? "Review removed or type-changed fields before upgrading existing consumers."
        : added.length > 0
          ? "Existing consumers remain compatible; map the newly added fields when needed."
          : "No reusable-field contract changes detected.",
    removed,
  };
}

export async function listReusableFields(companyId: number, projectId: number) {
  return db
    .select()
    .from(reusableFieldDefinitions)
    .where(
      and(
        eq(reusableFieldDefinitions.companyId, companyId),
        or(
          isNull(reusableFieldDefinitions.projectId),
          eq(reusableFieldDefinitions.projectId, projectId),
        ),
      ),
    )
    .orderBy(asc(reusableFieldDefinitions.key));
}

export async function createReusableField(input: {
  companyId: number;
  createdByUserId: number;
  definition?: Record<string, unknown>;
  fieldType: ReusableFieldType;
  key: string;
  label: string;
  projectId: number | null;
}) {
  const [field] = await db
    .insert(reusableFieldDefinitions)
    .values({ ...input, key: normalizeRegistryKey(input.key) })
    .returning();
  return field;
}

export async function retireReusableField(input: {
  companyId: number;
  fieldId: number;
  projectId: number;
}) {
  const [field] = await db
    .update(reusableFieldDefinitions)
    .set({ status: "retired", updatedAt: new Date() })
    .where(
      and(
        eq(reusableFieldDefinitions.id, input.fieldId),
        eq(reusableFieldDefinitions.companyId, input.companyId),
        or(
          isNull(reusableFieldDefinitions.projectId),
          eq(reusableFieldDefinitions.projectId, input.projectId),
        ),
      ),
    )
    .returning();
  return field ?? null;
}

export async function listReusableTemplates(
  companyId: number,
  projectId: number,
) {
  const templates = await db
    .select()
    .from(reusableTemplates)
    .where(
      and(
        eq(reusableTemplates.companyId, companyId),
        or(
          isNull(reusableTemplates.projectId),
          eq(reusableTemplates.projectId, projectId),
        ),
      ),
    )
    .orderBy(asc(reusableTemplates.kind), asc(reusableTemplates.name));
  const versions = await db
    .select()
    .from(reusableTemplateVersions)
    .orderBy(
      asc(reusableTemplateVersions.templateId),
      desc(reusableTemplateVersions.versionNumber),
    );

  return templates.map((template) => ({
    ...template,
    versions: versions.filter((version) => version.templateId === template.id),
  }));
}

export async function createReusableTemplate(input: {
  companyId: number;
  createdByUserId: number;
  description?: string | null;
  key: string;
  kind: ReusableTemplateKind;
  name: string;
  payload: Record<string, unknown>;
  projectId: number | null;
}) {
  const payload = parseReusableTemplatePayload(input.kind, input.payload);
  return db.transaction(async (tx) => {
    const [template] = await tx
      .insert(reusableTemplates)
      .values({ ...input, key: normalizeRegistryKey(input.key) })
      .returning();
    const [version] = await tx
      .insert(reusableTemplateVersions)
      .values({
        createdByUserId: input.createdByUserId,
        payload,
        templateId: template.id,
        versionNumber: 1,
      })
      .returning();
    return { template, version };
  });
}

export async function addReusableTemplateVersion(input: {
  companyId: number;
  createdByUserId: number;
  payload: Record<string, unknown>;
  projectId: number;
  templateId: number;
}) {
  return db.transaction(async (tx) => {
    const [template] = await tx
      .select()
      .from(reusableTemplates)
      .where(
        and(
          eq(reusableTemplates.id, input.templateId),
          eq(reusableTemplates.companyId, input.companyId),
          or(
            isNull(reusableTemplates.projectId),
            eq(reusableTemplates.projectId, input.projectId),
          ),
        ),
      )
      .limit(1);
    if (!template) throw new Error("Reusable template not found.");
    const payload = parseReusableTemplatePayload(
      template.kind as ReusableTemplateKind,
      input.payload,
    );
    const versionNumber = template.currentVersion + 1;
    const [version] = await tx
      .insert(reusableTemplateVersions)
      .values({
        createdByUserId: input.createdByUserId,
        payload,
        templateId: template.id,
        versionNumber,
      })
      .returning();
    await tx
      .update(reusableTemplates)
      .set({
        currentVersion: versionNumber,
        status: "draft",
        updatedAt: new Date(),
      })
      .where(eq(reusableTemplates.id, template.id));
    return version;
  });
}

export async function approveReusableTemplate(input: {
  companyId: number;
  projectId: number;
  templateId: number;
  userId: number;
}) {
  return db.transaction(async (tx) => {
    const [template] = await tx
      .select()
      .from(reusableTemplates)
      .where(
        and(
          eq(reusableTemplates.id, input.templateId),
          eq(reusableTemplates.companyId, input.companyId),
          or(
            isNull(reusableTemplates.projectId),
            eq(reusableTemplates.projectId, input.projectId),
          ),
        ),
      )
      .limit(1);
    if (!template) throw new Error("Reusable template not found.");
    await tx
      .update(reusableTemplateVersions)
      .set({ approvedAt: new Date(), approvedByUserId: input.userId })
      .where(
        and(
          eq(reusableTemplateVersions.templateId, template.id),
          eq(reusableTemplateVersions.versionNumber, template.currentVersion),
        ),
      );
    const [updated] = await tx
      .update(reusableTemplates)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(reusableTemplates.id, template.id))
      .returning();
    return updated;
  });
}

export async function duplicateReusableTemplate(input: {
  companyId: number;
  createdByUserId: number;
  projectId: number;
  templateId: number;
}) {
  const templates = await listReusableTemplates(
    input.companyId,
    input.projectId,
  );
  const source = templates.find((template) => template.id === input.templateId);
  const version = source?.versions.find(
    (entry) => entry.versionNumber === source.currentVersion,
  );
  if (!source || !version) throw new Error("Reusable template not found.");
  return createReusableTemplate({
    companyId: input.companyId,
    createdByUserId: input.createdByUserId,
    description: source.description,
    key: `${source.key}_copy_${Date.now()}`,
    kind: source.kind as ReusableTemplateKind,
    name: `${source.name} copy`,
    payload: version.payload,
    projectId: input.projectId,
  });
}
