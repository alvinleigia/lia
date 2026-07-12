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
  ACTION_STEP_INPUT_TYPES,
  ACTION_STEP_TYPES,
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
  syncOperationRoutePresets,
  updateActionFlowBranchRule,
  updateActionFlowStep,
  updateProjectAction,
  validateActionFlowRoutes,
} from "@/lib/action-flows";
import {
  getActionTemplate,
  isProjectActionTemplate,
  parseProjectActionTemplateKey,
} from "@/lib/action-templates";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndProject } from "@/lib/auth-project";
import type {
  SelectCatalogProduct,
  SelectMediaAsset,
  SelectProductCatalog,
} from "@/lib/db-schema";
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

const actionStepSchema = z
  .object({
    actionId: z.coerce.number().int().positive(),
    stepId: z.coerce.number().int().positive().optional(),
    sortOrder: z.coerce.number().int().positive(),
    stepType: z.enum(ACTION_STEP_TYPES),
    fieldKey: z.string().trim().max(80).optional(),
    label: z.string().trim().max(160).optional(),
    prompt: z.string().trim().max(1000).optional(),
    inputType: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.enum(ACTION_STEP_INPUT_TYPES).optional(),
    ),
    operationId: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.coerce.number().int().positive().optional(),
    ),
    operationFailureStepId: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.coerce.number().int().positive().optional(),
    ),
    nextStepId: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.coerce.number().int().positive().optional(),
    ),
    operationSuccessStepId: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.coerce.number().int().positive().optional(),
    ),
    mediaAssetId: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.coerce.number().int().positive().optional(),
    ),
    whatsappTemplateCategory: z
      .enum(["authentication", "marketing", "utility"])
      .optional(),
    whatsappTemplateBody: z.string().trim().max(4000).optional(),
    whatsappTemplateLanguage: z.string().trim().max(20).optional(),
    whatsappTemplateName: z.string().trim().max(120).optional(),
    whatsappTemplateStatus: z
      .enum(["approved", "draft", "pending", "rejected"])
      .optional(),
    whatsappTemplateVariables: z.string().trim().max(2000).optional(),
    productCatalogId: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.coerce.number().int().positive().optional(),
    ),
    productIds: z.array(z.coerce.number().int().positive()).optional(),
    productDisplayLayout: z.enum(["featured", "grid", "list"]).optional(),
    productSelectionAllowMultiple: z.coerce.boolean().optional(),
    productSelectionAllowQuantity: z.coerce.boolean().optional(),
    sourceType: z.string().trim().max(80).optional(),
    catalogId: z.string().trim().max(120).optional(),
    filterByField: z.string().trim().max(80).optional(),
    choiceDisplayMode: z.enum(["buttons", "list", "text"]).optional(),
    operationExecutionMode: z.enum(["post_submit", "inline"]).optional(),
    contactAttributeKey: z.string().trim().max(120).optional(),
    contactAttributeFieldKey: z.string().trim().max(120).optional(),
    contactAttributeValue: z.string().trim().max(1000).optional(),
    contactAttributeValueSource: z.enum(["field", "static"]).optional(),
    contactTagNames: z.string().trim().max(1000).optional(),
    connectedActionId: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.coerce.number().int().positive().optional(),
    ),
    connectFlowMode: z.enum(["jump", "return"]).optional(),
    handoffNotifyTeam: z.coerce.boolean().optional(),
    handoffPriority: z.enum(["high", "low", "normal", "urgent"]).optional(),
    handoffQueue: z.string().trim().max(120).optional(),
    requiredMessage: z.string().trim().max(240).optional(),
    validationMessage: z.string().trim().max(240).optional(),
    validationAllowedFileTypes: z.string().trim().max(1000).optional(),
    validationMaxDate: z.string().trim().max(20).optional(),
    validationMaxLength: z.coerce.number().int().min(1).max(10000).optional(),
    validationMaxNumber: z.coerce
      .number()
      .min(-1_000_000_000)
      .max(1_000_000_000)
      .optional(),
    validationMinDate: z.string().trim().max(20).optional(),
    validationMinLength: z.coerce.number().int().min(0).max(10000).optional(),
    validationMinNumber: z.coerce
      .number()
      .min(-1_000_000_000)
      .max(1_000_000_000)
      .optional(),
    validationRegex: z.string().trim().max(500).optional(),
    isRequired: z.coerce.boolean().optional(),
    isEnabled: z.coerce.boolean().optional(),
    options: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const isInputStep = isInputStepType(data.stepType);
    const isPromptStep =
      data.stepType === "message" ||
      data.stepType === "display_result" ||
      data.stepType === "handoff";

    if (data.stepType === "operation" && !data.operationId) {
      ctx.addIssue({
        code: "custom",
        message: "Operation is required.",
        path: ["operationId"],
      });
    }

    if (isPromptStep && !data.prompt?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Prompt is required.",
        path: ["prompt"],
      });
    }

    if (data.stepType === "choice") {
      const hasManualOptions = parseLines(data.options).length > 0;
      const hasDynamicOptions = Boolean(data.sourceType?.trim());

      if (!hasManualOptions && !hasDynamicOptions) {
        ctx.addIssue({
          code: "custom",
          message: "Choice steps need manual options or an option source.",
          path: ["options"],
        });
      }
    }

    if (data.stepType === "media" && !data.mediaAssetId) {
      ctx.addIssue({
        code: "custom",
        message: "Media asset is required.",
        path: ["mediaAssetId"],
      });
    }

    if (
      data.stepType === "template_message" &&
      (!data.whatsappTemplateName?.trim() ||
        !data.whatsappTemplateLanguage?.trim())
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Template name and language are required.",
        path: ["whatsappTemplateName"],
      });
    }

    if (data.stepType === "catalog_message" && !data.productCatalogId) {
      ctx.addIssue({
        code: "custom",
        message: "Product catalog is required.",
        path: ["productCatalogId"],
      });
    }

    if (
      data.stepType === "single_product" &&
      (data.productIds ?? []).length !== 1
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Choose exactly one product.",
        path: ["productIds"],
      });
    }

    if (
      data.stepType === "multiple_products" &&
      (data.productIds ?? []).length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Choose at least one product.",
        path: ["productIds"],
      });
    }

    if (
      data.stepType === "product_selection" &&
      !data.productCatalogId &&
      (data.productIds ?? []).length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Choose a product catalog or at least one product.",
        path: ["productIds"],
      });
    }

    if (
      data.stepType === "set_attribute" &&
      (!data.contactAttributeKey?.trim() ||
        (data.contactAttributeValueSource === "static"
          ? !data.contactAttributeValue?.trim()
          : !data.contactAttributeFieldKey?.trim()))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Attribute key and value source are required.",
        path: ["contactAttributeKey"],
      });
    }

    if (data.stepType === "add_tag" && !data.contactTagNames?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "At least one tag is required.",
        path: ["contactTagNames"],
      });
    }

    if (data.stepType === "connect_flow" && !data.connectedActionId) {
      ctx.addIssue({
        code: "custom",
        message: "Connected flow is required.",
        path: ["connectedActionId"],
      });
    }

    if (!isInputStep) {
      return;
    }

    if (!data.fieldKey?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Field key is required.",
        path: ["fieldKey"],
      });
    }

    if (!data.label?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Label is required.",
        path: ["label"],
      });
    }

    if (!data.prompt?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Prompt is required.",
        path: ["prompt"],
      });
    }

    if (
      data.validationMinLength !== undefined &&
      data.validationMaxLength !== undefined &&
      data.validationMinLength > data.validationMaxLength
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Minimum length cannot be greater than maximum length.",
        path: ["validationMinLength"],
      });
    }

    if (
      data.validationMinNumber !== undefined &&
      data.validationMaxNumber !== undefined &&
      data.validationMinNumber > data.validationMaxNumber
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Minimum number cannot be greater than maximum number.",
        path: ["validationMinNumber"],
      });
    }

    if (
      data.validationMinDate &&
      data.validationMaxDate &&
      data.validationMinDate > data.validationMaxDate
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Minimum date cannot be after maximum date.",
        path: ["validationMinDate"],
      });
    }

    if (data.validationRegex) {
      try {
        new RegExp(data.validationRegex);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Regex pattern is invalid.",
          path: ["validationRegex"],
        });
      }
    }
  });

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

