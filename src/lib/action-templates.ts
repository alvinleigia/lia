import {
  listActionFlowSteps,
  listProjectActions,
  type ProjectActionStatus,
} from "@/lib/action-flows";
import type { SelectProjectAction } from "@/lib/db-schema";
import {
  type FlowComponentChannel,
  getFlowComponentByStepType,
} from "@/lib/flow-components";
import actionTemplates from "../../data/action-templates.json";

export type ActionTemplateStep = {
  fieldKey: string | null;
  inputType: string | null;
  isEnabled?: boolean;
  isRequired: boolean;
  label: string | null;
  nextStepId?: number | null;
  operationId?: number | null;
  options: unknown[];
  prompt: string | null;
  settings: Record<string, unknown>;
  sortOrder: number;
  stepType: string;
};
export type ActionTemplate = {
  action: {
    description: string | null;
    name: string;
    settings: Record<string, unknown>;
    status: string;
    triggerPhrases: string[];
  };
  businessTypes: string[];
  description: string;
  key: string;
  name: string;
  steps: ActionTemplateStep[];
};
export type ActionTemplateStatus = "custom" | "stable";
export type ActionTemplateCompatibilityIssue = {
  message: string;
  severity: "error" | "warning";
};
export type ActionTemplateSummary = {
  channels: FlowComponentChannel[];
  compatibilityErrors: number;
  compatibilityIssues: ActionTemplateCompatibilityIssue[];
  compatibilityWarnings: number;
  fieldCount: number;
  requiredFieldCount: number;
  status: ActionTemplateStatus;
  stepCount: number;
  version: string;
};
export type ActionTemplateWithSummary = ActionTemplate & {
  summary: ActionTemplateSummary;
};

const DEFAULT_TEMPLATE_VERSION = "1.0.0";
const PROJECT_ACTION_TEMPLATE_KEY_PREFIX = "project_action:";
const bundledActionTemplates = actionTemplates.templates as ActionTemplate[];

type ProjectActionTemplateSettings = {
  enabled: boolean;
  savedAt?: string;
  version?: string;
};

function getProjectActionTemplateSettings(
  action: SelectProjectAction,
): ProjectActionTemplateSettings | null {
  const customTemplate = action.settings.customTemplate;

  if (
    !customTemplate ||
    typeof customTemplate !== "object" ||
    Array.isArray(customTemplate)
  ) {
    return null;
  }

  const record = customTemplate as Record<string, unknown>;
  if (record.enabled !== true) {
    return null;
  }

  return {
    enabled: true,
    savedAt: typeof record.savedAt === "string" ? record.savedAt : undefined,
    version: typeof record.version === "string" ? record.version : undefined,
  };
}

