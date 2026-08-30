import type {
  ConversationalTaskDefinitionV1,
  ToolDefinitionV1,
} from "@/lib/conversation-contracts";
import { toolDefinitionV1Schema } from "@/lib/conversation-contracts";
import { getProjectOperation, listProjectOperations } from "@/lib/operations";
import {
  getProjectCatalog,
  listProjectCatalogProductsByIds,
} from "@/lib/product-catalogs";

export type ProjectTaskToolOption = {
  access: "read" | "write";
  description: string;
  id: string;
  kind: "built_in" | "operation";
  name: string;
  version: number;
};

export type OperationToolSemantics = {
  access: "read" | "write";
  requiredForCompletion: boolean;
};

export type BuiltInToolExecutionResult = {
  errorCode: string | null;
  result: Record<string, unknown> | null;
  status:
    | "success"
    | "no_result"
    | "rejected"
    | "timeout"
    | "provider_failure"
    | "outcome_unknown"
    | "cancelled";
};

type ToolTemplate = Omit<ToolDefinitionV1, "projectId">;

const serviceIdInput = {
  key: "serviceId",
  required: true,
  source: { kind: "field" as const, key: "serviceId" },
  type: "project_resource" as const,
};

const BUILT_IN_TOOL_TEMPLATES: ToolTemplate[] = [
  {
    access: "read",
    description:
      "Read the current name, description, and catalog for a project service.",
    execution: {
      adapter: "built_in",
      cancellation: "unsupported",
      handler: "catalog.service_details",
      mode: "synchronous",
      retryAttempts: 0,
      retryDelayMs: 0,
      timeoutMs: 5_000,
    },
    id: "catalog.service_details",
    inputSchema: { fields: [serviceIdInput] },
    name: "Service Details",
    outputSchema: {
      fields: [
        {
          path: "serviceId",
          required: true,
          type: "project_resource",
        },
        { path: "name", required: true, type: "text" },
        { path: "description", required: false, type: "text" },
        {
          path: "catalogId",
          required: true,
          type: "project_resource",
        },
        { path: "catalogName", required: true, type: "text" },
      ],
    },
    requiredForCompletion: false,
    resultMappings: [
      {
        freshnessMinutes: 60,
        modelVisible: true,
        sourcePath: "name",
        target: "context",
        targetKey: "serviceName",
        toolVisible: true,
        type: "text",
      },
      {
        freshnessMinutes: 60,
        modelVisible: true,
        sourcePath: "description",
        target: "context",
        targetKey: "serviceDescription",
        toolVisible: true,
        type: "text",
      },
    ],
    schemaVersion: 1,
    version: 1,
  },
  {
    access: "read",
    description: "Read the current recorded price for a project service.",
    execution: {
      adapter: "built_in",
      cancellation: "unsupported",
      handler: "catalog.service_price",
      mode: "synchronous",
      retryAttempts: 0,
      retryDelayMs: 0,
      timeoutMs: 5_000,
    },
    id: "catalog.service_price",
    inputSchema: { fields: [serviceIdInput] },
    name: "Service Price",
    outputSchema: {
      fields: [
        { path: "amount", required: true, type: "decimal" },
        { path: "currency", required: true, type: "text" },
      ],
    },
    requiredForCompletion: false,
    resultMappings: [
      {
        freshnessMinutes: 30,
        modelVisible: true,
        sourcePath: "amount",
        target: "context",
        targetKey: "servicePriceAmount",
        toolVisible: true,
        type: "decimal",
      },
      {
        freshnessMinutes: 30,
        modelVisible: true,
        sourcePath: "currency",
        target: "context",
        targetKey: "servicePriceCurrency",
        toolVisible: true,
        type: "text",
      },
    ],
    schemaVersion: 1,
    version: 1,
  },
  {
    access: "read",
    description:
      "Read the current recorded duration in minutes for a project service.",
    execution: {
      adapter: "built_in",
      cancellation: "unsupported",
      handler: "catalog.service_duration",
      mode: "synchronous",
      retryAttempts: 0,
      retryDelayMs: 0,
      timeoutMs: 5_000,
    },
    id: "catalog.service_duration",
    inputSchema: { fields: [serviceIdInput] },
    name: "Service Duration",
    outputSchema: {
      fields: [{ path: "durationMinutes", required: true, type: "integer" }],
    },
    requiredForCompletion: false,
    resultMappings: [
      {
        freshnessMinutes: 60,
        modelVisible: true,
        sourcePath: "durationMinutes",
        target: "context",
        targetKey: "serviceDurationMinutes",
        toolVisible: true,
        type: "integer",
      },
    ],
    schemaVersion: 1,
    version: 1,
  },
  {
    access: "read",
    description:
      "Read explicitly recorded service availability without inferring live inventory.",
    execution: {
      adapter: "built_in",
      cancellation: "unsupported",
      handler: "catalog.service_availability",
      mode: "synchronous",
      retryAttempts: 0,
      retryDelayMs: 0,
      timeoutMs: 5_000,
    },
    id: "catalog.service_availability",
    inputSchema: {
      fields: [
        serviceIdInput,
        {
          key: "preferredDate",
          required: false,
          source: { kind: "field", key: "preferredDate" },
          type: "date",
        },
        {
          key: "preferredTime",
          required: false,
          source: { kind: "field", key: "preferredTime" },
          type: "time",
        },
      ],
    },
    name: "Service Availability",
    outputSchema: {
      fields: [
        { path: "available", required: true, type: "boolean" },
        { path: "status", required: false, type: "text" },
      ],
    },
    requiredForCompletion: false,
    resultMappings: [
      {
        freshnessMinutes: 5,
        modelVisible: true,
        sourcePath: "available",
        target: "context",
        targetKey: "serviceAvailable",
        toolVisible: true,
        type: "boolean",
      },
      {
        freshnessMinutes: 5,
        modelVisible: true,
        sourcePath: "status",
        target: "context",
        targetKey: "serviceAvailabilityStatus",
        toolVisible: true,
        type: "text",
      },
    ],
    schemaVersion: 1,
    version: 1,
  },
];

