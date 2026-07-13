import {
  type ActionDataSourceSettings,
  resolveActionDataSourceOptions,
} from "@/lib/action-data-sources";
import {
  formatFlowContentBlockText,
  formatFlowInteractiveContentBlockText,
  getFlowCatalogContentBlocks,
  getFlowChoiceContentBlock,
  getFlowMediaContentBlocks,
} from "@/lib/flow-content-blocks";
import {
  formatFlowMediaUploadValue,
  isFlowMediaUploadValue,
} from "@/lib/flow-media-values";
import {
  formatFlowAddressValue,
  formatFlowLocationValue,
  normalizeFlowAddressValue,
  normalizeFlowLocationValue,
} from "@/lib/flow-structured-values";
import type {
  RuntimeReplyMedia,
  RuntimeReplyProduct,
} from "@/lib/runtime-replies";

export type ProductDisplayLayout = "featured" | "grid" | "list";

type RuntimeActionOption = {
  description?: string;
  label: string;
  metadata?: Record<string, unknown>;
  value: unknown;
};

type ProductSelectionAnswerValue = {
  productId: unknown;
  quantity: number;
};

type ProductSelectionCartItemValue = ProductSelectionAnswerValue;

type ProductSelectionCartAnswerValue = {
  items: ProductSelectionCartItemValue[];
};

export type RuntimeActionStep = {
  id: number;
  sortOrder: number;
  stepType: string;
  fieldKey: string | null;
  label: string | null;
  prompt: string | null;
  inputType: string | null;
  isRequired: boolean;
  isEnabled: boolean;
  operationId: number | null;
  nextStepId: number | null;
  options: unknown;
  settings: ActionDataSourceSettings;
};

export type RuntimeActionBranchRule = {
  id: number;
  sourceStepId: number;
  sourceFieldKey: string;
  operator: string;
  comparisonValue: string | null;
  targetStepId: number;
  sortOrder: number;
  isEnabled: boolean;
};

export type RuntimeAction = {
  id: number;
  name: string;
  description: string | null;
  triggerPhrases: string[];
  steps: RuntimeActionStep[];
  branchRules: RuntimeActionBranchRule[];
};

export type FlowChatMessage = {
  id: string;
  media?: RuntimeReplyMedia[];
  productLayout?: ProductDisplayLayout;
  productGroups?: FlowChatProductGroup[];
  products?: RuntimeReplyProduct[];
  productMode?: "catalog" | "multiple_products" | "single_product";
  role: "assistant" | "user";
  text: string;
};

export type FlowChatProductGroup = {
  id: string;
  layout: ProductDisplayLayout;
  mode: "catalog" | "multiple_products" | "single_product";
  products: RuntimeReplyProduct[];
};

export type ActiveActionFlow = {
  actionId: number;
  actionName: string;
  conversationId?: string;
  editStepIndexes?: number[];
  stepIndex: number;
  fields: Record<string, unknown>;
  mode: "collecting" | "confirming";
  submissionId?: number;
};

export type StepAnswerResult = {
  fields: Record<string, unknown>;
  label: string;
};

export type RuntimeRouteDecision = {
  routeType: "branch" | "default_next_step" | "ordered_next_step" | "end";
  sourceStepId: number;
  targetStepId: number | null;
  branchRuleId?: number;
  stepIndex: number | null;
};

export type RuntimeHandoffConfig = {
  notifyTeam: boolean;
  priority: "high" | "low" | "normal" | "urgent";
  queue: string | null;
};

export type RuntimeConnectFlowMode = "jump" | "return";

export type FlowEditSection =
  | "service"
  | "schedule"
  | "name"
  | "email"
  | "phone"
  | "all";

export function normalizeActionText(value: string) {
  return value.trim().toLowerCase();
}

export function findTriggeredAction(actions: RuntimeAction[], input: string) {
  const normalizedInput = normalizeActionText(input);

  return (
    actions.find((action) =>
      action.triggerPhrases.some((phrase) => {
        const normalizedPhrase = normalizeActionText(phrase);
        return (
          normalizedPhrase.length > 0 &&
          normalizedInput.includes(normalizedPhrase)
        );
      }),
    ) ?? null
  );
}

export function getActionStepPrompt(step: RuntimeActionStep) {
  if (isProductMessageStep(step)) {
    return step.prompt || step.label || "Here are the available products.";
  }

  if (step.stepType === "media") {
    return (
      step.prompt ||
      step.label ||
      step.settings.mediaAsset?.originalName ||
      "Media"
    );
  }

  if (step.stepType === "template_message") {
    return step.prompt || step.label || "Template message";
  }

  if (step.stepType === "file_upload") {
    return (
      step.prompt ||
      step.label ||
      "File upload steps are not available in this chat yet."
    );
  }

  if (step.stepType === "display_result") {
    return step.prompt || step.label || "Here is the result.";
  }

  if (step.stepType === "handoff") {
    return (
      step.prompt || step.label || "A team member will follow up with you."
    );
  }

  if (step.stepType === "connect_flow") {
    return step.prompt || step.label || "Moving you to the next flow.";
  }

  if (step.stepType === "confirmation") {
    return (
      step.prompt ||
      step.label ||
      "Please review your request before I save it."
    );
  }

  if (step.stepType === "submit") {
    return step.prompt || step.label || "Submitting your request.";
  }

  if (step.stepType === "set_attribute") {
    return step.prompt || step.label || "Updating contact details.";
  }

  if (step.stepType === "add_tag") {
    return step.prompt || step.label || "Updating contact tags.";
  }

  return (
    step.prompt || step.label || step.fieldKey || "Please provide a value."
  );
}

export function getActionStepHandoffConfig(
  step: RuntimeActionStep,
): RuntimeHandoffConfig {
  const priority = step.settings.handoffPriority;

  return {
    notifyTeam: step.settings.handoffNotifyTeam !== false,
    priority:
      priority === "urgent" ||
      priority === "high" ||
      priority === "normal" ||
      priority === "low"
        ? priority
        : "normal",
    queue: step.settings.handoffQueue?.trim() || null,
  };
}

export function isActionInputStep(step: RuntimeActionStep) {
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
    "file_upload",
    "product_selection",
  ].includes(step.stepType);
}

