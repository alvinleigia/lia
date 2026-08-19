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
  updateProjectAction,
} from "@/lib/action-flows";
import type { SelectProject } from "@/lib/db-schema";
import {
  remapHybridEntryPolicySettings,
  remapHybridStepSettings,
} from "@/lib/hybrid-flow-settings";

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

export type ActionFlowResourceKind =
  | "catalog"
  | "catalog_product"
  | "connected_action"
  | "conversational_task_version"
  | "media_asset"
  | "operation";

export type ActionFlowResourceReference = {
  kind: ActionFlowResourceKind;
  sourceId: number;
  stepId: number;
  stepLabel: string;
};

export type ActionFlowMappedConversationalTask = {
  contextKeys: string[];
  fieldKeys: string[];
  name: string;
  objective: string;
  outcomes: unknown[];
  taskId: number;
  taskVersionId: number;
  versionNumber: number;
};

export type ActionFlowResourceMappings = {
  catalogs?: Record<number, number | null>;
  catalogProducts?: Record<number, number | null>;
  connectedActions?: Record<number, number | null>;
  conversationalTaskVersions?: Record<
    number,
    ActionFlowMappedConversationalTask | null
  >;
  mediaAssets?: Record<number, number | null>;
  operations?: Record<number, number | null>;
};

export type ActionFlowImportResult = {
  actionId: number;
  branchRuleCount: number;
  skippedBranchRuleCount: number;
  stepCount: number;
};

