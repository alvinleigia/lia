"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import {
  importActionFlowExport,
  parseActionFlowExportJson,
} from "@/lib/action-flow-export";
import { restoreActionFlowDraftFromSnapshot } from "@/lib/action-flow-restore";
import {
  ACTION_BRANCH_OPERATORS,
  type ActionBranchOperator,
  countBlockingActionFlowIssues,
  createActionFlowBranchRule,
  createActionFlowStep,
  createProjectAction,
  createPublishedActionFlowVersion,
  deleteActionFlowBranchRule,
  deleteActionFlowStep,
  deleteProjectAction,
  getActionFlowBranchRule,
  getActionFlowStep,
  getActionFlowVersion,
  getProjectAction,
  listActionFlowBranchRules,
  listActionFlowSteps,
  PROJECT_ACTION_STATUSES,
  type ProjectActionStatus,
  setActionFlowStepEnabled,
  setActionFlowStepSortOrder,
  setProjectActionPublishedVersion,
  syncOperationStepRoutePresets,
  updateActionFlowBranchRule,
  updateActionFlowStep,
  updateProjectAction,
  validateActionFlowRoutes,
} from "@/lib/action-flows";
import type { ActionFormState } from "@/lib/action-form-state";
import {
  actionStepDynamicChoiceSchemaShape,
  createActionStepSchema,
  mergeActionStepOptions,
  parseActionStepLines,
  parseActionStepOptions,
  parseOperationOutcomeRoutes,
} from "@/lib/action-step-schema";
import { buildActionStepSettings } from "@/lib/action-step-settings";
import {
  getActionTemplate,
  isProjectActionTemplate,
  parseProjectActionTemplateKey,
} from "@/lib/action-templates";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndProject } from "@/lib/auth-project";
import { getFlowInputType, isFlowInputStepType } from "@/lib/flow-input-editor";
import { getProjectMediaAsset } from "@/lib/media-assets";
import {
  getProjectCatalog,
  listProjectCatalogProductsByIds,
  listProjectCatalogProductsForCatalog,
} from "@/lib/product-catalogs";

const actionIdSchema = z.coerce.number().int().positive();
const templateKeySchema = z.string().trim().min(1).max(120);
const templateApplySchema = z.object({
  sourcePath: z.string().trim().max(120).optional(),
  templateKey: templateKeySchema,
});
const saveTemplateSchema = z.object({
  actionId: z.coerce.number().int().positive(),
});

const actionDetailsSchema = z
  .object({
    actionId: z.coerce.number().int().positive().optional(),
    projectId: z.coerce.number().int().positive().optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    experimentEnabled: z.boolean().optional(),
    experimentKey: z.string().trim().max(120).optional(),
    experimentVariantLabel: z.string().trim().max(120).optional(),
    experimentWeight: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.coerce.number().int().min(0).max(100).optional(),
    ),
    templateEnabled: z.boolean().optional(),
    templateVersion: z.string().trim().max(40).optional(),
    status: z.enum(PROJECT_ACTION_STATUSES),
    triggerPhrases: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.experimentEnabled) {
      return;
    }

    if (!data.experimentKey?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Experiment key is required.",
        path: ["experimentKey"],
      });
    }

    if (!data.experimentVariantLabel?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Variant label is required.",
        path: ["experimentVariantLabel"],
      });
    }
  });

const actionStepSchema = createActionStepSchema(
  {
    ...actionStepDynamicChoiceSchemaShape,
    sortOrder: z.coerce.number().int().positive(),
    nextStepId: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.coerce.number().int().positive().optional(),
    ),
  },
  { allowDynamicChoiceSource: true },
);

const branchRuleSchema = z
  .object({
    actionId: z.coerce.number().int().positive(),
    ruleId: z.coerce.number().int().positive().optional(),
    sourceStepId: z.coerce.number().int().positive(),
    sourceFieldKey: z.string().trim().min(1).max(80),
    operator: z.enum(ACTION_BRANCH_OPERATORS),
    comparisonValue: z.string().trim().max(240).optional(),
    branchLabel: z.string().trim().max(80).optional(),
    targetStepId: z.coerce.number().int().positive(),
    sortOrder: z.coerce.number().int().positive(),
    isEnabled: z.coerce.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const needsComparison = !["is_empty", "is_not_empty"].includes(
      data.operator,
    );

    if (needsComparison && !data.comparisonValue?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Comparison value is required.",
        path: ["comparisonValue"],
      });
    }

    if (data.sourceStepId === data.targetStepId) {
      ctx.addIssue({
        code: "custom",
        message: "Target step must be different from source step.",
        path: ["targetStepId"],
      });
    }
  });

const stepMoveSchema = z.object({
  actionId: z.coerce.number().int().positive(),
  stepId: z.coerce.number().int().positive(),
  direction: z.enum(["up", "down"]),
});

const stepToggleSchema = z.object({
  actionId: z.coerce.number().int().positive(),
  stepId: z.coerce.number().int().positive(),
  isEnabled: z.enum(["true", "false"]),
});

function buildBranchRuleSettings(
  existingSettings: Record<string, unknown> | undefined,
  branchLabel: string | undefined,
) {
  const settings = { ...(existingSettings ?? {}) };

  if (branchLabel === undefined) {
    return settings;
  }

  const label = branchLabel.trim();
  if (label) {
    settings.branchLabel = label;
  } else {
    delete settings.branchLabel;
  }

  return settings;
}

function buildActionSettings(input: {
  existingSettings: Record<string, unknown>;
  experimentEnabled?: boolean;
  experimentKey?: string;
  experimentVariantLabel?: string;
  experimentWeight?: number;
  templateEnabled?: boolean;
  templateVersion?: string;
}) {
  const settings = { ...input.existingSettings };

  if (input.experimentEnabled) {
    settings.experiment = {
      enabled: true,
      key: input.experimentKey?.trim() ?? "",
      variantLabel: input.experimentVariantLabel?.trim() ?? "",
      weight: input.experimentWeight ?? 100,
    };
  } else {
    delete settings.experiment;
  }

  if (input.templateEnabled) {
    const existingTemplate =
      input.existingSettings.customTemplate &&
      typeof input.existingSettings.customTemplate === "object" &&
      !Array.isArray(input.existingSettings.customTemplate)
        ? (input.existingSettings.customTemplate as Record<string, unknown>)
        : {};
    const existingSavedAt = existingTemplate.savedAt;

    settings.customTemplate = {
      ...existingTemplate,
      enabled: true,
      savedAt:
        typeof existingSavedAt === "string" && existingSavedAt.trim()
          ? existingSavedAt
          : new Date().toISOString(),
      version: input.templateVersion?.trim() || "1.0.0",
    };
  } else {
    delete settings.customTemplate;
  }

  return settings;
}

async function requireConnectedAction(input: {
  actionId: number;
  connectedActionId?: number;
  projectId: number;
  stepType: string;
}) {
  if (input.stepType !== "connect_flow") {
    return null;
  }

  if (!input.connectedActionId || input.connectedActionId === input.actionId) {
    return null;
  }

  const connectedAction = await getProjectAction(
    input.projectId,
    input.connectedActionId,
  );

  return connectedAction?.status === "active" ? connectedAction : null;
}

