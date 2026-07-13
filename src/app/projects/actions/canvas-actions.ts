"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import {
  ACTION_BRANCH_OPERATORS,
  ACTION_STEP_INPUT_TYPES,
  ACTION_STEP_TYPES,
  type ActionBranchOperator,
  createActionFlowBranchRule,
  createActionFlowStep,
  deleteActionFlowBranchRule,
  getActionFlowBranchRule,
  getActionFlowStep,
  getProjectAction,
  listActionFlowSteps,
  setActionFlowStepDefaultRoute,
  setActionFlowStepSettings,
  syncOperationRoutePresets,
  updateActionFlowBranchRule,
  updateActionFlowStep,
} from "@/lib/action-flows";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndProject } from "@/lib/auth-project";
import type {
  SelectCatalogProduct,
  SelectMediaAsset,
  SelectProductCatalog,
} from "@/lib/db-schema";
import {
  getFlowChoiceContentBlock,
  getFlowContentBlocks,
  parseFlowContentBlocks,
} from "@/lib/flow-content-blocks";
import { getProjectMediaAsset } from "@/lib/media-assets";
import { getProjectOperation } from "@/lib/operations";
import {
  getProjectCatalog,
  listProjectCatalogProductsByIds,
  listProjectCatalogProductsForCatalog,
} from "@/lib/product-catalogs";

type CanvasRouteActionResult = {
  message: string;
  ok: boolean;
};

const optionalValidationNumber = (schema: z.ZodType<number>) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );

const canvasRouteSchema = z.object({
  actionId: z.coerce.number().int().positive(),
  sourceStepId: z.coerce.number().int().positive(),
  targetStepId: z.coerce.number().int().positive(),
});

const clearCanvasRouteSchema = canvasRouteSchema.omit({ targetStepId: true });
const canvasStepPositionsSchema = z.object({
  actionId: z.coerce.number().int().positive(),
  positions: z
    .array(
      z.object({
        stepId: z.coerce.number().int().positive(),
        x: z.coerce.number().finite().min(-10_000).max(10_000),
        y: z.coerce.number().finite().min(-10_000).max(10_000),
      }),
    )
    .min(1)
    .max(200),
});
const canvasStepSchema = z
  .object({
    actionId: z.coerce.number().int().positive(),
    stepId: z.coerce.number().int().positive().optional(),
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
    operationExecutionMode: z.enum(["post_submit", "inline"]).optional(),
    operationFailureStepId: z.preprocess(
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
    choiceDisplayMode: z.enum(["buttons", "list", "text"]).optional(),
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
    validationAllowedFileTypes: z.string().trim().max(1000).optional(),
    validationMaxDate: z.string().trim().max(20).optional(),
    validationMaxLength: optionalValidationNumber(
      z.coerce.number().int().min(1).max(10000),
    ),
    validationMaxNumber: optionalValidationNumber(
      z.coerce.number().min(-1_000_000_000).max(1_000_000_000),
    ),
    validationMessage: z.string().trim().max(240).optional(),
    validationMinDate: z.string().trim().max(20).optional(),
    validationMinLength: optionalValidationNumber(
      z.coerce.number().int().min(0).max(10000),
    ),
    validationMinNumber: optionalValidationNumber(
      z.coerce.number().min(-1_000_000_000).max(1_000_000_000),
    ),
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

    if (data.stepType === "choice" && parseLines(data.options).length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Choice options are required.",
        path: ["options"],
      });
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
  });
const canvasStepBasicsSchema = z.object({
  actionId: z.coerce.number().int().positive(),
  choiceDisplayMode: z.enum(["buttons", "list", "text"]),
  contentBlocks: z.string().max(24000),
  contentBlocksChanged: z.coerce.boolean(),
  inputType: z.enum(ACTION_STEP_INPUT_TYPES).optional(),
  stepId: z.coerce.number().int().positive(),
  isEnabled: z.coerce.boolean(),
  isRequired: z.coerce.boolean(),
  label: z.string().trim().max(160),
  options: z.string().max(4000),
  optionsChanged: z.coerce.boolean(),
  prompt: z.string().trim().max(1000),
});
const canvasBranchRuleSchema = z
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
const deleteCanvasBranchRuleSchema = z.object({
  actionId: z.coerce.number().int().positive(),
  ruleId: z.coerce.number().int().positive(),
});

