import type {
  SelectCatalogProduct,
  SelectMediaAsset,
  SelectProductCatalog,
} from "@/lib/db-schema";

type ConnectedAction = {
  id: number;
  name: string;
};

export type ActionStepSettingsInput = {
  catalogId?: string;
  choiceDisplayMode?: "buttons" | "list" | "text";
  connectedAction?: ConnectedAction | null;
  connectFlowMode?: "jump" | "return";
  contactAttributeFieldKey?: string;
  contactAttributeKey?: string;
  contactAttributeValue?: string;
  contactAttributeValueSource?: "field" | "static";
  contactTagNames?: string;
  existingSettings?: unknown;
  filterByField?: string;
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
  sourceType?: string;
  stepType?: string;
  validationAllowedFileTypes?: string;
  validationMaxDate?: string;
  validationMaxLength?: number;
  validationMaxNumber?: number;
  validationMessage?: string;
  validationMinDate?: string;
  validationMinLength?: number;
  validationMinNumber?: number;
  validationRegex?: string;
  waitAmount?: number;
  waitUnit?: "seconds" | "minutes" | "hours" | "days";
  whatsappTemplateBody?: string;
  whatsappTemplateCategory?: "authentication" | "marketing" | "utility";
  whatsappTemplateLanguage?: string;
  whatsappTemplateName?: string;
  whatsappTemplateStatus?: "approved" | "draft" | "pending" | "rejected";
  whatsappTemplateVariables?: string;
};

function toSettingsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function hasOwn(
  input: ActionStepSettingsInput,
  key: keyof ActionStepSettingsInput,
) {
  return Object.hasOwn(input, key);
}

function hasAnyOwn(
  input: ActionStepSettingsInput,
  keys: Array<keyof ActionStepSettingsInput>,
) {
  return keys.some((key) => hasOwn(input, key));
}

