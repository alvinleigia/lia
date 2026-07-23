import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  type ActionFlowCompilerIssueCode,
  type ActionFlowCompilerIssueSource,
  compileActionFlowGraph,
} from "@/lib/action-flow-compiler";
import type {
  ActionBranchOperator,
  ActionSubmissionStatus,
  ProjectActionStatus,
} from "@/lib/action-flow-constants";
import { db } from "@/lib/db-config";
import {
  actionFlowBranchRules,
  actionFlowSteps,
  actionFlowVersions,
  actionSubmissionEvents,
  actionSubmissions,
  operationAttempts,
  projectActions,
} from "@/lib/db-schema";
import { resolveTraceId } from "@/lib/execution-trace";
import { getFlowStepChannelCapabilityIssues } from "@/lib/flow-channel-capabilities";
import { getInvalidAllowedFileTypeTokens } from "@/lib/flow-file-validation";
import { isFlowInputStepType } from "@/lib/flow-input-editor";

export type {
  ActionBranchOperator,
  ActionFlowVersionStatus,
  ActionStepInputType,
  ActionStepType,
  ActionSubmissionStatus,
  ProjectActionStatus,
} from "@/lib/action-flow-constants";
export {
  ACTION_BRANCH_OPERATORS,
  ACTION_FLOW_VERSION_STATUSES,
  ACTION_STEP_INPUT_TYPES,
  ACTION_STEP_TYPES,
  ACTION_SUBMISSION_STATUSES,
  PROJECT_ACTION_STATUSES,
} from "@/lib/action-flow-constants";

export const ACTION_SUBMISSION_STATUS_LABELS = {
  cancelled: "Cancelled",
  completed: "Completed",
  in_progress: "In Progress",
  rejected: "Rejected",
  submitted: "Submitted",
  under_review: "Under Review",
} satisfies Record<ActionSubmissionStatus, string>;

export type CreateProjectActionInput = {
  projectId: number;
  name: string;
  description?: string | null;
  status?: ProjectActionStatus;
  triggerPhrases?: string[];
  settings?: Record<string, unknown>;
};

export type UpdateProjectActionInput = {
  projectId: number;
  actionId: number;
  name: string;
  description?: string | null;
  status: ProjectActionStatus;
  triggerPhrases?: string[];
  settings?: Record<string, unknown>;
};

export type CreateActionFlowStepInput = {
  projectId: number;
  actionId: number;
  sortOrder: number;
  stepType: string;
  fieldKey?: string | null;
  label?: string | null;
  prompt?: string | null;
  inputType?: string | null;
  isRequired?: boolean;
  isEnabled?: boolean;
  options?: unknown[];
  settings?: Record<string, unknown>;
  nextStepId?: number | null;
  operationId?: number | null;
};

export type UpdateActionFlowStepInput = CreateActionFlowStepInput & {
  stepId: number;
};

export type CreateActionFlowBranchRuleInput = {
  projectId: number;
  actionId: number;
  sourceStepId: number;
  sourceFieldKey: string;
  operator: ActionBranchOperator;
  comparisonValue?: string | null;
  targetStepId: number;
  sortOrder: number;
  isEnabled?: boolean;
  settings?: Record<string, unknown>;
};

export type UpdateActionFlowBranchRuleInput =
  CreateActionFlowBranchRuleInput & {
    ruleId: number;
  };

export type ActionFlowVersionSnapshot = {
  schemaVersion: 1;
  action: {
    id: number;
    name: string;
    description: string | null;
    status: string;
    triggerPhrases: string[];
    settings: Record<string, unknown>;
  };
  steps: Array<{
    id: number;
    sortOrder: number;
    stepType: string;
    fieldKey: string | null;
    label: string | null;
    prompt: string | null;
    inputType: string | null;
    isRequired: boolean;
    isEnabled: boolean;
    options: unknown[];
    settings: Record<string, unknown>;
    nextStepId: number | null;
    operationId: number | null;
  }>;
  branchRules: Array<{
    id: number;
    sourceStepId: number;
    sourceFieldKey: string;
    operator: string;
    comparisonValue: string | null;
    targetStepId: number;
    sortOrder: number;
    isEnabled: boolean;
    settings: Record<string, unknown>;
  }>;
  publishedAt: string;
};

export type ActionFlowRouteValidationIssue = {
  code?: ActionFlowCompilerIssueCode;
  source: ActionFlowCompilerIssueSource | "channel_capability" | "step_config";
  stepId?: number;
  ruleId?: number;
  severity?: "error" | "warning";
  message: string;
};

export type OperationRoutePresetTargetInput = {
  failureStepId?: number | null;
  projectId: number;
  actionId: number;
  sourceStepId: number;
  statusFieldKey: string;
  successStepId?: number | null;
};

export type ProjectReusableActionField = {
  actions: Array<{
    id: number;
    name: string;
  }>;
  fieldKey: string;
  inputTypes: string[];
  labels: string[];
  stepTypes: string[];
  usageCount: number;
};

function getStepSettingText(settings: Record<string, unknown>, key: string) {
  const value = settings[key];
  return typeof value === "string" ? value.trim() : "";
}