export function isActionMessageStep(step: RuntimeActionStep) {
  return (
    [
      "message",
      "media",
      "template_message",
      "display_result",
      "handoff",
    ].includes(step.stepType) || isProductMessageStep(step)
  );
}

export function isProductMessageStep(step: RuntimeActionStep) {
  return ["catalog_message", "single_product", "multiple_products"].includes(
    step.stepType,
  );
}

export function isActionConfirmationStep(step: RuntimeActionStep) {
  return step.stepType === "confirmation";
}

export function isActionSubmitStep(step: RuntimeActionStep) {
  return step.stepType === "submit";
}

export function isActionMutationStep(step: RuntimeActionStep) {
  return step.stepType === "set_attribute" || step.stepType === "add_tag";
}

export function isActionConnectFlowStep(step: RuntimeActionStep) {
  return step.stepType === "connect_flow";
}

export function isInlineOperationStep(step: RuntimeActionStep) {
  return (
    step.stepType === "operation" &&
    step.settings.operationExecutionMode === "inline"
  );
}

export function isRunnableActionStep(step: RuntimeActionStep) {
  return (
    step.isEnabled &&
    (step.stepType !== "operation" || isInlineOperationStep(step))
  );
}

export function getActionStepConnectedActionId(step: RuntimeActionStep) {
  const actionId = step.settings.connectedActionId;
  return typeof actionId === "number" ? actionId : null;
}

export function getActionStepConnectFlowMode(
  step: RuntimeActionStep,
): RuntimeConnectFlowMode {
  return step.settings.connectFlowMode === "return" ? "return" : "jump";
}

export function getRunnableActionSteps(action: RuntimeAction) {
  return action.steps.filter(isRunnableActionStep);
}

function getRunnableStepIndexById(action: RuntimeAction, stepId: number) {
  return getRunnableActionSteps(action).findIndex((step) => step.id === stepId);
}

function isEmptyBranchValue(value: unknown) {
  return value === undefined || value === null || String(value).trim() === "";
}

function compareBranchValues(leftValue: unknown, rightValue: string | null) {
  const left = String(leftValue ?? "").trim();
  const right = String(rightValue ?? "").trim();

  return {
    left,
    right,
    normalizedLeft: normalizeActionText(left),
    normalizedRight: normalizeActionText(right),
    numericLeft: Number(left),
    numericRight: Number(right),
  };
}

function doesBranchRuleMatch(
  rule: RuntimeActionBranchRule,
  fields: Record<string, unknown>,
) {
  const fieldValue = fields[normalizeSubmissionFieldKey(rule.sourceFieldKey)];

  switch (rule.operator) {
    case "is_empty":
      return isEmptyBranchValue(fieldValue);
    case "is_not_empty":
      return !isEmptyBranchValue(fieldValue);
    default:
      break;
  }

  if (isEmptyBranchValue(fieldValue)) {
    return false;
  }

  const comparison = compareBranchValues(fieldValue, rule.comparisonValue);

  switch (rule.operator) {
    case "contains":
      return comparison.normalizedLeft.includes(comparison.normalizedRight);
    case "equals":
      return comparison.normalizedLeft === comparison.normalizedRight;
    case "greater_than":
      return (
        Number.isFinite(comparison.numericLeft) &&
        Number.isFinite(comparison.numericRight) &&
        comparison.numericLeft > comparison.numericRight
      );
    case "less_than":
      return (
        Number.isFinite(comparison.numericLeft) &&
        Number.isFinite(comparison.numericRight) &&
        comparison.numericLeft < comparison.numericRight
      );
    case "not_equals":
      return comparison.normalizedLeft !== comparison.normalizedRight;
    default:
      return false;
  }
}

export function getNextActionStepDecision(
  action: RuntimeAction,
  step: RuntimeActionStep,
  currentStepIndex: number,
  fields: Record<string, unknown>,
): RuntimeRouteDecision {
  const branchRule = action.branchRules
    .filter((rule) => rule.isEnabled && rule.sourceStepId === step.id)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .find((rule) => doesBranchRuleMatch(rule, fields));

  if (branchRule) {
    const stepIndex = getRunnableStepIndexById(action, branchRule.targetStepId);

    return {
      routeType: "branch",
      sourceStepId: step.id,
      targetStepId: branchRule.targetStepId,
      branchRuleId: branchRule.id,
      stepIndex: stepIndex >= 0 ? stepIndex : null,
    };
  }

  if (step.nextStepId !== null) {
    const stepIndex = getRunnableStepIndexById(action, step.nextStepId);

    return {
      routeType: "default_next_step",
      sourceStepId: step.id,
      targetStepId: step.nextStepId,
      stepIndex: stepIndex >= 0 ? stepIndex : null,
    };
  }

  const steps = getRunnableActionSteps(action);
  const orderedNextStep = steps[currentStepIndex + 1] ?? null;

  if (!orderedNextStep) {
    return {
      routeType: "end",
      sourceStepId: step.id,
      targetStepId: null,
      stepIndex: null,
    };
  }

  return {
    routeType: "ordered_next_step",
    sourceStepId: step.id,
    targetStepId: orderedNextStep.id,
    stepIndex: currentStepIndex + 1,
  };
}

export function getActionStepInputType(step: RuntimeActionStep) {
  switch (step.stepType) {
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
      return step.inputType;
  }
}

export function getActionStepOptions(
  step: RuntimeActionStep,
  fields: Record<string, unknown> = {},
): RuntimeActionOption[] {
  if (step.stepType === "product_selection") {
    return getProductSelectionOptions(step);
  }

  const dataSourceOptions = resolveActionDataSourceOptions(
    step.settings,
    fields,
  );

  if (dataSourceOptions.length > 0) {
    return dataSourceOptions;
  }

  const contentChoice = getFlowChoiceContentBlock(step.settings);
  if (contentChoice) {
    return contentChoice.options.map((option) => ({
      label: option,
      value: option,
    }));
  }

  if (!Array.isArray(step.options)) {
    return [];
  }

  return step.options
    .map((option) => {
      if (typeof option === "string") {
        return { label: option, value: option };
      }

      if (option && typeof option === "object") {
        const label =
          "label" in option && typeof option.label === "string"
            ? option.label
            : null;
        const value =
          "value" in option &&
          (typeof option.value === "string" ||
            typeof option.value === "number" ||
            typeof option.value === "boolean")
            ? option.value
            : label;

        if (label && value !== null) {
          return { label, value };
        }
      }

      return null;
    })
    .filter((option): option is RuntimeActionOption => Boolean(option));
}