export function sanitizeActionFlowExportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeActionFlowExportValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      /secret|password|token|api.?key|authorization|credential/i.test(key)
        ? "[REDACTED]"
        : sanitizeActionFlowExportValue(entry),
    ]),
  );
}

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
      settings: sanitizeActionFlowExportValue(action.settings) as Record<
        string,
        unknown
      >,
      status: action.status,
      triggerPhrases: action.triggerPhrases,
    },
    branchRules: branchRules.map((rule) => ({
      comparisonValue: rule.comparisonValue,
      id: rule.id,
      isEnabled: rule.isEnabled,
      operator: rule.operator,
      settings: sanitizeActionFlowExportValue(rule.settings) as Record<
        string,
        unknown
      >,
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
  resourceMappings?: ActionFlowResourceMappings;
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
    const settings = buildImportedActionFlowStepSettings(
      step,
      stepIdMap,
      input.resourceMappings,
    );
    const importedStep = await createActionFlowStep({
      actionId: importedAction.id,
      fieldKey: step.fieldKey,
      inputType: step.inputType,
      isEnabled: step.isEnabled,
      isRequired: step.isRequired,
      label: step.label,
      nextStepId: null,
      operationId: getMappedOperationId(step, input.resourceMappings),
      options: step.options,
      projectId: input.projectId,
      prompt: step.prompt,
      settings,
      sortOrder: step.sortOrder,
      stepType: step.stepType,
    });
    stepIdMap.set(step.id, importedStep.id);
  }

  await updateProjectAction({
    actionId: importedAction.id,
    description: input.exportData.action.description,
    name: actionName,
    projectId: input.projectId,
    settings: {
      ...remapHybridEntryPolicySettings(
        input.exportData.action.settings,
        stepIdMap,
      ),
      importedAt: new Date().toISOString(),
      importedFromActionId: input.exportData.action.id ?? null,
    },
    status: "draft",
    triggerPhrases: input.exportData.action.triggerPhrases,
  });

  for (const step of orderedSteps) {
    const importedStepId = stepIdMap.get(step.id);
    if (!importedStepId) {
      continue;
    }

    const nextStepId =
      step.nextStepId === null
        ? null
        : (stepIdMap.get(step.nextStepId) ?? null);
    const settings = buildImportedActionFlowStepSettings(
      step,
      stepIdMap,
      input.resourceMappings,
    );
    await updateActionFlowStep({
      actionId: importedAction.id,
      fieldKey: step.fieldKey,
      inputType: step.inputType,
      isEnabled: step.isEnabled,
      isRequired: step.isRequired,
      label: step.label,
      nextStepId,
      operationId: getMappedOperationId(step, input.resourceMappings),
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

export function collectActionFlowResourceReferences(
  exportData: Pick<ParsedActionFlowExport, "steps">,
) {
  const references = new Map<string, ActionFlowResourceReference>();

  const addReference = (
    kind: ActionFlowResourceKind,
    sourceId: unknown,
    step: ParsedActionFlowExportStep,
  ) => {
    const normalizedId = toPositiveNumber(sourceId);
    if (normalizedId === null) return;
    const key = `${kind}:${normalizedId}`;
    if (references.has(key)) return;
    references.set(key, {
      kind,
      sourceId: normalizedId,
      stepId: step.id,
      stepLabel: step.label?.trim() || `Step ${step.sortOrder}`,
    });
  };

  const visitSettings = (
    value: unknown,
    step: ParsedActionFlowExportStep,
  ): void => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        visitSettings(entry, step);
      });
      return;
    }
    if (!isRecord(value)) return;

    for (const [key, entry] of Object.entries(value)) {
      if (key === "mediaAssetId") addReference("media_asset", entry, step);
      if (key === "productCatalogId" || key === "catalogId") {
        addReference("catalog", entry, step);
      }
      if (key === "productId") addReference("catalog_product", entry, step);
      if (key === "productIds" && Array.isArray(entry)) {
        entry.forEach((id) => {
          addReference("catalog_product", id, step);
        });
      }
      if (
        key === "connectedActionId" ||
        key === "exportedConnectedActionId" ||
        key === "importedConnectedActionId"
      ) {
        addReference("connected_action", entry, step);
      }
      if (key === "taskVersionId") {
        addReference("conversational_task_version", entry, step);
      }
      visitSettings(entry, step);
    }
  };

  for (const step of exportData.steps) {
    addReference("operation", step.operationId, step);
    visitSettings(step.settings, step);
  }

  return [...references.values()];
}

function buildPortableExportStepSettings(step: {
  settings: Record<string, unknown>;
  stepType: string;
}) {
  if (
    step.stepType !== "connect_flow" &&
    step.stepType !== "conversational_task"
  ) {
    return sanitizeActionFlowExportValue(step.settings) as Record<
      string,
      unknown
    >;
  }

  const settings = { ...step.settings };
  if (step.stepType === "conversational_task") {
    if (isRecord(settings.conversationalTask)) {
      settings.exportedConversationalTask = settings.conversationalTask;
    }
    delete settings.conversationalTask;
    settings.conversationalTaskExportNote =
      "Published task versions are project-specific. Select a published task version after import.";
    return sanitizeActionFlowExportValue(settings) as Record<string, unknown>;
  }

  const connectedActionId = toPositiveNumber(settings.connectedActionId);
  delete settings.connectedActionId;

  if (connectedActionId !== null) {
    settings.exportedConnectedActionId = connectedActionId;
  }

  settings.connectFlowMode = "jump";
  settings.connectedActionExportNote =
    "Connected flow links are environment-specific. Reconnect this step after import.";

  return sanitizeActionFlowExportValue(settings) as Record<string, unknown>;
}

export function buildImportedActionFlowStepSettings(
  step: ParsedActionFlowExportStep,
  stepIdMap: Map<number, number>,
  resourceMappings?: ActionFlowResourceMappings,
) {
  const mappedOperationId = getMappedOperationId(step, resourceMappings);
  const settings: Record<string, unknown> =
    step.operationId === null || mappedOperationId !== null
      ? remapProjectResourceSettings(step.settings, resourceMappings)
      : {
          ...remapProjectResourceSettings(step.settings, resourceMappings),
          importedOperationId: step.operationId,
          importedOperationNote:
            "Operation links are not restored automatically during import.",
        };

  if (step.stepType === "conversational_task") {
    const exportedTask = isRecord(step.settings.exportedConversationalTask)
      ? step.settings.exportedConversationalTask
      : isRecord(step.settings.conversationalTask)
        ? step.settings.conversationalTask
        : null;
    const sourceTaskVersionId = getConversationalTaskVersionId(exportedTask);
    const mappedTask =
      sourceTaskVersionId === null
        ? undefined
        : resourceMappings?.conversationalTaskVersions?.[sourceTaskVersionId];
    delete settings.conversationalTask;
    delete settings.exportedConversationalTask;
    delete settings.importedConversationalTask;
    delete settings.conversationalTaskImportNote;
    delete settings.conversationalTaskExportNote;
    if (mappedTask) {
      settings.conversationalTask = buildMappedConversationalTaskSettings(
        exportedTask,
        mappedTask,
      );
    } else {
      if (exportedTask) {
        settings.importedConversationalTask = exportedTask;
      }
      settings.conversationalTaskImportNote =
        "Reconnect this node to a published task version in the current project.";
    }
  }

  if (step.stepType === "connect_flow") {
    const connectedActionId =
      toPositiveNumber(step.settings.connectedActionId) ??
      toPositiveNumber(step.settings.exportedConnectedActionId);
    delete settings.connectedActionId;
    delete settings.exportedConnectedActionId;
    delete settings.importedConnectedActionId;
    delete settings.connectedActionImportNote;
    delete settings.connectedActionExportNote;

    const mappedActionId =
      connectedActionId === null
        ? undefined
        : resourceMappings?.connectedActions?.[connectedActionId];

    if (mappedActionId) {
      settings.connectedActionId = mappedActionId;
    } else if (connectedActionId !== null) {
      settings.importedConnectedActionId = connectedActionId;
      settings.connectedActionImportNote =
        "Connected flow links are not restored automatically during import. Select an active action in this project before publishing.";
    }

    settings.connectFlowMode = "jump";
  }

  return remapHybridStepSettings(settings, stepIdMap);
}

function getMappedOperationId(
  step: ParsedActionFlowExportStep,
  resourceMappings?: ActionFlowResourceMappings,
) {
  if (step.operationId === null) return null;
  return resourceMappings?.operations?.[step.operationId] ?? null;
}

function remapProjectResourceSettings(
  value: Record<string, unknown>,
  resourceMappings?: ActionFlowResourceMappings,
) {
  if (!resourceMappings) return { ...value };

  const visit = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(visit);
    if (!isRecord(entry)) return entry;

    const mapped: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(entry)) {
      if (key === "mediaAssetId") {
        const sourceId = toPositiveNumber(nestedValue);
        if (sourceId === null) {
          mapped[key] = visit(nestedValue);
          continue;
        }
        const targetId = resourceMappings.mediaAssets?.[sourceId];
        if (targetId) mapped[key] = targetId;
        continue;
      }
      if (key === "productCatalogId" || key === "catalogId") {
        const sourceId = toPositiveNumber(nestedValue);
        if (sourceId === null) {
          mapped[key] = visit(nestedValue);
          continue;
        }
        const targetId = resourceMappings.catalogs?.[sourceId];
        if (targetId) mapped[key] = targetId;
        continue;
      }
      if (key === "productId") {
        const sourceId = toPositiveNumber(nestedValue);
        if (sourceId === null) {
          mapped[key] = visit(nestedValue);
          continue;
        }
        const targetId = resourceMappings.catalogProducts?.[sourceId];
        if (targetId) mapped[key] = targetId;
        continue;
      }
      if (key === "productIds" && Array.isArray(nestedValue)) {
        mapped[key] = nestedValue.flatMap((sourceValue) => {
          const sourceId = toPositiveNumber(sourceValue);
          const targetId =
            sourceId === null
              ? undefined
              : resourceMappings.catalogProducts?.[sourceId];
          return targetId ? [targetId] : [];
        });
        continue;
      }
      mapped[key] = visit(nestedValue);
    }
    return mapped;
  };

  return visit(value) as Record<string, unknown>;
}