function numberSetting(
  value: Record<string, unknown>,
  key: string,
  fallback: number,
) {
  const candidate = Number(value[key]);
  return Number.isFinite(candidate) ? candidate : fallback;
}

function stableSourceKey(value: string) {
  const normalized = value
    .replace(/^fields\./, "")
    .replace(/^context\./, "")
    .trim();
  return /^[a-z][a-zA-Z0-9_]*$/.test(normalized) ? normalized : null;
}

export function getOperationToolSemantics(input: {
  operationType: string;
  providerType: string;
}): OperationToolSemantics {
  const isGoogleCalendarRead =
    input.providerType === "google_calendar" &&
    (input.operationType === "google_calendar.availability" ||
      input.operationType === "google_calendar.lookup");

  return isGoogleCalendarRead
    ? { access: "read", requiredForCompletion: false }
    : { access: "write", requiredForCompletion: true };
}

function operationDefinition(input: {
  definition: ConversationalTaskDefinitionV1;
  operationRow: Awaited<ReturnType<typeof getProjectOperation>>;
  projectId: number;
}): ToolDefinitionV1 | null {
  const row = input.operationRow;
  if (
    !row ||
    row.operation.status !== "active" ||
    row.provider.status !== "active"
  ) {
    return null;
  }
  const fields = new Map(
    input.definition.fields.map((field) => [field.key, field]),
  );
  const context = new Map(
    input.definition.contextVariables.map((variable) => [
      variable.key,
      variable,
    ]),
  );
  const inputFields: ToolDefinitionV1["inputSchema"]["fields"] = [];
  for (const [target, source] of Object.entries(row.operation.inputMapping)) {
    if (typeof source !== "string") {
      inputFields.push({
        key: target,
        required: true,
        source: { kind: "literal", value: source },
        type: "text",
      });
      continue;
    }
    const key = stableSourceKey(source);
    if (!key) continue;
    const field = fields.get(key);
    if (field) {
      inputFields.push({
        key: target,
        required: true,
        source: { kind: "field", key },
        type: field.type,
      });
      continue;
    }
    const variable = context.get(key);
    if (variable) {
      inputFields.push({
        key: target,
        required: true,
        source: { kind: "context", key },
        type: variable.type,
      });
    }
  }
  const outputFields: ToolDefinitionV1["outputSchema"]["fields"] = [];
  const resultMappings: ToolDefinitionV1["resultMappings"] = [];
  for (const [target, source] of Object.entries(row.operation.outputMapping)) {
    if (typeof source !== "string") continue;
    const sourcePath = source.replace(/^responsePayload\./, "").trim();
    if (!/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/.test(sourcePath)) continue;
    const targetKey = target
      .replace(/^fields\./, "")
      .replace(/^contactAttributes\./, "")
      .trim();
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(targetKey)) continue;
    const targetField = fields.get(targetKey);
    const targetContext = context.get(targetKey);
    const type = targetField?.type ?? targetContext?.type ?? "text";
    if (!outputFields.some((field) => field.path === sourcePath)) {
      outputFields.push({ path: sourcePath, required: false, type });
    }
    resultMappings.push({
      freshnessMinutes: targetField ? null : 30,
      modelVisible: targetContext?.modelVisible ?? true,
      sourcePath,
      target: targetField ? "field" : "context",
      targetKey,
      toolVisible: targetContext?.toolVisible ?? true,
      type,
    });
  }
  const config = row.provider.config;
  const timeoutMs = Math.min(
    300_000,
    Math.max(100, numberSetting(config, "timeoutMs", 15_000)),
  );
  const retryAttempts = Math.min(
    10,
    Math.max(0, numberSetting(config, "retryCount", 0)),
  );
  const retryDelayMs = Math.min(
    300_000,
    Math.max(0, numberSetting(config, "retryDelayMs", 1_000)),
  );
  const semantics = getOperationToolSemantics({
    operationType: row.operation.operationType,
    providerType: row.provider.providerType,
  });
  return toolDefinitionV1Schema.parse({
    access: semantics.access,
    description: `${row.operation.name} via ${row.provider.name}.`,
    execution: {
      adapter: "operation",
      cancellation: "best_effort",
      handler: String(row.operation.id),
      mode: "asynchronous",
      retryAttempts,
      retryDelayMs,
      timeoutMs,
    },
    id: `operation:${row.operation.id}`,
    inputSchema: { fields: inputFields },
    name: row.operation.name,
    outputSchema: { fields: outputFields },
    projectId: input.projectId,
    requiredForCompletion: semantics.requiredForCompletion,
    resultMappings,
    schemaVersion: 1,
    version: 1,
  });
}

