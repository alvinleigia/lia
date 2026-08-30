import { createHash, createHmac } from "node:crypto";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db-config";
import {
  actionFlowSteps,
  actionSubmissionEvents,
  actionSubmissions,
  durableJobs,
  integrationProviders,
  operationAttempts,
  operations,
  providerSecrets,
  type SelectOperation,
  type SelectOperationAttempt,
} from "@/lib/db-schema";
import {
  claimNextDurableJob,
  completeDurableJob,
  failDurableJob,
} from "@/lib/durable-jobs";
import { resolveTraceId } from "@/lib/execution-trace";
import { executeGoogleCalendarProviderOperation } from "@/lib/google-calendar";
import { googleCalendarAppointmentStore } from "@/lib/google-calendar-store";
import { HTTP_METHODS, type HttpMethod } from "@/lib/operation-contracts";
import {
  hydrateProviderConfig,
  isProviderSecretReference,
  listMissingProviderSecretNames,
  prepareProviderConfig,
} from "@/lib/provider-secrets";

export const INTEGRATION_PROVIDER_TYPES = [
  "manual_review",
  "internal_save",
  "email",
  "webhook",
  "n8n_webhook",
  "meta_conversions_api",
  "google_calendar",
] as const;
export const INTEGRATION_PROVIDER_STATUSES = ["active", "disabled"] as const;
export const OPERATION_STATUSES = ["active", "disabled"] as const;
export const OPERATION_ATTEMPT_STATUSES = [
  "pending",
  "completed",
  "failed",
  "outcome_unknown",
] as const;

export type IntegrationProviderType =
  (typeof INTEGRATION_PROVIDER_TYPES)[number];
export type IntegrationProviderStatus =
  (typeof INTEGRATION_PROVIDER_STATUSES)[number];
export type OperationStatus = (typeof OPERATION_STATUSES)[number];
export type OperationAttemptStatus =
  (typeof OPERATION_ATTEMPT_STATUSES)[number];

export type CreateIntegrationProviderInput = {
  projectId: number;
  name: string;
  providerType: IntegrationProviderType;
  status?: IntegrationProviderStatus;
  config?: Record<string, unknown>;
};

export type CreateOperationInput = {
  projectId: number;
  providerId: number;
  name: string;
  operationType: string;
  status?: OperationStatus;
  inputMapping?: Record<string, unknown>;
  outputMapping?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  successStepId?: number | null;
  failureStepId?: number | null;
};

function getMappedValue(fields: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || !(key in value)) {
      return undefined;
    }

    return (value as Record<string, unknown>)[key];
  }, fields);
}

function setMappedValue(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const keys = path.split(".").filter(Boolean);
  if (
    keys.some((key) => ["__proto__", "constructor", "prototype"].includes(key))
  ) {
    return;
  }
  let current = target;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      current[key] = value;
      return;
    }
    const child = current[key];
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  });
}

function buildInputPayload(
  fields: Record<string, unknown>,
  inputMapping: Record<string, unknown>,
) {
  const entries = Object.entries(inputMapping);
  if (entries.length === 0) {
    return { fields };
  }

  return entries.reduce<Record<string, unknown>>(
    (payload, [target, source]) => {
      if (typeof source === "string") {
        payload[target] = getMappedValue(fields, source) ?? null;
        return payload;
      }

      payload[target] = source;
      return payload;
    },
    {},
  );
}

function getOutputMappingValue(
  context: Record<string, unknown>,
  source: unknown,
) {
  if (typeof source === "string") {
    return getMappedValue(context, source) ?? null;
  }

  return source;
}

function buildOutputPayload(input: {
  errorMessage?: string | null;
  outputMapping: Record<string, unknown>;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  status: OperationAttemptStatus;
  attemptId: number;
}) {
  const context = {
    attemptId: input.attemptId,
    errorMessage: input.errorMessage ?? null,
    requestPayload: input.requestPayload,
    responsePayload: input.responsePayload,
    status: input.status,
  };
  const fields: Record<string, unknown> = {};
  const contactAttributes: Record<string, unknown> = {};

  for (const [target, source] of Object.entries(input.outputMapping)) {
    const normalizedTarget = target.trim();
    if (!normalizedTarget) {
      continue;
    }

    const value = getOutputMappingValue(context, source);
    if (normalizedTarget.startsWith("contactAttributes.")) {
      const key = normalizedTarget.slice("contactAttributes.".length).trim();
      if (key) {
        contactAttributes[key] = value;
      }
      continue;
    }

    const fieldKey = normalizedTarget.startsWith("fields.")
      ? normalizedTarget.slice("fields.".length).trim()
      : normalizedTarget;

    if (fieldKey) {
      fields[fieldKey] = value;
    }
  }

  return { contactAttributes, fields };
}

export type OperationRunResult = {
  attempt: SelectOperationAttempt;
  contactAttributes: Record<string, unknown>;
  fields: Record<string, unknown>;
  outcome: string;
};

function getCustomStatusCodes(settings: Record<string, unknown>) {
  return Array.isArray(settings.customStatusCodes)
    ? settings.customStatusCodes.filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isInteger(value) &&
          value >= 100 &&
          value <= 599,
      )
    : [];
}

export function getOperationResultOutcome(input: {
  attempt: SelectOperationAttempt;
  operation: SelectOperation;
}) {
  const response = getRecordValue(input.attempt.responsePayload, "response");
  const status = response?.status;
  if (
    typeof status === "number" &&
    getCustomStatusCodes(input.operation.settings).includes(status)
  ) {
    return `status_${status}`;
  }
  if (typeof status === "number") {
    if (status >= 200 && status < 300) return "success";
    if (status >= 400 && status < 500) return "client_error";
    if (status >= 500) return "server_error";
  }

  const errorKind = input.attempt.responsePayload.errorKind;
  if (errorKind === "timeout") return "timeout";
  if (errorKind === "network_failure") return "network_failure";
  return input.attempt.status === "completed" ? "success" : "server_error";
}

type RetryQueueReplayStats = {
  completed: boolean;
  count: number;
};

export type OperationRetryQueueResult = {
  completed: number;
  failed: number;
  idle: boolean;
  processed: number;
  skipped: number;
};

export type DurableOperationQueueResult = {
  completed: number;
  failed: number;
  idle: boolean;
  processed: number;
  rescheduled: number;
};

export function getOperationAttemptReplaySourceId(
  requestPayload: Record<string, unknown>,
) {
  const replay = requestPayload.replay;
  if (!replay || typeof replay !== "object" || Array.isArray(replay)) {
    return null;
  }

  const sourceAttemptId = (replay as Record<string, unknown>).sourceAttemptId;
  return typeof sourceAttemptId === "number" ? sourceAttemptId : null;
}

export function getOperationAttemptMappedOutput(input: {
  attempt: SelectOperationAttempt;
  operation: SelectOperation;
}) {
  return buildOutputPayload({
    attemptId: input.attempt.id,
    errorMessage: input.attempt.errorMessage,
    outputMapping: input.operation.outputMapping,
    requestPayload: input.attempt.requestPayload,
    responsePayload: input.attempt.responsePayload,
    status: input.attempt.status as OperationAttemptStatus,
  });
}

function sanitizeOperationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeOperationValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      /secret|password|token|api.?key|authorization|credential/i.test(key)
        ? "[REDACTED]"
        : sanitizeOperationValue(entry),
    ]),
  );
}

export function getSanitizedOperationAttemptPreview(input: {
  attempt: SelectOperationAttempt;
  operation: SelectOperation;
}) {
  const response = getRecordValue(input.attempt.responsePayload, "response");

  return {
    body: sanitizeOperationValue(response?.body ?? null),
    outcome: getOperationResultOutcome(input),
    status: typeof response?.status === "number" ? response.status : null,
    statusText:
      typeof response?.statusText === "string" ? response.statusText : null,
  };
}

export function getOperationAttemptToolResult(input: {
  attempt: SelectOperationAttempt;
  operation: SelectOperation;
}) {
  const context = {
    attemptId: input.attempt.id,
    errorMessage: input.attempt.errorMessage ?? null,
    requestPayload: input.attempt.requestPayload,
    responsePayload: input.attempt.responsePayload,
    status: input.attempt.status,
  };
  const result: Record<string, unknown> = {};
  for (const source of Object.values(input.operation.outputMapping)) {
    if (typeof source !== "string") continue;
    const sourcePath = source.replace(/^responsePayload\./, "").trim();
    if (!/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/.test(sourcePath)) continue;
    setMappedValue(result, sourcePath, getOutputMappingValue(context, source));
  }
  return result;
}

