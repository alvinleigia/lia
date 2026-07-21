import { getChannelAdapterProfile } from "@/lib/channel-adapter-contract";
import { getFlowChoiceContentBlock } from "@/lib/flow-content-blocks";
import { getWhatsAppTemplateMetadataIssues } from "@/lib/whatsapp-template-metadata";

export type FlowChannelCapabilityIssue = {
  message: string;
  severity: "error" | "warning";
  source: "channel_capability";
  stepId: number;
};

type CapabilityStep = {
  id: number;
  options?: unknown[];
  settings: Record<string, unknown>;
  sortOrder: number;
  stepType: string;
};

function isProductMessageStepType(stepType: string) {
  return ["catalog_message", "single_product", "multiple_products"].includes(
    stepType,
  );
}

function canResolveMediaUrl(publicPath: unknown) {
  if (typeof publicPath !== "string" || !publicPath.trim()) {
    return false;
  }

  if (/^https?:\/\//i.test(publicPath)) {
    return true;
  }

  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";

  return Boolean(appBaseUrl && publicPath.startsWith("/"));
}

function getProductCatalogExternalId(settings: Record<string, unknown>) {
  const catalog = settings.productCatalog;

  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    return "";
  }

  const externalId = (catalog as Record<string, unknown>).externalId;
  return typeof externalId === "string" ? externalId.trim() : "";
}

function hasWhatsAppProductRetailerId(product: unknown) {
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    return false;
  }

  const record = product as Record<string, unknown>;
  const retailerId =
    typeof record.whatsappRetailerId === "string"
      ? record.whatsappRetailerId.trim()
      : "";
  const sku = typeof record.sku === "string" ? record.sku.trim() : "";

  return Boolean(retailerId || sku);
}

function createWarning(step: CapabilityStep, message: string) {
  return {
    message: `Step ${step.sortOrder} ${message}`,
    severity: "warning",
    source: "channel_capability",
    stepId: step.id,
  } as const;
}

function getChoiceCapabilityWarnings(step: CapabilityStep) {
  if (step.stepType !== "choice") {
    return [];
  }

  const choiceBlock = getFlowChoiceContentBlock(step.settings);
  const optionCount = choiceBlock
    ? choiceBlock.options.length
    : Array.isArray(step.options)
      ? step.options.length
      : 0;
  const displayMode =
    choiceBlock?.displayMode === "list" ||
    step.settings.choiceDisplayMode === "list"
      ? "list"
      : choiceBlock?.displayMode === "text" ||
          step.settings.choiceDisplayMode === "text"
        ? "text"
        : "buttons";
  const limits = getChannelAdapterProfile("whatsapp").limits;

  if (
    displayMode === "buttons" &&
    limits.buttonOptions !== null &&
    optionCount > limits.buttonOptions
  ) {
    return [
      createWarning(
        step,
        `has ${optionCount} button options; WhatsApp supports ${limits.buttonOptions} native reply buttons and will use text fallback.`,
      ),
    ];
  }

  if (
    displayMode === "list" &&
    limits.listOptions !== null &&
    optionCount > limits.listOptions
  ) {
    return [
      createWarning(
        step,
        `has ${optionCount} list options; WhatsApp supports ${limits.listOptions} native list rows and will use text fallback.`,
      ),
    ];
  }

  return [];
}

export function getFlowStepChannelCapabilityIssues(step: CapabilityStep) {
  const warnings: FlowChannelCapabilityIssue[] = [
    ...getChoiceCapabilityWarnings(step),
  ];
  const productLimit =
    getChannelAdapterProfile("whatsapp").limits.productItems ?? 30;

  if (
    step.stepType === "media" &&
    step.settings.mediaAsset &&
    !canResolveMediaUrl(
      (step.settings.mediaAsset as Record<string, unknown>).publicPath,
    )
  ) {
    warnings.push(
      createWarning(
        step,
        "can show media in browser channels, but WhatsApp native media needs a public app URL or absolute media URL.",
      ),
    );
  }

  if (isProductMessageStepType(step.stepType)) {
    const products = Array.isArray(step.settings.products)
      ? step.settings.products
      : [];

    if (!getProductCatalogExternalId(step.settings)) {
      warnings.push(
        createWarning(
          step,
          "has browser product cards, but WhatsApp native product messages need a Meta catalog id on the selected catalog.",
        ),
      );
    }

    if (products.length > productLimit) {
      warnings.push(
        createWarning(
          step,
          `has more than ${productLimit} products, so WhatsApp will use text fallback instead of a native product list.`,
        ),
      );
    }

    if (products.some((product) => !hasWhatsAppProductRetailerId(product))) {
      warnings.push(
        createWarning(
          step,
          "has products without WhatsApp retailer ids or SKUs, so those products cannot be sent as native WhatsApp catalog items.",
        ),
      );
    }
  }

  if (
    step.stepType === "product_selection" &&
    step.settings.productSelectionAllowMultiple === true
  ) {
    const products = Array.isArray(step.settings.products)
      ? step.settings.products
      : [];

    if (!getProductCatalogExternalId(step.settings)) {
      warnings.push(
        createWarning(
          step,
          "can collect a cart, but native WhatsApp checkout needs a Meta catalog id on the selected catalog.",
        ),
      );
    }

    if (products.length > productLimit) {
      warnings.push(
        createWarning(
          step,
          `can collect a cart, but WhatsApp native cart payloads support up to ${productLimit} items.`,
        ),
      );
    }

    if (products.some((product) => !hasWhatsAppProductRetailerId(product))) {
      warnings.push(
        createWarning(
          step,
          "can collect a cart, but every product needs a WhatsApp retailer id or SKU for native checkout handoff.",
        ),
      );
    }
  }

  if (step.stepType === "template_message") {
    if (step.settings.whatsappTemplateStatus !== "approved") {
      warnings.push(
        createWarning(
          step,
          "uses a WhatsApp template that is not marked approved, so runtime will use text fallback.",
        ),
      );
    }

    const variables = Array.isArray(step.settings.whatsappTemplateVariables)
      ? step.settings.whatsappTemplateVariables.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const metadataIssues = getWhatsAppTemplateMetadataIssues({
      body:
        typeof step.settings.whatsappTemplateBody === "string"
          ? step.settings.whatsappTemplateBody
          : null,
      status:
        typeof step.settings.whatsappTemplateStatus === "string"
          ? step.settings.whatsappTemplateStatus
          : null,
      variables,
    });

    for (const issue of metadataIssues) {
      warnings.push({
        message: `Step ${step.sortOrder}: ${issue.message}`,
        severity: "warning",
        source: "channel_capability",
        stepId: step.id,
      });
    }
  }

  return warnings;
}