async function requireStepMediaAsset(input: {
  mediaAssetId?: number;
  projectId: number;
  stepType: string;
}) {
  if (input.stepType !== "media") {
    return null;
  }

  if (!input.mediaAssetId) {
    return null;
  }

  return getProjectMediaAsset(input.projectId, input.mediaAssetId);
}

async function requireStepProductConfig(input: {
  productCatalogId?: number;
  productIds?: number[];
  projectId: number;
  stepType: string;
}) {
  if (
    ![
      "catalog_message",
      "single_product",
      "multiple_products",
      "product_selection",
    ].includes(input.stepType)
  ) {
    return { productCatalog: null, products: [] };
  }

  const productIds = input.productIds ?? [];
  const selectedProducts =
    productIds.length > 0
      ? await listProjectCatalogProductsByIds(input.projectId, productIds)
      : [];
  const catalogId =
    input.productCatalogId ?? selectedProducts[0]?.catalogId ?? null;

  if (!catalogId) {
    return { productCatalog: null, products: selectedProducts };
  }

  const productCatalog = await getProjectCatalog(input.projectId, catalogId);
  const products =
    input.stepType === "catalog_message" ||
    (input.stepType === "product_selection" && productIds.length === 0)
      ? await listProjectCatalogProductsForCatalog(input.projectId, catalogId)
      : selectedProducts.filter((product) => product.catalogId === catalogId);

  return {
    productCatalog,
    products:
      input.stepType === "single_product" ? products.slice(0, 1) : products,
  };
}

function getTemplateApplySourcePath(value?: string) {
  return value === "/projects/templates"
    ? "/projects/templates"
    : "/projects/actions/new";
}

function getTemplateVersionFromSettings(settings: Record<string, unknown>) {
  const customTemplate = settings.customTemplate;

  if (
    customTemplate &&
    typeof customTemplate === "object" &&
    !Array.isArray(customTemplate)
  ) {
    const version = (customTemplate as Record<string, unknown>).version;
    if (typeof version === "string" && version.trim()) {
      return version.trim();
    }
  }

  return "1.0.0";
}

function getActionSettingsWithoutTemplateFlag(
  settings: Record<string, unknown>,
) {
  const rest = { ...settings };
  delete rest.customTemplate;

  return rest;
}

async function applyBundledActionTemplate(input: {
  context: Awaited<ReturnType<typeof resolveUserAndProject>>;
  sourcePath: string;
  template: NonNullable<ReturnType<typeof getActionTemplate>>;
}) {
  const { context, template } = input;
  const { project } = context;
  const appliedAt = new Date().toISOString();
  const action = await createProjectAction({
    projectId: project.id,
    name: template.action.name,
    description: template.action.description,
    status: template.action.status as ProjectActionStatus,
    triggerPhrases: template.action.triggerPhrases,
    settings: {
      ...template.action.settings,
      templateAppliedAt: appliedAt,
      templateKey: template.key,
      templateSource: "bundled_marketplace",
      templateVersion: template.summary.version,
    },
  });

  for (const step of template.steps) {
    await createActionFlowStep({
      projectId: project.id,
      actionId: action.id,
      sortOrder: step.sortOrder,
      stepType: step.stepType,
      fieldKey: step.fieldKey,
      label: step.label,
      prompt: step.prompt,
      inputType: step.inputType,
      isRequired: step.isRequired,
      isEnabled: step.isEnabled ?? true,
      options: step.options,
      settings: step.settings,
    });
  }
  await writeAuditLog({
    ...context,
    action: "chatbot_action.template_applied",
    targetType: "project_action",
    targetId: action.id,
    metadata: {
      actionName: action.name,
      stepCount: template.steps.length,
      templateKey: template.key,
      templateSource: "bundled_marketplace",
      templateVersion: template.summary.version,
    },
  });

  revalidatePath("/projects/actions");
  revalidatePath(input.sourcePath);
  redirect(`/projects/actions/${action.id}?created=1`);
}

async function applyProjectActionTemplate(input: {
  context: Awaited<ReturnType<typeof resolveUserAndProject>>;
  sourceActionId: number;
  sourcePath: string;
}) {
  const { context, sourceActionId } = input;
  const { project } = context;
  const sourceAction = await getProjectAction(project.id, sourceActionId);

  if (!sourceAction || !isProjectActionTemplate(sourceAction)) {
    redirect(`${input.sourcePath}?error=Template%20not%20found.`);
  }

  const [sourceSteps, sourceBranchRules] = await Promise.all([
    listActionFlowSteps(project.id, sourceAction.id),
    listActionFlowBranchRules(project.id, sourceAction.id),
  ]);

  if (sourceSteps.length === 0) {
    redirect(`${input.sourcePath}?error=Template%20has%20no%20steps.`);
  }

  const appliedAt = new Date().toISOString();
  const sourceSettings = getActionSettingsWithoutTemplateFlag(
    sourceAction.settings,
  );
  const action = await createProjectAction({
    projectId: project.id,
    name: sourceAction.name,
    description: sourceAction.description,
    status: sourceAction.status as ProjectActionStatus,
    triggerPhrases: sourceAction.triggerPhrases,
    settings: {
      ...sourceSettings,
      templateAppliedAt: appliedAt,
      templateKey: `project_action:${sourceAction.id}`,
      templateSource: "project_custom",
      templateVersion: getTemplateVersionFromSettings(sourceAction.settings),
    },
  });
  const stepIdMap = new Map<number, number>();
  const createdSteps = new Map<
    number,
    Awaited<ReturnType<typeof createActionFlowStep>>
  >();

  for (const sourceStep of sourceSteps) {
    const createdStep = await createActionFlowStep({
      projectId: project.id,
      actionId: action.id,
      sortOrder: sourceStep.sortOrder,
      stepType: sourceStep.stepType,
      fieldKey: sourceStep.fieldKey,
      label: sourceStep.label,
      prompt: sourceStep.prompt,
      inputType: sourceStep.inputType,
      operationId: sourceStep.operationId,
      isRequired: sourceStep.isRequired,
      isEnabled: sourceStep.isEnabled,
      options: sourceStep.options,
      settings: sourceStep.settings,
    });

    stepIdMap.set(sourceStep.id, createdStep.id);
    createdSteps.set(sourceStep.id, createdStep);
  }

  for (const sourceStep of sourceSteps) {
    const createdStep = createdSteps.get(sourceStep.id);
    const mappedNextStepId = sourceStep.nextStepId
      ? stepIdMap.get(sourceStep.nextStepId)
      : null;

    if (!createdStep || !mappedNextStepId) {
      continue;
    }

    await updateActionFlowStep({
      projectId: project.id,
      actionId: action.id,
      stepId: createdStep.id,
      sortOrder: createdStep.sortOrder,
      stepType: createdStep.stepType,
      fieldKey: createdStep.fieldKey,
      label: createdStep.label,
      prompt: createdStep.prompt,
      inputType: createdStep.inputType,
      operationId: createdStep.operationId,
      nextStepId: mappedNextStepId,
      isRequired: createdStep.isRequired,
      isEnabled: createdStep.isEnabled,
      options: createdStep.options,
      settings: createdStep.settings,
    });
  }

  let branchRuleCount = 0;
  for (const sourceRule of sourceBranchRules) {
    const sourceStepId = stepIdMap.get(sourceRule.sourceStepId);
    const targetStepId = stepIdMap.get(sourceRule.targetStepId);

    if (!sourceStepId || !targetStepId) {
      continue;
    }

    await createActionFlowBranchRule({
      projectId: project.id,
      actionId: action.id,
      sourceStepId,
      sourceFieldKey: sourceRule.sourceFieldKey,
      operator: sourceRule.operator as ActionBranchOperator,
      comparisonValue: sourceRule.comparisonValue,
      targetStepId,
      sortOrder: sourceRule.sortOrder,
      isEnabled: sourceRule.isEnabled,
      settings: sourceRule.settings,
    });
    branchRuleCount += 1;
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.template_applied",
    targetType: "project_action",
    targetId: action.id,
    metadata: {
      actionName: action.name,
      branchRuleCount,
      sourceActionId: sourceAction.id,
      stepCount: sourceSteps.length,
      templateKey: `project_action:${sourceAction.id}`,
      templateSource: "project_custom",
    },
  });

  revalidatePath("/projects/actions");
  revalidatePath(input.sourcePath);
  redirect(`/projects/actions/${action.id}?created=1`);
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "function"
  );
}

