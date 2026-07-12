import { createHash, createHmac } from "node:crypto";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db-config";
import {
  actionFlowSteps,
  actionSubmissionEvents,
  actionSubmissions,
  integrationProviders,
  operationAttempts,
  operations,
  type SelectOperation,
  type SelectOperationAttempt,
} from "@/lib/db-schema";

export const INTEGRATION_PROVIDER_TYPES = [
  "manual_review",
  "internal_save",
  "email",
  "webhook",
  "n8n_webhook",
  "meta_conversions_api",
] as const;
export const INTEGRATION_PROVIDER_STATUSES = ["active", "disabled"] as const;
export const OPERATION_STATUSES = ["active", "disabled"] as const;
export const OPERATION_ATTEMPT_STATUSES = [
  "pending",
  "completed",
  "failed",
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
};

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

export async function createIntegrationProvider(
  input: CreateIntegrationProviderInput,
) {
  const [provider] = await db
    .insert(integrationProviders)
    .values({
      projectId: input.projectId,
      name: input.name,
      providerType: input.providerType,
      status: input.status ?? "active",
      config: input.config ?? {},
      updatedAt: new Date(),
    })
    .returning();

  return provider;
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

async function executeProvider(input: {
  config: Record<string, unknown>;
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
    return executeEmailProvider(input.config, input.payload);
  }

  if (
    input.providerType === "webhook" ||
    input.providerType === "n8n_webhook"
  ) {
    return executeWebhookProvider(input.config, input.payload);
  }

  if (input.providerType === "meta_conversions_api") {
    return executeMetaConversionsProvider(input.config, input.payload);
  }

  return {
    status: "failed" as const,
    responsePayload: {},
    errorMessage: `Unsupported provider type: ${input.providerType}`,
  };
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
  body: string;
  headers: Record<string, string>;
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
      method: "POST",
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
    return {
      ok: false,
      attemptPayload: {
        durationMs: Date.now() - startedAt,
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

async function executeWebhookProvider(
  config: Record<string, unknown>,
  payload: Record<string, unknown>,
) {
  const url = readStringConfig(config, "url");
  if (!url) {
    return {
      status: "failed" as const,
      responsePayload: {},
      errorMessage: "Webhook provider requires config.url.",
    };
  }

  const body = JSON.stringify(payload);
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
  const secret = readStringConfig(config, "secret");
  const headers = {
    "content-type": "application/json",
    "x-lia-event": "operation.execute",
    ...(secret ? { "x-lia-signature": buildSignature(secret, body) } : {}),
    ...readHeadersConfig(config),
  };
  const attempts = [];
  let lastErrorMessage = "Webhook request failed.";

  for (let attemptIndex = 0; attemptIndex <= retryCount; attemptIndex += 1) {
    if (attemptIndex > 0 && retryDelayMs > 0) {
      await sleep(retryDelayMs);
    }

    const result = await postWebhookAttempt({
      body,
      headers,
      timeoutMs,
      url,
    });
    attempts.push({
      attempt: attemptIndex + 1,
      ...result.attemptPayload,
    });
    lastErrorMessage = result.errorMessage ?? lastErrorMessage;

    if (result.ok) {
      return {
        status: "completed" as const,
        responsePayload: {
          attempts,
          finalAttempt: attemptIndex + 1,
          retryCount,
        },
        errorMessage: undefined,
      };
    }
  }

  return {
    status: "failed" as const,
    responsePayload: {
      attempts,
      finalAttempt: attempts.length,
      retryCount,
    },
    errorMessage: lastErrorMessage,
  };
}

async function executeEmailProvider(
  config: Record<string, unknown>,
  payload: Record<string, unknown>,
) {
  const webhookUrl = readStringConfig(config, "webhookUrl");

  if (webhookUrl) {
    return executeWebhookProvider({ ...config, url: webhookUrl }, payload);
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
    (typeof payload.submissionId === "number"
      ? `submission-${payload.submissionId}`
      : null);
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
}) {
  await db.insert(actionSubmissionEvents).values({
    projectId: input.projectId,
    submissionId: input.submissionId,
    eventType: input.eventType,
    message: input.message,
    payload: input.payload,
  });
}

export async function runOperationForSubmission(input: {
  projectId: number;
  actionId: number;
  submissionId: number;
  operationId: number;
  fields: Record<string, unknown>;
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
    operationType: operation.operationType,
    submissionId: input.submissionId,
    payload: buildInputPayload(input.fields, operation.inputMapping),
  };
  const startedAt = new Date();
  const [attempt] = await db
    .insert(operationAttempts)
    .values({
      projectId: input.projectId,
      operationId: operation.id,
      providerId: provider.id,
      actionId: input.actionId,
      submissionId: input.submissionId,
      status: "pending",
      requestPayload,
      startedAt,
    })
    .returning();

  const result = await executeProvider({
    config: provider.config,
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
  });

  return {
    attempt: finalAttempt,
    contactAttributes: output.contactAttributes,
    fields: output.fields,
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
  const [attempt] = await db
    .insert(operationAttempts)
    .values({
      projectId: input.projectId,
      operationId: operation.id,
      providerId: provider.id,
      actionId: null,
      submissionId: null,
      status: "pending",
      requestPayload,
      startedAt,
    })
    .returning();

  const result = await executeProvider({
    config: provider.config,
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
  const [attempt] = await db
    .insert(operationAttempts)
    .values({
      projectId: input.projectId,
      operationId: operation.id,
      providerId: provider.id,
      actionId: sourceAttempt.actionId,
      submissionId: sourceAttempt.submissionId,
      status: "pending",
      requestPayload,
      startedAt,
    })
    .returning();

  const result = await executeProvider({
    config: provider.config,
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
    });
  }

  return {
    attempt: finalAttempt,
    contactAttributes: output.contactAttributes,
    fields: output.fields,
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

    const attempt = await runOperationForSubmission({
      projectId,
      actionId: submission.actionId,
      submissionId: submission.id,
      operationId: row.operation.id,
      fields: submission.fields,
    });

    if (attempt) {
      attempts.push(attempt.attempt);
    }
  }

  return attempts;
}