function getStepSettingNumber(settings: Record<string, unknown>, key: string) {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isValidDateSetting(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function isBlockingActionFlowIssue(
  issue: ActionFlowRouteValidationIssue,
) {
  return issue.severity !== "warning";
}

export function countBlockingActionFlowIssues(
  issues: ActionFlowRouteValidationIssue[],
) {
  return issues.filter(isBlockingActionFlowIssue).length;
}

function isProductMessageStepType(stepType: string) {
  return ["catalog_message", "single_product", "multiple_products"].includes(
    stepType,
  );
}

function isTemplateMessageStepType(stepType: string) {
  return stepType === "template_message";
}

function hasManualOptions(options: unknown) {
  return Array.isArray(options) && options.length > 0;
}

function hasValidDynamicOptionSource(settings: Record<string, unknown>) {
  const sourceType = getStepSettingText(settings, "sourceType");

  if (!sourceType) {
    return false;
  }

  if (!["catalog_categories", "catalog_items"].includes(sourceType)) {
    return false;
  }

  const sourceConfig =
    settings.sourceConfig &&
    typeof settings.sourceConfig === "object" &&
    !Array.isArray(settings.sourceConfig)
      ? (settings.sourceConfig as Record<string, unknown>)
      : null;
  const catalogId = sourceConfig?.catalogId;

  return typeof catalogId === "string" && Boolean(catalogId.trim());
}

function getProductSettingsIssuesForStep(step: {
  id: number;
  sortOrder: number;
  stepType: string;
  settings: Record<string, unknown>;
}) {
  const issues: ActionFlowRouteValidationIssue[] = [];
  const products = Array.isArray(step.settings.products)
    ? step.settings.products
    : [];
  const hasCatalog = typeof step.settings.productCatalogId === "number";

  if (step.stepType === "catalog_message" && !hasCatalog) {
    issues.push({
      source: "step_config",
      stepId: step.id,
      message: `Step ${step.sortOrder} needs a product catalog.`,
    });
  }

  if (step.stepType === "single_product" && products.length !== 1) {
    issues.push({
      source: "step_config",
      stepId: step.id,
      message: `Step ${step.sortOrder} needs exactly one selected product.`,
    });
  }

  if (
    (step.stepType === "multiple_products" ||
      step.stepType === "product_selection") &&
    products.length === 0
  ) {
    issues.push({
      source: "step_config",
      stepId: step.id,
      message: `Step ${step.sortOrder} needs at least one selected product.`,
    });
  }

  return issues;
}

function getValidationSettingsIssuesForStep(step: {
  id: number;
  sortOrder: number;
  stepType: string;
  settings: Record<string, unknown>;
}) {
  const issues: ActionFlowRouteValidationIssue[] = [];
  const minLength = getStepSettingNumber(step.settings, "validationMinLength");
  const maxLength = getStepSettingNumber(step.settings, "validationMaxLength");
  const minNumber = getStepSettingNumber(step.settings, "validationMinNumber");
  const maxNumber = getStepSettingNumber(step.settings, "validationMaxNumber");
  const minDate = getStepSettingText(step.settings, "validationMinDate");
  const maxDate = getStepSettingText(step.settings, "validationMaxDate");
  const regex = getStepSettingText(step.settings, "validationRegex");
  const allowedFileTypes = getStepSettingText(
    step.settings,
    "validationAllowedFileTypes",
  );

  if (minLength !== null && maxLength !== null && minLength > maxLength) {
    issues.push({
      source: "step_config",
      stepId: step.id,
      message: `Step ${step.sortOrder} has a minimum length greater than its maximum length.`,
    });
  }

  if (minNumber !== null && maxNumber !== null && minNumber > maxNumber) {
    issues.push({
      source: "step_config",
      stepId: step.id,
      message: `Step ${step.sortOrder} has a minimum number greater than its maximum number.`,
    });
  }

  if (minDate && !isValidDateSetting(minDate)) {
    issues.push({
      source: "step_config",
      stepId: step.id,
      message: `Step ${step.sortOrder} has an invalid minimum date constraint.`,
    });
  }

  if (maxDate && !isValidDateSetting(maxDate)) {
    issues.push({
      source: "step_config",
      stepId: step.id,
      message: `Step ${step.sortOrder} has an invalid maximum date constraint.`,
    });
  }

  if (
    minDate &&
    maxDate &&
    isValidDateSetting(minDate) &&
    isValidDateSetting(maxDate) &&
    minDate > maxDate
  ) {
    issues.push({
      source: "step_config",
      stepId: step.id,
      message: `Step ${step.sortOrder} has a minimum date after its maximum date.`,
    });
  }

  if (regex) {
    try {
      new RegExp(regex);
    } catch {
      issues.push({
        source: "step_config",
        stepId: step.id,
        message: `Step ${step.sortOrder} has an invalid regex validation pattern.`,
      });
    }
  }

  if (allowedFileTypes) {
    const invalidTokens = getInvalidAllowedFileTypeTokens(allowedFileTypes);

    if (invalidTokens.length > 0) {
      issues.push({
        source: "step_config",
        stepId: step.id,
        message: `Step ${step.sortOrder} has invalid allowed file type entries.`,
      });
    }
  }

  return issues;
}

function getStepConfigIssues(step: {
  fieldKey: string | null;
  id: number;
  inputType: string | null;
  label: string | null;
  operationId: number | null;
  options: unknown;
  prompt: string | null;
  sortOrder: number;
  stepType: string;
  settings: Record<string, unknown>;
}) {
  const issues: ActionFlowRouteValidationIssue[] = [];

  if (isFlowInputStepType(step.stepType)) {
    if (!step.fieldKey?.trim()) {
      issues.push({
        source: "step_config",
        stepId: step.id,
        message: `Step ${step.sortOrder} needs a field key.`,
      });
    }

    if (!step.label?.trim()) {
      issues.push({
        source: "step_config",
        stepId: step.id,
        message: `Step ${step.sortOrder} needs a label.`,
      });
    }

    if (!step.prompt?.trim()) {
      issues.push({
        source: "step_config",
        stepId: step.id,
        message: `Step ${step.sortOrder} needs a prompt.`,
      });
    }
  }

  if (
    ["message", "display_result", "handoff"].includes(step.stepType) &&
    !step.prompt?.trim()
  ) {
    issues.push({
      source: "step_config",
      stepId: step.id,
      message: `Step ${step.sortOrder} needs message text.`,
    });
  }

  if (step.stepType === "choice" && !hasManualOptions(step.options)) {
    if (!hasValidDynamicOptionSource(step.settings)) {
      issues.push({
        source: "step_config",
        stepId: step.id,
        message: `Step ${step.sortOrder} needs manual options or a valid option source.`,
      });
    }
  }

  if (step.stepType === "operation" && typeof step.operationId !== "number") {
    issues.push({
      source: "step_config",
      stepId: step.id,
      message: `Step ${step.sortOrder} needs an operation.`,
    });
  }

  if (
    isProductMessageStepType(step.stepType) ||
    step.stepType === "product_selection"
  ) {
    issues.push(...getProductSettingsIssuesForStep(step));
  }

  issues.push(...getValidationSettingsIssuesForStep(step));

  return issues;
}

function getOperationRoutePreset(
  settings: Record<string, unknown>,
): "failure" | "success" | null {
  if (settings.operationRoutePreset === "success") {
    return "success";
  }

  if (settings.operationRoutePreset === "failure") {
    return "failure";
  }

  return null;
}

export type CreateActionSubmissionInput = {
  projectId: number;
  actionId: number;
  actionVersionId?: number | null;
  currentStepId?: number | null;
  conversationId?: string | null;
  source?: string;
  status?: ActionSubmissionStatus;
  fields?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  traceId?: string | null;
};

export type UpdateActionSubmissionInput = {
  projectId: number;
  submissionId: number;
  currentStepId?: number | null;
  status?: ActionSubmissionStatus;
  fields?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  expectedRevision: number;
};

export async function listProjectActions(projectId: number) {
  return db
    .select()
    .from(projectActions)
    .where(eq(projectActions.projectId, projectId))
    .orderBy(asc(projectActions.name), asc(projectActions.id));
}

export async function listActiveProjectActions(projectId: number) {
  return db
    .select()
    .from(projectActions)
    .where(
      and(
        eq(projectActions.projectId, projectId),
        eq(projectActions.status, "active"),
      ),
    )
    .orderBy(asc(projectActions.name), asc(projectActions.id));
}

export async function getProjectAction(projectId: number, actionId: number) {
  const [action] = await db
    .select()
    .from(projectActions)
    .where(
      and(
        eq(projectActions.projectId, projectId),
        eq(projectActions.id, actionId),
      ),
    )
    .limit(1);

  return action ?? null;
}

export async function createProjectAction(input: CreateProjectActionInput) {
  const [action] = await db
    .insert(projectActions)
    .values({
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
      status: input.status ?? "draft",
      triggerPhrases: input.triggerPhrases ?? [],
      settings: input.settings ?? {},
      updatedAt: new Date(),
    })
    .returning();

  return action;
}

export async function updateProjectAction(input: UpdateProjectActionInput) {
  const [action] = await db
    .update(projectActions)
    .set({
      name: input.name,
      description: input.description ?? null,
      status: input.status,
      triggerPhrases: input.triggerPhrases ?? [],
      settings: input.settings ?? {},
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectActions.projectId, input.projectId),
        eq(projectActions.id, input.actionId),
      ),
    )
    .returning();

  return action ?? null;
}

export async function setProjectActionPublishedVersion(input: {
  projectId: number;
  actionId: number;
  publishedVersionId: number | null;
}) {
  const [action] = await db
    .update(projectActions)
    .set({
      publishedVersionId: input.publishedVersionId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectActions.projectId, input.projectId),
        eq(projectActions.id, input.actionId),
      ),
    )
    .returning();

  return action ?? null;
}