async function resolveActionForCurrentProject(actionId: number) {
  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.project.manage");
  const { project } = context;
  const action = await getProjectAction(project.id, actionId);

  if (!action) {
    redirect("/projects/actions?error=Action%20not%20found.");
  }

  return { ...context, action };
}

async function requireActionStepTarget(
  projectId: number,
  actionId: number,
  stepId: number | undefined,
) {
  if (!stepId) {
    return null;
  }

  const step = await getActionFlowStep(projectId, actionId, stepId);

  if (!step) {
    throw new Error("Invalid route target.");
  }

  return step;
}

export async function createProjectActionBuilderAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = actionDetailsSchema.safeParse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    description: formData.get("description"),
    status: formData.get("status") ?? "draft",
    triggerPhrases: formData.get("triggerPhrases"),
  });

  if (!parsed.success) {
    return { error: "Please check the action details." };
  }

  const context = await resolveUserAndProject(parsed.data.projectId);
  assertPermission(context.membership, "company.project.manage");
  const { project } = context;
  const action = await createProjectAction({
    projectId: project.id,
    name: parsed.data.name,
    description: parsed.data.description || null,
    status: parsed.data.status,
    triggerPhrases: parseActionStepLines(parsed.data.triggerPhrases),
  });
  await writeAuditLog({
    ...context,
    action: "chatbot_action.created",
    targetType: "project_action",
    targetId: action.id,
    metadata: { name: action.name, status: action.status },
  });

  revalidatePath("/projects/actions");
  redirect(`/projects/actions/${action.id}?created=1`);
}

export async function saveProjectActionAsTemplateAction(formData: FormData) {
  const parsed = saveTemplateSchema.safeParse({
    actionId: formData.get("actionId"),
  });

  if (!parsed.success) {
    redirect("/projects/actions?error=Invalid%20action.");
  }

  const context = await resolveActionForCurrentProject(parsed.data.actionId);
  const { action, project } = context;
  const steps = await listActionFlowSteps(project.id, action.id);

  if (steps.length === 0) {
    redirect(
      `/projects/actions/${action.id}?error=Add%20at%20least%20one%20step%20before%20saving%20a%20template.`,
    );
  }

  const savedAt = new Date().toISOString();
  const updatedAction = await updateProjectAction({
    projectId: project.id,
    actionId: action.id,
    name: action.name,
    description: action.description,
    status: action.status as ProjectActionStatus,
    triggerPhrases: action.triggerPhrases,
    settings: {
      ...action.settings,
      customTemplate: {
        enabled: true,
        savedAt,
        sourceActionId: action.id,
        version: getTemplateVersionFromSettings(action.settings),
      },
    },
  });

  if (!updatedAction) {
    redirect("/projects/actions?error=Action%20not%20found.");
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.template_saved",
    targetType: "project_action",
    targetId: action.id,
    metadata: {
      actionName: action.name,
      stepCount: steps.length,
      templateSource: "project_custom",
    },
  });

  revalidatePath(`/projects/actions/${action.id}`);
  revalidatePath("/projects/templates");
  redirect(`/projects/actions/${action.id}?templateSaved=1`);
}

export async function importActionFlowBuilderAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const file = formData.get("flowFile");
  const rawNameOverride = formData.get("nameOverride");
  const nameOverride =
    typeof rawNameOverride === "string" ? rawNameOverride : undefined;

  if (!isUploadedFile(file) || file.size === 0) {
    return { error: "Choose an exported JSON file." };
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.project.manage");
  const { project } = context;
  let imported: Awaited<ReturnType<typeof importActionFlowExport>>;

  try {
    const json = await file.text();
    const exportData = parseActionFlowExportJson(json);
    imported = await importActionFlowExport({
      exportData,
      nameOverride,
      projectId: project.id,
    });
  } catch {
    return { error: "Could not import that flow file." };
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.imported",
    targetType: "project_action",
    targetId: imported.actionId,
    metadata: {
      branchRuleCount: imported.branchRuleCount,
      skippedBranchRuleCount: imported.skippedBranchRuleCount,
      stepCount: imported.stepCount,
    },
  });

  revalidatePath("/projects/actions");
  redirect(`/projects/actions/${imported.actionId}?created=1`);
}

export async function applyActionTemplateAction(formData: FormData) {
  const parsed = templateApplySchema.safeParse({
    sourcePath: formData.get("sourcePath"),
    templateKey: formData.get("templateKey"),
  });
  const sourcePath = getTemplateApplySourcePath(
    parsed.success ? parsed.data.sourcePath : undefined,
  );

  if (!parsed.success) {
    redirect(`${sourcePath}?error=Please%20choose%20a%20template.`);
  }

  const template = getActionTemplate(parsed.data.templateKey);
  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.project.manage");

  if (template) {
    await applyBundledActionTemplate({
      context,
      sourcePath,
      template,
    });
  }

  const sourceActionId = parseProjectActionTemplateKey(parsed.data.templateKey);

  if (sourceActionId) {
    await applyProjectActionTemplate({
      context,
      sourceActionId,
      sourcePath,
    });
  }

  redirect(`${sourcePath}?error=Template%20not%20found.`);
}