function getProductSelectionOptions(
  step: RuntimeActionStep,
): RuntimeActionOption[] {
  return getActionStepProducts(step).map((product) => ({
    label: product.name,
    value: String(product.id),
    description: product.description ?? undefined,
    metadata: {
      currency: product.currency,
      imageUrl: product.imageUrl,
      name: product.name,
      priceAmount: product.priceAmount,
      productId: product.id,
      productUrl: product.productUrl,
      sku: product.sku,
      whatsappRetailerId: product.whatsappRetailerId,
    },
  }));
}

function getProductOptionProviderIds(option: RuntimeActionOption) {
  const metadata = option.metadata ?? {};

  return [
    typeof metadata.whatsappRetailerId === "string"
      ? metadata.whatsappRetailerId
      : null,
    typeof metadata.sku === "string" ? metadata.sku : null,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => normalizeActionText(value));
}

function doesProductSelectionOptionMatch(
  option: RuntimeActionOption,
  rawProduct: string,
) {
  const normalizedProduct = normalizeActionText(rawProduct);

  return (
    normalizeActionText(option.label) === normalizedProduct ||
    normalizeActionText(String(option.value)) === normalizedProduct ||
    getProductOptionProviderIds(option).includes(normalizedProduct)
  );
}

export function getActionStepChoiceDisplayMode(step: RuntimeActionStep) {
  const contentChoice = getFlowChoiceContentBlock(step.settings);
  if (contentChoice) {
    return contentChoice.displayMode;
  }

  if (step.settings.choiceDisplayMode === "list") {
    return "list";
  }

  if (step.settings.choiceDisplayMode === "text") {
    return "text";
  }

  return "buttons";
}

export function getActionStepProductDisplayLayout(
  step: RuntimeActionStep,
): ProductDisplayLayout {
  const layout = step.settings.productDisplayLayout;

  return layout === "featured" || layout === "list" || layout === "grid"
    ? layout
    : "grid";
}

export function getActionStepContentMedia(step: RuntimeActionStep) {
  return getFlowMediaContentBlocks(step.settings)
    .map((block) => block.media)
    .filter((media): media is RuntimeReplyMedia => media !== null);
}

export function getActionStepContentProductGroups(
  step: RuntimeActionStep,
): FlowChatProductGroup[] {
  return getFlowCatalogContentBlocks(step.settings)
    .filter((block) => block.products.length > 0)
    .map((block) => ({
      id: block.id,
      layout: block.layout,
      mode: block.displayMode,
      products: block.products,
    }));
}

export function getActionStepProductSelectionAllowQuantity(
  step: RuntimeActionStep,
) {
  return step.settings.productSelectionAllowQuantity === true;
}

export function getActionStepProductSelectionAllowMultiple(
  step: RuntimeActionStep,
) {
  return step.settings.productSelectionAllowMultiple === true;
}

export function getActionStepWhatsAppTemplate(step: RuntimeActionStep) {
  if (step.stepType !== "template_message") {
    return null;
  }

  const name = step.settings.whatsappTemplateName?.trim();
  const language = step.settings.whatsappTemplateLanguage?.trim();

  if (!name || !language) {
    return null;
  }

  return {
    body: step.settings.whatsappTemplateBody?.trim() || null,
    category: step.settings.whatsappTemplateCategory ?? "utility",
    language,
    name,
    status: step.settings.whatsappTemplateStatus ?? "draft",
    variables: step.settings.whatsappTemplateVariables ?? [],
  };
}

export function resolveTemplateVariableValue(
  variable: string,
  fields: Record<string, unknown>,
) {
  const trimmed = variable.trim();
  const fieldMatch = /^\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}$/.exec(trimmed);

  if (!fieldMatch) {
    return trimmed;
  }

  const value = fields[normalizeSubmissionFieldKey(fieldMatch[1])];

  return value === undefined || value === null ? "" : String(value);
}

function normalizeProductQuantity(quantity: number) {
  return Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
}

export function buildProductSelectionAnswerValue(
  productId: unknown,
  quantity = 1,
) {
  return JSON.stringify({
    productId,
    quantity: normalizeProductQuantity(quantity),
  });
}

export function buildProductSelectionCartAnswerValue(
  items: ProductSelectionCartItemValue[],
) {
  return JSON.stringify({
    items: items.map((item) => ({
      productId: item.productId,
      quantity: normalizeProductQuantity(item.quantity),
    })),
  });
}

export function buildActionStepMessage(step: RuntimeActionStep) {
  if (step.stepType === "media" || isProductMessageStep(step)) {
    return buildActionStepTextFallbackMessage(step);
  }

  return appendFlowContentBlockText(step, getActionStepPrompt(step));
}

export function buildActionStepChannelMessage(step: RuntimeActionStep) {
  const additionalText = formatFlowInteractiveContentBlockText(step.settings);
  const prompt = getActionStepPrompt(step);

  return additionalText ? [prompt, additionalText].join("\n\n") : prompt;
}

function appendFlowContentBlockText(step: RuntimeActionStep, text: string) {
  const additionalText = formatFlowContentBlockText(step.settings);

  return additionalText ? [text, additionalText].join("\n\n") : text;
}

function appendFlowRichContentFallbackText(
  step: RuntimeActionStep,
  text: string,
) {
  const lines = [text];

  for (const block of getFlowMediaContentBlocks(step.settings)) {
    if (!block.media) {
      continue;
    }

    lines.push("", `${block.media.originalName}: ${block.media.publicPath}`);
  }

  for (const block of getFlowCatalogContentBlocks(step.settings)) {
    lines.push("", ...block.products.map((product) => product.name));
  }

  return lines.join("\n");
}

