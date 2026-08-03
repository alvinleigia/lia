import { z } from "zod";
import {
  ACTION_STEP_INPUT_TYPES,
  ACTION_STEP_TYPES,
} from "@/lib/action-flow-constants";
import { isFlowInputStepType } from "@/lib/flow-input-editor";
import { isOperationOutcomeKey } from "@/lib/operation-contracts";

const optionalNumber = (schema: z.ZodType<number>) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );

const actionStepSchemaShape = {
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
  operationId: optionalNumber(z.coerce.number().int().positive()),
  operationExecutionMode: z.enum(["post_submit", "inline"]).optional(),
  operationFailureStepId: optionalNumber(z.coerce.number().int().positive()),
  operationOutcomeRoutes: z
    .record(
      z.string().refine(isOperationOutcomeKey, "Invalid operation outcome."),
      z.coerce.number().int().positive(),
    )
    .optional(),
  operationSuccessStepId: optionalNumber(z.coerce.number().int().positive()),
  mediaAssetId: optionalNumber(z.coerce.number().int().positive()),
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
  productCatalogId: optionalNumber(z.coerce.number().int().positive()),
  productIds: z.array(z.coerce.number().int().positive()).optional(),
  productDisplayLayout: z.enum(["featured", "grid", "list"]).optional(),
  productSelectionAllowMultiple: z.coerce.boolean().optional(),
  productSelectionAllowQuantity: z.coerce.boolean().optional(),
  choiceDisplayMode: z.enum(["buttons", "list", "text"]).optional(),
  contactAttributeKey: z.string().trim().max(120).optional(),
  contactAttributeFieldKey: z.string().trim().max(120).optional(),
  contactAttributeValue: z.string().trim().max(1000).optional(),
  contactAttributeValueSource: z.enum(["field", "static"]).optional(),
  contactAgentEmail: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().email().max(320).optional(),
  ),
  contactTagNames: z.string().trim().max(1000).optional(),
  contactTeamName: z.string().trim().max(120).optional(),
  connectedActionId: optionalNumber(z.coerce.number().int().positive()),
  connectFlowMode: z.enum(["jump", "return"]).optional(),
  handoffNotifyTeam: z.coerce.boolean().optional(),
  handoffPriority: z.enum(["high", "low", "normal", "urgent"]).optional(),
  handoffQueue: z.string().trim().max(120).optional(),
  waitAmount: optionalNumber(z.coerce.number().int().min(1).max(2_592_000)),
  waitUnit: z.preprocess(
    (value) =>
      value === null || (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.enum(["seconds", "minutes", "hours", "days"]).optional(),
  ),
  retryCount: optionalNumber(z.coerce.number().int().min(0).max(10)),
  retryMessage: z.string().trim().max(500).optional(),
  retryExhaustedStepId: optionalNumber(z.coerce.number().int().positive()),
  validationFailureStepId: optionalNumber(z.coerce.number().int().positive()),
  cancellationStepId: optionalNumber(z.coerce.number().int().positive()),
  noReplyReminderMinutes: optionalNumber(
    z.coerce.number().int().min(1).max(10_080),
  ),
  noReplyReminderMessage: z.string().trim().max(500).optional(),
  noReplyTimeoutMinutes: optionalNumber(
    z.coerce.number().int().min(1).max(10_080),
  ),
  noReplyTimeoutMessage: z.string().trim().max(500).optional(),
  noReplyTimeoutStepId: optionalNumber(z.coerce.number().int().positive()),
  requiredMessage: z.string().trim().max(240).optional(),
  validationMessage: z.string().trim().max(240).optional(),
  validationAllowedFileTypes: z.string().trim().max(1000).optional(),
  validationMaxDate: z.string().trim().max(20).optional(),
  validationMaxLength: optionalNumber(
    z.coerce.number().int().min(1).max(10000),
  ),
  validationMaxNumber: optionalNumber(
    z.coerce.number().min(-1_000_000_000).max(1_000_000_000),
  ),
  validationMinDate: z.string().trim().max(20).optional(),
  validationMinLength: optionalNumber(
    z.coerce.number().int().min(0).max(10000),
  ),
  validationMinNumber: optionalNumber(
    z.coerce.number().min(-1_000_000_000).max(1_000_000_000),
  ),
  validationRegex: z.string().trim().max(500).optional(),
  isRequired: z.coerce.boolean().optional(),
  isEnabled: z.coerce.boolean().optional(),
  options: z.string().optional(),
} satisfies z.ZodRawShape;