export async function updateProjectActionBuilderAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = actionDetailsSchema.safeParse({
    actionId: formData.get("actionId"),
    name: formData.get("name"),
    description: formData.get("description"),
    experimentEnabled: formData.get("experimentEnabled") === "on",
    experimentKey: formData.get("experimentKey"),
    experimentVariantLabel: formData.get("experimentVariantLabel"),
    experimentWeight: formData.get("experimentWeight"),
    templateEnabled: formData.get("templateEnabled") === "on",
    templateVersion: formData.get("templateVersion"),
    status: formData.get("status") ?? "draft",
    triggerPhrases: formData.get("triggerPhrases"),
  });

  if (!parsed.success || !parsed.data.actionId) {
    return { error: "Please check the action details." };
  }

  const context = await resolveActionForCurrentProject(parsed.data.actionId);
  const { action: existingAction, project } = context;
  const action = await updateProjectAction({
    projectId: project.id,
    actionId: parsed.data.actionId,
    name: parsed.data.name,
    description: parsed.data.description || null,
    status: parsed.data.status as ProjectActionStatus,
    triggerPhrases: parseActionStepLines(parsed.data.triggerPhrases),
    settings: buildActionSettings({
      existingSettings: existingAction.settings,
      experimentEnabled: parsed.data.experimentEnabled,
      experimentKey: parsed.data.experimentKey,
      experimentVariantLabel: parsed.data.experimentVariantLabel,
      experimentWeight: parsed.data.experimentWeight,
      templateEnabled: parsed.data.templateEnabled,
      templateVersion: parsed.data.templateVersion,
    }),
  });

  if (!action) {
    return { error: "Action not found." };
  }
  await writeAuditLog({
    ...context,
    action: "chatbot_action.updated",
    targetType: "project_action",
    targetId: action.id,
    metadata: {
      experimentEnabled: parsed.data.experimentEnabled === true,
      name: action.name,
      status: action.status,
      templateEnabled: parsed.data.templateEnabled === true,
    },
  });

  revalidatePath("/projects/actions");
  revalidatePath(`/projects/actions/${action.id}`);
  revalidatePath(`/projects/actions/${action.id}/settings`);
  revalidatePath("/projects/templates");
  redirect(`/projects/actions/${action.id}/settings?updated=1`);
}

export async function publishProjectActionVersionAction(formData: FormData) {
  const actionId = actionIdSchema.safeParse(formData.get("actionId"));

  if (!actionId.success) {
    redirect("/projects/actions?error=Invalid%20action.");
  }

  const context = await resolveActionForCurrentProject(actionId.data);
  const { project, action, user } = context;
  const [steps, routeIssues] = await Promise.all([
    listActionFlowSteps(project.id, action.id),
    validateActionFlowRoutes(project.id, action.id),
  ]);
  const enabledSteps = steps.filter((step) => step.isEnabled);

  if (enabledSteps.length === 0) {
    redirect(
      `/projects/actions/${action.id}?error=Enable%20at%20least%20one%20step%20before%20publishing.`,
    );
  }

  if (countBlockingActionFlowIssues(routeIssues) > 0) {
    redirect(
      `/projects/actions/${action.id}?error=Fix%20route%20issues%20before%20publishing.`,
    );
  }

  const version = await createPublishedActionFlowVersion({
    projectId: project.id,
    actionId: action.id,
    publishedByUserId: user.id,
  });

  if (!version) {
    redirect(`/projects/actions/${action.id}?error=Could%20not%20publish.`);
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.version_published",
    targetType: "action_flow_version",
    targetId: version.id,
    metadata: {
      actionId: action.id,
      versionNumber: version.versionNumber,
    },
  });

  revalidatePath(`/projects/actions/${action.id}`);
  revalidatePath(`/projects/actions/${action.id}/canvas`);
  redirect(`/projects/actions/${action.id}?published=1`);
}

export async function activateProjectActionVersionAction(formData: FormData) {
  const actionId = actionIdSchema.safeParse(formData.get("actionId"));
  const versionId = actionIdSchema.safeParse(formData.get("versionId"));

  if (!actionId.success || !versionId.success) {
    redirect("/projects/actions?error=Invalid%20version.");
  }

  const context = await resolveActionForCurrentProject(actionId.data);
  const { project, action } = context;
  const version = await getActionFlowVersion(
    project.id,
    action.id,
    versionId.data,
  );

  if (!version) {
    redirect(`/projects/actions/${action.id}?error=Version%20not%20found.`);
  }

  await setProjectActionPublishedVersion({
    projectId: project.id,
    actionId: action.id,
    publishedVersionId: version.id,
  });

  await writeAuditLog({
    ...context,
    action: "chatbot_action.version_activated",
    targetType: "action_flow_version",
    targetId: version.id,
    metadata: {
      actionId: action.id,
      versionNumber: version.versionNumber,
    },
  });

  revalidatePath(`/projects/actions/${action.id}`);
  revalidatePath(`/projects/actions/${action.id}/canvas`);
  redirect(`/projects/actions/${action.id}?versionActivated=1`);
}

export async function restoreProjectActionVersionDraftAction(
  formData: FormData,
) {
  const actionId = actionIdSchema.safeParse(formData.get("actionId"));
  const versionId = actionIdSchema.safeParse(formData.get("versionId"));

  if (!actionId.success || !versionId.success) {
    redirect("/projects/actions?error=Invalid%20version.");
  }

  const context = await resolveActionForCurrentProject(actionId.data);
  const { project, action } = context;
  const version = await getActionFlowVersion(
    project.id,
    action.id,
    versionId.data,
  );

  if (!version) {
    redirect(`/projects/actions/${action.id}?error=Version%20not%20found.`);
  }

  let restored: Awaited<ReturnType<typeof restoreActionFlowDraftFromSnapshot>>;

  try {
    restored = await restoreActionFlowDraftFromSnapshot({
      actionId: action.id,
      projectId: project.id,
      snapshot: version.snapshot,
    });
  } catch {
    redirect(
      `/projects/actions/${action.id}/versions/${version.id}?error=Could%20not%20restore%20that%20version.`,
    );
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.version_restored_to_draft",
    targetType: "action_flow_version",
    targetId: version.id,
    metadata: {
      actionId: action.id,
      branchRuleCount: restored.branchRuleCount,
      skippedBranchRuleCount: restored.skippedBranchRuleCount,
      stepCount: restored.stepCount,
      versionNumber: version.versionNumber,
    },
  });

  revalidatePath(`/projects/actions/${action.id}`);
  revalidatePath(`/projects/actions/${action.id}/canvas`);
  revalidatePath(`/projects/actions/${action.id}/versions/${version.id}`);
  redirect(`/projects/actions/${action.id}?versionRestored=1`);
}

