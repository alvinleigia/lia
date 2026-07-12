import { z } from "zod";
import {
  ACTION_BRANCH_OPERATORS,
  type ActionBranchOperator,
  createActionFlowBranchRule,
  createActionFlowStep,
  createProjectAction,
  getProjectAction,
  listActionFlowBranchRules,
  listActionFlowSteps,
  updateActionFlowStep,
} from "@/lib/action-flows";
import type { SelectProject } from "@/lib/db-schema";

export type ActionFlowExport = {
  schemaVersion: 1;
  exportedAt: string;
  project: {
    id: number;
    name: string;
  };
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
};

const recordSchema = z.record(z.string(), z.unknown());
const nullableStringSchema = z.string().nullable();
const nullableNumberSchema = z.number().int().positive().nullable();

const actionFlowExportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().optional(),
  project: z
    .object({
      id: z.number().int().positive().optional(),
      name: z.string().optional(),
    })
    .optional(),
  action: z.object({
    id: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(120),
    description: nullableStringSchema.optional().default(null),
    status: z.string().optional(),
    triggerPhrases: z.array(z.string()).optional().default([]),
    settings: recordSchema.optional().default({}),
  }),
  steps: z.array(
    z.object({
      id: z.number().int().positive(),
      sortOrder: z.number().int().positive(),
      stepType: z.string().trim().min(1).max(80),
      fieldKey: nullableStringSchema.optional().default(null),
      label: nullableStringSchema.optional().default(null),
      prompt: nullableStringSchema.optional().default(null),
      inputType: nullableStringSchema.optional().default(null),
      isRequired: z.boolean().optional().default(false),
      isEnabled: z.boolean().optional().default(true),
      options: z.array(z.unknown()).optional().default([]),
      settings: recordSchema.optional().default({}),
      nextStepId: nullableNumberSchema.optional().default(null),
      operationId: nullableNumberSchema.optional().default(null),
    }),
  ),
  branchRules: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        sourceStepId: z.number().int().positive(),
        sourceFieldKey: z.string().trim().min(1).max(80),
        operator: z.string().trim().min(1).max(80),
        comparisonValue: nullableStringSchema.optional().default(null),
        targetStepId: z.number().int().positive(),
        sortOrder: z.number().int().positive(),
        isEnabled: z.boolean().optional().default(true),
        settings: recordSchema.optional().default({}),
      }),
    )
    .optional()
    .default([]),
});

type ParsedActionFlowExport = z.infer<typeof actionFlowExportSchema>;
type ParsedActionFlowExportStep = ParsedActionFlowExport["steps"][number];

export type ActionFlowImportResult = {
  actionId: number;
  branchRuleCount: number;
  skippedBranchRuleCount: number;
  stepCount: number;
};

export async function buildProjectActionFlowExport(input: {
  actionId: number;
  project: Pick<SelectProject, "id" | "name">;
}): Promise<ActionFlowExport | null> {
  const [action, steps, branchRules] = await Promise.all([
    getProjectAction(input.project.id, input.actionId),
    listActionFlowSteps(input.project.id, input.actionId),
    listActionFlowBranchRules(input.project.id, input.actionId),
  ]);

  if (!action) {
    return null;
  }

  return {
    action: {
      description: action.description,
      id: action.id,
      name: action.name,
      settings: action.settings,
      status: action.status,
      triggerPhrases: action.triggerPhrases,
    },
    branchRules: branchRules.map((rule) => ({
      comparisonValue: rule.comparisonValue,
      id: rule.id,
      isEnabled: rule.isEnabled,
      operator: rule.operator,
      settings: rule.settings,
      sortOrder: rule.sortOrder,
      sourceFieldKey: rule.sourceFieldKey,
      sourceStepId: rule.sourceStepId,
      targetStepId: rule.targetStepId,
    })),
    exportedAt: new Date().toISOString(),
    project: {
      id: input.project.id,
      name: input.project.name,
    },
    schemaVersion: 1,
    steps: steps.map((step) => ({
      fieldKey: step.fieldKey,
      id: step.id,
      inputType: step.inputType,
      isEnabled: step.isEnabled,
      isRequired: step.isRequired,
      label: step.label,
      nextStepId: step.nextStepId,
      operationId: step.operationId,
      options: step.options,
      prompt: step.prompt,
      settings: buildPortableExportStepSettings(step),
      sortOrder: step.sortOrder,
      stepType: step.stepType,
    })),
  };
}

export function createActionFlowExportFilename(actionName: string) {
  const slug =
    actionName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "action-flow";

  return `${slug}-flow-export.json`;
}

export function parseActionFlowExportJson(json: string) {
  const parsedJson = JSON.parse(json);
  return actionFlowExportSchema.parse(parsedJson);
}