async function resolveCanvasAction(actionId: number) {
  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.project.manage");
  const action = await getProjectAction(context.project.id, actionId);

  if (!action) {
    return { error: "Action not found." as const };
  }

  return { ...context, action };
}

function revalidateCanvasPaths(actionId: number) {
  revalidatePath(`/projects/actions/${actionId}`);
  revalidatePath(`/projects/actions/${actionId}/canvas`);
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

function asSettingsRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

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
  } else {
    delete settings[key];
  }
}

function setOptionalNumberSetting(
  settings: Record<string, unknown>,
  key: string,
  value: number | undefined,
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    settings[key] = value;
  } else {
    delete settings[key];
  }
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

function getInputTypeForStepType(stepType: string, inputType?: string) {
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

async function syncCanvasOperationStepRoutes(input: {
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

function getChoiceStepSettings(input: {
  stepType?: string;
  choiceDisplayMode?: "buttons" | "list" | "text";
  contactAttributeFieldKey?: string;
  contactAttributeKey?: string;
  contactAttributeValue?: string;
  contactAttributeValueSource?: "field" | "static";
  contactTagNames?: string;
  connectedAction?: Awaited<ReturnType<typeof getProjectAction>> | null;
  connectFlowMode?: "jump" | "return";
  existingSettings?: unknown;
  handoffNotifyTeam?: boolean;
  handoffPriority?: "high" | "low" | "normal" | "urgent";
  handoffQueue?: string;
  mediaAsset?: SelectMediaAsset | null;
  operationExecutionMode?: "post_submit" | "inline";
  productCatalog?: SelectProductCatalog | null;
  productDisplayLayout?: "featured" | "grid" | "list";
  productSelectionAllowMultiple?: boolean;
  productSelectionAllowQuantity?: boolean;
  products?: SelectCatalogProduct[];
  requiredMessage?: string;
  validationAllowedFileTypes?: string;
  validationMaxDate?: string;
  validationMaxLength?: number;
  validationMaxNumber?: number;
  validationMessage?: string;
  validationMinDate?: string;
  validationMinLength?: number;
  validationMinNumber?: number;
  validationRegex?: string;
  whatsappTemplateCategory?: "authentication" | "marketing" | "utility";
  whatsappTemplateBody?: string;
  whatsappTemplateLanguage?: string;
  whatsappTemplateName?: string;
  whatsappTemplateStatus?: "approved" | "draft" | "pending" | "rejected";
  whatsappTemplateVariables?: string;
}) {
  const settings: Record<string, unknown> = {
    ...asSettingsRecord(input.existingSettings),
    ...(input.choiceDisplayMode
      ? { choiceDisplayMode: input.choiceDisplayMode }
      : {}),
  };
  const isProductBackedStep = [
    "catalog_message",
    "single_product",
    "multiple_products",
    "product_selection",
  ].includes(input.stepType ?? "");

  if (input.operationExecutionMode) {
    settings.operationExecutionMode = input.operationExecutionMode;
  }

  setOptionalStringSetting(settings, "requiredMessage", input.requiredMessage);
  setOptionalStringSetting(
    settings,
    "validationMessage",
    input.validationMessage,
  );
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

  if (input.stepType === "template_message") {
    const templateBody = input.whatsappTemplateBody?.trim();
    const templateName = input.whatsappTemplateName?.trim();
    const templateLanguage = input.whatsappTemplateLanguage?.trim();
    const templateVariables = parseLines(input.whatsappTemplateVariables);

    if (templateBody) {
      settings.whatsappTemplateBody = templateBody;
    } else {
      delete settings.whatsappTemplateBody;
    }

    if (templateName) {
      settings.whatsappTemplateName = templateName;
    } else {
      delete settings.whatsappTemplateName;
    }

    if (templateLanguage) {
      settings.whatsappTemplateLanguage = templateLanguage;
    } else {
      delete settings.whatsappTemplateLanguage;
    }

    settings.whatsappTemplateCategory =
      input.whatsappTemplateCategory ?? "utility";
    settings.whatsappTemplateStatus = input.whatsappTemplateStatus ?? "draft";

    if (templateVariables.length > 0) {
      settings.whatsappTemplateVariables = templateVariables;
    } else {
      delete settings.whatsappTemplateVariables;
    }
  } else {
    delete settings.whatsappTemplateCategory;
    delete settings.whatsappTemplateBody;
    delete settings.whatsappTemplateLanguage;
    delete settings.whatsappTemplateName;
    delete settings.whatsappTemplateStatus;
    delete settings.whatsappTemplateVariables;
  }

  if (isProductBackedStep && input.productDisplayLayout) {
    settings.productDisplayLayout = input.productDisplayLayout;
  } else {
    delete settings.productDisplayLayout;
  }

  if (
    input.stepType === "product_selection" &&
    input.productSelectionAllowMultiple
  ) {
    settings.productSelectionAllowMultiple = true;
  } else {
    delete settings.productSelectionAllowMultiple;
  }

  if (
    input.stepType === "product_selection" &&
    input.productSelectionAllowQuantity
  ) {
    settings.productSelectionAllowQuantity = true;
  } else {
    delete settings.productSelectionAllowQuantity;
  }

  if (input.productCatalog) {
    settings.productCatalogId = input.productCatalog.id;
    settings.productCatalog = {
      externalId: input.productCatalog.externalId,
      id: input.productCatalog.id,
      name: input.productCatalog.name,
      providerType: input.productCatalog.providerType,
    };
  } else {
    delete settings.productCatalogId;
    delete settings.productCatalog;
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
  } else {
    delete settings.productIds;
    delete settings.products;
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
  } else if (settings.mediaAssetId || settings.mediaAsset) {
    delete settings.mediaAssetId;
    delete settings.mediaAsset;
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
  } else {
    delete settings.connectedActionId;
    delete settings.connectedActionName;
    delete settings.connectFlowMode;
  }

  if (input.stepType === "handoff") {
    settings.handoffNotifyTeam = input.handoffNotifyTeam !== false;
    settings.handoffPriority = input.handoffPriority ?? "normal";

    if (input.handoffQueue?.trim()) {
      settings.handoffQueue = input.handoffQueue.trim();
    } else {
      delete settings.handoffQueue;
    }
  } else {
    delete settings.handoffNotifyTeam;
    delete settings.handoffPriority;
    delete settings.handoffQueue;
  }

  return settings;
}

async function requireCanvasConnectedAction(input: {
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

async function requireCanvasStep(input: {
  projectId: number;
  actionId: number;
  stepId: number;
}) {
  return getActionFlowStep(input.projectId, input.actionId, input.stepId);
}

async function requireCanvasOperation(input: {
  operationId: number | undefined;
  projectId: number;
  stepType: string;
}) {
  if (!["handoff", "operation"].includes(input.stepType)) {
    return null;
  }

  if (!input.operationId) {
    return null;
  }

  const operation = await getProjectOperation(
    input.projectId,
    input.operationId,
  );

  return operation?.operation ?? null;
}

async function requireCanvasMediaAsset(input: {
  mediaAssetId: number | undefined;
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

async function requireCanvasProductConfig(input: {
  productCatalogId: number | undefined;
  productIds: number[] | undefined;
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

export async function createCanvasStepAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasStepSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Please check the step details." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const steps = await listActionFlowSteps(project.id, action.id);
  const sortOrder =
    steps.reduce((max, step) => Math.max(max, step.sortOrder), 0) + 1;
  const isInputStep = isInputStepType(parsed.data.stepType);
  const inputType = getInputTypeForStepType(
    parsed.data.stepType,
    parsed.data.inputType,
  );
  const operation = await requireCanvasOperation({
    operationId: parsed.data.operationId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const mediaAsset = await requireCanvasMediaAsset({
    mediaAssetId: parsed.data.mediaAssetId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const productConfig = await requireCanvasProductConfig({
    productCatalogId: parsed.data.productCatalogId,
    productIds: parsed.data.productIds,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const connectedAction = await requireCanvasConnectedAction({
    actionId: action.id,
    connectedActionId: parsed.data.connectedActionId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });

  if (
    parsed.data.stepType === "operation" ||
    (parsed.data.stepType === "handoff" && parsed.data.operationId)
  ) {
    if (!operation) {
      return { ok: false, message: "Operation must belong to this project." };
    }
  }

  if (parsed.data.stepType === "operation" && !operation) {
    return { ok: false, message: "Operation must belong to this project." };
  }

  if (parsed.data.stepType === "media" && !mediaAsset) {
    return { ok: false, message: "Media asset must belong to this project." };
  }

  if (
    ["catalog_message", "single_product", "multiple_products"].includes(
      parsed.data.stepType,
    ) &&
    (!productConfig.productCatalog || productConfig.products.length === 0)
  ) {
    return {
      ok: false,
      message: "Product selection must belong to this project.",
    };
  }

  if (
    parsed.data.stepType === "product_selection" &&
    productConfig.products.length === 0
  ) {
    return {
      ok: false,
      message: "Product selection must belong to this project.",
    };
  }

  if (parsed.data.stepType === "connect_flow" && !connectedAction) {
    return {
      ok: false,
      message: "Connected flow must be an active flow in this project.",
    };
  }

  try {
    const step = await createActionFlowStep({
      projectId: project.id,
      actionId: action.id,
      sortOrder,
      stepType: parsed.data.stepType,
      fieldKey:
        isInputStep || parsed.data.stepType === "operation"
          ? parsed.data.fieldKey || null
          : null,
      label: parsed.data.label || null,
      prompt: parsed.data.prompt || null,
      inputType: isInputStep ? inputType : null,
      operationId:
        parsed.data.stepType === "operation" ||
        parsed.data.stepType === "handoff"
          ? (operation?.id ?? null)
          : null,
      isRequired: isInputStep ? parsed.data.isRequired : false,
      isEnabled: parsed.data.isEnabled ?? true,
      options: isInputStep ? parseOptions(parsed.data.options) : [],
      settings: getChoiceStepSettings({
        stepType: parsed.data.stepType,
        choiceDisplayMode: parsed.data.choiceDisplayMode,
        contactAttributeFieldKey: parsed.data.contactAttributeFieldKey,
        contactAttributeKey: parsed.data.contactAttributeKey,
        contactAttributeValue: parsed.data.contactAttributeValue,
        contactAttributeValueSource: parsed.data.contactAttributeValueSource,
        contactTagNames: parsed.data.contactTagNames,
        connectedAction,
        connectFlowMode: parsed.data.connectFlowMode,
        handoffNotifyTeam: parsed.data.handoffNotifyTeam,
        handoffPriority: parsed.data.handoffPriority,
        handoffQueue: parsed.data.handoffQueue,
        mediaAsset,
        operationExecutionMode: parsed.data.operationExecutionMode,
        whatsappTemplateCategory: parsed.data.whatsappTemplateCategory,
        whatsappTemplateBody: parsed.data.whatsappTemplateBody,
        whatsappTemplateLanguage: parsed.data.whatsappTemplateLanguage,
        whatsappTemplateName: parsed.data.whatsappTemplateName,
        whatsappTemplateStatus: parsed.data.whatsappTemplateStatus,
        whatsappTemplateVariables: parsed.data.whatsappTemplateVariables,
        productDisplayLayout: parsed.data.productDisplayLayout,
        productSelectionAllowMultiple:
          parsed.data.productSelectionAllowMultiple,
        productSelectionAllowQuantity:
          parsed.data.productSelectionAllowQuantity,
        requiredMessage: parsed.data.requiredMessage,
        validationAllowedFileTypes: parsed.data.validationAllowedFileTypes,
        validationMaxDate: parsed.data.validationMaxDate,
        validationMaxLength: parsed.data.validationMaxLength,
        validationMaxNumber: parsed.data.validationMaxNumber,
        validationMessage: parsed.data.validationMessage,
        validationMinDate: parsed.data.validationMinDate,
        validationMinLength: parsed.data.validationMinLength,
        validationMinNumber: parsed.data.validationMinNumber,
        validationRegex: parsed.data.validationRegex,
        ...productConfig,
      }),
    });
    await syncCanvasOperationStepRoutes({
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
      action: "chatbot_action.canvas_step_created",
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
    return { ok: false, message: "Could not create the step." };
  }

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Step created." };
}

export async function updateCanvasStepAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasStepSchema.safeParse(input);

  if (!parsed.success || !parsed.data.stepId) {
    return { ok: false, message: "Please check the step details." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const existingStep = await getActionFlowStep(
    project.id,
    action.id,
    parsed.data.stepId,
  );

  if (!existingStep) {
    return { ok: false, message: "Step not found." };
  }

  const isInputStep = isInputStepType(parsed.data.stepType);
  const inputType = getInputTypeForStepType(
    parsed.data.stepType,
    parsed.data.inputType,
  );
  const operation = await requireCanvasOperation({
    operationId: parsed.data.operationId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const mediaAsset = await requireCanvasMediaAsset({
    mediaAssetId: parsed.data.mediaAssetId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const productConfig = await requireCanvasProductConfig({
    productCatalogId: parsed.data.productCatalogId,
    productIds: parsed.data.productIds,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });
  const connectedAction = await requireCanvasConnectedAction({
    actionId: action.id,
    connectedActionId: parsed.data.connectedActionId,
    projectId: project.id,
    stepType: parsed.data.stepType,
  });

  if (
    parsed.data.stepType === "operation" ||
    (parsed.data.stepType === "handoff" && parsed.data.operationId)
  ) {
    if (!operation) {
      return { ok: false, message: "Operation must belong to this project." };
    }
  }

  if (parsed.data.stepType === "media" && !mediaAsset) {
    return { ok: false, message: "Media asset must belong to this project." };
  }

  if (
    ["catalog_message", "single_product", "multiple_products"].includes(
      parsed.data.stepType,
    ) &&
    (!productConfig.productCatalog || productConfig.products.length === 0)
  ) {
    return {
      ok: false,
      message: "Product selection must belong to this project.",
    };
  }

  if (
    parsed.data.stepType === "product_selection" &&
    productConfig.products.length === 0
  ) {
    return {
      ok: false,
      message: "Product selection must belong to this project.",
    };
  }

  if (parsed.data.stepType === "connect_flow" && !connectedAction) {
    return {
      ok: false,
      message: "Connected flow must be an active flow in this project.",
    };
  }

  try {
    const step = await updateActionFlowStep({
      projectId: project.id,
      actionId: action.id,
      stepId: existingStep.id,
      sortOrder: existingStep.sortOrder,
      stepType: parsed.data.stepType,
      fieldKey:
        isInputStep || parsed.data.stepType === "operation"
          ? parsed.data.fieldKey || null
          : null,
      label: parsed.data.label || null,
      prompt: parsed.data.prompt || null,
      inputType: isInputStep ? inputType : null,
      operationId:
        parsed.data.stepType === "operation" ||
        parsed.data.stepType === "handoff"
          ? (operation?.id ?? null)
          : null,
      nextStepId: existingStep.nextStepId,
      isRequired: isInputStep ? parsed.data.isRequired : false,
      isEnabled: parsed.data.isEnabled ?? true,
      options: isInputStep ? parseOptions(parsed.data.options) : [],
      settings: getChoiceStepSettings({
        stepType: parsed.data.stepType,
        choiceDisplayMode: parsed.data.choiceDisplayMode,
        contactAttributeFieldKey: parsed.data.contactAttributeFieldKey,
        contactAttributeKey: parsed.data.contactAttributeKey,
        contactAttributeValue: parsed.data.contactAttributeValue,
        contactAttributeValueSource: parsed.data.contactAttributeValueSource,
        contactTagNames: parsed.data.contactTagNames,
        connectedAction,
        connectFlowMode: parsed.data.connectFlowMode,
        existingSettings: existingStep.settings,
        handoffNotifyTeam: parsed.data.handoffNotifyTeam,
        handoffPriority: parsed.data.handoffPriority,
        handoffQueue: parsed.data.handoffQueue,
        mediaAsset,
        operationExecutionMode: parsed.data.operationExecutionMode,
        whatsappTemplateCategory: parsed.data.whatsappTemplateCategory,
        whatsappTemplateBody: parsed.data.whatsappTemplateBody,
        whatsappTemplateLanguage: parsed.data.whatsappTemplateLanguage,
        whatsappTemplateName: parsed.data.whatsappTemplateName,
        whatsappTemplateStatus: parsed.data.whatsappTemplateStatus,
        whatsappTemplateVariables: parsed.data.whatsappTemplateVariables,
        productDisplayLayout: parsed.data.productDisplayLayout,
        productSelectionAllowMultiple:
          parsed.data.productSelectionAllowMultiple,
        productSelectionAllowQuantity:
          parsed.data.productSelectionAllowQuantity,
        requiredMessage: parsed.data.requiredMessage,
        validationAllowedFileTypes: parsed.data.validationAllowedFileTypes,
        validationMaxDate: parsed.data.validationMaxDate,
        validationMaxLength: parsed.data.validationMaxLength,
        validationMaxNumber: parsed.data.validationMaxNumber,
        validationMessage: parsed.data.validationMessage,
        validationMinDate: parsed.data.validationMinDate,
        validationMinLength: parsed.data.validationMinLength,
        validationMinNumber: parsed.data.validationMinNumber,
        validationRegex: parsed.data.validationRegex,
        ...productConfig,
      }),
    });
    await syncCanvasOperationStepRoutes({
      actionId: action.id,
      failureStepId: parsed.data.operationFailureStepId,
      fieldKey: step?.fieldKey ?? undefined,
      projectId: project.id,
      sourceStepId: existingStep.id,
      stepType: parsed.data.stepType,
      successStepId: parsed.data.operationSuccessStepId,
    });

    if (!step) {
      return { ok: false, message: "Could not update the step." };
    }

    await writeAuditLog({
      ...context,
      action: "chatbot_action.canvas_step_updated",
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
    return { ok: false, message: "Could not update the step." };
  }

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Step updated." };
}

export async function updateCanvasStepBasicsAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasStepBasicsSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Please check the step details." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const existingStep = await getActionFlowStep(
    project.id,
    action.id,
    parsed.data.stepId,
  );

  if (!existingStep) {
    return { ok: false, message: "Step not found." };
  }

  const isInputStep = isInputStepType(existingStep.stepType);
  const existingContentBlocks = getFlowContentBlocks(existingStep.settings);
  let contentBlocks = existingContentBlocks;

  if (parsed.data.contentBlocksChanged) {
    try {
      const rawContentBlocks = JSON.parse(parsed.data.contentBlocks) as unknown;
      const parsedContentBlocks = parseFlowContentBlocks(rawContentBlocks);

      if (
        !Array.isArray(rawContentBlocks) ||
        parsedContentBlocks.length !== rawContentBlocks.length
      ) {
        return { ok: false, message: "Please check the added content." };
      }

      contentBlocks = parsedContentBlocks;
    } catch {
      return { ok: false, message: "Please check the added content." };
    }
  }

  const existingChoiceContent = getFlowChoiceContentBlock(
    existingStep.settings,
  );
  const choiceContent =
    contentBlocks.find((block) => block.type === "choice") ?? null;
  if (contentBlocks.filter((block) => block.type === "choice").length > 1) {
    return { ok: false, message: "A step can contain one choice block." };
  }

  const dynamicSourceType =
    typeof existingStep.settings.sourceType === "string"
      ? existingStep.settings.sourceType
      : "";
  const hasDynamicOptions = ["catalog_categories", "catalog_items"].includes(
    dynamicSourceType,
  );
  const requiresPrompt =
    isInputStep ||
    ["display_result", "handoff", "message"].includes(existingStep.stepType);
  let options = existingStep.options;

  if (choiceContent && (!isInputStep || hasDynamicOptions)) {
    return {
      ok: false,
      message: "Choice content can only be added to a manual answer step.",
    };
  }

  if (choiceContent && parsed.data.contentBlocksChanged) {
    options = parseOptions(choiceContent.options.join("\n"));
  } else if (
    existingChoiceContent &&
    !choiceContent &&
    parsed.data.contentBlocksChanged
  ) {
    options = [];
  } else if (isInputStep && parsed.data.optionsChanged && !hasDynamicOptions) {
    options = parseOptions(parsed.data.options);
  }

  if (isInputStep && !parsed.data.label) {
    return { ok: false, message: "Add a step name before saving." };
  }

  if (requiresPrompt && !parsed.data.prompt) {
    return { ok: false, message: "Add the message shown to visitors." };
  }

  if (
    existingStep.stepType === "choice" &&
    !hasDynamicOptions &&
    options.length === 0
  ) {
    return { ok: false, message: "Add at least one choice before saving." };
  }

  const settings = { ...existingStep.settings };
  if (parsed.data.contentBlocksChanged) {
    if (contentBlocks.length > 0) {
      settings.contentBlocks = contentBlocks;
    } else {
      delete settings.contentBlocks;
    }
  }

  if (choiceContent) {
    settings.choiceDisplayMode = choiceContent.displayMode;
  }

  if (
    !choiceContent &&
    (existingStep.stepType === "choice" ||
      hasDynamicOptions ||
      options.length > 0)
  ) {
    settings.choiceDisplayMode = parsed.data.choiceDisplayMode;
  }

  try {
    const step = await updateActionFlowStep({
      projectId: project.id,
      actionId: action.id,
      stepId: existingStep.id,
      sortOrder: existingStep.sortOrder,
      stepType: existingStep.stepType,
      fieldKey: existingStep.fieldKey,
      label: parsed.data.label || null,
      prompt: parsed.data.prompt || null,
      inputType: isInputStep
        ? getInputTypeForStepType(
            existingStep.stepType,
            parsed.data.inputType ?? existingStep.inputType ?? undefined,
          )
        : existingStep.inputType,
      operationId: existingStep.operationId,
      nextStepId: existingStep.nextStepId,
      isRequired: isInputStep ? parsed.data.isRequired : false,
      isEnabled: parsed.data.isEnabled,
      options,
      settings,
    });

    if (!step) {
      return { ok: false, message: "Could not update the step." };
    }

    await writeAuditLog({
      ...context,
      action: "chatbot_action.canvas_step_updated",
      targetType: "action_flow_step",
      targetId: step.id,
      metadata: {
        actionId: action.id,
        editMode: "basic",
        fieldKey: step.fieldKey,
        sortOrder: step.sortOrder,
        stepType: step.stepType,
      },
    });
  } catch {
    return { ok: false, message: "Could not update the step." };
  }

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Step updated." };
}

export async function saveCanvasStepPositionsAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasStepPositionsSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Invalid canvas layout." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const steps = await listActionFlowSteps(project.id, action.id);
  const stepsById = new Map(steps.map((step) => [step.id, step]));

  for (const position of parsed.data.positions) {
    if (!stepsById.has(position.stepId)) {
      return { ok: false, message: "All nodes must belong to this action." };
    }
  }

  for (const position of parsed.data.positions) {
    const step = stepsById.get(position.stepId);
    if (!step) {
      continue;
    }

    await setActionFlowStepSettings({
      projectId: project.id,
      actionId: action.id,
      stepId: step.id,
      settings: {
        ...asSettingsRecord(step.settings),
        canvasPosition: {
          x: Math.round(position.x),
          y: Math.round(position.y),
        },
      },
    });
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.canvas_layout_saved",
    targetType: "project_action",
    targetId: action.id,
    metadata: {
      actionId: action.id,
      nodeCount: parsed.data.positions.length,
    },
  });

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Canvas layout saved." };
}

export async function setCanvasDefaultRouteAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasRouteSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Invalid canvas route." };
  }

  if (parsed.data.sourceStepId === parsed.data.targetStepId) {
    return { ok: false, message: "A step cannot route to itself." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const [sourceStep, targetStep] = await Promise.all([
    getActionFlowStep(project.id, action.id, parsed.data.sourceStepId),
    getActionFlowStep(project.id, action.id, parsed.data.targetStepId),
  ]);

  if (!sourceStep || !targetStep) {
    return { ok: false, message: "Both steps must belong to this action." };
  }

  if (sourceStep.stepType === "submit") {
    return { ok: false, message: "Submit steps cannot have a default route." };
  }

  const step = await setActionFlowStepDefaultRoute({
    projectId: project.id,
    actionId: action.id,
    stepId: sourceStep.id,
    nextStepId: targetStep.id,
  });

  if (!step) {
    return { ok: false, message: "Could not save the default route." };
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.canvas_default_route_updated",
    targetType: "action_flow_step",
    targetId: step.id,
    metadata: {
      actionId: action.id,
      sourceStepId: sourceStep.id,
      targetStepId: targetStep.id,
    },
  });

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Default route saved." };
}

export async function clearCanvasDefaultRouteAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = clearCanvasRouteSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Invalid canvas route." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const sourceStep = await getActionFlowStep(
    project.id,
    action.id,
    parsed.data.sourceStepId,
  );

  if (!sourceStep) {
    return { ok: false, message: "Step not found." };
  }

  const step = await setActionFlowStepDefaultRoute({
    projectId: project.id,
    actionId: action.id,
    stepId: sourceStep.id,
    nextStepId: null,
  });

  if (!step) {
    return { ok: false, message: "Could not clear the default route." };
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.canvas_default_route_cleared",
    targetType: "action_flow_step",
    targetId: step.id,
    metadata: {
      actionId: action.id,
      sourceStepId: sourceStep.id,
    },
  });

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Default route cleared." };
}

export async function createCanvasBranchRuleAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasBranchRuleSchema.omit({ ruleId: true }).safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Please check the branch rule." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const [sourceStep, targetStep] = await Promise.all([
    requireCanvasStep({
      projectId: project.id,
      actionId: action.id,
      stepId: parsed.data.sourceStepId,
    }),
    requireCanvasStep({
      projectId: project.id,
      actionId: action.id,
      stepId: parsed.data.targetStepId,
    }),
  ]);

  if (!sourceStep || !targetStep) {
    return { ok: false, message: "Both steps must belong to this action." };
  }

  try {
    const rule = await createActionFlowBranchRule({
      projectId: project.id,
      actionId: action.id,
      sourceStepId: sourceStep.id,
      sourceFieldKey: parsed.data.sourceFieldKey,
      operator: parsed.data.operator as ActionBranchOperator,
      comparisonValue: parsed.data.comparisonValue || null,
      targetStepId: targetStep.id,
      sortOrder: parsed.data.sortOrder,
      isEnabled: parsed.data.isEnabled ?? true,
      settings: buildBranchRuleSettings(undefined, parsed.data.branchLabel),
    });

    await writeAuditLog({
      ...context,
      action: "chatbot_action.canvas_branch_rule_created",
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
    return {
      ok: false,
      message: "Branch rule order must be unique for this source step.",
    };
  }

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Branch rule created." };
}

export async function updateCanvasBranchRuleAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = canvasBranchRuleSchema.safeParse(input);

  if (!parsed.success || !parsed.data.ruleId) {
    return { ok: false, message: "Please check the branch rule." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const [existingRule, sourceStep, targetStep] = await Promise.all([
    getActionFlowBranchRule(project.id, action.id, parsed.data.ruleId),
    requireCanvasStep({
      projectId: project.id,
      actionId: action.id,
      stepId: parsed.data.sourceStepId,
    }),
    requireCanvasStep({
      projectId: project.id,
      actionId: action.id,
      stepId: parsed.data.targetStepId,
    }),
  ]);

  if (!existingRule) {
    return { ok: false, message: "Branch rule not found." };
  }

  if (!sourceStep || !targetStep) {
    return { ok: false, message: "Both steps must belong to this action." };
  }

  try {
    const rule = await updateActionFlowBranchRule({
      projectId: project.id,
      actionId: action.id,
      ruleId: existingRule.id,
      sourceStepId: sourceStep.id,
      sourceFieldKey: parsed.data.sourceFieldKey,
      operator: parsed.data.operator as ActionBranchOperator,
      comparisonValue: parsed.data.comparisonValue || null,
      targetStepId: targetStep.id,
      sortOrder: parsed.data.sortOrder,
      isEnabled: parsed.data.isEnabled ?? true,
      settings: buildBranchRuleSettings(
        existingRule.settings,
        parsed.data.branchLabel,
      ),
    });

    if (rule) {
      await writeAuditLog({
        ...context,
        action: "chatbot_action.canvas_branch_rule_updated",
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
    return {
      ok: false,
      message: "Branch rule order must be unique for this source step.",
    };
  }

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Branch rule updated." };
}

export async function deleteCanvasBranchRuleAction(
  input: unknown,
): Promise<CanvasRouteActionResult> {
  const parsed = deleteCanvasBranchRuleSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Invalid branch rule." };
  }

  const context = await resolveCanvasAction(parsed.data.actionId);
  if ("error" in context) {
    return { ok: false, message: context.error ?? "Action not found." };
  }

  const { action, project } = context;
  const rule = await deleteActionFlowBranchRule(
    project.id,
    action.id,
    parsed.data.ruleId,
  );

  if (!rule) {
    return { ok: false, message: "Branch rule not found." };
  }

  await writeAuditLog({
    ...context,
    action: "chatbot_action.canvas_branch_rule_deleted",
    targetType: "action_flow_branch_rule",
    targetId: rule.id,
    metadata: {
      actionId: action.id,
      sourceFieldKey: rule.sourceFieldKey,
      sourceStepId: rule.sourceStepId,
      targetStepId: rule.targetStepId,
    },
  });

  revalidateCanvasPaths(action.id);

  return { ok: true, message: "Branch rule deleted." };
}