function builtInDefinition(projectId: number, toolId: string) {
  const template = BUILT_IN_TOOL_TEMPLATES.find(({ id }) => id === toolId);
  return template
    ? toolDefinitionV1Schema.parse({ ...template, projectId })
    : null;
}

export async function listProjectTaskToolOptions(
  projectId: number,
): Promise<ProjectTaskToolOption[]> {
  const operationRows = await listProjectOperations(projectId);
  return [
    ...BUILT_IN_TOOL_TEMPLATES.map((tool) => ({
      access: tool.access,
      description: tool.description,
      id: tool.id,
      kind: "built_in" as const,
      name: tool.name,
      version: tool.version,
    })),
    ...operationRows.flatMap(({ operation, provider }) =>
      operation.status === "active" && provider.status === "active"
        ? [
            {
              access: getOperationToolSemantics({
                operationType: operation.operationType,
                providerType: provider.providerType,
              }).access,
              description: `${operation.name} via ${provider.name}.`,
              id: `operation:${operation.id}`,
              kind: "operation" as const,
              name: operation.name,
              version: 1,
            },
          ]
        : [],
    ),
  ];
}

export async function resolveProjectTaskToolDefinition(input: {
  definition: ConversationalTaskDefinitionV1;
  projectId: number;
  toolId: string;
  version: number;
}) {
  const builtIn = builtInDefinition(input.projectId, input.toolId);
  if (builtIn) {
    return builtIn.version === input.version ? builtIn : null;
  }
  const match = input.toolId.match(/^operation:(\d+)$/);
  if (!match || input.version !== 1) return null;
  return operationDefinition({
    definition: input.definition,
    operationRow: await getProjectOperation(input.projectId, Number(match[1])),
    projectId: input.projectId,
  });
}

export function getMissingTaskToolSourceKeys(input: {
  definition: ConversationalTaskDefinitionV1;
  toolDefinition: ToolDefinitionV1;
}) {
  const missing = new Set<string>();
  for (const field of input.toolDefinition.inputSchema.fields) {
    if (!field.required || field.source.kind === "literal") continue;
    const sourceKey = field.source.key;
    const exists =
      field.source.kind === "field"
        ? input.definition.fields.some(
            (candidate) => candidate.key === sourceKey,
          )
        : input.definition.contextVariables.some(
            (candidate) => candidate.key === sourceKey,
          );
    if (!exists) {
      missing.add(sourceKey);
    }
  }
  return Array.from(missing);
}