export function buildActionStepTextFallbackMessage(
  step: RuntimeActionStep,
  fields: Record<string, unknown> = {},
  renderOptions: { includeRichContent?: boolean } = {},
) {
  const withRichContent = (text: string) =>
    renderOptions.includeRichContent === false
      ? text
      : appendFlowRichContentFallbackText(step, text);
  const prompt = appendFlowContentBlockText(step, getActionStepPrompt(step));
  const mediaAsset = step.settings.mediaAsset;

  if (step.stepType === "media" && mediaAsset) {
    return withRichContent(
      [prompt, "", `${mediaAsset.originalName}: ${mediaAsset.publicPath}`].join(
        "\n",
      ),
    );
  }

  if (step.stepType === "template_message") {
    const template = getActionStepWhatsAppTemplate(step);

    if (template) {
      return withRichContent(
        [
          prompt,
          "",
          `Template: ${template.name} (${template.language})`,
          ...template.variables.map(
            (variable, index) => `${index + 1}. ${variable}`,
          ),
        ].join("\n"),
      );
    }
  }

  if (isProductMessageStep(step)) {
    return withRichContent(
      appendFlowContentBlockText(step, buildProductTextFallbackMessage(step)),
    );
  }

  const options = isActionInputStep(step)
    ? getActionStepOptions(step, fields)
    : [];

  if (options.length === 0) {
    return withRichContent(prompt);
  }

  const lines = [
    prompt,
    "",
    ...options.map((option, index) => `${index + 1}. ${option.label}`),
  ];

  if (
    step.stepType === "product_selection" &&
    getActionStepProductSelectionAllowMultiple(step)
  ) {
    lines.push(
      "",
      "Reply with one or more items and quantities, for example: 1 x 2, 3 x 1",
    );
  } else if (
    step.stepType === "product_selection" &&
    getActionStepProductSelectionAllowQuantity(step)
  ) {
    lines.push("", "Reply with item and quantity, for example: 1 x 2");
  }

  return withRichContent(lines.join("\n"));
}

function isRuntimeReplyProduct(value: unknown): value is RuntimeReplyProduct {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const product = value as Partial<RuntimeReplyProduct>;
  return typeof product.id === "number" && typeof product.name === "string";
}

export function getActionStepProducts(step: RuntimeActionStep) {
  const products = step.settings.products;

  return Array.isArray(products) ? products.filter(isRuntimeReplyProduct) : [];
}

export function getActionStepProductCatalog(step: RuntimeActionStep) {
  const catalog = step.settings.productCatalog;

  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    return null;
  }

  const record = catalog as Record<string, unknown>;
  return typeof record.id === "number" && typeof record.name === "string"
    ? {
        externalId:
          typeof record.externalId === "string" ? record.externalId : null,
        id: record.id,
        name: record.name,
        providerType:
          typeof record.providerType === "string"
            ? record.providerType
            : undefined,
      }
    : null;
}

function formatProductPrice(product: RuntimeReplyProduct) {
  if (product.priceAmount === null) {
    return "";
  }

  return new Intl.NumberFormat("en", {
    currency: product.currency ?? "USD",
    style: "currency",
  }).format(product.priceAmount / 100);
}

export function buildProductTextFallbackMessage(step: RuntimeActionStep) {
  const prompt = getActionStepPrompt(step);
  const products = getActionStepProducts(step);

  if (products.length === 0) {
    return prompt;
  }

  return [
    prompt,
    "",
    ...products.map((product, index) => {
      const details = [
        formatProductPrice(product),
        product.description,
        product.productUrl,
      ]
        .filter(Boolean)
        .join(" - ");

      return details
        ? `${index + 1}. ${product.name} - ${details}`
        : `${index + 1}. ${product.name}`;
    }),
  ].join("\n");
}

export function normalizeStepAnswer(
  step: RuntimeActionStep,
  answer: string,
  fields: Record<string, unknown> = {},
) {
  const trimmed = answer.trim();
  const options = getActionStepOptions(step, fields);

  if (options.length === 0) {
    return trimmed;
  }

  const numericAnswer = Number(trimmed);
  if (
    Number.isInteger(numericAnswer) &&
    numericAnswer >= 1 &&
    numericAnswer <= options.length
  ) {
    return options[numericAnswer - 1].value;
  }

  const matchedOption = options.find(
    (option) =>
      normalizeActionText(option.label) === normalizeActionText(trimmed),
  );

  if (matchedOption) {
    return matchedOption.value;
  }

  const inputType = getActionStepInputType(step);

  if (inputType === "email") {
    return trimmed.toLowerCase();
  }

  if (inputType === "phone") {
    return normalizePhoneAnswer(trimmed);
  }

  if (isNameStep(step)) {
    return trimmed.replace(/\s+/g, " ");
  }

  if (inputType === "int") {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isNaN(parsed) ? trimmed : parsed;
  }

  if (inputType === "float") {
    const parsed = Number.parseFloat(trimmed);
    return Number.isNaN(parsed) ? trimmed : parsed;
  }

  return trimmed;
}

function normalizePhoneAnswer(value: string) {
  return value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
}

function normalizeProductSelectionAnswerValue(
  value: unknown,
): ProductSelectionAnswerValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const quantity =
    typeof record.quantity === "number" && Number.isInteger(record.quantity)
      ? record.quantity
      : Number(record.quantity);

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    return null;
  }

  return {
    productId: record.productId,
    quantity,
  };
}