export async function importActionFlowExport(input: {
  exportData: z.infer<typeof actionFlowExportSchema>;
  nameOverride?: string;
  projectId: number;
}): Promise<ActionFlowImportResult> {
  const actionName = normalizeImportedActionName(
    input.nameOverride || `${input.exportData.action.name} (Imported)`,
  );
  const importedAction = await createProjectAction({
    projectId: input.projectId,
    name: actionName,
    description: input.exportData.action.description,
    status: "draft",
    triggerPhrases: input.exportData.action.triggerPhrases,
    settings: {
      ...input.exportData.action.settings,
      importedFromActionId: input.exportData.action.id ?? null,
      importedAt: new Date().toISOString(),
    },
  });
  const stepIdMap = new Map<number, number>();
  const orderedSteps = [...input.exportData.steps].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.id - right.id,
  );

  for (const step of orderedSteps) {
    const settings = buildImportedStepSettings(step);
    const importedStep = await createActionFlowStep({
      actionId: importedAction.id,
      fieldKey: step.fieldKey,
      inputType: step.inputType,
      isEnabled: step.isEnabled,
      isRequired: step.isRequired,
      label: step.label,
      nextStepId: null,
      operationId: null,
      options: step.options,
      projectId: input.projectId,
      prompt: step.prompt,
      settings,
      sortOrder: step.sortOrder,
      stepType: step.stepType,
    });
    stepIdMap.set(step.id, importedStep.id);
  }

  for (const step of orderedSteps) {
    const importedStepId = stepIdMap.get(step.id);
    if (!importedStepId) {
      continue;
    }

    const nextStepId =
      step.nextStepId === null
        ? null
        : (stepIdMap.get(step.nextStepId) ?? null);
    const settings = buildImportedStepSettings(step);
    await updateActionFlowStep({
      actionId: importedAction.id,
      fieldKey: step.fieldKey,
      inputType: step.inputType,
      isEnabled: step.isEnabled,
      isRequired: step.isRequired,
      label: step.label,
      nextStepId,
      operationId: null,
      options: step.options,
      projectId: input.projectId,
      prompt: step.prompt,
      settings,
      sortOrder: step.sortOrder,
      stepId: importedStepId,
      stepType: step.stepType,
    });
  }

  let branchRuleCount = 0;
  let skippedBranchRuleCount = 0;
  for (const rule of input.exportData.branchRules) {
    const sourceStepId = stepIdMap.get(rule.sourceStepId);
    const targetStepId = stepIdMap.get(rule.targetStepId);
    const operator = toBranchOperator(rule.operator);

    if (!sourceStepId || !targetStepId || !operator) {
      skippedBranchRuleCount += 1;
      continue;
    }

    await createActionFlowBranchRule({
      actionId: importedAction.id,
      comparisonValue: rule.comparisonValue,
      isEnabled: rule.isEnabled,
      operator,
      projectId: input.projectId,
      settings: rule.settings,
      sortOrder: rule.sortOrder,
      sourceFieldKey: rule.sourceFieldKey,
      sourceStepId,
      targetStepId,
    });
    branchRuleCount += 1;
  }

  return {
    actionId: importedAction.id,
    branchRuleCount,
    skippedBranchRuleCount,
    stepCount: orderedSteps.length,
  };
}

function buildPortableExportStepSettings(step: {
  settings: Record<string, unknown>;
  stepType: string;
}) {
  if (step.stepType !== "connect_flow") {
    return step.settings;
  }

  const settings = { ...step.settings };
  const connectedActionId = toPositiveNumber(settings.connectedActionId);
  delete settings.connectedActionId;

  if (connectedActionId !== null) {
    settings.exportedConnectedActionId = connectedActionId;
  }

  settings.connectFlowMode = "jump";
  settings.connectedActionExportNote =
    "Connected flow links are environment-specific. Reconnect this step after import.";

  return settings;
}

function buildImportedStepSettings(step: ParsedActionFlowExportStep) {
  const settings: Record<string, unknown> =
    step.operationId === null
      ? { ...step.settings }
      : {
          ...step.settings,
          importedOperationId: step.operationId,
          importedOperationNote:
            "Operation links are not restored automatically during import.",
        };

  if (step.stepType === "connect_flow") {
    const connectedActionId =
      toPositiveNumber(step.settings.connectedActionId) ??
      toPositiveNumber(step.settings.exportedConnectedActionId);
    delete settings.connectedActionId;
    delete settings.exportedConnectedActionId;

    if (connectedActionId !== null) {
      settings.importedConnectedActionId = connectedActionId;
    }

    settings.connectFlowMode = "jump";
    settings.connectedActionImportNote =
      "Connected flow links are not restored automatically during import. Select an active action in this project before publishing.";
  }

  return settings;
}

function toPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function normalizeImportedActionName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 120) || "Imported Flow";
}

function toBranchOperator(value: string): ActionBranchOperator | null {
  return ACTION_BRANCH_OPERATORS.includes(value as ActionBranchOperator)
    ? (value as ActionBranchOperator)
    : null;
}