export async function setProjectActionStatus(
  projectId: number,
  actionId: number,
  status: ProjectActionStatus,
) {
  const [action] = await db
    .update(projectActions)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(projectActions.projectId, projectId),
        eq(projectActions.id, actionId),
      ),
    )
    .returning();

  return action ?? null;
}

export async function listActionFlowSteps(projectId: number, actionId: number) {
  return db
    .select()
    .from(actionFlowSteps)
    .where(
      and(
        eq(actionFlowSteps.projectId, projectId),
        eq(actionFlowSteps.actionId, actionId),
      ),
    )
    .orderBy(asc(actionFlowSteps.sortOrder), asc(actionFlowSteps.id));
}

export async function listProjectReusableActionFields(projectId: number) {
  const rows = await db
    .select({
      action: projectActions,
      step: actionFlowSteps,
    })
    .from(actionFlowSteps)
    .innerJoin(projectActions, eq(projectActions.id, actionFlowSteps.actionId))
    .where(
      and(
        eq(actionFlowSteps.projectId, projectId),
        eq(projectActions.projectId, projectId),
      ),
    )
    .orderBy(
      asc(actionFlowSteps.fieldKey),
      asc(projectActions.name),
      asc(actionFlowSteps.sortOrder),
    );
  const fields = new Map<
    string,
    {
      actions: Map<number, { id: number; name: string }>;
      inputTypes: Set<string>;
      labels: Set<string>;
      stepTypes: Set<string>;
      usageCount: number;
    }
  >();

  for (const { action, step } of rows) {
    const fieldKey = step.fieldKey?.trim();

    if (!fieldKey) {
      continue;
    }

    const entry = fields.get(fieldKey) ?? {
      actions: new Map<number, { id: number; name: string }>(),
      inputTypes: new Set<string>(),
      labels: new Set<string>(),
      stepTypes: new Set<string>(),
      usageCount: 0,
    };

    entry.actions.set(action.id, {
      id: action.id,
      name: action.name,
    });
    if (step.inputType?.trim()) {
      entry.inputTypes.add(step.inputType.trim());
    }
    if (step.label?.trim()) {
      entry.labels.add(step.label.trim());
    }
    entry.stepTypes.add(step.stepType);
    entry.usageCount += 1;
    fields.set(fieldKey, entry);
  }

  return Array.from(fields.entries())
    .map<ProjectReusableActionField>(([fieldKey, field]) => ({
      actions: Array.from(field.actions.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      fieldKey,
      inputTypes: Array.from(field.inputTypes).sort(),
      labels: Array.from(field.labels).sort(),
      stepTypes: Array.from(field.stepTypes).sort(),
      usageCount: field.usageCount,
    }))
    .sort(
      (a, b) =>
        b.usageCount - a.usageCount || a.fieldKey.localeCompare(b.fieldKey),
    );
}

export async function getActionFlowStep(
  projectId: number,
  actionId: number,
  stepId: number,
) {
  const [step] = await db
    .select()
    .from(actionFlowSteps)
    .where(
      and(
        eq(actionFlowSteps.projectId, projectId),
        eq(actionFlowSteps.actionId, actionId),
        eq(actionFlowSteps.id, stepId),
      ),
    )
    .limit(1);

  return step ?? null;
}

export async function createActionFlowStep(input: CreateActionFlowStepInput) {
  const [step] = await db
    .insert(actionFlowSteps)
    .values({
      projectId: input.projectId,
      actionId: input.actionId,
      sortOrder: input.sortOrder,
      stepType: input.stepType,
      fieldKey: input.fieldKey ?? null,
      label: input.label ?? null,
      prompt: input.prompt ?? null,
      inputType: input.inputType ?? null,
      isRequired: input.isRequired ?? false,
      isEnabled: input.isEnabled ?? true,
      options: input.options ?? [],
      settings: input.settings ?? {},
      nextStepId: input.nextStepId ?? null,
      operationId: input.operationId ?? null,
      updatedAt: new Date(),
    })
    .returning();

  return step;
}

export async function updateActionFlowStep(input: UpdateActionFlowStepInput) {
  const [step] = await db
    .update(actionFlowSteps)
    .set({
      sortOrder: input.sortOrder,
      stepType: input.stepType,
      fieldKey: input.fieldKey ?? null,
      label: input.label ?? null,
      prompt: input.prompt ?? null,
      inputType: input.inputType ?? null,
      isRequired: input.isRequired ?? false,
      isEnabled: input.isEnabled ?? true,
      options: input.options ?? [],
      settings: input.settings ?? {},
      nextStepId: input.nextStepId ?? null,
      operationId: input.operationId ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(actionFlowSteps.projectId, input.projectId),
        eq(actionFlowSteps.actionId, input.actionId),
        eq(actionFlowSteps.id, input.stepId),
      ),
    )
    .returning();

  return step ?? null;
}

export async function setActionFlowStepSettings(input: {
  projectId: number;
  actionId: number;
  stepId: number;
  settings: Record<string, unknown>;
}) {
  const [step] = await db
    .update(actionFlowSteps)
    .set({
      settings: input.settings,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(actionFlowSteps.projectId, input.projectId),
        eq(actionFlowSteps.actionId, input.actionId),
        eq(actionFlowSteps.id, input.stepId),
      ),
    )
    .returning();

  return step ?? null;
}

export async function setActionFlowStepSortOrder(input: {
  projectId: number;
  actionId: number;
  stepId: number;
  sortOrder: number;
}) {
  const [step] = await db
    .update(actionFlowSteps)
    .set({ sortOrder: input.sortOrder, updatedAt: new Date() })
    .where(
      and(
        eq(actionFlowSteps.projectId, input.projectId),
        eq(actionFlowSteps.actionId, input.actionId),
        eq(actionFlowSteps.id, input.stepId),
      ),
    )
    .returning();

  return step ?? null;
}

export async function setActionFlowStepEnabled(input: {
  projectId: number;
  actionId: number;
  stepId: number;
  isEnabled: boolean;
}) {
  const [step] = await db
    .update(actionFlowSteps)
    .set({ isEnabled: input.isEnabled, updatedAt: new Date() })
    .where(
      and(
        eq(actionFlowSteps.projectId, input.projectId),
        eq(actionFlowSteps.actionId, input.actionId),
        eq(actionFlowSteps.id, input.stepId),
      ),
    )
    .returning();

  return step ?? null;
}

export async function setActionFlowStepDefaultRoute(input: {
  projectId: number;
  actionId: number;
  stepId: number;
  nextStepId: number | null;
}) {
  const [step] = await db
    .update(actionFlowSteps)
    .set({ nextStepId: input.nextStepId, updatedAt: new Date() })
    .where(
      and(
        eq(actionFlowSteps.projectId, input.projectId),
        eq(actionFlowSteps.actionId, input.actionId),
        eq(actionFlowSteps.id, input.stepId),
      ),
    )
    .returning();

  return step ?? null;
}

export async function listActionFlowBranchRules(
  projectId: number,
  actionId: number,
) {
  return db
    .select()
    .from(actionFlowBranchRules)
    .where(
      and(
        eq(actionFlowBranchRules.projectId, projectId),
        eq(actionFlowBranchRules.actionId, actionId),
      ),
    )
    .orderBy(
      asc(actionFlowBranchRules.sourceStepId),
      asc(actionFlowBranchRules.sortOrder),
      asc(actionFlowBranchRules.id),
    );
}

function buildActionFlowVersionSnapshot(input: {
  action: NonNullable<Awaited<ReturnType<typeof getProjectAction>>>;
  branchRules: Awaited<ReturnType<typeof listActionFlowBranchRules>>;
  publishedAt: Date;
  steps: Awaited<ReturnType<typeof listActionFlowSteps>>;
}): ActionFlowVersionSnapshot {
  return {
    schemaVersion: 1,
    action: {
      id: input.action.id,
      name: input.action.name,
      description: input.action.description,
      status: input.action.status,
      triggerPhrases: input.action.triggerPhrases,
      settings: input.action.settings,
    },
    steps: input.steps.map((step) => ({
      id: step.id,
      sortOrder: step.sortOrder,
      stepType: step.stepType,
      fieldKey: step.fieldKey,
      label: step.label,
      prompt: step.prompt,
      inputType: step.inputType,
      isRequired: step.isRequired,
      isEnabled: step.isEnabled,
      options: step.options,
      settings: step.settings,
      nextStepId: step.nextStepId,
      operationId: step.operationId,
    })),
    branchRules: input.branchRules.map((rule) => ({
      id: rule.id,
      sourceStepId: rule.sourceStepId,
      sourceFieldKey: rule.sourceFieldKey,
      operator: rule.operator,
      comparisonValue: rule.comparisonValue,
      targetStepId: rule.targetStepId,
      sortOrder: rule.sortOrder,
      isEnabled: rule.isEnabled,
      settings: rule.settings,
    })),
    publishedAt: input.publishedAt.toISOString(),
  };
}

export async function listActionFlowVersions(
  projectId: number,
  actionId: number,
) {
  return db
    .select()
    .from(actionFlowVersions)
    .where(
      and(
        eq(actionFlowVersions.projectId, projectId),
        eq(actionFlowVersions.actionId, actionId),
      ),
    )
    .orderBy(
      desc(actionFlowVersions.publishedAt),
      desc(actionFlowVersions.versionNumber),
      desc(actionFlowVersions.id),
    );
}

export async function getActionFlowVersion(
  projectId: number,
  actionId: number,
  versionId: number,
) {
  const [version] = await db
    .select()
    .from(actionFlowVersions)
    .where(
      and(
        eq(actionFlowVersions.projectId, projectId),
        eq(actionFlowVersions.actionId, actionId),
        eq(actionFlowVersions.id, versionId),
      ),
    )
    .limit(1);

  return version ?? null;
}

export async function createPublishedActionFlowVersion(input: {
  projectId: number;
  actionId: number;
  publishedByUserId: number;
}) {
  const [action, steps, branchRules, versions] = await Promise.all([
    getProjectAction(input.projectId, input.actionId),
    listActionFlowSteps(input.projectId, input.actionId),
    listActionFlowBranchRules(input.projectId, input.actionId),
    listActionFlowVersions(input.projectId, input.actionId),
  ]);

  if (!action) {
    return null;
  }

  const publishedAt = new Date();
  const versionNumber =
    versions.reduce(
      (maxVersion, version) => Math.max(maxVersion, version.versionNumber),
      0,
    ) + 1;
  const snapshot = buildActionFlowVersionSnapshot({
    action,
    branchRules,
    publishedAt,
    steps,
  });
  const [version] = await db
    .insert(actionFlowVersions)
    .values({
      projectId: input.projectId,
      actionId: input.actionId,
      versionNumber,
      status: "published",
      snapshot,
      publishedByUserId: input.publishedByUserId,
      publishedAt,
    })
    .returning();

  await setProjectActionPublishedVersion({
    projectId: input.projectId,
    actionId: input.actionId,
    publishedVersionId: version.id,
  });

  return version;
}

export async function listActionFlowBranchRulesForStep(
  projectId: number,
  actionId: number,
  sourceStepId: number,
) {
  return db
    .select()
    .from(actionFlowBranchRules)
    .where(
      and(
        eq(actionFlowBranchRules.projectId, projectId),
        eq(actionFlowBranchRules.actionId, actionId),
        eq(actionFlowBranchRules.sourceStepId, sourceStepId),
      ),
    )
    .orderBy(
      asc(actionFlowBranchRules.sortOrder),
      asc(actionFlowBranchRules.id),
    );
}

export async function getActionFlowBranchRule(
  projectId: number,
  actionId: number,
  ruleId: number,
) {
  const [rule] = await db
    .select()
    .from(actionFlowBranchRules)
    .where(
      and(
        eq(actionFlowBranchRules.projectId, projectId),
        eq(actionFlowBranchRules.actionId, actionId),
        eq(actionFlowBranchRules.id, ruleId),
      ),
    )
    .limit(1);

  return rule ?? null;
}

export async function createActionFlowBranchRule(
  input: CreateActionFlowBranchRuleInput,
) {
  const [rule] = await db
    .insert(actionFlowBranchRules)
    .values({
      projectId: input.projectId,
      actionId: input.actionId,
      sourceStepId: input.sourceStepId,
      sourceFieldKey: input.sourceFieldKey,
      operator: input.operator,
      comparisonValue: input.comparisonValue ?? null,
      targetStepId: input.targetStepId,
      sortOrder: input.sortOrder,
      isEnabled: input.isEnabled ?? true,
      settings: input.settings ?? {},
      updatedAt: new Date(),
    })
    .returning();

  return rule;
}

export async function updateActionFlowBranchRule(
  input: UpdateActionFlowBranchRuleInput,
) {
  const [rule] = await db
    .update(actionFlowBranchRules)
    .set({
      sourceStepId: input.sourceStepId,
      sourceFieldKey: input.sourceFieldKey,
      operator: input.operator,
      comparisonValue: input.comparisonValue ?? null,
      targetStepId: input.targetStepId,
      sortOrder: input.sortOrder,
      isEnabled: input.isEnabled ?? true,
      settings: input.settings ?? {},
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(actionFlowBranchRules.projectId, input.projectId),
        eq(actionFlowBranchRules.actionId, input.actionId),
        eq(actionFlowBranchRules.id, input.ruleId),
      ),
    )
    .returning();

  return rule ?? null;
}

export async function deleteActionFlowBranchRule(
  projectId: number,
  actionId: number,
  ruleId: number,
) {
  const [rule] = await db
    .delete(actionFlowBranchRules)
    .where(
      and(
        eq(actionFlowBranchRules.projectId, projectId),
        eq(actionFlowBranchRules.actionId, actionId),
        eq(actionFlowBranchRules.id, ruleId),
      ),
    )
    .returning();

  return rule ?? null;
}

async function syncOperationRoutePreset(input: {
  actionId: number;
  comparisonValue: "completed" | "failed";
  existingRule:
    | Awaited<ReturnType<typeof listActionFlowBranchRulesForStep>>[number]
    | null;
  preset: "failure" | "success";
  projectId: number;
  sourceStepId: number;
  sourceFieldKey: string;
  sortOrder: number;
  targetStepId?: number | null;
}) {
  if (!input.targetStepId) {
    if (input.existingRule) {
      await deleteActionFlowBranchRule(
        input.projectId,
        input.actionId,
        input.existingRule.id,
      );
    }

    return null;
  }

  if (input.targetStepId === input.sourceStepId) {
    throw new Error("Operation route target cannot point to itself.");
  }

  const targetStep = await getActionFlowStep(
    input.projectId,
    input.actionId,
    input.targetStepId,
  );

  if (!targetStep) {
    throw new Error("Operation route target must belong to this action.");
  }

  const values = {
    projectId: input.projectId,
    actionId: input.actionId,
    sourceStepId: input.sourceStepId,
    sourceFieldKey: input.sourceFieldKey,
    operator: "equals" as ActionBranchOperator,
    comparisonValue: input.comparisonValue,
    targetStepId: input.targetStepId,
    sortOrder: input.existingRule?.sortOrder ?? input.sortOrder,
    isEnabled: true,
    settings: {
      operationRoutePreset: input.preset,
    },
  };

  if (input.existingRule) {
    return updateActionFlowBranchRule({
      ...values,
      ruleId: input.existingRule.id,
    });
  }

  return createActionFlowBranchRule(values);
}

export async function syncOperationRoutePresets(
  input: OperationRoutePresetTargetInput,
) {
  const sourceStep = await getActionFlowStep(
    input.projectId,
    input.actionId,
    input.sourceStepId,
  );

  if (!sourceStep) {
    return [];
  }

  const sourceFieldKey = input.statusFieldKey.trim();
  if (!sourceFieldKey) {
    throw new Error("Operation status field key is required.");
  }

  const branchRules = await listActionFlowBranchRulesForStep(
    input.projectId,
    input.actionId,
    sourceStep.id,
  );
  const successRule =
    branchRules.find(
      (rule) => getOperationRoutePreset(rule.settings) === "success",
    ) ?? null;
  const failureRule =
    branchRules.find(
      (rule) => getOperationRoutePreset(rule.settings) === "failure",
    ) ?? null;
  let nextSortOrder =
    branchRules.reduce((max, rule) => Math.max(max, rule.sortOrder), 0) + 1;
  const synced = [];
  const success = await syncOperationRoutePreset({
    actionId: input.actionId,
    comparisonValue: "completed",
    existingRule: successRule,
    preset: "success",
    projectId: input.projectId,
    sourceFieldKey,
    sourceStepId: sourceStep.id,
    sortOrder: nextSortOrder,
    targetStepId: input.successStepId,
  });

  if (success) {
    synced.push(success);
    if (!successRule) {
      nextSortOrder += 1;
    }
  }

  const failure = await syncOperationRoutePreset({
    actionId: input.actionId,
    comparisonValue: "failed",
    existingRule: failureRule,
    preset: "failure",
    projectId: input.projectId,
    sourceFieldKey,
    sourceStepId: sourceStep.id,
    sortOrder: nextSortOrder,
    targetStepId: input.failureStepId,
  });

  if (failure) {
    synced.push(failure);
  }

  return synced;
}

export async function validateActionFlowRoutes(
  projectId: number,
  actionId: number,
): Promise<ActionFlowRouteValidationIssue[]> {
  const [steps, branchRules] = await Promise.all([
    listActionFlowSteps(projectId, actionId),
    listActionFlowBranchRules(projectId, actionId),
  ]);
  const issues: ActionFlowRouteValidationIssue[] = [];

  for (const step of steps) {
    issues.push(...getFlowStepChannelCapabilityIssues(step));
    issues.push(...getStepConfigIssues(step));

    if (step.stepType === "set_attribute") {
      const valueSource =
        getStepSettingText(step.settings, "contactAttributeValueSource") ||
        "field";
      const hasValue =
        valueSource === "static"
          ? Boolean(getStepSettingText(step.settings, "contactAttributeValue"))
          : Boolean(
              getStepSettingText(step.settings, "contactAttributeFieldKey"),
            );

      if (
        !getStepSettingText(step.settings, "contactAttributeKey") ||
        !hasValue
      ) {
        issues.push({
          source: "default_next_step",
          stepId: step.id,
          message: `Step ${step.sortOrder} needs a contact attribute key and value source.`,
        });
      }
    }

    if (
      step.stepType === "media" &&
      (typeof step.settings.mediaAssetId !== "number" ||
        !step.settings.mediaAsset)
    ) {
      issues.push({
        source: "default_next_step",
        stepId: step.id,
        message: `Step ${step.sortOrder} needs a media asset.`,
      });
    }

    if (
      isTemplateMessageStepType(step.stepType) &&
      (!getStepSettingText(step.settings, "whatsappTemplateName") ||
        !getStepSettingText(step.settings, "whatsappTemplateLanguage"))
    ) {
      issues.push({
        source: "default_next_step",
        stepId: step.id,
        message: `Step ${step.sortOrder} needs a WhatsApp template name and language.`,
      });
    }

    if (
      step.stepType === "add_tag" &&
      !getStepSettingText(step.settings, "contactTagNames")
    ) {
      issues.push({
        source: "default_next_step",
        stepId: step.id,
        message: `Step ${step.sortOrder} needs at least one contact tag.`,
      });
    }

    if (step.stepType === "connect_flow") {
      const connectedActionId = step.settings.connectedActionId;
      const connectedAction =
        typeof connectedActionId === "number"
          ? await getProjectAction(projectId, connectedActionId)
          : null;

      if (!connectedActionId) {
        issues.push({
          source: "default_next_step",
          stepId: step.id,
          message: `Step ${step.sortOrder} needs an active connected flow.`,
        });
      } else if (
        connectedActionId === actionId ||
        !connectedAction ||
        connectedAction.status !== "active"
      ) {
        issues.push({
          source: "default_next_step",
          stepId: step.id,
          message: `Step ${step.sortOrder} points to an unavailable connected flow.`,
        });
      }
    }
  }

  const graph = compileActionFlowGraph({ branchRules, steps });
  issues.push(...graph.issues);

  return issues;
}

export async function deleteActionFlowStep(
  projectId: number,
  actionId: number,
  stepId: number,
) {
  await db
    .delete(actionFlowBranchRules)
    .where(
      and(
        eq(actionFlowBranchRules.projectId, projectId),
        eq(actionFlowBranchRules.actionId, actionId),
        or(
          eq(actionFlowBranchRules.sourceStepId, stepId),
          eq(actionFlowBranchRules.targetStepId, stepId),
        ),
      ),
    );

  const [step] = await db
    .delete(actionFlowSteps)
    .where(
      and(
        eq(actionFlowSteps.projectId, projectId),
        eq(actionFlowSteps.actionId, actionId),
        eq(actionFlowSteps.id, stepId),
      ),
    )
    .returning();

  return step ?? null;
}

export async function deleteProjectAction(projectId: number, actionId: number) {
  const submissions = await db
    .select({ id: actionSubmissions.id })
    .from(actionSubmissions)
    .where(
      and(
        eq(actionSubmissions.projectId, projectId),
        eq(actionSubmissions.actionId, actionId),
      ),
    );

  const submissionIds = submissions.map((submission) => submission.id);

  if (submissionIds.length > 0) {
    await db
      .delete(operationAttempts)
      .where(
        and(
          eq(operationAttempts.projectId, projectId),
          inArray(operationAttempts.submissionId, submissionIds),
        ),
      );

    await db
      .delete(actionSubmissionEvents)
      .where(
        and(
          eq(actionSubmissionEvents.projectId, projectId),
          inArray(actionSubmissionEvents.submissionId, submissionIds),
        ),
      );

    await db
      .delete(actionSubmissions)
      .where(
        and(
          eq(actionSubmissions.projectId, projectId),
          eq(actionSubmissions.actionId, actionId),
        ),
      );
  }

  await db
    .delete(operationAttempts)
    .where(
      and(
        eq(operationAttempts.projectId, projectId),
        eq(operationAttempts.actionId, actionId),
      ),
    );

  await db
    .delete(actionFlowBranchRules)
    .where(
      and(
        eq(actionFlowBranchRules.projectId, projectId),
        eq(actionFlowBranchRules.actionId, actionId),
      ),
    );

  await db
    .delete(actionFlowSteps)
    .where(
      and(
        eq(actionFlowSteps.projectId, projectId),
        eq(actionFlowSteps.actionId, actionId),
      ),
    );

  await db
    .delete(actionFlowVersions)
    .where(
      and(
        eq(actionFlowVersions.projectId, projectId),
        eq(actionFlowVersions.actionId, actionId),
      ),
    );

  const [action] = await db
    .delete(projectActions)
    .where(
      and(
        eq(projectActions.projectId, projectId),
        eq(projectActions.id, actionId),
      ),
    )
    .returning();

  return action ?? null;
}

export async function createActionSubmission(
  input: CreateActionSubmissionInput,
) {
  const [submission] = await db
    .insert(actionSubmissions)
    .values({
      projectId: input.projectId,
      actionId: input.actionId,
      actionVersionId: input.actionVersionId ?? null,
      currentStepId: input.currentStepId ?? null,
      conversationId: input.conversationId ?? null,
      traceId: resolveTraceId(input.traceId),
      source: input.source ?? "chat_widget",
      status: input.status ?? "in_progress",
      fields: input.fields ?? {},
      metadata: input.metadata ?? {},
      submittedAt: input.status === "submitted" ? new Date() : null,
      updatedAt: new Date(),
    })
    .returning();

  return submission;
}

export async function getActionSubmission(
  projectId: number,
  submissionId: number,
) {
  const [submission] = await db
    .select()
    .from(actionSubmissions)
    .where(
      and(
        eq(actionSubmissions.projectId, projectId),
        eq(actionSubmissions.id, submissionId),
      ),
    )
    .limit(1);

  return submission ?? null;
}

export async function getActiveActionSubmissionForConversation(input: {
  projectId: number;
  conversationId: string;
  source: string;
}) {
  const [submission] = await db
    .select()
    .from(actionSubmissions)
    .where(
      and(
        eq(actionSubmissions.projectId, input.projectId),
        eq(actionSubmissions.conversationId, input.conversationId),
        eq(actionSubmissions.source, input.source),
        eq(actionSubmissions.status, "in_progress"),
      ),
    )
    .orderBy(desc(actionSubmissions.updatedAt), desc(actionSubmissions.id))
    .limit(1);

  return submission ?? null;
}

export async function listActionSubmissions(
  projectId: number,
  actionId?: number,
) {
  const filters = actionId
    ? and(
        eq(actionSubmissions.projectId, projectId),
        eq(actionSubmissions.actionId, actionId),
      )
    : eq(actionSubmissions.projectId, projectId);

  return db
    .select()
    .from(actionSubmissions)
    .where(filters)
    .orderBy(desc(actionSubmissions.createdAt), desc(actionSubmissions.id));
}

export async function listActionSubmissionsWithActions(
  projectId: number,
  actionId?: number,
) {
  const filters = actionId
    ? and(
        eq(actionSubmissions.projectId, projectId),
        eq(actionSubmissions.actionId, actionId),
      )
    : eq(actionSubmissions.projectId, projectId);

  return db
    .select({
      submission: actionSubmissions,
      action: projectActions,
    })
    .from(actionSubmissions)
    .innerJoin(
      projectActions,
      eq(projectActions.id, actionSubmissions.actionId),
    )
    .where(filters)
    .orderBy(desc(actionSubmissions.createdAt), desc(actionSubmissions.id));
}

export async function updateActionSubmission(
  input: UpdateActionSubmissionInput,
) {
  const [submission] = await db
    .update(actionSubmissions)
    .set({
      currentStepId: input.currentStepId,
      status: input.status,
      fields: input.fields,
      metadata: input.metadata,
      revision: sql`${actionSubmissions.revision} + 1`,
      submittedAt: input.status === "submitted" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(actionSubmissions.projectId, input.projectId),
        eq(actionSubmissions.id, input.submissionId),
        eq(actionSubmissions.revision, input.expectedRevision),
      ),
    )
    .returning();

  return submission ?? null;
}

export async function reserveActionSubmissionRevision(input: {
  expectedRevision: number;
  projectId: number;
  submissionId: number;
}) {
  const [submission] = await db
    .update(actionSubmissions)
    .set({
      revision: sql`${actionSubmissions.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(actionSubmissions.projectId, input.projectId),
        eq(actionSubmissions.id, input.submissionId),
        eq(actionSubmissions.status, "in_progress"),
        eq(actionSubmissions.revision, input.expectedRevision),
      ),
    )
    .returning();

  return submission ?? null;
}

export async function markActionSubmissionForReview(input: {
  currentStepId?: number | null;
  fields?: Record<string, unknown>;
  handoff: Record<string, unknown>;
  expectedRevision: number;
  projectId: number;
  submissionId: number;
}) {
  const existingSubmission = await getActionSubmission(
    input.projectId,
    input.submissionId,
  );

  if (!existingSubmission) {
    return null;
  }

  const [submission] = await db
    .update(actionSubmissions)
    .set({
      currentStepId: input.currentStepId ?? existingSubmission.currentStepId,
      fields: input.fields ?? existingSubmission.fields,
      metadata: {
        ...existingSubmission.metadata,
        handoff: input.handoff,
      },
      status: "under_review",
      revision: sql`${actionSubmissions.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(actionSubmissions.projectId, input.projectId),
        eq(actionSubmissions.id, input.submissionId),
        eq(actionSubmissions.revision, input.expectedRevision),
      ),
    )
    .returning();

  return submission ?? null;
}

export async function setActionSubmissionStatus(
  projectId: number,
  submissionId: number,
  status: ActionSubmissionStatus,
  expectedRevision?: number,
) {
  const [submission] = await db
    .update(actionSubmissions)
    .set({
      status,
      revision: sql`${actionSubmissions.revision} + 1`,
      submittedAt: status === "submitted" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(actionSubmissions.projectId, projectId),
        eq(actionSubmissions.id, submissionId),
        expectedRevision === undefined
          ? undefined
          : eq(actionSubmissions.revision, expectedRevision),
      ),
    )
    .returning();

  return submission ?? null;
}

export async function listActionSubmissionEvents(
  projectId: number,
  submissionId: number,
) {
  return db
    .select()
    .from(actionSubmissionEvents)
    .where(
      and(
        eq(actionSubmissionEvents.projectId, projectId),
        eq(actionSubmissionEvents.submissionId, submissionId),
      ),
    )
    .orderBy(
      asc(actionSubmissionEvents.createdAt),
      asc(actionSubmissionEvents.id),
    );
}

export async function addActionSubmissionEvent(input: {
  projectId: number;
  submissionId: number;
  eventType: string;
  message?: string | null;
  payload?: Record<string, unknown>;
  traceId?: string | null;
}) {
  const [submission] = input.traceId
    ? []
    : await db
        .select({ traceId: actionSubmissions.traceId })
        .from(actionSubmissions)
        .where(
          and(
            eq(actionSubmissions.projectId, input.projectId),
            eq(actionSubmissions.id, input.submissionId),
          ),
        )
        .limit(1);
  const [event] = await db
    .insert(actionSubmissionEvents)
    .values({
      projectId: input.projectId,
      submissionId: input.submissionId,
      eventType: input.eventType,
      traceId: input.traceId ?? submission?.traceId ?? null,
      message: input.message ?? null,
      payload: input.payload ?? {},
    })
    .returning();

  return event;
}