function normalizeProductSelectionCartAnswerValue(
  value: unknown,
): ProductSelectionCartAnswerValue | null {
  if (Array.isArray(value)) {
    return normalizeProductSelectionCartAnswerValue({ items: value });
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const items = Array.isArray(record.items) ? record.items : null;

  if (!items || items.length === 0 || items.length > 30) {
    return null;
  }

  const normalizedItems = items
    .map(normalizeProductSelectionAnswerValue)
    .filter((item): item is ProductSelectionCartItemValue => Boolean(item));

  if (normalizedItems.length !== items.length) {
    return null;
  }

  return mergeProductSelectionCartItems(normalizedItems);
}

function mergeProductSelectionCartItems(
  items: ProductSelectionCartItemValue[],
): ProductSelectionCartAnswerValue | null {
  const mergedItems: ProductSelectionCartItemValue[] = [];
  const itemIndexByProductId = new Map<string, number>();

  for (const item of items) {
    const productId = String(item.productId);
    const existingIndex = itemIndexByProductId.get(productId);

    if (existingIndex === undefined) {
      itemIndexByProductId.set(productId, mergedItems.length);
      mergedItems.push(item);
      continue;
    }

    const existingItem = mergedItems[existingIndex];
    mergedItems[existingIndex] = {
      ...existingItem,
      quantity: Math.min(existingItem.quantity + item.quantity, 999),
    };
  }

  return mergedItems.length > 0 ? { items: mergedItems } : null;
}

function buildProductSelectionCartCheckout(
  step: RuntimeActionStep,
  cartItems: Array<{
    currency: string | null;
    lineTotalAmount: number | null;
    name: string;
    priceAmount: number | null;
    productId: unknown;
    quantity: number;
    sku: string | null;
    url: string | null;
    whatsappRetailerId: string | null;
  }>,
) {
  const catalog = getActionStepProductCatalog(step);
  const catalogId = catalog?.externalId?.trim();

  if (!catalogId) {
    return {
      provider: "none",
      reason: "missing_catalog_external_id",
      status: "fallback",
    };
  }

  const items = cartItems.map((item) => ({
    currency: item.currency,
    lineTotalAmount: item.lineTotalAmount,
    name: item.name,
    priceAmount: item.priceAmount,
    productId: item.productId,
    productRetailerId: item.whatsappRetailerId?.trim() || item.sku?.trim(),
    quantity: item.quantity,
  }));
  const hasNativeItems = items.every((item) => item.productRetailerId);

  if (!hasNativeItems) {
    return {
      catalogId,
      provider: "whatsapp",
      reason: "missing_product_retailer_id",
      status: "fallback",
    };
  }

  if (items.length > 30) {
    return {
      catalogId,
      provider: "whatsapp",
      reason: "too_many_items",
      status: "fallback",
    };
  }

  return {
    catalogId,
    items: items.map((item) => ({
      productRetailerId: item.productRetailerId,
      quantity: item.quantity,
    })),
    provider: "whatsapp",
    status: "ready",
  };
}

function parseProductSelectionAnswer(
  answer: string,
  options: RuntimeActionOption[],
): ProductSelectionAnswerValue | null {
  try {
    const parsedJson = JSON.parse(answer) as unknown;
    const jsonValue = normalizeProductSelectionAnswerValue(parsedJson);

    if (jsonValue) {
      return options.some(
        (option) => String(option.value) === String(jsonValue.productId),
      )
        ? jsonValue
        : null;
    }
  } catch {
    // Non-JSON answers fall through to text parsing.
  }

  const [rawProduct, rawQuantity] = answer
    .split(/\s*(?:x|\*)\s*/i)
    .map((part) => part.trim());
  const quantity = rawQuantity ? Number(rawQuantity) : 1;

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    return null;
  }

  const numericAnswer = Number(rawProduct);
  if (
    Number.isInteger(numericAnswer) &&
    numericAnswer >= 1 &&
    numericAnswer <= options.length
  ) {
    return {
      productId: options[numericAnswer - 1].value,
      quantity,
    };
  }

  const matchedOption = options.find((option) =>
    doesProductSelectionOptionMatch(option, rawProduct),
  );

  return matchedOption
    ? {
        productId: matchedOption.value,
        quantity,
      }
    : null;
}

function hasKnownProductSelectionOptions(
  items: ProductSelectionCartItemValue[],
  options: RuntimeActionOption[],
) {
  return items.every((item) =>
    options.some((option) => String(option.value) === String(item.productId)),
  );
}

function parseProductSelectionCartAnswer(
  answer: string,
  options: RuntimeActionOption[],
): ProductSelectionCartAnswerValue | null {
  try {
    const parsedJson = JSON.parse(answer) as unknown;
    const jsonCart = normalizeProductSelectionCartAnswerValue(parsedJson);

    if (jsonCart && hasKnownProductSelectionOptions(jsonCart.items, options)) {
      return jsonCart;
    }

    const jsonSingle = normalizeProductSelectionAnswerValue(parsedJson);

    if (jsonSingle && hasKnownProductSelectionOptions([jsonSingle], options)) {
      return { items: [jsonSingle] };
    }
  } catch {
    // Non-JSON answers fall through to text parsing.
  }

  const parsedItems = answer
    .split(/[,;\n]/)
    .map((part) => parseProductSelectionAnswer(part.trim(), options))
    .filter((item): item is ProductSelectionCartItemValue => Boolean(item));

  if (parsedItems.length === 0) {
    return null;
  }

  const answerParts = answer.split(/[,;\n]/).filter((part) => part.trim());

  if (parsedItems.length !== answerParts.length) {
    return null;
  }

  return mergeProductSelectionCartItems(parsedItems);
}