function getConversationalTaskVersionId(value: Record<string, unknown> | null) {
  if (!value) return null;
  if (isRecord(value.task)) return toPositiveNumber(value.task.taskVersionId);
  return toPositiveNumber(value.taskVersionId);
}

function buildMappedConversationalTaskSettings(
  exportedTask: Record<string, unknown> | null,
  mappedTask: ActionFlowMappedConversationalTask,
) {
  const wrapper =
    exportedTask && isRecord(exportedTask.task) ? exportedTask : {};
  const allowedFieldKeys = new Set(mappedTask.fieldKeys);
  const allowedContextKeys = new Set(mappedTask.contextKeys);
  const transferFieldKeys = Array.isArray(wrapper.transferFieldKeys)
    ? wrapper.transferFieldKeys.filter(
        (key): key is string =>
          typeof key === "string" && allowedFieldKeys.has(key),
      )
    : [];
  const transferContextKeys = Array.isArray(wrapper.transferContextKeys)
    ? wrapper.transferContextKeys.filter(
        (key): key is string =>
          typeof key === "string" && allowedContextKeys.has(key),
      )
    : [];

  return {
    ...wrapper,
    outcomeRoutes: {},
    schemaVersion: 1,
    task: {
      name: mappedTask.name,
      outcomes: mappedTask.outcomes,
      schemaVersion: 1,
      taskId: mappedTask.taskId,
      taskVersionId: mappedTask.taskVersionId,
      versionNumber: mappedTask.versionNumber,
    },
    transferContextKeys,
    transferFieldKeys,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