export async function resolveProjectTaskToolDefinitions(input: {
  definition: ConversationalTaskDefinitionV1;
  projectId: number;
}) {
  const definitions: ToolDefinitionV1[] = [];
  for (const binding of input.definition.tools) {
    const definition = await resolveProjectTaskToolDefinition({
      definition: input.definition,
      projectId: input.projectId,
      toolId: binding.tool.id,
      version: binding.tool.version,
    });
    if (!definition) {
      throw new Error(
        `Tool "${binding.tool.id}" is no longer available. Remove it from Tools before publishing.`,
      );
    }
    if (definition.access !== binding.access) {
      const expectedPermission =
        definition.access === "read" ? "Read data" : "Take action";
      throw new Error(
        `Tool "${definition.name}" has an outdated permission. Remove it from Tools and add it again as ${expectedPermission}.`,
      );
    }
    const [missingSourceKey] = getMissingTaskToolSourceKeys({
      definition: input.definition,
      toolDefinition: definition,
    });
    if (missingSourceKey) {
      throw new Error(
        `Tool "${definition.name}" requires "${missingSourceKey}".`,
      );
    }
    const outputFields = new Map(
      definition.outputSchema.fields.map((field) => [field.path, field]),
    );
    for (const mapping of definition.resultMappings) {
      const output = outputFields.get(mapping.sourcePath);
      if (!output || output.type !== mapping.type) {
        throw new Error(
          `Tool "${definition.name}" has an invalid result mapping.`,
        );
      }
      if (mapping.target === "field") {
        const target = input.definition.fields.find(
          (field) => field.key === mapping.targetKey,
        );
        if (
          !target ||
          target.type !== mapping.type ||
          !target.sourcePriority.includes("tool")
        ) {
          throw new Error(
            `Tool "${definition.name}" cannot update "${mapping.targetKey}".`,
          );
        }
      } else {
        const target = input.definition.contextVariables.find(
          (variable) => variable.key === mapping.targetKey,
        );
        if (target && target.type !== mapping.type) {
          throw new Error(
            `Tool "${definition.name}" cannot update "${mapping.targetKey}".`,
          );
        }
      }
    }
    definitions.push(definition);
  }
  return definitions;
}

function productId(value: unknown) {
  const match = String(value ?? "").match(/^product:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function executeBuiltInTaskTool(input: {
  definition: ToolDefinitionV1;
  projectId: number;
  toolInput: Record<string, unknown>;
}): Promise<BuiltInToolExecutionResult> {
  if (input.definition.execution.adapter !== "built_in") {
    return {
      errorCode: "unsupported_adapter",
      result: null,
      status: "rejected",
    };
  }
  const id = productId(input.toolInput.serviceId);
  const [product] = id
    ? await listProjectCatalogProductsByIds(input.projectId, [id])
    : [];
  if (!product) {
    return {
      errorCode: "service_not_found",
      result: null,
      status: "rejected",
    };
  }

  switch (input.definition.execution.handler) {
    case "catalog.service_details": {
      const catalog = await getProjectCatalog(
        input.projectId,
        product.catalogId,
      );
      if (!catalog) {
        return {
          errorCode: "catalog_not_found",
          result: null,
          status: "rejected",
        };
      }
      return {
        errorCode: null,
        result: {
          catalogId: `catalog:${catalog.id}`,
          catalogName: catalog.name,
          description: product.description,
          name: product.name,
          serviceId: `product:${product.id}`,
        },
        status: "success",
      };
    }
    case "catalog.service_price":
      return product.priceAmount === null || !product.currency
        ? {
            errorCode: "price_not_recorded",
            result: null,
            status: "no_result",
          }
        : {
            errorCode: null,
            result: {
              amount: product.priceAmount / 100,
              currency: product.currency,
            },
            status: "success",
          };
    case "catalog.service_duration": {
      const durationMinutes = positiveInteger(
        product.metadata.durationMinutes ??
          product.metadata.serviceDurationMinutes,
      );
      return durationMinutes
        ? {
            errorCode: null,
            result: { durationMinutes },
            status: "success",
          }
        : {
            errorCode: "duration_not_recorded",
            result: null,
            status: "no_result",
          };
    }
    case "catalog.service_availability": {
      const available = product.metadata.available;
      if (typeof available !== "boolean") {
        return {
          errorCode: "availability_not_recorded",
          result: null,
          status: "no_result",
        };
      }
      return {
        errorCode: null,
        result: {
          available,
          status:
            typeof product.metadata.availabilityStatus === "string"
              ? product.metadata.availabilityStatus
              : available
                ? "available"
                : "unavailable",
        },
        status: "success",
      };
    }
    default:
      return {
        errorCode: "unknown_built_in_tool",
        result: null,
        status: "rejected",
      };
  }
}