function isValidEmailAnswer(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhoneAnswer(value: string) {
  const normalized = normalizePhoneAnswer(value);
  const digitCount = normalized.replace(/\D/g, "").length;
  return digitCount >= 7 && digitCount <= 15;
}

function isValidDateAnswer(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function isValidTimeAnswer(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidDateRangeAnswer(value: string) {
  const [startDate, endDate] = value
    .split(/\s+(?:to|through|until|-)\s+/i)
    .map((part) => part.trim());

  return Boolean(
    startDate &&
      endDate &&
      isValidDateAnswer(startDate) &&
      isValidDateAnswer(endDate) &&
      startDate <= endDate,
  );
}

function validateTypedAnswer(step: RuntimeActionStep, answer: string) {
  const inputType = getActionStepInputType(step);

  if (step.stepType === "date_range") {
    return isValidDateRangeAnswer(answer);
  }

  if (step.stepType === "address") {
    return Boolean(normalizeFlowAddressValue(answer));
  }

  if (step.stepType === "location") {
    return Boolean(normalizeFlowLocationValue(answer));
  }

  if (isNameStep(step)) {
    return isValidNameAnswer(answer);
  }

  switch (inputType) {
    case "date":
      return isValidDateAnswer(answer);
    case "email":
      return isValidEmailAnswer(answer);
    case "float":
      return Number.isFinite(Number(answer));
    case "int":
      return /^-?\d+$/.test(answer);
    case "phone":
      return isValidPhoneAnswer(answer);
    case "time":
      return isValidTimeAnswer(answer);
    default:
      return true;
  }
}

function getStepNumberSetting(step: RuntimeActionStep, key: string) {
  const settings = step.settings as Record<string, unknown>;
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getStepStringSetting(step: RuntimeActionStep, key: string) {
  const settings = step.settings as Record<string, unknown>;
  const value = settings[key];
  return typeof value === "string" ? value.trim() : "";
}

function isNumericStep(step: RuntimeActionStep) {
  const inputType = getActionStepInputType(step);
  return (
    step.stepType === "number" || inputType === "float" || inputType === "int"
  );
}

function isDateStep(step: RuntimeActionStep) {
  return step.stepType === "date" || getActionStepInputType(step) === "date";
}

function validateStepConstraints(step: RuntimeActionStep, answer: string) {
  const minLength = getStepNumberSetting(step, "validationMinLength");
  const maxLength = getStepNumberSetting(step, "validationMaxLength");

  if (minLength !== null && answer.length < minLength) {
    return false;
  }

  if (maxLength !== null && answer.length > maxLength) {
    return false;
  }

  const pattern = getStepStringSetting(step, "validationRegex");
  if (pattern) {
    try {
      if (!new RegExp(pattern).test(answer)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (isNumericStep(step)) {
    const numericAnswer = Number(answer);
    const minNumber = getStepNumberSetting(step, "validationMinNumber");
    const maxNumber = getStepNumberSetting(step, "validationMaxNumber");

    if (!Number.isFinite(numericAnswer)) {
      return false;
    }

    if (minNumber !== null && numericAnswer < minNumber) {
      return false;
    }

    if (maxNumber !== null && numericAnswer > maxNumber) {
      return false;
    }
  }

  if (isDateStep(step)) {
    const minDate = getStepStringSetting(step, "validationMinDate");
    const maxDate = getStepStringSetting(step, "validationMaxDate");

    if (minDate && (!isValidDateAnswer(minDate) || answer < minDate)) {
      return false;
    }

    if (maxDate && (!isValidDateAnswer(maxDate) || answer > maxDate)) {
      return false;
    }
  }

  return true;
}

function isNameStep(step: RuntimeActionStep) {
  const fieldKey = step.fieldKey?.toLowerCase() ?? "";
  return (
    getActionStepInputType(step) === "text" &&
    ["name", "guestname", "customername", "clientname", "fullname"].includes(
      fieldKey,
    )
  );
}

function isValidNameAnswer(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (normalized.length < 2 || normalized.length > 120) {
    return false;
  }

  if (!/\p{L}/u.test(normalized)) {
    return false;
  }

  if (/\d/.test(normalized)) {
    return false;
  }

  return /^[\p{L}\p{M} .'-]+$/u.test(normalized);
}

export function validateStepAnswer(
  step: RuntimeActionStep,
  answer: string,
  fields: Record<string, unknown> = {},
) {
  const trimmed = answer.trim();

  if (step.stepType === "file_upload") {
    return { isValid: false, value: trimmed };
  }

  if (!step.isRequired && trimmed.length === 0) {
    return { isValid: true, value: "" };
  }

  if (trimmed.length === 0) {
    return { isValid: false, value: trimmed };
  }

  const options = getActionStepOptions(step, fields);

  if (options.length === 0) {
    if (step.stepType === "address") {
      const address = normalizeFlowAddressValue(trimmed);
      return address
        ? { isValid: true, value: address }
        : { isValid: false, value: trimmed };
    }

    if (step.stepType === "location") {
      const location = normalizeFlowLocationValue(trimmed);
      return location
        ? { isValid: true, value: location }
        : { isValid: false, value: trimmed };
    }

    if (!validateTypedAnswer(step, trimmed)) {
      return { isValid: false, value: trimmed };
    }

    if (!validateStepConstraints(step, trimmed)) {
      return { isValid: false, value: trimmed };
    }

    return { isValid: true, value: normalizeStepAnswer(step, trimmed, fields) };
  }

  if (
    step.stepType === "product_selection" &&
    getActionStepProductSelectionAllowMultiple(step)
  ) {
    const cartSelection = parseProductSelectionCartAnswer(trimmed, options);

    return cartSelection
      ? { isValid: true, value: cartSelection }
      : { isValid: false, value: trimmed };
  }

  if (
    step.stepType === "product_selection" &&
    getActionStepProductSelectionAllowQuantity(step)
  ) {
    const productSelection = parseProductSelectionAnswer(trimmed, options);

    return productSelection
      ? { isValid: true, value: productSelection }
      : { isValid: false, value: trimmed };
  }

  const numericAnswer = Number(trimmed);
  if (
    Number.isInteger(numericAnswer) &&
    numericAnswer >= 1 &&
    numericAnswer <= options.length
  ) {
    return { isValid: true, value: options[numericAnswer - 1].value };
  }

  const matchedOption = options.find((option) => {
    const normalizedAnswer = normalizeActionText(trimmed);
    return (
      normalizeActionText(option.label) === normalizedAnswer ||
      normalizeActionText(String(option.value)) === normalizedAnswer
    );
  });

  return matchedOption
    ? { isValid: true, value: matchedOption.value }
    : { isValid: false, value: trimmed };
}

function getCompanionFieldPrefix(fieldKey: string) {
  return fieldKey.endsWith("Id") ? fieldKey.slice(0, -2) : fieldKey;
}

export function normalizeSubmissionFieldKey(fieldKey: string) {
  if (fieldKey === "time") {
    return "preferredTime";
  }

  return fieldKey;
}

export function buildStepAnswerResult(
  step: RuntimeActionStep,
  fieldKey: string,
  value: unknown,
  fields: Record<string, unknown> = {},
): StepAnswerResult {
  const normalizedFieldKey = normalizeSubmissionFieldKey(fieldKey);
  if (step.stepType === "file_upload" && isFlowMediaUploadValue(value)) {
    const mediaLabel = formatFlowMediaUploadValue(value);

    return {
      fields: { [normalizedFieldKey]: value },
      label: `Uploaded ${mediaLabel}`,
    };
  }

  if (step.stepType === "address") {
    const address = normalizeFlowAddressValue(value);

    if (address) {
      return {
        fields: { [normalizedFieldKey]: address },
        label: formatFlowAddressValue(address),
      };
    }
  }

  if (step.stepType === "location") {
    const location = normalizeFlowLocationValue(value);

    if (location) {
      return {
        fields: { [normalizedFieldKey]: location },
        label: formatFlowLocationValue(location),
      };
    }
  }

  const options = getActionStepOptions(step, fields);
  const productSelectionCartValue =
    step.stepType === "product_selection"
      ? normalizeProductSelectionCartAnswerValue(value)
      : null;
  const productSelectionValue =
    step.stepType === "product_selection" && !productSelectionCartValue
      ? normalizeProductSelectionAnswerValue(value)
      : null;

  if (productSelectionCartValue) {
    const prefix = getCompanionFieldPrefix(normalizedFieldKey);
    const cartItems = productSelectionCartValue.items
      .map((item) => {
        const matchedOption = options.find(
          (option) => String(option.value) === String(item.productId),
        );

        if (!matchedOption) {
          return null;
        }

        const metadata = matchedOption.metadata ?? {};
        const priceAmount =
          typeof metadata.priceAmount === "number"
            ? metadata.priceAmount
            : null;

        return {
          currency:
            typeof metadata.currency === "string" ? metadata.currency : null,
          lineTotalAmount:
            priceAmount === null ? null : priceAmount * item.quantity,
          name:
            typeof metadata.name === "string"
              ? metadata.name
              : matchedOption.label,
          priceAmount,
          productId: item.productId,
          quantity: item.quantity,
          sku: typeof metadata.sku === "string" ? metadata.sku : null,
          url:
            typeof metadata.productUrl === "string"
              ? metadata.productUrl
              : null,
          whatsappRetailerId:
            typeof metadata.whatsappRetailerId === "string"
              ? metadata.whatsappRetailerId
              : null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (cartItems.length === 0) {
      return {
        fields: { [normalizedFieldKey]: value },
        label: String(value),
      };
    }

    const currencies = new Set(
      cartItems
        .map((item) => item.currency)
        .filter((currency): currency is string => Boolean(currency)),
    );
    const totalAmount = cartItems.reduce(
      (total, item) => total + (item.lineTotalAmount ?? 0),
      0,
    );
    const hasCompleteTotals = cartItems.every(
      (item) => item.lineTotalAmount !== null,
    );
    const resultFields: Record<string, unknown> = {
      [normalizedFieldKey]: cartItems.map((item) => item.productId),
      [`${prefix}Items`]: cartItems,
      [`${prefix}Names`]: cartItems.map((item) => item.name),
      [`${prefix}TotalQuantity`]: cartItems.reduce(
        (total, item) => total + item.quantity,
        0,
      ),
    };

    if (hasCompleteTotals) {
      resultFields[`${prefix}TotalAmount`] = totalAmount;
    }

    if (currencies.size === 1) {
      resultFields[`${prefix}Currency`] = [...currencies][0];
    }

    const checkout = buildProductSelectionCartCheckout(step, cartItems);

    if (checkout) {
      resultFields[`${prefix}Checkout`] = checkout;
    }

    return {
      fields: resultFields,
      label: cartItems
        .map((item) => `${item.name} x ${item.quantity}`)
        .join(", "),
    };
  }

  const matchedOption = options.find((option) =>
    productSelectionValue
      ? String(option.value) === String(productSelectionValue.productId)
      : option.value === value,
  );

  if (!matchedOption) {
    return {
      fields: { [normalizedFieldKey]: value },
      label: String(value),
    };
  }

  const prefix = getCompanionFieldPrefix(normalizedFieldKey);
  const metadata = matchedOption.metadata ?? {};
  const resultFields: Record<string, unknown> = {
    [normalizedFieldKey]: productSelectionValue
      ? productSelectionValue.productId
      : matchedOption.value,
    [`${prefix}Name`]:
      typeof metadata.name === "string" ? metadata.name : matchedOption.label,
  };

  if (typeof metadata.price === "number") {
    resultFields[`${prefix}Price`] = metadata.price;
  }

  if (typeof metadata.productId === "number") {
    resultFields[`${prefix}ProductId`] = metadata.productId;
  }

  if (typeof metadata.priceAmount === "number") {
    resultFields[`${prefix}PriceAmount`] = metadata.priceAmount;
  }

  if (productSelectionValue) {
    resultFields[`${prefix}Quantity`] = productSelectionValue.quantity;

    if (typeof metadata.priceAmount === "number") {
      resultFields[`${prefix}LineTotalAmount`] =
        metadata.priceAmount * productSelectionValue.quantity;
    }
  }

  if (typeof metadata.currency === "string") {
    resultFields[`${prefix}Currency`] = metadata.currency;
  }

  if (typeof metadata.sku === "string") {
    resultFields[`${prefix}Sku`] = metadata.sku;
  }

  if (typeof metadata.productUrl === "string") {
    resultFields[`${prefix}Url`] = metadata.productUrl;
  }

  if (typeof metadata.whatsappRetailerId === "string") {
    resultFields[`${prefix}WhatsAppRetailerId`] = metadata.whatsappRetailerId;
  }

  if (typeof metadata.durationMinutes === "number") {
    resultFields[`${prefix}DurationMinutes`] = metadata.durationMinutes;
  }

  return {
    fields: resultFields,
    label: productSelectionValue
      ? `${matchedOption.label} x ${productSelectionValue.quantity}`
      : matchedOption.label,
  };
}

export function buildInvalidStepAnswerMessage(
  step: RuntimeActionStep,
  fields: Record<string, unknown> = {},
  answer?: string,
) {
  if (
    step.isRequired &&
    answer !== undefined &&
    answer.trim().length === 0 &&
    step.settings.requiredMessage
  ) {
    return step.settings.requiredMessage;
  }

  if (step.settings.validationMessage) {
    return step.settings.validationMessage;
  }

  const options = getActionStepOptions(step, fields);

  if (options.length > 0) {
    if (
      step.stepType === "product_selection" &&
      getActionStepProductSelectionAllowMultiple(step)
    ) {
      return "Please choose at least one product for the cart.";
    }

    if (
      step.stepType === "product_selection" &&
      getActionStepProductSelectionAllowQuantity(step)
    ) {
      return "Please choose a product and a quantity of 1 or more.";
    }

    return "Please choose one of the available options.";
  }

  if (step.stepType === "file_upload") {
    return "Please upload a supported file.";
  }

  if (step.stepType === "date_range") {
    return "Please enter a valid date range.";
  }

  if (step.stepType === "address") {
    return "Please enter a valid address.";
  }

  if (step.stepType === "location") {
    return "Please enter a valid location.";
  }

  switch (getActionStepInputType(step)) {
    case "date":
      return "Please enter a valid date.";
    case "email":
      return "Please enter a valid email address.";
    case "float":
      return "Please enter a valid number.";
    case "int":
      return "Please enter a whole number.";
    case "phone":
      return "Please enter a valid phone number.";
    case "time":
      return "Please enter a valid time.";
    default:
      if (isNameStep(step)) {
        return "Please enter a valid name.";
      }

      return "Please provide a valid value.";
  }
}

export function summarizeActionFields(fields: Record<string, unknown>) {
  const entries = Object.entries(fields);

  if (entries.length === 0) {
    return "No fields collected.";
  }

  return entries
    .map(([key, value]) => `- ${key}: ${formatReviewValue(key, value)}`)
    .join("\n");
}

const REVIEW_FIELD_LABELS: Record<string, string> = {
  guestEmail: "Email",
  guestName: "Name",
  guestPhone: "Phone",
  location: "Location",
  address: "Address",
  preferredDate: "Date",
  preferredTime: "Time",
  serviceCategoryName: "Category",
  serviceItemDurationMinutes: "Duration",
  serviceItemName: "Service",
  serviceItemPrice: "Price",
};

const REVIEW_FIELD_ORDER = [
  "serviceCategoryName",
  "serviceItemName",
  "serviceItemPrice",
  "serviceItemDurationMinutes",
  "preferredDate",
  "preferredTime",
  "guestName",
  "guestEmail",
  "guestPhone",
];

function formatReviewValue(key: string, value: unknown) {
  if (isFlowMediaUploadValue(value)) {
    return formatFlowMediaUploadValue(value);
  }

  if (key.toLowerCase().includes("address")) {
    return formatFlowAddressValue(value);
  }

  if (key.toLowerCase().includes("location")) {
    return formatFlowLocationValue(value);
  }

  if (key === "serviceItemPrice" && typeof value === "number") {
    return String(value);
  }

  if (key === "serviceItemDurationMinutes" && typeof value === "number") {
    return `${value} minutes`;
  }

  return String(value);
}

export function buildActionReviewSummary(fields: Record<string, unknown>) {
  const knownLines = REVIEW_FIELD_ORDER.filter((key) => key in fields).map(
    (key) =>
      `- ${REVIEW_FIELD_LABELS[key] ?? key}: ${formatReviewValue(
        key,
        fields[key],
      )}`,
  );
  const knownKeys = new Set([
    ...REVIEW_FIELD_ORDER,
    "serviceCategoryId",
    "serviceItemId",
  ]);
  const extraLines = Object.entries(fields)
    .filter(([key]) => !knownKeys.has(key))
    .map(
      ([key, value]) =>
        `- ${REVIEW_FIELD_LABELS[key] ?? key}: ${formatReviewValue(
          key,
          value,
        )}`,
    );
  const lines = [...knownLines, ...extraLines];

  if (lines.length === 0) {
    return "No details collected.";
  }

  return lines.join("\n");
}

function findStepIndexByFieldKeys(action: RuntimeAction, fieldKeys: string[]) {
  return getRunnableActionSteps(action).findIndex(
    (step) => step.fieldKey !== null && fieldKeys.includes(step.fieldKey),
  );
}

function findStepIndexesByFieldKeys(
  action: RuntimeAction,
  fieldKeys: string[],
) {
  return getRunnableActionSteps(action)
    .map((step, index) =>
      step.fieldKey !== null && fieldKeys.includes(step.fieldKey)
        ? index
        : null,
    )
    .filter((index): index is number => index !== null);
}

function getCollectibleActionSteps(action: RuntimeAction) {
  return action.steps.filter(isActionInputStep);
}

function clearFields(fields: Record<string, unknown>, keysToClear: string[]) {
  return Object.fromEntries(
    Object.entries(fields).filter(([key]) => !keysToClear.includes(key)),
  );
}

export function prepareFlowSectionEdit(
  action: RuntimeAction,
  flow: ActiveActionFlow,
  section: FlowEditSection,
) {
  const editConfig: Record<
    FlowEditSection,
    { fieldKeys: string[]; clearKeys: string[] }
  > = {
    all: {
      fieldKeys: getCollectibleActionSteps(action)
        .map((step) => step.fieldKey)
        .filter((fieldKey): fieldKey is string => Boolean(fieldKey)),
      clearKeys: Object.keys(flow.fields),
    },
    email: {
      fieldKeys: ["guestEmail", "email", "customerEmail", "clientEmail"],
      clearKeys: ["guestEmail", "email", "customerEmail", "clientEmail"],
    },
    name: {
      fieldKeys: ["guestName", "name", "customerName", "clientName"],
      clearKeys: ["guestName", "name", "customerName", "clientName"],
    },
    phone: {
      fieldKeys: ["guestPhone", "phone", "customerPhone", "clientPhone"],
      clearKeys: ["guestPhone", "phone", "customerPhone", "clientPhone"],
    },
    schedule: {
      fieldKeys: ["preferredDate", "preferredTime", "time"],
      clearKeys: ["preferredDate", "preferredTime", "time"],
    },
    service: {
      fieldKeys: ["serviceCategoryId", "serviceItemId"],
      clearKeys: [
        "serviceCategoryId",
        "serviceCategoryName",
        "serviceItemId",
        "serviceItemName",
        "serviceItemPrice",
        "serviceItemDurationMinutes",
      ],
    },
  };
  const config = editConfig[section];
  const runnableSteps = getRunnableActionSteps(action);
  const stepIndexes =
    section === "all"
      ? runnableSteps
          .map((step, index) => (isActionInputStep(step) ? index : null))
          .filter((index): index is number => index !== null)
      : findStepIndexesByFieldKeys(action, config.fieldKeys);
  const stepIndex =
    stepIndexes[0] ?? findStepIndexByFieldKeys(action, config.fieldKeys);

  return {
    ...flow,
    editStepIndexes: stepIndexes.length > 0 ? stepIndexes : undefined,
    fields: clearFields(flow.fields, config.clearKeys),
    mode: "collecting" as const,
    stepIndex: stepIndex >= 0 ? stepIndex : 0,
  };
}