export async function createActionFlowStepAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = actionStepSchema.safeParse({
    actionId: formData.get("actionId"),
    sortOrder: formData.get("sortOrder"),
    stepType: formData.get("stepType"),
    fieldKey: formData.get("fieldKey"),
    label: formData.get("label"),
    prompt: formData.get("prompt"),
    inputType: formData.get("inputType"),
    operationId: formData.get("operationId"),
    operationFailureStepId: formData.get("operationFailureStepId"),
    operationOutcomeRoutes: parseOperationOutcomeRoutes(formData),
    mediaAssetId: formData.get("mediaAssetId"),
    whatsappTemplateCategory: formData.get("whatsappTemplateCategory"),
    whatsappTemplateBody: formData.get("whatsappTemplateBody"),
    whatsappTemplateLanguage: formData.get("whatsappTemplateLanguage"),
    whatsappTemplateName: formData.get("whatsappTemplateName"),
    whatsappTemplateStatus: formData.get("whatsappTemplateStatus"),
    whatsappTemplateVariables: formData.get("whatsappTemplateVariables"),
    productCatalogId: formData.get("productCatalogId"),
    productDisplayLayout: formData.get("productDisplayLayout"),
    productSelectionAllowMultiple:
      formData.get("productSelectionAllowMultiple") === "on",
    productSelectionAllowQuantity:
      formData.get("productSelectionAllowQuantity") === "on",
    productIds: formData.getAll("productIds"),
    nextStepId: formData.get("nextStepId"),
    operationSuccessStepId: formData.get("operationSuccessStepId"),
    sourceType: formData.get("sourceType"),
    catalogId: formData.get("catalogId"),
    filterByField: formData.get("filterByField"),
    choiceDisplayMode: formData.get("choiceDisplayMode"),
    operationExecutionMode: formData.get("operationExecutionMode"),
    contactAttributeKey: formData.get("contactAttributeKey"),
    contactAttributeFieldKey: formData.get("contactAttributeFieldKey"),
    contactAttributeValue: formData.get("contactAttributeValue"),
    contactAttributeValueSource: formData.get("contactAttributeValueSource"),
    contactAgentEmail: formData.get("contactAgentEmail"),
    contactTagNames: formData.get("contactTagNames"),
    contactTeamName: formData.get("contactTeamName"),
    connectedActionId: formData.get("connectedActionId"),
    connectFlowMode: formData.get("connectFlowMode"),
    handoffNotifyTeam: formData.get("handoffNotifyTeam") === "on",
    handoffPriority: formData.get("handoffPriority"),
    handoffQueue: formData.get("handoffQueue"),
    waitAmount: formData.get("waitAmount") || undefined,
    waitUnit: formData.get("waitUnit"),
    retryCount: formData.get("retryCount") || undefined,
    retryMessage: formData.get("retryMessage") ?? undefined,
    retryExhaustedStepId: formData.get("retryExhaustedStepId") ?? undefined,
    validationFailureStepId:
      formData.get("validationFailureStepId") ?? undefined,
    cancellationStepId: formData.get("cancellationStepId") ?? undefined,
    noReplyReminderMinutes: formData.get("noReplyReminderMinutes") || undefined,
    noReplyReminderMessage: formData.get("noReplyReminderMessage") ?? undefined,
    noReplyTimeoutMinutes: formData.get("noReplyTimeoutMinutes") || undefined,
    noReplyTimeoutMessage: formData.get("noReplyTimeoutMessage") ?? undefined,
    noReplyTimeoutStepId: formData.get("noReplyTimeoutStepId") ?? undefined,
    requiredMessage: formData.get("requiredMessage"),
    validationAllowedFileTypes: formData.get("validationAllowedFileTypes"),
    validationMaxDate: formData.get("validationMaxDate"),
    validationMaxLength: formData.get("validationMaxLength") || undefined,
    validationMaxNumber: formData.get("validationMaxNumber") || undefined,
    validationMessage: formData.get("validationMessage"),
    validationMinDate: formData.get("validationMinDate"),
    validationMinLength: formData.get("validationMinLength") || undefined,
    validationMinNumber: formData.get("validationMinNumber") || undefined,
    validationRegex: formData.get("validationRegex"),
    isRequired: formData.get("isRequired") === "on",
    isEnabled: formData.get("isEnabled") === "on",
    options: formData.get("options"),
  });

  if (!parsed.success) {
    return { error: "Field key, label, and prompt are required." };
  }

  const context = await resolveActionForCurrentProject(parsed.data.actionId);
  const { project, action } = context;
  const isInputStep = isFlowInputStepType(parsed.data.stepType);
  const canStoreFieldKey = isInputStep || parsed.data.stepType === "operation";
  const inputType = getFlowInputType(
    parsed.data.stepType,
    parsed.data.inputType,
  );
  const mediaAsset = await requireStepMediaAsset({
    mediaAssetId: parsed.data.mediaAssetId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const productConfig = await requireStepProductConfig({
    productCatalogId: parsed.data.productCatalogId,
    productIds: parsed.data.productIds,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const connectedAction = await requireConnectedAction({
    actionId: action.id,
    connectedActionId: parsed.data.connectedActionId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });

  if (parsed.data.stepType === "media" && !mediaAsset) {
    return { error: "Media asset must belong to this project." };
  }

  if (
    ["catalog_message", "single_product", "multiple_products"].includes(
      parsed.data.stepType,
    ) &&
    (!productConfig.productCatalog || productConfig.products.length === 0)
  ) {
    return { error: "Product selection must belong to this project." };
  }

  if (
    parsed.data.stepType === "product_selection" &&
    productConfig.products.length === 0
  ) {
    return { error: "Product selection must belong to this project." };
  }

  if (parsed.data.stepType === "connect_flow" && !connectedAction) {
    return {
      error: "Connected flow must be an active flow in this project.",
    };
  }

  try {
    await requireActionStepTarget(
      project.id,
      action.id,
      parsed.data.nextStepId,
    );
  } catch {
    return { error: "Default next step must belong to this action." };
  }

  try {
    const step = await createActionFlowStep({
      projectId: project.id,
      actionId: action.id,
      sortOrder: parsed.data.sortOrder,
      stepType: parsed.data.stepType,
      fieldKey: canStoreFieldKey ? parsed.data.fieldKey || null : null,
      label: parsed.data.label || null,
      prompt: parsed.data.prompt || null,
      inputType: isInputStep ? inputType : null,
      operationId: parsed.data.operationId ?? null,
      nextStepId: parsed.data.nextStepId ?? null,
      isRequired: isInputStep ? parsed.data.isRequired : false,
      isEnabled: parsed.data.isEnabled,
      options: isInputStep ? parseActionStepOptions(parsed.data.options) : [],
      settings: buildActionStepSettings({
        ...parsed.data,
        connectedAction,
        mediaAsset,
        ...productConfig,
      }),
    });
    await syncOperationStepRoutePresets({
      actionId: action.id,
      failureStepId: parsed.data.operationFailureStepId,
      fieldKey: step.fieldKey ?? undefined,
      outcomeStepIds: parsed.data.operationOutcomeRoutes,
      projectId: project.id,
      sourceStepId: step.id,
      stepType: step.stepType,
      successStepId: parsed.data.operationSuccessStepId,
    });
    await writeAuditLog({
      ...context,
      action: "chatbot_action.step_created",
      targetType: "action_flow_step",
      targetId: step.id,
      metadata: {
        actionId: action.id,
        fieldKey: step.fieldKey,
        sortOrder: step.sortOrder,
        stepType: step.stepType,
      },
    });
  } catch {
    return { error: "Step order must be unique." };
  }

  revalidatePath(`/projects/actions/${action.id}`);
  redirect(`/projects/actions/${action.id}?stepCreated=1`);
}

export async function updateActionFlowStepAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = actionStepSchema.safeParse({
    actionId: formData.get("actionId"),
    stepId: formData.get("stepId"),
    sortOrder: formData.get("sortOrder"),
    stepType: formData.get("stepType"),
    fieldKey: formData.get("fieldKey"),
    label: formData.get("label"),
    prompt: formData.get("prompt"),
    inputType: formData.get("inputType"),
    operationId: formData.get("operationId"),
    operationFailureStepId: formData.get("operationFailureStepId"),
    operationOutcomeRoutes: parseOperationOutcomeRoutes(formData),
    mediaAssetId: formData.get("mediaAssetId"),
    whatsappTemplateCategory: formData.get("whatsappTemplateCategory"),
    whatsappTemplateBody: formData.get("whatsappTemplateBody"),
    whatsappTemplateLanguage: formData.get("whatsappTemplateLanguage"),
    whatsappTemplateName: formData.get("whatsappTemplateName"),
    whatsappTemplateStatus: formData.get("whatsappTemplateStatus"),
    whatsappTemplateVariables: formData.get("whatsappTemplateVariables"),
    productCatalogId: formData.get("productCatalogId"),
    productDisplayLayout: formData.get("productDisplayLayout"),
    productSelectionAllowMultiple:
      formData.get("productSelectionAllowMultiple") === "on",
    productSelectionAllowQuantity:
      formData.get("productSelectionAllowQuantity") === "on",
    productIds: formData.getAll("productIds"),
    nextStepId: formData.get("nextStepId"),
    operationSuccessStepId: formData.get("operationSuccessStepId"),
    sourceType: formData.get("sourceType"),
    catalogId: formData.get("catalogId"),
    filterByField: formData.get("filterByField"),
    choiceDisplayMode: formData.get("choiceDisplayMode"),
    operationExecutionMode: formData.get("operationExecutionMode"),
    contactAttributeKey: formData.get("contactAttributeKey"),
    contactAttributeFieldKey: formData.get("contactAttributeFieldKey"),
    contactAttributeValue: formData.get("contactAttributeValue"),
    contactAttributeValueSource: formData.get("contactAttributeValueSource"),
    contactAgentEmail: formData.get("contactAgentEmail"),
    contactTagNames: formData.get("contactTagNames"),
    contactTeamName: formData.get("contactTeamName"),
    connectedActionId: formData.get("connectedActionId"),
    connectFlowMode: formData.get("connectFlowMode"),
    handoffNotifyTeam: formData.get("handoffNotifyTeam") === "on",
    handoffPriority: formData.get("handoffPriority"),
    handoffQueue: formData.get("handoffQueue"),
    waitAmount: formData.get("waitAmount") || undefined,
    waitUnit: formData.get("waitUnit"),
    retryCount: formData.get("retryCount") || undefined,
    retryMessage: formData.get("retryMessage") ?? undefined,
    retryExhaustedStepId: formData.get("retryExhaustedStepId") ?? undefined,
    validationFailureStepId:
      formData.get("validationFailureStepId") ?? undefined,
    cancellationStepId: formData.get("cancellationStepId") ?? undefined,
    noReplyReminderMinutes: formData.get("noReplyReminderMinutes") || undefined,
    noReplyReminderMessage: formData.get("noReplyReminderMessage") ?? undefined,
    noReplyTimeoutMinutes: formData.get("noReplyTimeoutMinutes") || undefined,
    noReplyTimeoutMessage: formData.get("noReplyTimeoutMessage") ?? undefined,
    noReplyTimeoutStepId: formData.get("noReplyTimeoutStepId") ?? undefined,
    requiredMessage: formData.get("requiredMessage"),
    validationAllowedFileTypes: formData.get("validationAllowedFileTypes"),
    validationMaxDate: formData.get("validationMaxDate"),
    validationMaxLength: formData.get("validationMaxLength") || undefined,
    validationMaxNumber: formData.get("validationMaxNumber") || undefined,
    validationMessage: formData.get("validationMessage"),
    validationMinDate: formData.get("validationMinDate"),
    validationMinLength: formData.get("validationMinLength") || undefined,
    validationMinNumber: formData.get("validationMinNumber") || undefined,
    validationRegex: formData.get("validationRegex"),
    isRequired: formData.get("isRequired") === "on",
    isEnabled: formData.get("isEnabled") === "on",
    options: formData.get("options"),
  });

  if (!parsed.success || !parsed.data.stepId) {
    return { error: "Field key, label, and prompt are required." };
  }

  const context = await resolveActionForCurrentProject(parsed.data.actionId);
  const { project, action } = context;
  const existingStep = await getActionFlowStep(
    project.id,
    action.id,
    parsed.data.stepId,
  );
  if (!existingStep) {
    return { error: "Step not found." };
  }
  const isInputStep = isFlowInputStepType(parsed.data.stepType);
  const canStoreFieldKey = isInputStep || parsed.data.stepType === "operation";
  const inputType = getFlowInputType(
    parsed.data.stepType,
    parsed.data.inputType,
  );
  const mediaAsset = await requireStepMediaAsset({
    mediaAssetId: parsed.data.mediaAssetId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const productConfig = await requireStepProductConfig({
    productCatalogId: parsed.data.productCatalogId,
    productIds: parsed.data.productIds,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const connectedAction = await requireConnectedAction({
    actionId: action.id,
    connectedActionId: parsed.data.connectedActionId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });

  if (parsed.data.stepType === "media" && !mediaAsset) {
    return { error: "Media asset must belong to this project." };
  }

  if (
    ["catalog_message", "single_product", "multiple_products"].includes(
      parsed.data.stepType,
    ) &&
    (!productConfig.productCatalog || productConfig.products.length === 0)
  ) {
    return { error: "Product selection must belong to this project." };
  }

  if (
    parsed.data.stepType === "product_selection" &&
    productConfig.products.length === 0
  ) {
    return { error: "Product selection must belong to this project." };
  }

  if (parsed.data.stepType === "connect_flow" && !connectedAction) {
    return {
      error: "Connected flow must be an active flow in this project.",
    };
  }

  if (parsed.data.nextStepId === parsed.data.stepId) {
    return { error: "Default next step cannot point to itself." };
  }

  try {
    await requireActionStepTarget(
      project.id,
      action.id,
      parsed.data.nextStepId,
    );
  } catch {
    return { error: "Default next step must belong to this action." };
  }

  try {
    const step = await updateActionFlowStep({
      projectId: project.id,
      actionId: action.id,
      stepId: parsed.data.stepId,
      sortOrder: parsed.data.sortOrder,
      stepType: parsed.data.stepType,
      fieldKey: canStoreFieldKey ? parsed.data.fieldKey || null : null,
      label: parsed.data.label || null,
      prompt: parsed.data.prompt || null,
      inputType: isInputStep ? inputType : null,
      operationId: parsed.data.operationId ?? null,
      nextStepId: parsed.data.nextStepId ?? null,
      isRequired: isInputStep ? parsed.data.isRequired : false,
      isEnabled: parsed.data.isEnabled,
      options: isInputStep
        ? mergeActionStepOptions(parsed.data.options, existingStep.options)
        : [],
      settings: buildActionStepSettings({
        ...parsed.data,
        connectedAction,
        existingSettings: existingStep.settings,
        mediaAsset,
        ...productConfig,
      }),
    });
    await syncOperationStepRoutePresets({
      actionId: action.id,
      failureStepId: parsed.data.operationFailureStepId,
      fieldKey: step?.fieldKey ?? undefined,
      outcomeStepIds: parsed.data.operationOutcomeRoutes,
      projectId: project.id,
      sourceStepId: parsed.data.stepId,
      stepType: parsed.data.stepType,
      successStepId: parsed.data.operationSuccessStepId,
    });
    if (step) {
      await writeAuditLog({
        ...context,
        action: "chatbot_action.step_updated",
        targetType: "action_flow_step",
        targetId: step.id,
        metadata: {
          actionId: action.id,
          fieldKey: step.fieldKey,
          sortOrder: step.sortOrder,
          stepType: step.stepType,
        },
      });
    }
  } catch {
    return { error: "Step order must be unique." };
  }

  revalidatePath(`/projects/actions/${action.id}`);
  revalidatePath(`/projects/actions/${action.id}/steps/${parsed.data.stepId}`);
  redirect(`/projects/actions/${action.id}?stepUpdated=1`);
}

export async function createActionFlowBranchRuleAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = branchRuleSchema.safeParse({
    actionId: formData.get("actionId"),
    sourceStepId: formData.get("sourceStepId"),
    sourceFieldKey: formData.get("sourceFieldKey"),
    operator: formData.get("operator"),
    comparisonValue: formData.get("comparisonValue"),
    branchLabel: formData.get("branchLabel") ?? undefined,
    targetStepId: formData.get("targetStepId"),
    sortOrder: formData.get("sortOrder"),
    isEnabled: formData.get("isEnabled") === "on",
  });

  if (!parsed.success) {
    return { error: "Please check the branch rule." };
  }

  const context = await resolveActionForCurrentProject(parsed.data.actionId);
  const { project, action } = context;

  try {
    await Promise.all([
      requireActionStepTarget(project.id, action.id, parsed.data.sourceStepId),
      requireActionStepTarget(project.id, action.id, parsed.data.targetStepId),
    ]);
  } catch {
    return { error: "Branch steps must belong to this action." };
  }

  try {
    const rule = await createActionFlowBranchRule({
      projectId: project.id,
      actionId: action.id,
      sourceStepId: parsed.data.sourceStepId,
      sourceFieldKey: parsed.data.sourceFieldKey,
      operator: parsed.data.operator as ActionBranchOperator,
      comparisonValue: parsed.data.comparisonValue || null,
      targetStepId: parsed.data.targetStepId,
      sortOrder: parsed.data.sortOrder,
      isEnabled: parsed.data.isEnabled,
      settings: buildBranchRuleSettings(undefined, parsed.data.branchLabel),
    });
    await writeAuditLog({
      ...context,
      action: "chatbot_action.branch_rule_created",
      targetType: "action_flow_branch_rule",
      targetId: rule.id,
      metadata: {
        actionId: action.id,
        sourceFieldKey: rule.sourceFieldKey,
        sourceStepId: rule.sourceStepId,
        targetStepId: rule.targetStepId,
      },
    });
  } catch {
    return { error: "Branch rule order must be unique for this step." };
  }

  revalidatePath(`/projects/actions/${action.id}`);
  revalidatePath(
    `/projects/actions/${action.id}/steps/${parsed.data.sourceStepId}`,
  );
  redirect(
    `/projects/actions/${action.id}/steps/${parsed.data.sourceStepId}?branchCreated=1`,
  );
}

export async function updateActionFlowBranchRuleAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = branchRuleSchema.safeParse({
    actionId: formData.get("actionId"),
    ruleId: formData.get("ruleId"),
    sourceStepId: formData.get("sourceStepId"),
    sourceFieldKey: formData.get("sourceFieldKey"),
    operator: formData.get("operator"),
    comparisonValue: formData.get("comparisonValue"),
    branchLabel: formData.get("branchLabel") ?? undefined,
    targetStepId: formData.get("targetStepId"),
    sortOrder: formData.get("sortOrder"),
    isEnabled: formData.get("isEnabled") === "on",
  });

  if (!parsed.success || !parsed.data.ruleId) {
    return { error: "Please check the branch rule." };
  }

  const context = await resolveActionForCurrentProject(parsed.data.actionId);
  const { project, action } = context;
  const existingRule = await getActionFlowBranchRule(
    project.id,
    action.id,
    parsed.data.ruleId,
  );

  if (!existingRule) {
    return { error: "Branch rule not found." };
  }

  try {
    await Promise.all([
      requireActionStepTarget(project.id, action.id, parsed.data.sourceStepId),
      requireActionStepTarget(project.id, action.id, parsed.data.targetStepId),
    ]);
  } catch {
    return { error: "Branch steps must belong to this action." };
  }

  try {
    const rule = await updateActionFlowBranchRule({
      projectId: project.id,
      actionId: action.id,
      ruleId: parsed.data.ruleId,
      sourceStepId: parsed.data.sourceStepId,
      sourceFieldKey: parsed.data.sourceFieldKey,
      operator: parsed.data.operator as ActionBranchOperator,
      comparisonValue: parsed.data.comparisonValue || null,
      targetStepId: parsed.data.targetStepId,
      sortOrder: parsed.data.sortOrder,
      isEnabled: parsed.data.isEnabled,
      settings: buildBranchRuleSettings(
        existingRule.settings,
        parsed.data.branchLabel,
      ),
    });
    if (rule) {
      await writeAuditLog({
        ...context,
        action: "chatbot_action.branch_rule_updated",
        targetType: "action_flow_branch_rule",
        targetId: rule.id,
        metadata: {
          actionId: action.id,
          sourceFieldKey: rule.sourceFieldKey,
          sourceStepId: rule.sourceStepId,
          targetStepId: rule.targetStepId,
        },
      });
    }
  } catch {
    return { error: "Branch rule order must be unique for this step." };
  }

  revalidatePath(`/projects/actions/${action.id}`);
  revalidatePath(
    `/projects/actions/${action.id}/steps/${parsed.data.sourceStepId}`,
  );
  redirect(
    `/projects/actions/${action.id}/steps/${parsed.data.sourceStepId}?branchUpdated=1`,
  );
}

export async function deleteActionFlowBranchRuleAction(formData: FormData) {
  const actionId = actionIdSchema.safeParse(formData.get("actionId"));
  const ruleId = actionIdSchema.safeParse(formData.get("ruleId"));
  const sourceStepId = actionIdSchema.safeParse(formData.get("sourceStepId"));

  if (!actionId.success || !ruleId.success || !sourceStepId.success) {
    redirect("/projects/actions?error=Invalid%20branch%20rule.");
  }

  const context = await resolveActionForCurrentProject(actionId.data);
  const { project, action } = context;
  const rule = await deleteActionFlowBranchRule(
    project.id,
    action.id,
    ruleId.data,
  );

  if (rule) {
    await writeAuditLog({
      ...context,
      action: "chatbot_action.branch_rule_deleted",
      targetType: "action_flow_branch_rule",
      targetId: rule.id,
      metadata: {
        actionId: action.id,
        sourceFieldKey: rule.sourceFieldKey,
        sourceStepId: rule.sourceStepId,
        targetStepId: rule.targetStepId,
      },
    });
  }

  revalidatePath(`/projects/actions/${action.id}`);
  revalidatePath(`/projects/actions/${action.id}/steps/${sourceStepId.data}`);
  redirect(
    `/projects/actions/${action.id}/steps/${sourceStepId.data}?branchDeleted=1`,
  );
}

export async function moveActionFlowStepAction(formData: FormData) {
  const parsed = stepMoveSchema.safeParse({
    actionId: formData.get("actionId"),
    stepId: formData.get("stepId"),
    direction: formData.get("direction"),
  });

  if (!parsed.success) {
    redirect("/projects/actions?error=Invalid%20step%20move.");
  }

  const context = await resolveActionForCurrentProject(parsed.data.actionId);
  const { project, action } = context;
  const steps = await listActionFlowSteps(project.id, action.id);
  const stepIndex = steps.findIndex((step) => step.id === parsed.data.stepId);
  const neighborIndex =
    parsed.data.direction === "up" ? stepIndex - 1 : stepIndex + 1;
  const step = steps[stepIndex];
  const neighbor = steps[neighborIndex];

  if (!step || !neighbor) {
    redirect(`/projects/actions/${action.id}`);
  }

  try {
    await setActionFlowStepSortOrder({
      projectId: project.id,
      actionId: action.id,
      stepId: step.id,
      sortOrder: -step.id,
    });
    await setActionFlowStepSortOrder({
      projectId: project.id,
      actionId: action.id,
      stepId: neighbor.id,
      sortOrder: step.sortOrder,
    });
    await setActionFlowStepSortOrder({
      projectId: project.id,
      actionId: action.id,
      stepId: step.id,
      sortOrder: neighbor.sortOrder,
    });
  } catch {
    redirect(
      `/projects/actions/${action.id}?error=Could%20not%20move%20that%20step.`,
    );
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.step_moved",
    targetType: "action_flow_step",
    targetId: step.id,
    metadata: {
      actionId: action.id,
      direction: parsed.data.direction,
      sortOrder: neighbor.sortOrder,
    },
  });

  revalidatePath(`/projects/actions/${action.id}`);
  redirect(`/projects/actions/${action.id}?stepUpdated=1`);
}

export async function duplicateActionFlowStepAction(formData: FormData) {
  const actionId = actionIdSchema.safeParse(formData.get("actionId"));
  const stepId = actionIdSchema.safeParse(formData.get("stepId"));

  if (!actionId.success || !stepId.success) {
    redirect("/projects/actions?error=Invalid%20step.");
  }

  const context = await resolveActionForCurrentProject(actionId.data);
  const { project, action } = context;
  const sourceStep = await getActionFlowStep(
    project.id,
    action.id,
    stepId.data,
  );

  if (!sourceStep) {
    redirect(`/projects/actions/${action.id}?error=Step%20not%20found.`);
  }

  const steps = await listActionFlowSteps(project.id, action.id);
  const nextSortOrder =
    steps.reduce((max, step) => Math.max(max, step.sortOrder), 0) + 1;
  const label = sourceStep.label
    ? `${sourceStep.label} Copy`.slice(0, 160)
    : null;
  const fieldKey = sourceStep.fieldKey
    ? `${sourceStep.fieldKey}Copy`.slice(0, 80)
    : null;
  const duplicatedStep = await createActionFlowStep({
    projectId: project.id,
    actionId: action.id,
    sortOrder: nextSortOrder,
    stepType: sourceStep.stepType,
    fieldKey,
    label,
    prompt: sourceStep.prompt,
    inputType: sourceStep.inputType,
    operationId: sourceStep.operationId,
    nextStepId: null,
    isRequired: sourceStep.isRequired,
    isEnabled: false,
    options: sourceStep.options,
    settings: sourceStep.settings,
  });

  await writeAuditLog({
    ...context,
    action: "chatbot_action.step_duplicated",
    targetType: "action_flow_step",
    targetId: duplicatedStep.id,
    metadata: {
      actionId: action.id,
      sourceStepId: sourceStep.id,
      sortOrder: duplicatedStep.sortOrder,
    },
  });

  revalidatePath(`/projects/actions/${action.id}`);
  redirect(`/projects/actions/${action.id}/steps/${duplicatedStep.id}`);
}

export async function toggleActionFlowStepEnabledAction(formData: FormData) {
  const parsed = stepToggleSchema.safeParse({
    actionId: formData.get("actionId"),
    stepId: formData.get("stepId"),
    isEnabled: formData.get("isEnabled"),
  });

  if (!parsed.success) {
    redirect("/projects/actions?error=Invalid%20step%20status.");
  }

  const context = await resolveActionForCurrentProject(parsed.data.actionId);
  const { project, action } = context;
  const isEnabled = parsed.data.isEnabled === "true";
  const step = await setActionFlowStepEnabled({
    projectId: project.id,
    actionId: action.id,
    stepId: parsed.data.stepId,
    isEnabled,
  });

  if (!step) {
    redirect(`/projects/actions/${action.id}?error=Step%20not%20found.`);
  }

  await writeAuditLog({
    ...context,
    action: isEnabled
      ? "chatbot_action.step_enabled"
      : "chatbot_action.step_disabled",
    targetType: "action_flow_step",
    targetId: step.id,
    metadata: { actionId: action.id, sortOrder: step.sortOrder },
  });

  revalidatePath(`/projects/actions/${action.id}`);
  redirect(`/projects/actions/${action.id}?stepUpdated=1`);
}

export async function deleteActionFlowStepAction(formData: FormData) {
  const actionId = actionIdSchema.safeParse(formData.get("actionId"));
  const stepId = actionIdSchema.safeParse(formData.get("stepId"));

  if (!actionId.success || !stepId.success) {
    redirect("/projects/actions?error=Invalid%20step.");
  }

  const context = await resolveActionForCurrentProject(actionId.data);
  const { project, action } = context;
  await deleteActionFlowStep(project.id, action.id, stepId.data);
  await writeAuditLog({
    ...context,
    action: "chatbot_action.step_deleted",
    targetType: "action_flow_step",
    targetId: stepId.data,
    metadata: { actionId: action.id },
  });

  revalidatePath(`/projects/actions/${action.id}`);
  redirect(`/projects/actions/${action.id}?stepDeleted=1`);
}

export async function deleteProjectActionBuilderAction(formData: FormData) {
  const actionId = actionIdSchema.safeParse(formData.get("actionId"));

  if (!actionId.success) {
    redirect("/projects/actions?error=Invalid%20action.");
  }

  const context = await resolveActionForCurrentProject(actionId.data);
  const { project, action } = context;

  await deleteProjectAction(project.id, action.id);
  await writeAuditLog({
    ...context,
    action: "chatbot_action.deleted",
    targetType: "project_action",
    targetId: action.id,
    metadata: { name: action.name },
  });

  revalidatePath("/projects/actions");
  revalidatePath("/projects/submissions");
  redirect("/projects/actions?deleted=1");
}