function parseLines(value?: string) {
  return (
    value
      ?.split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

function updateStringSetting(
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

function updateNumberSetting(
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

function deleteSettings(settings: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    delete settings[key];
  }
}

export function buildActionStepSettings(input: ActionStepSettingsInput) {
  const settings = toSettingsRecord(input.existingSettings);

  if (hasOwn(input, "choiceDisplayMode")) {
    if (input.choiceDisplayMode) {
      settings.choiceDisplayMode = input.choiceDisplayMode;
    } else {
      delete settings.choiceDisplayMode;
    }
  }

  if (hasOwn(input, "operationExecutionMode")) {
    if (input.operationExecutionMode) {
      settings.operationExecutionMode = input.operationExecutionMode;
    } else {
      delete settings.operationExecutionMode;
    }
  }

  const stringValidationSettings = [
    ["requiredMessage", input.requiredMessage],
    ["validationMessage", input.validationMessage],
    ["validationRegex", input.validationRegex],
    ["validationMinDate", input.validationMinDate],
    ["validationMaxDate", input.validationMaxDate],
    ["validationAllowedFileTypes", input.validationAllowedFileTypes],
  ] as const;

  for (const [key, value] of stringValidationSettings) {
    if (hasOwn(input, key)) {
      updateStringSetting(settings, key, value);
    }
  }

  const numberValidationSettings = [
    ["validationMinLength", input.validationMinLength],
    ["validationMaxLength", input.validationMaxLength],
    ["validationMinNumber", input.validationMinNumber],
    ["validationMaxNumber", input.validationMaxNumber],
  ] as const;

  for (const [key, value] of numberValidationSettings) {
    if (hasOwn(input, key)) {
      updateNumberSetting(settings, key, value);
    }
  }

  const templateKeys = [
    "whatsappTemplateBody",
    "whatsappTemplateCategory",
    "whatsappTemplateLanguage",
    "whatsappTemplateName",
    "whatsappTemplateStatus",
    "whatsappTemplateVariables",
  ] as const;

  if (hasAnyOwn(input, [...templateKeys])) {
    if (input.stepType === "template_message") {
      updateStringSetting(
        settings,
        "whatsappTemplateBody",
        input.whatsappTemplateBody,
      );
      updateStringSetting(
        settings,
        "whatsappTemplateName",
        input.whatsappTemplateName,
      );
      updateStringSetting(
        settings,
        "whatsappTemplateLanguage",
        input.whatsappTemplateLanguage,
      );
      settings.whatsappTemplateCategory =
        input.whatsappTemplateCategory ?? "utility";
      settings.whatsappTemplateStatus = input.whatsappTemplateStatus ?? "draft";

      const variables = parseLines(input.whatsappTemplateVariables);
      if (variables.length > 0) {
        settings.whatsappTemplateVariables = variables;
      } else {
        delete settings.whatsappTemplateVariables;
      }
    } else {
      deleteSettings(settings, [...templateKeys]);
    }
  }

  const productKeys = [
    "productCatalog",
    "productDisplayLayout",
    "productSelectionAllowMultiple",
    "productSelectionAllowQuantity",
    "products",
  ] as const;

  if (hasAnyOwn(input, [...productKeys])) {
    const isProductBackedStep = [
      "catalog_message",
      "single_product",
      "multiple_products",
      "product_selection",
    ].includes(input.stepType ?? "");

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
  }

  if (hasOwn(input, "mediaAsset")) {
    if (input.mediaAsset) {
      settings.mediaAssetId = input.mediaAsset.id;
      settings.mediaAsset = {
        id: input.mediaAsset.id,
        mediaType: input.mediaAsset.mediaType,
        mimeType: input.mediaAsset.mimeType,
        originalName: input.mediaAsset.originalName,
        publicPath: input.mediaAsset.publicPath,
      };
    } else {
      delete settings.mediaAssetId;
      delete settings.mediaAsset;
    }
  }

  if (hasAnyOwn(input, ["sourceType", "catalogId", "filterByField"])) {
    const sourceType = input.sourceType?.trim();
    if (sourceType) {
      settings.sourceType = sourceType;
      settings.sourceConfig = {
        catalogId: input.catalogId?.trim() || undefined,
        filterByField: input.filterByField?.trim() || undefined,
      };
    } else {
      delete settings.sourceType;
      delete settings.sourceConfig;
    }
  }

  const contactAttributeKeys = [
    "contactAttributeFieldKey",
    "contactAttributeKey",
    "contactAttributeValue",
    "contactAttributeValueSource",
  ] as const;

  if (hasAnyOwn(input, [...contactAttributeKeys])) {
    const attributeKey = input.contactAttributeKey?.trim();
    if (attributeKey) {
      settings.contactAttributeKey = attributeKey;
      settings.contactAttributeValueSource =
        input.contactAttributeValueSource ?? "field";
      updateStringSetting(
        settings,
        "contactAttributeFieldKey",
        input.contactAttributeFieldKey,
      );
      updateStringSetting(
        settings,
        "contactAttributeValue",
        input.contactAttributeValue,
      );
    } else {
      deleteSettings(settings, [...contactAttributeKeys]);
    }
  }

  if (hasOwn(input, "contactTagNames")) {
    updateStringSetting(settings, "contactTagNames", input.contactTagNames);
  }

  if (hasAnyOwn(input, ["connectedAction", "connectFlowMode"])) {
    if (input.stepType === "connect_flow" && input.connectedAction) {
      settings.connectedActionId = input.connectedAction.id;
      settings.connectedActionName = input.connectedAction.name;
      settings.connectFlowMode = input.connectFlowMode ?? "jump";
    } else {
      deleteSettings(settings, [
        "connectedActionId",
        "connectedActionName",
        "connectFlowMode",
      ]);
    }
  }

  if (
    hasAnyOwn(input, ["handoffNotifyTeam", "handoffPriority", "handoffQueue"])
  ) {
    if (input.stepType === "handoff") {
      settings.handoffNotifyTeam = input.handoffNotifyTeam !== false;
      settings.handoffPriority = input.handoffPriority ?? "normal";
      updateStringSetting(settings, "handoffQueue", input.handoffQueue);
    } else {
      deleteSettings(settings, [
        "handoffNotifyTeam",
        "handoffPriority",
        "handoffQueue",
      ]);
    }
  }

  if (hasAnyOwn(input, ["waitAmount", "waitUnit"])) {
    if (input.stepType === "wait") {
      settings.waitAmount = input.waitAmount ?? 1;
      settings.waitUnit = input.waitUnit ?? "minutes";
    } else {
      delete settings.waitAmount;
      delete settings.waitUnit;
    }
  }

  return settings;
}