function parseLines(value?: string) {
  return (
    value
      ?.split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

function parseOptions(value?: string) {
  return parseLines(value).map((label) => ({ label, value: label }));
}

function setOptionalStringSetting(
  settings: Record<string, unknown>,
  key: string,
  value: string | undefined,
) {
  const trimmed = value?.trim();
  if (trimmed) {
    settings[key] = trimmed;
  }
}

function setOptionalNumberSetting(
  settings: Record<string, unknown>,
  key: string,
  value: number | undefined,
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    settings[key] = value;
  }
}

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

function isInputStepType(stepType: string) {
  return [
    "collect_input",
    "choice",
    "date",
    "date_range",
    "address",
    "time",
    "number",
    "email",
    "phone",
    "location",
    "product_selection",
  ].includes(stepType);
}

function getInputTypeForStepType(
  stepType: string,
  inputType?: string,
): string | null {
  switch (stepType) {
    case "date":
      return "date";
    case "email":
      return "email";
    case "number":
      return "float";
    case "phone":
      return "phone";
    case "time":
      return "time";
    case "address":
    case "date_range":
    case "location":
    case "product_selection":
      return "text";
    default:
      return inputType || null;
  }
}

function getOperationStatusFieldKey(stepId: number, fieldKey?: string) {
  return fieldKey?.trim() || `operation_${stepId}_status`;
}

async function syncOperationStepRoutes(input: {
  actionId: number;
  failureStepId?: number;
  fieldKey?: string;
  projectId: number;
  sourceStepId: number;
  stepType: string;
  successStepId?: number;
}) {
  if (input.stepType !== "operation") {
    return;
  }

  await syncOperationRoutePresets({
    actionId: input.actionId,
    failureStepId: input.failureStepId ?? null,
    projectId: input.projectId,
    sourceStepId: input.sourceStepId,
    statusFieldKey: getOperationStatusFieldKey(
      input.sourceStepId,
      input.fieldKey,
    ),
    successStepId: input.successStepId ?? null,
  });
}

function buildStepSettings(input: {
  stepType?: string;
  sourceType?: string;
  catalogId?: string;
  choiceDisplayMode?: "buttons" | "list" | "text";
  contactAttributeKey?: string;
  contactAttributeFieldKey?: string;
  contactAttributeValue?: string;
  contactAttributeValueSource?: "field" | "static";
  contactTagNames?: string;
  connectedAction?: Awaited<ReturnType<typeof getProjectAction>> | null;
  connectedActionId?: number;
  connectFlowMode?: "jump" | "return";
  handoffNotifyTeam?: boolean;
  handoffPriority?: "high" | "low" | "normal" | "urgent";
  handoffQueue?: string;
  filterByField?: string;
  mediaAsset?: SelectMediaAsset | null;
  mediaAssetId?: number;
  operationExecutionMode?: "post_submit" | "inline";
  productCatalog?: SelectProductCatalog | null;
  productDisplayLayout?: "featured" | "grid" | "list";
  productSelectionAllowMultiple?: boolean;
  productSelectionAllowQuantity?: boolean;
  products?: SelectCatalogProduct[];
  productIds?: number[];
  requiredMessage?: string;
  validationAllowedFileTypes?: string;
  validationMaxDate?: string;
  validationMaxLength?: number;
  validationMaxNumber?: number;
  validationMinDate?: string;
  validationMinLength?: number;
  validationMinNumber?: number;
  validationMessage?: string;
  validationRegex?: string;
  whatsappTemplateCategory?: "authentication" | "marketing" | "utility";
  whatsappTemplateBody?: string;
  whatsappTemplateLanguage?: string;
  whatsappTemplateName?: string;
  whatsappTemplateStatus?: "approved" | "draft" | "pending" | "rejected";
  whatsappTemplateVariables?: string;
}) {
  const sourceType = input.sourceType?.trim();
  const requiredMessage = input.requiredMessage?.trim();
  const validationMessage = input.validationMessage?.trim();
  const settings: Record<string, unknown> = {};
  const isProductBackedStep = [
    "catalog_message",
    "single_product",
    "multiple_products",
    "product_selection",
  ].includes(input.stepType ?? "");

  if (input.choiceDisplayMode) {
    settings.choiceDisplayMode = input.choiceDisplayMode;
  }

  if (input.mediaAsset) {
    settings.mediaAssetId = input.mediaAsset.id;
    settings.mediaAsset = {
      id: input.mediaAsset.id,
      mediaType: input.mediaAsset.mediaType,
      mimeType: input.mediaAsset.mimeType,
      originalName: input.mediaAsset.originalName,
      publicPath: input.mediaAsset.publicPath,
    };
  }

  if (input.operationExecutionMode) {
    settings.operationExecutionMode = input.operationExecutionMode;
  }

  if (input.stepType === "template_message") {
    const templateBody = input.whatsappTemplateBody?.trim();
    const templateName = input.whatsappTemplateName?.trim();
    const templateLanguage = input.whatsappTemplateLanguage?.trim();
    const templateVariables = parseLines(input.whatsappTemplateVariables);

    if (templateBody) {
      settings.whatsappTemplateBody = templateBody;
    }

    if (templateName) {
      settings.whatsappTemplateName = templateName;
    }

    if (templateLanguage) {
      settings.whatsappTemplateLanguage = templateLanguage;
    }

    settings.whatsappTemplateCategory =
      input.whatsappTemplateCategory ?? "utility";
    settings.whatsappTemplateStatus = input.whatsappTemplateStatus ?? "draft";

    if (templateVariables.length > 0) {
      settings.whatsappTemplateVariables = templateVariables;
    }
  }

  if (isProductBackedStep && input.productDisplayLayout) {
    settings.productDisplayLayout = input.productDisplayLayout;
  }

  if (
    input.stepType === "product_selection" &&
    input.productSelectionAllowMultiple
  ) {
    settings.productSelectionAllowMultiple = true;
  }

  if (
    input.stepType === "product_selection" &&
    input.productSelectionAllowQuantity
  ) {
    settings.productSelectionAllowQuantity = true;
  }

  if (input.productCatalog) {
    settings.productCatalogId = input.productCatalog.id;
    settings.productCatalog = {
      externalId: input.productCatalog.externalId,
      id: input.productCatalog.id,
      name: input.productCatalog.name,
      providerType: input.productCatalog.providerType,
    };
  }

  if (input.products && input.products.length > 0) {
    settings.productIds = input.products.map((product) => product.id);
    settings.products = input.products.map((product) => ({
      currency: product.currency,
      description: product.description,
      id: product.id,
      imageUrl: product.imageUrl,
      name: product.name,
      priceAmount: product.priceAmount,
      productUrl: product.productUrl,
      sku: product.sku,
      whatsappRetailerId:
        typeof product.metadata.whatsappRetailerId === "string"
          ? product.metadata.whatsappRetailerId
          : null,
    }));
  }

  if (requiredMessage) {
    settings.requiredMessage = requiredMessage;
  }

  if (validationMessage) {
    settings.validationMessage = validationMessage;
  }

  setOptionalNumberSetting(
    settings,
    "validationMinLength",
    input.validationMinLength,
  );
  setOptionalNumberSetting(
    settings,
    "validationMaxLength",
    input.validationMaxLength,
  );
  setOptionalStringSetting(settings, "validationRegex", input.validationRegex);
  setOptionalNumberSetting(
    settings,
    "validationMinNumber",
    input.validationMinNumber,
  );
  setOptionalNumberSetting(
    settings,
    "validationMaxNumber",
    input.validationMaxNumber,
  );
  setOptionalStringSetting(
    settings,
    "validationMinDate",
    input.validationMinDate,
  );
  setOptionalStringSetting(
    settings,
    "validationMaxDate",
    input.validationMaxDate,
  );
  setOptionalStringSetting(
    settings,
    "validationAllowedFileTypes",
    input.validationAllowedFileTypes,
  );

  if (sourceType) {
    settings.sourceType = sourceType;
    settings.sourceConfig = {
      catalogId: input.catalogId?.trim() || undefined,
      filterByField: input.filterByField?.trim() || undefined,
    };
  }

  if (input.contactAttributeKey?.trim()) {
    settings.contactAttributeKey = input.contactAttributeKey.trim();
    settings.contactAttributeValueSource =
      input.contactAttributeValueSource ?? "field";
    settings.contactAttributeFieldKey =
      input.contactAttributeFieldKey?.trim() || undefined;
    settings.contactAttributeValue =
      input.contactAttributeValue?.trim() || undefined;
  }

  if (input.contactTagNames?.trim()) {
    settings.contactTagNames = input.contactTagNames.trim();
  }

  if (input.stepType === "connect_flow" && input.connectedAction) {
    settings.connectedActionId = input.connectedAction.id;
    settings.connectedActionName = input.connectedAction.name;
    settings.connectFlowMode = input.connectFlowMode ?? "jump";
  }

  if (input.stepType === "handoff") {
    settings.handoffNotifyTeam = input.handoffNotifyTeam !== false;
    settings.handoffPriority = input.handoffPriority ?? "normal";

    if (input.handoffQueue?.trim()) {
      settings.handoffQueue = input.handoffQueue.trim();
    }
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

function getImportSourcePath(value?: FormDataEntryValue | null) {
  return value === "/projects/actions/import"
    ? "/projects/actions/import"
    : "/projects/actions";
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

export async function createProjectActionBuilderAction(formData: FormData) {
  const parsed = actionDetailsSchema.omit({ actionId: true }).safeParse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    description: formData.get("description"),
    status: formData.get("status") ?? "draft",
    triggerPhrases: formData.get("triggerPhrases"),
  });

  if (!parsed.success) {
    redirect(
      "/projects/actions/new?error=Please%20check%20the%20action%20details.",
    );
  }

  const context = await resolveUserAndProject(parsed.data.projectId);
  assertPermission(context.membership, "company.project.manage");
  const { project } = context;
  const action = await createProjectAction({
    projectId: project.id,
    name: parsed.data.name,
    description: parsed.data.description || null,
    status: parsed.data.status,
    triggerPhrases: parseLines(parsed.data.triggerPhrases),
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

export async function importActionFlowBuilderAction(formData: FormData) {
  const sourcePath = getImportSourcePath(formData.get("sourcePath"));
  const file = formData.get("flowFile");
  const rawNameOverride = formData.get("nameOverride");
  const nameOverride =
    typeof rawNameOverride === "string" ? rawNameOverride : undefined;

  if (!isUploadedFile(file) || file.size === 0) {
    redirect(`${sourcePath}?error=Choose%20an%20exported%20JSON%20file.`);
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
    redirect(`${sourcePath}?error=Could%20not%20import%20that%20flow%20file.`);
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

export async function updateProjectActionBuilderAction(formData: FormData) {
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
    const actionId = actionIdSchema.safeParse(formData.get("actionId"));
    redirect(
      actionId.success
        ? `/projects/actions/${actionId.data}/settings?error=Please%20check%20the%20action%20details.`
        : "/projects/actions?error=Please%20check%20the%20action%20details.",
    );
  }

  const context = await resolveActionForCurrentProject(parsed.data.actionId);
  const { action: existingAction, project } = context;
  const action = await updateProjectAction({
    projectId: project.id,
    actionId: parsed.data.actionId,
    name: parsed.data.name,
    description: parsed.data.description || null,
    status: parsed.data.status as ProjectActionStatus,
    triggerPhrases: parseLines(parsed.data.triggerPhrases),
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
    redirect("/projects/actions?error=Action%20not%20found.");
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

export async function createActionFlowStepAction(formData: FormData) {
  const parsed = actionStepSchema.omit({ stepId: true }).safeParse({
    actionId: formData.get("actionId"),
    sortOrder: formData.get("sortOrder"),
    stepType: formData.get("stepType"),
    fieldKey: formData.get("fieldKey"),
    label: formData.get("label"),
    prompt: formData.get("prompt"),
    inputType: formData.get("inputType"),
    operationId: formData.get("operationId"),
    operationFailureStepId: formData.get("operationFailureStepId"),
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
    contactTagNames: formData.get("contactTagNames"),
    connectedActionId: formData.get("connectedActionId"),
    connectFlowMode: formData.get("connectFlowMode"),
    handoffNotifyTeam: formData.get("handoffNotifyTeam") === "on",
    handoffPriority: formData.get("handoffPriority"),
    handoffQueue: formData.get("handoffQueue"),
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
    const actionId = actionIdSchema.safeParse(formData.get("actionId"));
    redirect(
      actionId.success
        ? `/projects/actions/${actionId.data}/steps/new?error=Field%20key,%20label,%20and%20prompt%20are%20required.`
        : "/projects/actions?error=Please%20check%20the%20step%20details.",
    );
  }

  const context = await resolveActionForCurrentProject(parsed.data.actionId);
  const { project, action } = context;
  const isInputStep = isInputStepType(parsed.data.stepType);
  const canStoreFieldKey = isInputStep || parsed.data.stepType === "operation";
  const inputType = getInputTypeForStepType(
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
    redirect(
      `/projects/actions/${action.id}/steps/new?error=Media%20asset%20must%20belong%20to%20this%20project.`,
    );
  }

  if (
    ["catalog_message", "single_product", "multiple_products"].includes(
      parsed.data.stepType,
    ) &&
    (!productConfig.productCatalog || productConfig.products.length === 0)
  ) {
    redirect(
      `/projects/actions/${action.id}/steps/new?error=Product%20selection%20must%20belong%20to%20this%20project.`,
    );
  }

  if (
    parsed.data.stepType === "product_selection" &&
    productConfig.products.length === 0
  ) {
    redirect(
      `/projects/actions/${action.id}/steps/new?error=Product%20selection%20must%20belong%20to%20this%20project.`,
    );
  }

  if (parsed.data.stepType === "connect_flow" && !connectedAction) {
    redirect(
      `/projects/actions/${action.id}/steps/new?error=Connected%20flow%20must%20be%20an%20active%20flow%20in%20this%20project.`,
    );
  }

  try {
    await requireActionStepTarget(
      project.id,
      action.id,
      parsed.data.nextStepId,
    );
  } catch {
    redirect(
      `/projects/actions/${action.id}/steps/new?error=Default%20next%20step%20must%20belong%20to%20this%20action.`,
    );
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
      options: isInputStep ? parseOptions(parsed.data.options) : [],
      settings: buildStepSettings({
        ...parsed.data,
        connectedAction,
        mediaAsset,
        ...productConfig,
      }),
    });
    await syncOperationStepRoutes({
      actionId: action.id,
      failureStepId: parsed.data.operationFailureStepId,
      fieldKey: step.fieldKey ?? undefined,
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
    redirect(
      `/projects/actions/${action.id}/steps/new?error=Step%20order%20must%20be%20unique.`,
    );
  }

  revalidatePath(`/projects/actions/${action.id}`);
  redirect(`/projects/actions/${action.id}?stepCreated=1`);
}

export async function updateActionFlowStepAction(formData: FormData) {
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
    contactTagNames: formData.get("contactTagNames"),
    connectedActionId: formData.get("connectedActionId"),
    connectFlowMode: formData.get("connectFlowMode"),
    handoffNotifyTeam: formData.get("handoffNotifyTeam") === "on",
    handoffPriority: formData.get("handoffPriority"),
    handoffQueue: formData.get("handoffQueue"),
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
    const actionId = actionIdSchema.safeParse(formData.get("actionId"));
    const stepId = actionIdSchema.safeParse(formData.get("stepId"));
    redirect(
      actionId.success && stepId.success
        ? `/projects/actions/${actionId.data}/steps/${stepId.data}?error=Field%20key,%20label,%20and%20prompt%20are%20required.`
        : "/projects/actions?error=Please%20check%20the%20step%20details.",
    );
  }

  const context = await resolveActionForCurrentProject(parsed.data.actionId);
  const { project, action } = context;
  const isInputStep = isInputStepType(parsed.data.stepType);
  const canStoreFieldKey = isInputStep || parsed.data.stepType === "operation";
  const inputType = getInputTypeForStepType(
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
    redirect(
      `/projects/actions/${action.id}/steps/${parsed.data.stepId}?error=Media%20asset%20must%20belong%20to%20this%20project.`,
    );
  }

  if (
    ["catalog_message", "single_product", "multiple_products"].includes(
      parsed.data.stepType,
    ) &&
    (!productConfig.productCatalog || productConfig.products.length === 0)
  ) {
    redirect(
      `/projects/actions/${action.id}/steps/${parsed.data.stepId}?error=Product%20selection%20must%20belong%20to%20this%20project.`,
    );
  }

  if (
    parsed.data.stepType === "product_selection" &&
    productConfig.products.length === 0
  ) {
    redirect(
      `/projects/actions/${action.id}/steps/${parsed.data.stepId}?error=Product%20selection%20must%20belong%20to%20this%20project.`,
    );
  }

  if (parsed.data.stepType === "connect_flow" && !connectedAction) {
    redirect(
      `/projects/actions/${action.id}/steps/${parsed.data.stepId}?error=Connected%20flow%20must%20be%20an%20active%20flow%20in%20this%20project.`,
    );
  }

  if (parsed.data.nextStepId === parsed.data.stepId) {
    redirect(
      `/projects/actions/${action.id}/steps/${parsed.data.stepId}?error=Default%20next%20step%20cannot%20point%20to%20itself.`,
    );
  }

  try {
    await requireActionStepTarget(
      project.id,
      action.id,
      parsed.data.nextStepId,
    );
  } catch {
    redirect(
      `/projects/actions/${action.id}/steps/${parsed.data.stepId}?error=Default%20next%20step%20must%20belong%20to%20this%20action.`,
    );
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
      options: isInputStep ? parseOptions(parsed.data.options) : [],
      settings: buildStepSettings({
        ...parsed.data,
        connectedAction,
        mediaAsset,
        ...productConfig,
      }),
    });
    await syncOperationStepRoutes({
      actionId: action.id,
      failureStepId: parsed.data.operationFailureStepId,
      fieldKey: step?.fieldKey ?? undefined,
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
    redirect(
      `/projects/actions/${action.id}/steps/${parsed.data.stepId}?error=Step%20order%20must%20be%20unique.`,
    );
  }

  revalidatePath(`/projects/actions/${action.id}`);
  revalidatePath(`/projects/actions/${action.id}/steps/${parsed.data.stepId}`);
  redirect(`/projects/actions/${action.id}?stepUpdated=1`);
}

export async function createActionFlowBranchRuleAction(formData: FormData) {
  const parsed = branchRuleSchema.omit({ ruleId: true }).safeParse({
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
    const actionId = actionIdSchema.safeParse(formData.get("actionId"));
    const sourceStepId = actionIdSchema.safeParse(formData.get("sourceStepId"));
    redirect(
      actionId.success && sourceStepId.success
        ? `/projects/actions/${actionId.data}/steps/${sourceStepId.data}?error=Please%20check%20the%20branch%20rule.`
        : "/projects/actions?error=Please%20check%20the%20branch%20rule.",
    );
  }

  const context = await resolveActionForCurrentProject(parsed.data.actionId);
  const { project, action } = context;

  try {
    await Promise.all([
      requireActionStepTarget(project.id, action.id, parsed.data.sourceStepId),
      requireActionStepTarget(project.id, action.id, parsed.data.targetStepId),
    ]);
  } catch {
    redirect(
      `/projects/actions/${action.id}/steps/${parsed.data.sourceStepId}?error=Branch%20steps%20must%20belong%20to%20this%20action.`,
    );
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
    redirect(
      `/projects/actions/${action.id}/steps/${parsed.data.sourceStepId}?error=Branch%20rule%20order%20must%20be%20unique%20for%20this%20step.`,
    );
  }

  revalidatePath(`/projects/actions/${action.id}`);
  revalidatePath(
    `/projects/actions/${action.id}/steps/${parsed.data.sourceStepId}`,
  );
  redirect(
    `/projects/actions/${action.id}/steps/${parsed.data.sourceStepId}?branchCreated=1`,
  );
}

export async function updateActionFlowBranchRuleAction(formData: FormData) {
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
    const actionId = actionIdSchema.safeParse(formData.get("actionId"));
    const sourceStepId = actionIdSchema.safeParse(formData.get("sourceStepId"));
    redirect(
      actionId.success && sourceStepId.success
        ? `/projects/actions/${actionId.data}/steps/${sourceStepId.data}?error=Please%20check%20the%20branch%20rule.`
        : "/projects/actions?error=Please%20check%20the%20branch%20rule.",
    );
  }

  const context = await resolveActionForCurrentProject(parsed.data.actionId);
  const { project, action } = context;
  const existingRule = await getActionFlowBranchRule(
    project.id,
    action.id,
    parsed.data.ruleId,
  );

  if (!existingRule) {
    redirect(
      `/projects/actions/${action.id}/steps/${parsed.data.sourceStepId}?error=Branch%20rule%20not%20found.`,
    );
  }

  try {
    await Promise.all([
      requireActionStepTarget(project.id, action.id, parsed.data.sourceStepId),
      requireActionStepTarget(project.id, action.id, parsed.data.targetStepId),
    ]);
  } catch {
    redirect(
      `/projects/actions/${action.id}/steps/${parsed.data.sourceStepId}?error=Branch%20steps%20must%20belong%20to%20this%20action.`,
    );
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
    redirect(
      `/projects/actions/${action.id}/steps/${parsed.data.sourceStepId}?error=Branch%20rule%20order%20must%20be%20unique%20for%20this%20step.`,
    );
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