export async function createIntegrationProvider(
  input: CreateIntegrationProviderInput,
) {
  const prepared = prepareProviderConfig(input.config ?? {});

  return db.transaction(async (tx) => {
    const [provider] = await tx
      .insert(integrationProviders)
      .values({
        projectId: input.projectId,
        name: input.name,
        providerType: input.providerType,
        status: input.status ?? "active",
        config: prepared.config,
        updatedAt: new Date(),
      })
      .returning();

    if (prepared.secrets.length > 0) {
      await tx.insert(providerSecrets).values(
        prepared.secrets.map((secret) => ({
          ...secret,
          projectId: input.projectId,
          providerId: provider.id,
        })),
      );
    }

    return provider;
  });
}

export async function listProjectIntegrationProviders(projectId: number) {
  return db
    .select()
    .from(integrationProviders)
    .where(eq(integrationProviders.projectId, projectId))
    .orderBy(asc(integrationProviders.name), asc(integrationProviders.id));
}

export async function getProjectIntegrationProvider(
  projectId: number,
  providerId: number,
) {
  const [provider] = await db
    .select()
    .from(integrationProviders)
    .where(
      and(
        eq(integrationProviders.projectId, projectId),
        eq(integrationProviders.id, providerId),
      ),
    )
    .limit(1);

  return provider ?? null;
}

export async function updateIntegrationProviderStatus(input: {
  projectId: number;
  providerId: number;
  status: IntegrationProviderStatus;
}) {
  const [provider] = await db
    .update(integrationProviders)
    .set({
      status: input.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integrationProviders.projectId, input.projectId),
        eq(integrationProviders.id, input.providerId),
      ),
    )
    .returning();

  return provider ?? null;
}

export async function createOperation(input: CreateOperationInput) {
  const provider = await getProjectIntegrationProvider(
    input.projectId,
    input.providerId,
  );

  if (!provider) {
    throw new Error("Provider not found for project.");
  }

  const [operation] = await db
    .insert(operations)
    .values({
      projectId: input.projectId,
      providerId: input.providerId,
      name: input.name,
      operationType: input.operationType,
      status: input.status ?? "active",
      inputMapping: input.inputMapping ?? {},
      outputMapping: input.outputMapping ?? {},
      settings: input.settings ?? {},
      successStepId: input.successStepId ?? null,
      failureStepId: input.failureStepId ?? null,
      updatedAt: new Date(),
    })
    .returning();

  return operation;
}

export async function updateOperationStatus(input: {
  projectId: number;
  operationId: number;
  status: OperationStatus;
}) {
  const [operation] = await db
    .update(operations)
    .set({
      status: input.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(operations.projectId, input.projectId),
        eq(operations.id, input.operationId),
      ),
    )
    .returning();

  return operation ?? null;
}

export async function createDefaultManualReviewOperation(projectId: number) {
  const provider = await createIntegrationProvider({
    projectId,
    name: "Manual Review",
    providerType: "manual_review",
  });
  const operation = await createOperation({
    projectId,
    providerId: provider.id,
    name: "Manual Review",
    operationType: "manual_review",
  });

  return { provider, operation };
}

export async function listProjectOperations(projectId: number) {
  return db
    .select({
      operation: operations,
      provider: integrationProviders,
    })
    .from(operations)
    .innerJoin(
      integrationProviders,
      eq(integrationProviders.id, operations.providerId),
    )
    .where(
      and(
        eq(operations.projectId, projectId),
        eq(integrationProviders.projectId, projectId),
      ),
    )
    .orderBy(asc(operations.name), asc(operations.id));
}

export async function getProjectOperation(
  projectId: number,
  operationId: number,
) {
  const [row] = await db
    .select({
      operation: operations,
      provider: integrationProviders,
    })
    .from(operations)
    .innerJoin(
      integrationProviders,
      eq(integrationProviders.id, operations.providerId),
    )
    .where(
      and(
        eq(operations.projectId, projectId),
        eq(operations.id, operationId),
        eq(integrationProviders.projectId, projectId),
      ),
    )
    .limit(1);

  return row ?? null;
}

function isStringRecord(value: unknown) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value as Record<string, unknown>).every(
      ([key, entry]) => key.trim() && typeof entry === "string",
    )
  );
}

function isHeaderRecord(value: unknown) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value as Record<string, unknown>).every(
      ([key, entry]) =>
        key.trim() &&
        (typeof entry === "string" || isProviderSecretReference(entry)),
    )
  );
}

function hasUnsafeMappingPath(value: string) {
  return value
    .split(".")
    .some((part) => ["__proto__", "constructor", "prototype"].includes(part));
}

export function getOperationConfigurationIssues(
  context: NonNullable<Awaited<ReturnType<typeof getProjectOperation>>>,
) {
  const issues: string[] = [];
  const { operation, provider } = context;

  if (operation.status !== "active" || provider.status !== "active") {
    issues.push("The operation and its provider must both be active.");
  }
  if (operation.operationType !== "api_request") return issues;

  const url = readStringConfig(provider.config, "url");
  try {
    const parsedUrl = new URL(url ?? "");
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Unsupported protocol.");
    }
  } catch {
    issues.push("The API endpoint must be a valid HTTP or HTTPS URL.");
  }

  const method =
    readStringConfig(provider.config, "method")?.toUpperCase() ?? "POST";
  if (!HTTP_METHODS.includes(method as HttpMethod)) {
    issues.push("The API request method is invalid.");
  }
  if (
    provider.config.queryParameters !== undefined &&
    !isStringRecord(provider.config.queryParameters)
  ) {
    issues.push("Query parameters must contain named text values.");
  }
  if (
    provider.config.headers !== undefined &&
    !isHeaderRecord(provider.config.headers)
  ) {
    issues.push("Headers must contain named text values.");
  }

  for (const [label, mapping] of [
    ["Input", operation.inputMapping],
    ["Output", operation.outputMapping],
  ] as const) {
    if (!isStringRecord(mapping)) {
      issues.push(`${label} mapping must contain named field paths.`);
      continue;
    }
    if (
      Object.entries(mapping).some(
        ([target, source]) =>
          hasUnsafeMappingPath(target) || hasUnsafeMappingPath(String(source)),
      )
    ) {
      issues.push(`${label} mapping contains an unsafe field path.`);
    }
  }
  if (
    Object.keys(operation.outputMapping).some(
      (target) =>
        !target.startsWith("fields.") &&
        !target.startsWith("contactAttributes."),
    )
  ) {
    issues.push(
      "Output mapping targets must start with fields. or contactAttributes..",
    );
  }

  const customStatusCodes = operation.settings.customStatusCodes;
  if (
    customStatusCodes !== undefined &&
    (!Array.isArray(customStatusCodes) ||
      customStatusCodes.some(
        (status) =>
          typeof status !== "number" ||
          !Number.isInteger(status) ||
          status < 100 ||
          status > 599,
      ) ||
      new Set(customStatusCodes).size !== customStatusCodes.length)
  ) {
    issues.push(
      "Custom HTTP status outputs must be unique codes from 100 to 599.",
    );
  }

  return issues;
}

export async function getOperationCredentialIssues(
  context: NonNullable<Awaited<ReturnType<typeof getProjectOperation>>>,
) {
  const missing = await listMissingProviderSecretNames({
    config: context.provider.config,
    projectId: context.operation.projectId,
    providerId: context.provider.id,
  });
  return missing.map(
    (name) =>
      `The API credential ${name} is unavailable and must be saved again.`,
  );
}

export async function listOperationAttemptsForSubmission(
  projectId: number,
  submissionId: number,
) {
  return db
    .select()
    .from(operationAttempts)
    .where(
      and(
        eq(operationAttempts.projectId, projectId),
        eq(operationAttempts.submissionId, submissionId),
      ),
    )
    .orderBy(asc(operationAttempts.createdAt), asc(operationAttempts.id));
}

export async function listOperationAttemptsWithDetailsForSubmission(
  projectId: number,
  submissionId: number,
) {
  return db
    .select({
      attempt: operationAttempts,
      operation: operations,
      provider: integrationProviders,
    })
    .from(operationAttempts)
    .innerJoin(operations, eq(operations.id, operationAttempts.operationId))
    .innerJoin(
      integrationProviders,
      eq(integrationProviders.id, operationAttempts.providerId),
    )
    .where(
      and(
        eq(operationAttempts.projectId, projectId),
        eq(operationAttempts.submissionId, submissionId),
        eq(operations.projectId, projectId),
        eq(integrationProviders.projectId, projectId),
      ),
    )
    .orderBy(asc(operationAttempts.createdAt), asc(operationAttempts.id));
}

