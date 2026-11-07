import { z } from "zod";
import { conversationalTaskSnapshotV1Schema } from "@/lib/conversation-contracts";
import {
  type FlowMediaUploadValue,
  isFlowMediaUploadValue,
} from "@/lib/flow-media-values";

export const LEAD_STATUSES = [
  "new",
  "assigned",
  "contacted",
  "converted",
  "closed",
] as const;
export const LEAD_STATUS_LABELS: Record<
  (typeof LEAD_STATUSES)[number],
  string
> = {
  new: "New",
  assigned: "Assigned",
  contacted: "Contacted",
  converted: "Converted",
  closed: "Closed",
};

export const leadManagementSchema = z.object({
  status: z.enum(LEAD_STATUSES).default("new"),
  assignedUserId: z.number().int().positive().nullable().default(null),
  nextFollowUpDate: z.iso.date().nullable().default(null),
});

export const leadUpdateSchema = leadManagementSchema
  .extend({
    submissionId: z.coerce.number().int().positive(),
    expectedRevision: z.coerce.number().int().nonnegative(),
    note: z.string().trim().max(4000).default(""),
  })
  .refine(
    (data) => data.status !== "assigned" || data.assignedUserId !== null,
    {
      message: "Choose a team member for an assigned lead.",
      path: ["assignedUserId"],
    },
  );

export type LeadManagement = z.infer<typeof leadManagementSchema>;

export function readLeadManagement(
  metadata: Record<string, unknown>,
): LeadManagement {
  const parsed = leadManagementSchema.safeParse(metadata.leadInbox);
  return parsed.success ? parsed.data : leadManagementSchema.parse({});
}

// Workflow execution status is independent of the staff's lead lifecycle.
export function isInboxSubmission(submission: {
  status: string;
  submittedAt: Date | null;
}) {
  return (
    submission.submittedAt !== null ||
    ["submitted", "under_review", "completed", "rejected"].includes(
      submission.status,
    )
  );
}

const snapshotSchema = z.object({
  action: z.object({ name: z.string() }),
  steps: z.array(
    z.object({
      fieldKey: z.string().nullable(),
      label: z.string().nullable(),
      inputType: z.string().nullable(),
      stepType: z.string(),
      isRequired: z.boolean(),
      settings: z.record(z.string(), z.unknown()),
    }),
  ),
});

export function readLeadWorkflowSnapshot(snapshot: unknown) {
  const parsed = snapshotSchema.safeParse(snapshot);
  return parsed.success ? parsed.data : null;
}

export type LeadField = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  value: unknown;
};

export function buildLeadFields(input: {
  fields: Record<string, unknown>;
  workflowSnapshot: unknown;
  taskSnapshots?: unknown[];
}): LeadField[] {
  const definitions = new Map<string, Omit<LeadField, "value">>();
  for (const step of readLeadWorkflowSnapshot(input.workflowSnapshot)?.steps ??
    []) {
    if (step.fieldKey)
      definitions.set(step.fieldKey, {
        key: step.fieldKey,
        label: step.label || step.fieldKey,
        type: step.inputType || step.stepType,
        required: step.isRequired,
      });
  }
  for (const snapshot of input.taskSnapshots ?? []) {
    const parsed = conversationalTaskSnapshotV1Schema.safeParse(snapshot);
    if (!parsed.success) continue;
    for (const field of parsed.data.task.definition.fields) {
      definitions.set(field.key, {
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
      });
    }
  }
  // Never replace a historical schema with the current draft. Legacy keys remain readable.
  const keys = [
    ...Array.from(definitions.keys()).filter((key) =>
      Object.hasOwn(input.fields, key),
    ),
    ...Object.keys(input.fields).filter((key) => !definitions.has(key)),
  ];
  return keys.map((key) => ({
    ...(definitions.get(key) ?? {
      key,
      label: key,
      type: "unknown",
      required: false,
    }),
    value: input.fields[key],
  }));
}

export function formatLeadFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "Not recorded";
  if (isFlowMediaUploadValue(value))
    return (value as FlowMediaUploadValue).originalName;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