function getTemplateSettingText(template: ActionTemplate, key: string) {
  const settings = template.action.settings as Record<string, unknown>;
  const value = settings[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getActionTemplateVersion(template: ActionTemplate) {
  return (
    getTemplateSettingText(template, "templateVersion") ??
    getTemplateSettingText(template, "customTemplateVersion") ??
    DEFAULT_TEMPLATE_VERSION
  );
}

function getActionTemplateChannels(template: ActionTemplate) {
  const channels = new Set<FlowComponentChannel>();

  for (const step of template.steps) {
    const component = getFlowComponentByStepType(step.stepType);
    if (!component) {
      continue;
    }

    for (const channel of component.channels) {
      if (channel !== "future") {
        channels.add(channel);
      }
    }
  }

  if (channels.size === 0) {
    channels.add("project_chat");
    channels.add("widget");
  }

  return Array.from(channels).sort();
}

function getRecordValue(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

function hasMetaCatalogId(settings: Record<string, unknown>) {
  const catalog = getRecordValue(settings, "productCatalog");
  const externalId = catalog?.externalId;

  return typeof externalId === "string" && Boolean(externalId.trim());
}

function getActionTemplateCompatibilityIssues(
  template: ActionTemplate,
): ActionTemplateCompatibilityIssue[] {
  const issues: ActionTemplateCompatibilityIssue[] = [];
  const enabledSteps = template.steps.filter(
    (step) => step.isEnabled !== false,
  );
  const fieldKeys = enabledSteps
    .map((step) => step.fieldKey?.trim())
    .filter((fieldKey): fieldKey is string => Boolean(fieldKey));
  const fieldKeyCounts = fieldKeys.reduce<Map<string, number>>(
    (counts, fieldKey) => counts.set(fieldKey, (counts.get(fieldKey) ?? 0) + 1),
    new Map(),
  );

  for (const [fieldKey, count] of fieldKeyCounts) {
    if (count > 1) {
      issues.push({
        message: `Field key "${fieldKey}" is used by ${count} enabled steps.`,
        severity: "warning",
      });
    }
  }

  if (
    enabledSteps.length > 0 &&
    !enabledSteps.some((step) =>
      ["confirmation", "submit"].includes(step.stepType),
    )
  ) {
    issues.push({
      message: "No enabled confirmation or submit step is included.",
      severity: "warning",
    });
  }

  for (const step of enabledSteps) {
    const label = step.label || `Step ${step.sortOrder}`;
    const products = Array.isArray(step.settings.products)
      ? step.settings.products
      : [];

    if (step.stepType === "operation") {
      if (typeof step.operationId !== "number") {
        issues.push({
          message: `${label} needs an operation after apply.`,
          severity: "error",
        });
      } else {
        issues.push({
          message: `${label} uses a project operation; verify provider credentials before publishing.`,
          severity: "warning",
        });
      }
    }

    if (
      step.stepType === "connect_flow" &&
      typeof step.settings.connectedActionId === "number"
    ) {
      issues.push({
        message: `${label} links to another project flow; verify the target after apply.`,
        severity: "warning",
      });
    }

    if (
      step.stepType === "connect_flow" &&
      typeof step.settings.connectedActionId !== "number"
    ) {
      issues.push({
        message: `${label} needs a connected flow after apply.`,
        severity: "error",
      });
    }

    if (
      step.stepType === "media" &&
      (typeof step.settings.mediaAssetId !== "number" ||
        !step.settings.mediaAsset)
    ) {
      issues.push({
        message: `${label} needs a media asset after apply.`,
        severity: "error",
      });
    }

    if (
      step.stepType === "catalog_message" &&
      typeof step.settings.productCatalogId !== "number"
    ) {
      issues.push({
        message: `${label} needs a product catalog after apply.`,
        severity: "error",
      });
    }

    if (step.stepType === "single_product" && products.length !== 1) {
      issues.push({
        message: `${label} needs exactly one product after apply.`,
        severity: "error",
      });
    }

    if (
      ["multiple_products", "product_selection"].includes(step.stepType) &&
      products.length === 0
    ) {
      issues.push({
        message: `${label} needs at least one product after apply.`,
        severity: "error",
      });
    }

    if (
      [
        "catalog_message",
        "single_product",
        "multiple_products",
        "product_selection",
      ].includes(step.stepType) &&
      products.length > 0
    ) {
      if (!hasMetaCatalogId(step.settings)) {
        issues.push({
          message: `${label} can render in browser channels; WhatsApp native catalog messages need a Meta catalog id.`,
          severity: "warning",
        });
      }

      if (products.some((product) => !hasWhatsAppProductRetailerId(product))) {
        issues.push({
          message: `${label} has products without WhatsApp retailer ids or SKUs.`,
          severity: "warning",
        });
      }
    }

    if (
      step.stepType === "template_message" &&
      (!step.settings.whatsappTemplateName ||
        !step.settings.whatsappTemplateLanguage)
    ) {
      issues.push({
        message: `${label} needs a WhatsApp template name and language.`,
        severity: "error",
      });
    }

    if (
      step.stepType === "template_message" &&
      step.settings.whatsappTemplateStatus !== "approved"
    ) {
      issues.push({
        message: `${label} is not marked as an approved WhatsApp template.`,
        severity: "warning",
      });
    }
  }

  return issues;
}

export function getActionTemplateSummary(
  template: ActionTemplate,
): ActionTemplateSummary {
  const fieldSteps = template.steps.filter((step) => step.fieldKey);
  const source = getTemplateSettingText(template, "templateSource");
  const compatibilityIssues = getActionTemplateCompatibilityIssues(template);

  return {
    channels: getActionTemplateChannels(template),
    compatibilityErrors: compatibilityIssues.filter(
      (issue) => issue.severity === "error",
    ).length,
    compatibilityIssues,
    compatibilityWarnings: compatibilityIssues.filter(
      (issue) => issue.severity === "warning",
    ).length,
    fieldCount: fieldSteps.length,
    requiredFieldCount: fieldSteps.filter((step) => step.isRequired).length,
    status: source === "project_custom" ? "custom" : "stable",
    stepCount: template.steps.length,
    version: getActionTemplateVersion(template),
  };
}

export function withActionTemplateSummary(
  template: ActionTemplate,
): ActionTemplateWithSummary {
  return {
    ...template,
    summary: getActionTemplateSummary(template),
  };
}

export function listActionTemplates(): ActionTemplateWithSummary[] {
  return bundledActionTemplates.map(withActionTemplateSummary);
}

export function listActionTemplateBusinessTypes() {
  return Array.from(
    new Set(
      bundledActionTemplates.flatMap((template) => template.businessTypes),
    ),
  ).sort();
}

export function filterActionTemplates(input: {
  businessType?: string;
  query?: string;
}) {
  const query = input.query?.trim().toLowerCase();
  const businessType = input.businessType?.trim().toLowerCase();

  return listActionTemplates().filter((template) => {
    const matchesBusinessType =
      !businessType ||
      template.businessTypes.some(
        (item) => item.toLowerCase() === businessType,
      );
    const matchesQuery =
      !query ||
      [
        template.name,
        template.description,
        template.action.name,
        template.action.description,
        ...template.businessTypes,
        ...template.action.triggerPhrases,
      ]
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        )
        .some((value) => value.toLowerCase().includes(query));

    return matchesBusinessType && matchesQuery;
  });
}

export function getActionTemplate(templateKey: string) {
  const template =
    bundledActionTemplates.find((template) => template.key === templateKey) ??
    null;

  return template ? withActionTemplateSummary(template) : null;
}

export function getProjectActionTemplateKey(actionId: number) {
  return `${PROJECT_ACTION_TEMPLATE_KEY_PREFIX}${actionId}`;
}

export function parseProjectActionTemplateKey(templateKey: string) {
  if (!templateKey.startsWith(PROJECT_ACTION_TEMPLATE_KEY_PREFIX)) {
    return null;
  }

  const actionId = Number.parseInt(
    templateKey.slice(PROJECT_ACTION_TEMPLATE_KEY_PREFIX.length),
    10,
  );

  return Number.isInteger(actionId) && actionId > 0 ? actionId : null;
}

export function isProjectActionTemplate(action: SelectProjectAction) {
  return getProjectActionTemplateSettings(action) !== null;
}

function toProjectActionTemplate(input: {
  action: SelectProjectAction;
  steps: Awaited<ReturnType<typeof listActionFlowSteps>>;
}): ActionTemplateWithSummary {
  const templateSettings = getProjectActionTemplateSettings(input.action);
  const template: ActionTemplate = {
    action: {
      description: input.action.description,
      name: input.action.name,
      settings: {
        ...input.action.settings,
        customTemplateSourceActionId: input.action.id,
        customTemplateVersion: templateSettings?.version ?? "1.0.0",
        templateKey: getProjectActionTemplateKey(input.action.id),
        templateSource: "project_custom",
      },
      status: input.action.status as ProjectActionStatus,
      triggerPhrases: input.action.triggerPhrases,
    },
    businessTypes: ["project"],
    description:
      input.action.description ??
      "Project template saved from an existing flow.",
    key: getProjectActionTemplateKey(input.action.id),
    name: input.action.name,
    steps: input.steps.map((step) => ({
      fieldKey: step.fieldKey,
      inputType: step.inputType,
      isEnabled: step.isEnabled,
      isRequired: step.isRequired,
      label: step.label,
      nextStepId: step.nextStepId,
      operationId: step.operationId,
      options: step.options,
      prompt: step.prompt,
      settings: step.settings,
      sortOrder: step.sortOrder,
      stepType: step.stepType,
    })),
  };

  return withActionTemplateSummary(template);
}

export async function listProjectActionTemplates(projectId: number) {
  const actions = (await listProjectActions(projectId)).filter(
    isProjectActionTemplate,
  );

  return Promise.all(
    actions.map(async (action) =>
      toProjectActionTemplate({
        action,
        steps: await listActionFlowSteps(projectId, action.id),
      }),
    ),
  );
}

export async function filterProjectActionTemplates(input: {
  businessType?: string;
  projectId: number;
  query?: string;
}) {
  const query = input.query?.trim().toLowerCase();
  const businessType = input.businessType?.trim().toLowerCase();
  const templates = await listProjectActionTemplates(input.projectId);

  return templates.filter((template) => {
    const matchesBusinessType =
      !businessType ||
      template.businessTypes.some(
        (item) => item.toLowerCase() === businessType,
      );
    const matchesQuery =
      !query ||
      [
        template.name,
        template.description,
        template.action.name,
        template.action.description,
        ...template.businessTypes,
        ...template.action.triggerPhrases,
      ]
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        )
        .some((value) => value.toLowerCase().includes(query));

    return matchesBusinessType && matchesQuery;
  });
}