export async function listOperationAttemptsWithDetailsForTaskRun(
  projectId: number,
  taskRunId: number,
) {
  return db
    .select({
      attempt: operationAttempts,
      operation: operations,
      provider: integrationProviders,
    })
    .from(operationAttempts)
    .innerJoin(operations, eq(operations.id, operationAttempts.operationId))
    .innerJoin(
      integrationProviders,
      eq(integrationProviders.id, operationAttempts.providerId),
    )
    .where(
      and(
        eq(operationAttempts.projectId, projectId),
        eq(operationAttempts.taskRunId, taskRunId),
        eq(operations.projectId, projectId),
        eq(integrationProviders.projectId, projectId),
      ),
    )
    .orderBy(asc(operationAttempts.createdAt), asc(operationAttempts.id));
}

export async function listRecentProjectOperationAttempts(
  projectId: number,
  limit = 10,
) {
  return listProjectOperationAttemptsWithDetails({ projectId, limit });
}

export async function listProjectOperationAttemptsWithDetails(input: {
  limit?: number;
  operationId?: number;
  projectId: number;
  status?: OperationAttemptStatus;
}) {
  const conditions = [
    eq(operationAttempts.projectId, input.projectId),
    eq(operations.projectId, input.projectId),
    eq(integrationProviders.projectId, input.projectId),
  ];

  if (input.operationId) {
    conditions.push(eq(operationAttempts.operationId, input.operationId));
  }

  if (input.status) {
    conditions.push(eq(operationAttempts.status, input.status));
  }

  return db
    .select({
      attempt: operationAttempts,
      operation: operations,
      provider: integrationProviders,
    })
    .from(operationAttempts)
    .innerJoin(operations, eq(operations.id, operationAttempts.operationId))
    .innerJoin(
      integrationProviders,
      eq(integrationProviders.id, operationAttempts.providerId),
    )
    .where(and(...conditions))
    .orderBy(desc(operationAttempts.createdAt), desc(operationAttempts.id))
    .limit(input.limit ?? 25);
}