export const actionStepDynamicChoiceSchemaShape = {
  sourceType: z.string().trim().max(80).optional(),
  catalogId: z.string().trim().max(120).optional(),
  filterByField: z.string().trim().max(80).optional(),
} satisfies z.ZodRawShape;

const actionStepRefinementSchema = z.object({
  ...actionStepSchemaShape,
  ...actionStepDynamicChoiceSchemaShape,
});

type ActionStepRefinementData = z.infer<typeof actionStepRefinementSchema>;

type ActionStepSchemaOptions = {
  allowDynamicChoiceSource?: boolean;
};

export function parseActionStepLines(value?: string) {
  return (
    value
      ?.split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

export function parseOperationOutcomeRoutes(formData: FormData) {
  return Object.fromEntries(
    Array.from(formData.entries())
      .filter(
        ([key, value]) =>
          key.startsWith("operationOutcomeRoute:") &&
          typeof value === "string" &&
          value.trim(),
      )
      .map(([key, value]) => [
        key.slice("operationOutcomeRoute:".length),
        String(value),
      ]),
  );
}

export function parseActionStepOptions(value?: string) {
  return mergeActionStepOptions(value);
}

export function mergeActionStepOptions(
  value?: string,
  existingOptions: unknown[] = [],
  createId: () => string = () => crypto.randomUUID(),
) {
  const existing = existingOptions
    .map((option, index) => {
      if (typeof option === "string" && option.trim()) {
        return {
          id: null,
          index,
          label: option.trim(),
          value: option.trim(),
        };
      }

      if (!option || typeof option !== "object" || Array.isArray(option)) {
        return null;
      }

      const record = option as Record<string, unknown>;
      const label =
        typeof record.label === "string"
          ? record.label
          : typeof record.value === "string"
            ? record.value
            : "";

      return label
        ? {
            id:
              typeof record.id === "string" && record.id.trim()
                ? record.id.trim()
                : null,
            index,
            label,
            value: record.value ?? label,
          }
        : null;
    })
    .filter((option): option is NonNullable<typeof option> => Boolean(option));
  const usedIndexes = new Set<number>();

  return parseActionStepLines(value).map((label, index) => {
    const matchingLabel = existing.find(
      (option) => !usedIndexes.has(option.index) && option.label === label,
    );
    const matchingIndex = existing.find(
      (option) => !usedIndexes.has(option.index) && option.index === index,
    );
    const matched = matchingLabel ?? matchingIndex ?? null;

    if (matched) {
      usedIndexes.add(matched.index);
    }

    return {
      id: matched?.id ?? createId(),
      label,
      value: matched?.value ?? label,
    };
  });
}

function refineActionStep(
  data: ActionStepRefinementData,
  ctx: z.RefinementCtx,
  options: ActionStepSchemaOptions,
) {
  const isInputStep = isFlowInputStepType(data.stepType);
  const isPromptStep = ["display_result", "handoff", "message"].includes(
    data.stepType,
  );

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
    const hasManualOptions = parseActionStepLines(data.options).length > 0;
    const hasDynamicOptions =
      options.allowDynamicChoiceSource && Boolean(data.sourceType?.trim());

    if (!hasManualOptions && !hasDynamicOptions) {
      ctx.addIssue({
        code: "custom",
        message: options.allowDynamicChoiceSource
          ? "Choice steps need manual options or an option source."
          : "Choice options are required.",
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

  if (
    (data.stepType === "add_tag" || data.stepType === "remove_tag") &&
    !data.contactTagNames?.trim()
  ) {
    ctx.addIssue({
      code: "custom",
      message: "At least one tag is required.",
      path: ["contactTagNames"],
    });
  }

  if (data.stepType === "assign_agent" && !data.contactAgentEmail?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "An active company member email is required.",
      path: ["contactAgentEmail"],
    });
  }

  if (data.stepType === "assign_team" && !data.contactTeamName?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "A team or queue name is required.",
      path: ["contactTeamName"],
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

  if (
    data.noReplyReminderMinutes !== undefined &&
    data.noReplyTimeoutMinutes !== undefined &&
    data.noReplyReminderMinutes >= data.noReplyTimeoutMinutes
  ) {
    ctx.addIssue({
      code: "custom",
      message: "The no-reply reminder must run before the timeout.",
      path: ["noReplyReminderMinutes"],
    });
  }
}

export function createActionStepSchema<const T extends z.ZodRawShape>(
  additionalShape: T,
  options: ActionStepSchemaOptions = {},
) {
  return z
    .object({
      ...actionStepSchemaShape,
      ...additionalShape,
    })
    .superRefine((data, ctx) => {
      refineActionStep(data as ActionStepRefinementData, ctx, options);
    });
}