export async function getProjectOperationAttemptWithDetails(
  projectId: number,
  attemptId: number,
) {
  const [row] = await db
    .select({
      attempt: operationAttempts,
      operation: operations,
      provider: integrationProviders,
    })
    .from(operationAttempts)
    .innerJoin(operations, eq(operations.id, operationAttempts.operationId))
    .innerJoin(
      integrationProviders,
      eq(integrationProviders.id, operationAttempts.providerId),
    )
    .where(
      and(
        eq(operationAttempts.projectId, projectId),
        eq(operationAttempts.id, attemptId),
        eq(operations.projectId, projectId),
        eq(integrationProviders.projectId, projectId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function reconcileOperationAttemptOutcome(input: {
  attemptId: number;
  errorMessage?: string | null;
  projectId: number;
  responsePayload?: Record<string, unknown>;
  status: "completed" | "failed";
}) {
  const [attempt] = await db
    .update(operationAttempts)
    .set({
      errorMessage:
        input.status === "completed" ? null : (input.errorMessage ?? null),
      finishedAt: new Date(),
      responsePayload: input.responsePayload ?? {},
      status: input.status,
    })
    .where(
      and(
        eq(operationAttempts.projectId, input.projectId),
        eq(operationAttempts.id, input.attemptId),
        eq(operationAttempts.status, "outcome_unknown"),
      ),
    )
    .returning();

  return attempt ?? null;
}

async function executeProvider(input: {
  config: Record<string, unknown>;
  idempotencyKey: string;
  projectId: number;
  providerId: number;
  providerType: string;
  operationType: string;
  payload: Record<string, unknown>;
}) {
  if (input.providerType === "manual_review") {
    return {
      status: "completed" as const,
      responsePayload: {
        mode: "manual_review",
        message: "Submission queued for manual staff review.",
      },
      errorMessage: undefined,
    };
  }

  if (input.providerType === "internal_save") {
    return {
      status: "completed" as const,
      responsePayload: {
        mode: "internal_save",
        message: "Submission saved for internal processing.",
      },
      errorMessage: undefined,
    };
  }

  if (input.providerType === "email") {
    return executeEmailProvider(
      input.config,
      input.payload,
      input.idempotencyKey,
    );
  }

  if (
    input.providerType === "webhook" ||
    input.providerType === "n8n_webhook"
  ) {
    return executeWebhookProvider(
      input.config,
      input.payload,
      input.idempotencyKey,
    );
  }

  if (input.providerType === "meta_conversions_api") {
    return executeMetaConversionsProvider(
      input.config,
      input.payload,
      input.idempotencyKey,
    );
  }

  if (input.providerType === "google_calendar") {
    return executeGoogleCalendarProviderOperation({
      config: input.config,
      identitySecret:
        process.env.GOOGLE_CALENDAR_IDENTITY_SECRET ??
        process.env.AUTH_SECRET ??
        "",
      idempotencyKey: input.idempotencyKey,
      operationType: input.operationType,
      payload: input.payload,
      projectId: input.projectId,
      providerId: input.providerId,
      store: googleCalendarAppointmentStore,
    });
  }

  return {
    status: "failed" as const,
    responsePayload: {},
    errorMessage: `Unsupported provider type: ${input.providerType}`,
  };
}

async function executeConfiguredProvider(input: {
  config: Record<string, unknown>;
  idempotencyKey: string;
  operationType: string;
  payload: Record<string, unknown>;
  projectId: number;
  providerId: number;
  providerType: string;
}) {
  const config = await hydrateProviderConfig({
    config: input.config,
    projectId: input.projectId,
    providerId: input.providerId,
  });

  return executeProvider({ ...input, config });
}

function readStringConfig(
  config: Record<string, unknown>,
  key: string,
): string | null {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumberConfig(
  config: Record<string, unknown>,
  key: string,
): number | null {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBooleanConfig(
  config: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = config[key];
  return typeof value === "boolean" ? value : null;
}

function readIntegerConfig(
  config: Record<string, unknown>,
  key: string,
): number | null {
  const value = readNumberConfig(config, key);
  return value === null ? null : Math.trunc(value);
}

function getRetryQueueConfig(config: Record<string, unknown>) {
  return {
    delayMs:
      clampInteger(
        readIntegerConfig(config, "autoRetryDelayMinutes") ?? 5,
        0,
        10080,
      ) * 60_000,
    enabled: readBooleanConfig(config, "autoRetryEnabled") === true,
    maxAttempts: clampInteger(
      readIntegerConfig(config, "autoRetryMaxAttempts") ?? 0,
      0,
      10,
    ),
  };
}

function readHeadersConfig(config: Record<string, unknown>) {
  const headers = config.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function readQueryParametersConfig(config: Record<string, unknown>) {
  const parameters = config.queryParameters;
  if (
    !parameters ||
    typeof parameters !== "object" ||
    Array.isArray(parameters)
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parameters).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function readHttpMethod(config: Record<string, unknown>): HttpMethod {
  const method = readStringConfig(config, "method")?.toUpperCase();
  return HTTP_METHODS.includes(method as HttpMethod)
    ? (method as HttpMethod)
    : "POST";
}

function buildSignature(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
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

function getMappedPayload(payload: Record<string, unknown>) {
  const mappedPayload = getRecordValue(payload, "payload");
  return mappedPayload ?? {};
}

function setNestedValue(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
) {
  let cursor = target;

  for (const [index, part] of path.entries()) {
    if (!part) {
      return;
    }

    if (index === path.length - 1) {
      cursor[part] = value;
      return;
    }

    const next = cursor[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[part] = {};
    }

    cursor = cursor[part] as Record<string, unknown>;
  }
}

function expandDottedPayload(payload: Record<string, unknown>) {
  const expanded: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    setNestedValue(expanded, key.split("."), value);
  }

  return expanded;
}

function readPayloadString(
  payload: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
) {
  const camelValue = payload[camelKey];
  if (typeof camelValue === "string" && camelValue.trim()) {
    return camelValue.trim();
  }

  const snakeValue = payload[snakeKey];
  return typeof snakeValue === "string" && snakeValue.trim()
    ? snakeValue.trim()
    : null;
}

function normalizeMetaPhone(value: string) {
  return value.replace(/\D/g, "");
}

function isSha256Hash(value: string) {
  return /^[a-f0-9]{64}$/i.test(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeMetaUserDataEntry(key: string, value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeMetaUserDataEntry(key, item));
  }

  if (typeof value !== "string") {
    return value;
  }

  if (isSha256Hash(value)) {
    return value.toLowerCase();
  }

  if (key === "em") {
    return sha256(value.trim().toLowerCase());
  }

  if (key === "ph") {
    return sha256(normalizeMetaPhone(value));
  }

  return value;
}

function normalizeMetaUserData(
  userData: Record<string, unknown>,
  shouldHash: boolean,
) {
  if (!shouldHash) {
    return userData;
  }

  return Object.fromEntries(
    Object.entries(userData).map(([key, value]) => [
      key,
      normalizeMetaUserDataEntry(key, value),
    ]),
  );
}

function removeKeys(record: Record<string, unknown>, keys: readonly string[]) {
  const keySet = new Set(keys);

  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !keySet.has(key)),
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function postWebhookAttempt(input: {
  body?: string;
  headers: Record<string, string>;
  method: HttpMethod;
  timeoutMs: number;
  url: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(input.url, {
      body: input.body,
      headers: input.headers,
      method: input.method,
      signal: controller.signal,
    });
    const responseText = await response.text();
    let parsedBody: unknown = responseText;

    try {
      parsedBody = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsedBody = responseText;
    }

    return {
      ok: response.ok,
      outcomeKnown: true,
      attemptPayload: {
        body: parsedBody,
        durationMs: Date.now() - startedAt,
        status: response.status,
        statusText: response.statusText,
      },
      errorMessage: response.ok
        ? undefined
        : `Webhook returned ${response.status}.`,
    };
  } catch (error) {
    const errorKind =
      error instanceof Error && error.name === "AbortError"
        ? "timeout"
        : "network_failure";
    return {
      ok: false,
      outcomeKnown: false,
      attemptPayload: {
        durationMs: Date.now() - startedAt,
        errorKind,
        error:
          error instanceof Error ? error.message : "Webhook request failed.",
      },
      errorMessage:
        error instanceof Error ? error.message : "Webhook request failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildWebhookRequest(input: {
  config: Record<string, unknown>;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}) {
  const url = readStringConfig(input.config, "url");
  if (!url) {
    throw new Error("Webhook provider requires config.url.");
  }

  const method = readHttpMethod(input.config);
  const urlWithQuery = new URL(url);
  for (const [key, value] of Object.entries(
    readQueryParametersConfig(input.config),
  )) {
    if (key.trim()) urlWithQuery.searchParams.set(key.trim(), value);
  }
  const body = method === "GET" ? undefined : JSON.stringify(input.payload);
  const secret = readStringConfig(input.config, "secret");
  const headers = {
    ...(body ? { "content-type": "application/json" } : {}),
    "idempotency-key": input.idempotencyKey,
    "x-lia-event": "operation.execute",
    ...(secret
      ? { "x-lia-signature": buildSignature(secret, body ?? "") }
      : {}),
    ...readHeadersConfig(input.config),
  };

  return {
    body,
    headers,
    method,
    url: urlWithQuery.toString(),
  };
}

async function executeWebhookProvider(
  config: Record<string, unknown>,
  payload: Record<string, unknown>,
  idempotencyKey: string,
) {
  const url = readStringConfig(config, "url");
  if (!url) {
    return {
      status: "failed" as const,
      responsePayload: {},
      errorMessage: "Webhook provider requires config.url.",
    };
  }

  const request = buildWebhookRequest({ config, idempotencyKey, payload });
  const timeoutMs = readNumberConfig(config, "timeoutMs") ?? 15_000;
  const retryCount = clampInteger(
    readIntegerConfig(config, "retryCount") ?? 0,
    0,
    5,
  );
  const retryDelayMs = clampInteger(
    readIntegerConfig(config, "retryDelayMs") ?? 1_000,
    0,
    30_000,
  );
  const attempts = [];
  let lastErrorMessage = "Webhook request failed.";
  let outcomeUnknown = false;
  let lastAttemptPayload: Record<string, unknown> = {};

  for (let attemptIndex = 0; attemptIndex <= retryCount; attemptIndex += 1) {
    if (attemptIndex > 0 && retryDelayMs > 0) {
      await sleep(retryDelayMs);
    }

    const result = await postWebhookAttempt({
      body: request.body,
      headers: request.headers,
      method: request.method,
      timeoutMs,
      url: request.url,
    });
    attempts.push({
      attempt: attemptIndex + 1,
      ...result.attemptPayload,
    });
    lastErrorMessage = result.errorMessage ?? lastErrorMessage;
    lastAttemptPayload = result.attemptPayload;
    outcomeUnknown ||= !result.outcomeKnown;

    if (result.ok) {
      return {
        status: "completed" as const,
        responsePayload: {
          attempts,
          finalAttempt: attemptIndex + 1,
          response: result.attemptPayload,
          retryCount,
        },
        errorMessage: undefined,
      };
    }
  }

  return {
    status: outcomeUnknown ? ("outcome_unknown" as const) : ("failed" as const),
    responsePayload: {
      attempts,
      finalAttempt: attempts.length,
      ...(typeof lastAttemptPayload.errorKind === "string"
        ? { errorKind: lastAttemptPayload.errorKind }
        : {}),
      response: lastAttemptPayload,
      retryCount,
    },
    errorMessage: lastErrorMessage,
  };
}

async function executeEmailProvider(
  config: Record<string, unknown>,
  payload: Record<string, unknown>,
  idempotencyKey: string,
) {
  const webhookUrl = readStringConfig(config, "webhookUrl");

  if (webhookUrl) {
    return executeWebhookProvider(
      { ...config, url: webhookUrl },
      payload,
      idempotencyKey,
    );
  }

  return {
    status: "failed" as const,
    responsePayload: {
      mode: "email",
      message:
        "No email transport is configured. Set provider config.webhookUrl to deliver through an email automation service.",
      payload,
    },
    errorMessage: "Email provider requires config.webhookUrl.",
  };
}

async function executeMetaConversionsProvider(
  config: Record<string, unknown>,
  payload: Record<string, unknown>,
  idempotencyKey: string,
) {
  const datasetId =
    readStringConfig(config, "datasetId") ??
    readStringConfig(config, "pixelId");
  const accessToken = readStringConfig(config, "accessToken");

  if (!datasetId || !accessToken) {
    return {
      status: "failed" as const,
      responsePayload: {},
      errorMessage:
        "Meta Conversions API provider requires config.datasetId and config.accessToken.",
    };
  }

  const mappedPayload = expandDottedPayload(getMappedPayload(payload));
  const eventName =
    readPayloadString(mappedPayload, "eventName", "event_name") ??
    readStringConfig(config, "eventName") ??
    "Lead";
  const actionSource =
    readPayloadString(mappedPayload, "actionSource", "action_source") ??
    readStringConfig(config, "actionSource") ??
    "website";
  const eventSourceUrl =
    readPayloadString(mappedPayload, "eventSourceUrl", "event_source_url") ??
    readStringConfig(config, "eventSourceUrl");
  const eventId =
    readPayloadString(mappedPayload, "eventId", "event_id") ??
    (typeof payload.submissionId === "number" ? idempotencyKey : null);
  const testEventCode =
    readPayloadString(mappedPayload, "testEventCode", "test_event_code") ??
    readStringConfig(config, "testEventCode");
  const apiVersion = readStringConfig(config, "apiVersion") ?? "v23.0";
  const rawUserData =
    getRecordValue(mappedPayload, "userData") ??
    getRecordValue(mappedPayload, "user_data") ??
    {};
  const explicitCustomData =
    getRecordValue(mappedPayload, "customData") ??
    getRecordValue(mappedPayload, "custom_data");
  const customData =
    explicitCustomData ??
    removeKeys(mappedPayload, [
      "actionSource",
      "action_source",
      "customData",
      "custom_data",
      "eventId",
      "event_id",
      "eventName",
      "event_name",
      "eventSourceUrl",
      "event_source_url",
      "eventTime",
      "event_time",
      "testEventCode",
      "test_event_code",
      "userData",
      "user_data",
    ]);
  const shouldHashUserData =
    readBooleanConfig(config, "hashUserData") !== false;
  const eventTimeValue = mappedPayload.eventTime ?? mappedPayload.event_time;
  const eventTime =
    typeof eventTimeValue === "number" && Number.isFinite(eventTimeValue)
      ? Math.trunc(eventTimeValue)
      : Math.floor(Date.now() / 1000);
  const eventPayload: Record<string, unknown> = {
    action_source: actionSource,
    event_name: eventName,
    event_time: eventTime,
    user_data: normalizeMetaUserData(rawUserData, shouldHashUserData),
  };

  if (eventId) {
    eventPayload.event_id = eventId;
  }

  if (eventSourceUrl) {
    eventPayload.event_source_url = eventSourceUrl;
  }

  if (Object.keys(customData).length > 0) {
    eventPayload.custom_data = customData;
  }

  const requestBody: Record<string, unknown> = {
    data: [eventPayload],
  };

  if (testEventCode) {
    requestBody.test_event_code = testEventCode;
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(
      `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(
        datasetId,
      )}/events`,
      {
        body: JSON.stringify(requestBody),
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    const responseText = await response.text();
    let responseBody: unknown = responseText;

    try {
      responseBody = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseBody = responseText;
    }

    return {
      status: response.ok ? ("completed" as const) : ("failed" as const),
      responsePayload: {
        body: responseBody,
        durationMs: Date.now() - startedAt,
        status: response.status,
        statusText: response.statusText,
      },
      errorMessage: response.ok
        ? undefined
        : `Meta Conversions API returned ${response.status}.`,
    };
  } catch (error) {
    return {
      status: "failed" as const,
      responsePayload: {
        durationMs: Date.now() - startedAt,
        error:
          error instanceof Error
            ? error.message
            : "Meta Conversions API request failed.",
      },
      errorMessage:
        error instanceof Error
          ? error.message
          : "Meta Conversions API request failed.",
    };
  }
}

async function addOperationSubmissionEvent(input: {
  projectId: number;
  submissionId: number;
  eventType: string;
  message: string;
  payload: Record<string, unknown>;
  traceId?: string | null;
}) {
  await db.insert(actionSubmissionEvents).values({
    projectId: input.projectId,
    submissionId: input.submissionId,
    eventType: input.eventType,
    traceId: input.traceId ?? null,
    message: input.message,
    payload: input.payload,
  });
}

export type OperationToolRunInput = {
  idempotencyKey: string;
  operationId: number;
  payload: Record<string, unknown>;
  projectId: number;
};

export async function runOperationForTool(input: OperationToolRunInput) {
  const operationContext = await getProjectOperation(
    input.projectId,
    input.operationId,
  );
  if (!operationContext) return null;
  const { operation, provider } = operationContext;
  if (operation.status !== "active" || provider.status !== "active") {
    return null;
  }

  const requestPayload = {
    idempotencyKey: input.idempotencyKey,
    operationType: operation.operationType,
    payload: input.payload,
  };
  const startedAt = new Date();
  const [created] = await db
    .insert(operationAttempts)
    .values({
      idempotencyKey: input.idempotencyKey,
      operationId: operation.id,
      projectId: input.projectId,
      providerId: provider.id,
      requestPayload,
      startedAt,
      status: "pending",
      traceId: resolveTraceId(),
    })
    .onConflictDoNothing()
    .returning();
  if (!created) {
    const [existing] = await db
      .select()
      .from(operationAttempts)
      .where(
        and(
          eq(operationAttempts.projectId, input.projectId),
          eq(operationAttempts.idempotencyKey, input.idempotencyKey),
          eq(operationAttempts.operationId, operation.id),
        ),
      )
      .limit(1);
    if (!existing || existing.status === "pending") {
      throw new Error("This operation tool call is already being processed.");
    }
    return getOperationAttemptToolResult({ attempt: existing, operation });
  }

  const result = await executeConfiguredProvider({
    config: provider.config,
    idempotencyKey: input.idempotencyKey,
    operationType: operation.operationType,
    payload: requestPayload,
    projectId: input.projectId,
    providerId: provider.id,
    providerType: provider.providerType,
  });
  const [completed] = await db
    .update(operationAttempts)
    .set({
      errorMessage: result.errorMessage ?? null,
      finishedAt: new Date(),
      responsePayload: result.responsePayload,
      status: result.status,
    })
    .where(
      and(
        eq(operationAttempts.id, created.id),
        eq(operationAttempts.projectId, input.projectId),
      ),
    )
    .returning();
  const attempt = completed ?? created;
  return getOperationAttemptToolResult({ attempt, operation });
}

export async function runOperationForHostedVoiceTool(
  input: OperationToolRunInput,
) {
  return runOperationForTool(input);
}

export async function runOperationForSubmission(input: {
  actionId: number;
  fields: Record<string, unknown>;
  idempotencyKey: string;
  operationId: number;
  projectId: number;
  submissionId: number;
  traceId?: string | null;
}): Promise<OperationRunResult | null> {
  const operationContext = await getProjectOperation(
    input.projectId,
    input.operationId,
  );

  if (!operationContext) {
    return null;
  }

  const { operation, provider } = operationContext;
  if (operation.status !== "active" || provider.status !== "active") {
    return null;
  }

  const requestPayload = {
    idempotencyKey: input.idempotencyKey,
    operationType: operation.operationType,
    submissionId: input.submissionId,
    payload: buildInputPayload(input.fields, operation.inputMapping),
  };
  const startedAt = new Date();
  const traceId = resolveTraceId(input.traceId);
  const [createdAttempt] = await db
    .insert(operationAttempts)
    .values({
      projectId: input.projectId,
      operationId: operation.id,
      providerId: provider.id,
      actionId: input.actionId,
      submissionId: input.submissionId,
      idempotencyKey: input.idempotencyKey,
      traceId,
      status: "pending",
      requestPayload,
      startedAt,
    })
    .onConflictDoNothing()
    .returning();

  if (!createdAttempt) {
    const [existingAttempt] = await db
      .select()
      .from(operationAttempts)
      .where(
        and(
          eq(operationAttempts.projectId, input.projectId),
          eq(operationAttempts.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (!existingAttempt) {
      throw new Error("Could not reserve the operation attempt.");
    }

    if (existingAttempt.status === "pending") {
      throw new Error("This operation is already being processed.");
    }

    if (
      existingAttempt.status !== "completed" &&
      existingAttempt.status !== "failed"
    ) {
      throw new Error("This operation attempt has an invalid status.");
    }

    const replayOutput = buildOutputPayload({
      attemptId: existingAttempt.id,
      errorMessage: existingAttempt.errorMessage,
      outputMapping: operation.outputMapping,
      requestPayload: existingAttempt.requestPayload,
      responsePayload: existingAttempt.responsePayload,
      status: existingAttempt.status,
    });

    return {
      attempt: existingAttempt,
      contactAttributes: replayOutput.contactAttributes,
      fields: replayOutput.fields,
      outcome: getOperationResultOutcome({
        attempt: existingAttempt,
        operation,
      }),
    };
  }

  const attempt = createdAttempt;

  const result = await executeConfiguredProvider({
    config: provider.config,
    idempotencyKey: input.idempotencyKey,
    projectId: input.projectId,
    providerId: provider.id,
    providerType: provider.providerType,
    operationType: operation.operationType,
    payload: requestPayload,
  });
  const finishedAt = new Date();
  const [updatedAttempt] = await db
    .update(operationAttempts)
    .set({
      status: result.status,
      responsePayload: result.responsePayload,
      errorMessage: result.errorMessage ?? null,
      finishedAt,
    })
    .where(
      and(
        eq(operationAttempts.projectId, input.projectId),
        eq(operationAttempts.id, attempt.id),
      ),
    )
    .returning();

  const finalAttempt = updatedAttempt ?? attempt;
  const output = buildOutputPayload({
    attemptId: finalAttempt.id,
    errorMessage: result.errorMessage ?? null,
    outputMapping: operation.outputMapping,
    requestPayload,
    responsePayload: result.responsePayload,
    status: result.status,
  });

  await addOperationSubmissionEvent({
    projectId: input.projectId,
    submissionId: input.submissionId,
    eventType:
      result.status === "completed"
        ? "operation.completed"
        : "operation.failed",
    message:
      result.status === "completed"
        ? `Operation "${operation.name}" completed.`
        : `Operation "${operation.name}" failed.`,
    payload: {
      operationId: operation.id,
      operationType: operation.operationType,
      providerId: provider.id,
      providerType: provider.providerType,
      attemptId: finalAttempt.id,
      mappedContactAttributeKeys: Object.keys(output.contactAttributes),
      mappedFieldKeys: Object.keys(output.fields),
    },
    traceId,
  });

  return {
    attempt: finalAttempt,
    contactAttributes: output.contactAttributes,
    fields: output.fields,
    outcome: getOperationResultOutcome({ attempt: finalAttempt, operation }),
  };
}

export async function queueOperationForSubmission(input: {
  actionId: number;
  fields: Record<string, unknown>;
  idempotencyKey: string;
  operationId: number;
  projectId: number;
  submissionId: number;
  traceId?: string | null;
}) {
  const operationContext = await getProjectOperation(
    input.projectId,
    input.operationId,
  );

  if (!operationContext) {
    return null;
  }

  const { operation, provider } = operationContext;
  if (operation.status !== "active" || provider.status !== "active") {
    return null;
  }

  const traceId = resolveTraceId(input.traceId);
  const requestPayload = {
    idempotencyKey: input.idempotencyKey,
    operationType: operation.operationType,
    submissionId: input.submissionId,
    payload: buildInputPayload(input.fields, operation.inputMapping),
  };
  const retryConfig = getRetryQueueConfig(provider.config);
  const maxAttempts = retryConfig.enabled ? retryConfig.maxAttempts + 1 : 1;

  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .insert(operationAttempts)
      .values({
        actionId: input.actionId,
        idempotencyKey: input.idempotencyKey,
        operationId: operation.id,
        projectId: input.projectId,
        providerId: provider.id,
        requestPayload,
        status: "pending",
        submissionId: input.submissionId,
        traceId,
      })
      .onConflictDoNothing()
      .returning();
    const reservedAttempt =
      attempt ??
      (
        await tx
          .select()
          .from(operationAttempts)
          .where(
            and(
              eq(operationAttempts.projectId, input.projectId),
              eq(operationAttempts.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1)
      )[0];

    if (!reservedAttempt) {
      throw new Error("Could not reserve the queued operation attempt.");
    }

    const [job] = await tx
      .insert(durableJobs)
      .values({
        dedupeKey: input.idempotencyKey,
        jobType: "operation_delivery",
        maxAttempts,
        operationAttemptId: reservedAttempt.id,
        payload: { operationAttemptId: reservedAttempt.id },
        projectId: input.projectId,
        submissionId: input.submissionId,
        traceId: reservedAttempt.traceId ?? traceId,
      })
      .onConflictDoNothing()
      .returning();
    const reservedJob =
      job ??
      (
        await tx
          .select()
          .from(durableJobs)
          .where(
            and(
              eq(durableJobs.projectId, input.projectId),
              eq(durableJobs.jobType, "operation_delivery"),
              eq(durableJobs.dedupeKey, input.idempotencyKey),
            ),
          )
          .limit(1)
      )[0];

    if (!reservedJob) {
      throw new Error("Could not reserve the durable operation job.");
    }

    return {
      attempt: reservedAttempt,
      created: Boolean(attempt && job),
      job: reservedJob,
    };
  });
}

export async function queueOperationForConversationalTask(input: {
  confirmationId: number;
  idempotencyKey: string;
  operationId: number;
  payload: Record<string, unknown>;
  projectId: number;
  taskRunId: number;
  taskToolRequestId: number;
  taskVersionId: number;
  traceId?: string | null;
}) {
  const operationContext = await getProjectOperation(
    input.projectId,
    input.operationId,
  );
  if (!operationContext) return null;

  const { operation, provider } = operationContext;
  if (operation.status !== "active" || provider.status !== "active") {
    return null;
  }

  const traceId = resolveTraceId(input.traceId);
  const requestPayload = {
    idempotencyKey: input.idempotencyKey,
    operationType: operation.operationType,
    payload: input.payload,
    taskRunId: input.taskRunId,
    taskVersionId: input.taskVersionId,
    toolRequestId: input.taskToolRequestId,
  };
  const retryConfig = getRetryQueueConfig(provider.config);
  const maxAttempts = retryConfig.enabled ? retryConfig.maxAttempts + 1 : 1;

  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .insert(operationAttempts)
      .values({
        idempotencyKey: input.idempotencyKey,
        operationId: operation.id,
        projectId: input.projectId,
        providerId: provider.id,
        requestPayload,
        status: "pending",
        taskConfirmationId: input.confirmationId,
        taskRunId: input.taskRunId,
        taskToolRequestId: input.taskToolRequestId,
        taskVersionId: input.taskVersionId,
        traceId,
      })
      .onConflictDoNothing()
      .returning();
    const reservedAttempt =
      attempt ??
      (
        await tx
          .select()
          .from(operationAttempts)
          .where(
            and(
              eq(operationAttempts.projectId, input.projectId),
              eq(operationAttempts.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1)
      )[0];
    if (
      !reservedAttempt ||
      reservedAttempt.taskRunId !== input.taskRunId ||
      reservedAttempt.taskVersionId !== input.taskVersionId ||
      reservedAttempt.taskToolRequestId !== input.taskToolRequestId ||
      reservedAttempt.taskConfirmationId !== input.confirmationId
    ) {
      throw new Error("Could not reserve the task operation attempt.");
    }

    const [job] = await tx
      .insert(durableJobs)
      .values({
        dedupeKey: input.idempotencyKey,
        jobType: "operation_delivery",
        maxAttempts,
        operationAttemptId: reservedAttempt.id,
        payload: { operationAttemptId: reservedAttempt.id },
        projectId: input.projectId,
        traceId: reservedAttempt.traceId ?? traceId,
      })
      .onConflictDoNothing()
      .returning();
    const reservedJob =
      job ??
      (
        await tx
          .select()
          .from(durableJobs)
          .where(
            and(
              eq(durableJobs.projectId, input.projectId),
              eq(durableJobs.jobType, "operation_delivery"),
              eq(durableJobs.dedupeKey, input.idempotencyKey),
            ),
          )
          .limit(1)
      )[0];
    if (!reservedJob) {
      throw new Error("Could not reserve the durable task operation job.");
    }

    return {
      attempt: reservedAttempt,
      created: Boolean(attempt && job),
      job: reservedJob,
    };
  });
}

async function recordDurableOperationResult(input: {
  attempt: SelectOperationAttempt;
  errorMessage?: string | null;
  final: boolean;
  operation: SelectOperation;
  projectId: number;
  providerType: string;
  responsePayload: Record<string, unknown>;
  status: "completed" | "failed" | "outcome_unknown";
  traceId: string;
}) {
  const finishedAt = input.final ? new Date() : null;
  const [attempt] = await db
    .update(operationAttempts)
    .set({
      errorMessage: input.errorMessage ?? null,
      finishedAt,
      responsePayload: input.responsePayload,
      status: input.final ? input.status : "pending",
    })
    .where(
      and(
        eq(operationAttempts.projectId, input.projectId),
        eq(operationAttempts.id, input.attempt.id),
      ),
    )
    .returning();

  if (input.final) {
    await addDurableOperationResultEvent(input);
  }

  return attempt ?? input.attempt;
}

function getDurableOperationResultEvent(input: {
  attempt: SelectOperationAttempt;
  operation: SelectOperation;
  projectId: number;
  providerType: string;
  status: "completed" | "failed" | "outcome_unknown";
  traceId: string;
}) {
  if (!input.attempt.submissionId) {
    return null;
  }

  return {
    eventType:
      input.status === "completed"
        ? "operation.completed"
        : input.status === "outcome_unknown"
          ? "operation.outcome_unknown"
          : "operation.failed",
    message:
      input.status === "completed"
        ? `Operation "${input.operation.name}" completed.`
        : input.status === "outcome_unknown"
          ? `Operation "${input.operation.name}" needs reconciliation.`
          : `Operation "${input.operation.name}" failed after durable retries.`,
    payload: {
      attemptId: input.attempt.id,
      operationId: input.operation.id,
      operationType: input.operation.operationType,
      providerId: input.attempt.providerId,
      providerType: input.providerType,
    },
    projectId: input.projectId,
    submissionId: input.attempt.submissionId,
    traceId: input.traceId,
  };
}

async function addDurableOperationResultEvent(input: {
  attempt: SelectOperationAttempt;
  operation: SelectOperation;
  projectId: number;
  providerType: string;
  status: "completed" | "failed" | "outcome_unknown";
  traceId: string;
}) {
  const event = getDurableOperationResultEvent(input);
  if (event) {
    await addOperationSubmissionEvent(event);
  }
}

async function finalizeDurableOperationResult(input: {
  attempt: SelectOperationAttempt;
  errorMessage?: string | null;
  jobId: number;
  operation: SelectOperation;
  projectId: number;
  providerType: string;
  responsePayload: Record<string, unknown>;
  status: "completed" | "outcome_unknown";
  traceId: string;
  workerId: string;
}) {
  const finishedAt = new Date();
  const finalizedAttempt = await db.transaction(async (tx) => {
    const [completedJob] = await tx
      .update(durableJobs)
      .set({
        completedAt: finishedAt,
        lastError: null,
        leaseExpiresAt: null,
        leaseOwner: null,
        result: {
          operationAttemptId: input.attempt.id,
          status: input.status,
        },
        status: "completed",
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(durableJobs.projectId, input.projectId),
          eq(durableJobs.id, input.jobId),
          eq(durableJobs.status, "processing"),
          eq(durableJobs.leaseOwner, input.workerId.trim()),
        ),
      )
      .returning();

    if (!completedJob) {
      return null;
    }

    const [attempt] = await tx
      .update(operationAttempts)
      .set({
        errorMessage: input.errorMessage ?? null,
        finishedAt,
        responsePayload: input.responsePayload,
        status: input.status,
      })
      .where(
        and(
          eq(operationAttempts.projectId, input.projectId),
          eq(operationAttempts.id, input.attempt.id),
        ),
      )
      .returning();

    if (!attempt) {
      throw new Error("Durable operation attempt was not found.");
    }

    const event = getDurableOperationResultEvent({
      ...input,
      attempt,
    });
    if (event) {
      await tx.insert(actionSubmissionEvents).values(event);
    }

    return attempt;
  });

  if (!finalizedAttempt) {
    return null;
  }

  return finalizedAttempt;
}

export async function processProjectDurableOperationQueue(input: {
  maxJobs?: number;
  projectId: number;
  workerId: string;
}): Promise<DurableOperationQueueResult> {
  const maxJobs = clampInteger(input.maxJobs ?? 5, 1, 25);
  let completed = 0;
  let failed = 0;
  let processed = 0;
  let rescheduled = 0;

  for (let index = 0; index < maxJobs; index += 1) {
    const job = await claimNextDurableJob({
      jobTypes: ["operation_delivery"],
      projectId: input.projectId,
      workerId: input.workerId,
    });

    if (!job) {
      break;
    }

    processed += 1;

    try {
      if (!job.operationAttemptId) {
        throw new Error("Durable operation job has no operation attempt.");
      }

      const context = await getProjectOperationAttemptWithDetails(
        input.projectId,
        job.operationAttemptId,
      );
      if (!context) {
        throw new Error("Durable operation attempt was not found.");
      }

      const { attempt, operation, provider } = context;
      if (attempt.status === "completed") {
        const completedJob = await completeDurableJob({
          jobId: job.id,
          projectId: input.projectId,
          result: { operationAttemptId: attempt.id, status: attempt.status },
          workerId: input.workerId,
        });
        if (completedJob) {
          completed += 1;
        }
        continue;
      }

      if (operation.status !== "active" || provider.status !== "active") {
        throw new Error("The operation or provider is no longer active.");
      }

      if (!attempt.startedAt) {
        await db
          .update(operationAttempts)
          .set({ startedAt: new Date() })
          .where(
            and(
              eq(operationAttempts.projectId, input.projectId),
              eq(operationAttempts.id, attempt.id),
              eq(operationAttempts.status, "pending"),
            ),
          );
      }

      const result = await executeConfiguredProvider({
        config: provider.config,
        idempotencyKey: attempt.idempotencyKey ?? job.dedupeKey,
        operationType: operation.operationType,
        payload: attempt.requestPayload,
        projectId: input.projectId,
        providerId: provider.id,
        providerType: provider.providerType,
      });

      if (result.status === "completed") {
        const finalizedAttempt = await finalizeDurableOperationResult({
          attempt,
          jobId: job.id,
          operation,
          projectId: input.projectId,
          providerType: provider.providerType,
          responsePayload: result.responsePayload,
          status: "completed",
          traceId: job.traceId,
          workerId: input.workerId,
        });
        if (finalizedAttempt) {
          completed += 1;
        }
        continue;
      }

      if (result.status === "outcome_unknown") {
        const finalizedAttempt = await finalizeDurableOperationResult({
          attempt,
          errorMessage:
            result.errorMessage ?? "The provider outcome is unknown.",
          jobId: job.id,
          operation,
          projectId: input.projectId,
          providerType: provider.providerType,
          responsePayload: result.responsePayload,
          status: "outcome_unknown",
          traceId: job.traceId,
          workerId: input.workerId,
        });
        if (finalizedAttempt) {
          failed += 1;
        }
        continue;
      }

      const failedJob = await failDurableJob({
        errorMessage: result.errorMessage ?? "Operation delivery failed.",
        jobId: job.id,
        projectId: input.projectId,
        workerId: input.workerId,
      });
      if (!failedJob) {
        continue;
      }
      const exhausted = failedJob.status === "failed";
      await recordDurableOperationResult({
        attempt,
        errorMessage: result.errorMessage,
        final: exhausted,
        operation,
        projectId: input.projectId,
        providerType: provider.providerType,
        responsePayload: result.responsePayload,
        status: "failed",
        traceId: job.traceId,
      });

      if (exhausted) {
        failed += 1;
      } else {
        rescheduled += 1;
      }
    } catch (error) {
      const failedJob = await failDurableJob({
        errorMessage:
          error instanceof Error ? error.message : "Durable operation failed.",
        jobId: job.id,
        projectId: input.projectId,
        workerId: input.workerId,
      });

      if (!failedJob) {
        continue;
      }

      if (failedJob.status === "failed") {
        if (job.operationAttemptId) {
          await db
            .update(operationAttempts)
            .set({
              errorMessage: failedJob.lastError,
              finishedAt: new Date(),
              status: "failed",
            })
            .where(
              and(
                eq(operationAttempts.projectId, input.projectId),
                eq(operationAttempts.id, job.operationAttemptId),
              ),
            );
        }
        failed += 1;
      } else {
        rescheduled += 1;
      }
    }
  }

  return {
    completed,
    failed,
    idle: processed === 0,
    processed,
    rescheduled,
  };
}

export async function runOperationPreview(input: {
  fields: Record<string, unknown>;
  operationId: number;
  projectId: number;
}) {
  const operationContext = await getProjectOperation(
    input.projectId,
    input.operationId,
  );

  if (!operationContext) {
    return null;
  }

  const { operation, provider } = operationContext;
  if (operation.status !== "active" || provider.status !== "active") {
    return null;
  }

  const requestPayload = {
    operationType: operation.operationType,
    preview: true,
    payload: buildInputPayload(input.fields, operation.inputMapping),
  };
  const startedAt = new Date();
  const idempotencyKey = `preview:${input.projectId}:${operation.id}:${startedAt.getTime()}`;
  const traceId = resolveTraceId();
  const [attempt] = await db
    .insert(operationAttempts)
    .values({
      projectId: input.projectId,
      operationId: operation.id,
      providerId: provider.id,
      actionId: null,
      submissionId: null,
      idempotencyKey,
      traceId,
      status: "pending",
      requestPayload,
      startedAt,
    })
    .returning();

  const result = await executeConfiguredProvider({
    config: provider.config,
    idempotencyKey,
    projectId: input.projectId,
    providerId: provider.id,
    providerType: provider.providerType,
    operationType: operation.operationType,
    payload: requestPayload,
  });
  const finishedAt = new Date();
  const [updatedAttempt] = await db
    .update(operationAttempts)
    .set({
      status: result.status,
      responsePayload: result.responsePayload,
      errorMessage: result.errorMessage ?? null,
      finishedAt,
    })
    .where(
      and(
        eq(operationAttempts.projectId, input.projectId),
        eq(operationAttempts.id, attempt.id),
      ),
    )
    .returning();
  const finalAttempt = updatedAttempt ?? attempt;
  const output = buildOutputPayload({
    attemptId: finalAttempt.id,
    errorMessage: result.errorMessage ?? null,
    outputMapping: operation.outputMapping,
    requestPayload,
    responsePayload: result.responsePayload,
    status: result.status,
  });

  return {
    attempt: finalAttempt,
    contactAttributes: output.contactAttributes,
    fields: output.fields,
    outcome: getOperationResultOutcome({ attempt: finalAttempt, operation }),
  };
}

export async function replayOperationAttempt(input: {
  attemptId: number;
  mode?: "auto_retry" | "manual";
  projectId: number;
}) {
  const operationContext = await getProjectOperationAttemptWithDetails(
    input.projectId,
    input.attemptId,
  );

  if (!operationContext) {
    return null;
  }

  const { attempt: sourceAttempt, operation, provider } = operationContext;
  if (operation.status !== "active" || provider.status !== "active") {
    return null;
  }

  const requestPayload = {
    ...sourceAttempt.requestPayload,
    replay: {
      requestedAt: new Date().toISOString(),
      requestedBy: input.mode ?? "manual",
      sourceAttemptId: sourceAttempt.id,
    },
  };
  const startedAt = new Date();
  const idempotencyKey = `replay:${sourceAttempt.id}:${startedAt.getTime()}`;
  const providerIdempotencyKey =
    provider.providerType === "google_calendar" &&
    sourceAttempt.status === "outcome_unknown" &&
    sourceAttempt.idempotencyKey
      ? sourceAttempt.idempotencyKey
      : idempotencyKey;
  const [attempt] = await db
    .insert(operationAttempts)
    .values({
      projectId: input.projectId,
      operationId: operation.id,
      providerId: provider.id,
      actionId: sourceAttempt.actionId,
      submissionId: sourceAttempt.submissionId,
      idempotencyKey,
      traceId: sourceAttempt.traceId,
      status: "pending",
      requestPayload,
      startedAt,
    })
    .returning();

  const result = await executeConfiguredProvider({
    config: provider.config,
    idempotencyKey: providerIdempotencyKey,
    projectId: input.projectId,
    providerId: provider.id,
    providerType: provider.providerType,
    operationType: operation.operationType,
    payload: requestPayload,
  });
  const finishedAt = new Date();
  const [updatedAttempt] = await db
    .update(operationAttempts)
    .set({
      status: result.status,
      responsePayload: result.responsePayload,
      errorMessage: result.errorMessage ?? null,
      finishedAt,
    })
    .where(
      and(
        eq(operationAttempts.projectId, input.projectId),
        eq(operationAttempts.id, attempt.id),
      ),
    )
    .returning();

  const finalAttempt = updatedAttempt ?? attempt;
  const output = buildOutputPayload({
    attemptId: finalAttempt.id,
    errorMessage: result.errorMessage ?? null,
    outputMapping: operation.outputMapping,
    requestPayload,
    responsePayload: result.responsePayload,
    status: result.status,
  });

  if (sourceAttempt.submissionId) {
    await addOperationSubmissionEvent({
      projectId: input.projectId,
      submissionId: sourceAttempt.submissionId,
      eventType:
        result.status === "completed"
          ? "operation.replay_completed"
          : "operation.replay_failed",
      message:
        result.status === "completed"
          ? `Operation "${operation.name}" replay completed.`
          : `Operation "${operation.name}" replay failed.`,
      payload: {
        operationId: operation.id,
        operationType: operation.operationType,
        providerId: provider.id,
        providerType: provider.providerType,
        attemptId: finalAttempt.id,
        sourceAttemptId: sourceAttempt.id,
        mappedContactAttributeKeys: Object.keys(output.contactAttributes),
        mappedFieldKeys: Object.keys(output.fields),
      },
      traceId: sourceAttempt.traceId,
    });
  }

  return {
    attempt: finalAttempt,
    contactAttributes: output.contactAttributes,
    fields: output.fields,
    outcome: getOperationResultOutcome({ attempt: finalAttempt, operation }),
    sourceAttempt,
  };
}

export async function processProjectOperationRetryQueue(input: {
  maxAttempts?: number;
  projectId: number;
}): Promise<OperationRetryQueueResult> {
  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? 5, 25));
  const candidates = await db
    .select({
      attempt: operationAttempts,
      operation: operations,
      provider: integrationProviders,
    })
    .from(operationAttempts)
    .innerJoin(operations, eq(operations.id, operationAttempts.operationId))
    .innerJoin(
      integrationProviders,
      eq(integrationProviders.id, operationAttempts.providerId),
    )
    .where(
      and(
        eq(operationAttempts.projectId, input.projectId),
        eq(operationAttempts.status, "failed"),
        eq(operations.projectId, input.projectId),
        eq(operations.status, "active"),
        eq(integrationProviders.projectId, input.projectId),
        eq(integrationProviders.status, "active"),
      ),
    )
    .orderBy(asc(operationAttempts.createdAt), asc(operationAttempts.id))
    .limit(100);
  const recentAttempts = await listProjectOperationAttemptsWithDetails({
    projectId: input.projectId,
    limit: 500,
  });
  const replayStats = new Map<number, RetryQueueReplayStats>();

  for (const row of recentAttempts) {
    const sourceAttemptId = getOperationAttemptReplaySourceId(
      row.attempt.requestPayload,
    );

    if (!sourceAttemptId) {
      continue;
    }

    const existing = replayStats.get(sourceAttemptId) ?? {
      completed: false,
      count: 0,
    };
    replayStats.set(sourceAttemptId, {
      completed: existing.completed || row.attempt.status === "completed",
      count: existing.count + 1,
    });
  }

  let completed = 0;
  let failed = 0;
  let processed = 0;
  let skipped = 0;
  const now = Date.now();

  for (const { attempt, provider } of candidates) {
    if (processed >= maxAttempts) {
      break;
    }

    const retryConfig = getRetryQueueConfig(provider.config);
    const existingReplay = replayStats.get(attempt.id);
    const failedAt =
      attempt.finishedAt ?? attempt.startedAt ?? attempt.createdAt;
    const dueAt = failedAt.getTime() + retryConfig.delayMs;

    if (
      !retryConfig.enabled ||
      retryConfig.maxAttempts <= 0 ||
      !attempt.submissionId ||
      getOperationAttemptReplaySourceId(attempt.requestPayload) ||
      existingReplay?.completed ||
      (existingReplay?.count ?? 0) >= retryConfig.maxAttempts ||
      dueAt > now
    ) {
      skipped += 1;
      continue;
    }

    const replay = await replayOperationAttempt({
      attemptId: attempt.id,
      mode: "auto_retry",
      projectId: input.projectId,
    });

    if (!replay) {
      skipped += 1;
      continue;
    }

    processed += 1;
    const updatedReplayStats = replayStats.get(attempt.id) ?? {
      completed: false,
      count: 0,
    };
    replayStats.set(attempt.id, {
      completed:
        updatedReplayStats.completed || replay.attempt.status === "completed",
      count: updatedReplayStats.count + 1,
    });

    if (replay.attempt.status === "completed") {
      completed += 1;
    } else {
      failed += 1;
    }
  }

  return {
    completed,
    failed,
    idle: processed === 0,
    processed,
    skipped,
  };
}

export async function runSubmissionOperations(
  projectId: number,
  submissionId: number,
) {
  const [submission] = await db
    .select()
    .from(actionSubmissions)
    .where(
      and(
        eq(actionSubmissions.projectId, projectId),
        eq(actionSubmissions.id, submissionId),
      ),
    )
    .limit(1);

  if (!submission) {
    return [];
  }

  const operationSteps = await db
    .select({
      step: actionFlowSteps,
      operation: operations,
      provider: integrationProviders,
    })
    .from(actionFlowSteps)
    .innerJoin(operations, eq(operations.id, actionFlowSteps.operationId))
    .innerJoin(
      integrationProviders,
      eq(integrationProviders.id, operations.providerId),
    )
    .where(
      and(
        eq(actionFlowSteps.projectId, projectId),
        eq(actionFlowSteps.actionId, submission.actionId),
        eq(actionFlowSteps.stepType, "operation"),
        eq(actionFlowSteps.isEnabled, true),
        isNotNull(actionFlowSteps.operationId),
        eq(operations.projectId, projectId),
        eq(operations.status, "active"),
        eq(integrationProviders.projectId, projectId),
        eq(integrationProviders.status, "active"),
      ),
    )
    .orderBy(asc(actionFlowSteps.sortOrder), asc(actionFlowSteps.id));

  const attempts = [];
  for (const row of operationSteps) {
    if (row.step.settings.operationExecutionMode === "inline") {
      continue;
    }

    const queued = await queueOperationForSubmission({
      projectId,
      actionId: submission.actionId,
      submissionId: submission.id,
      idempotencyKey: `submission:${submission.id}:step:${row.step.id}`,
      operationId: row.operation.id,
      fields: submission.fields,
      traceId: submission.traceId,
    });

    if (queued) {
      attempts.push(queued.attempt);
    }
  }

  if (attempts.length > 0) {
    await processProjectDurableOperationQueue({
      maxJobs: attempts.length,
      projectId,
      workerId: `submission:${submission.id}:${Date.now()}`,
    });
  }

  return attempts;
}
