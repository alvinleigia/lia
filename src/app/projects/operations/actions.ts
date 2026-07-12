"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndProject } from "@/lib/auth-project";
import {
  createIntegrationProvider,
  createOperation,
  INTEGRATION_PROVIDER_STATUSES,
  INTEGRATION_PROVIDER_TYPES,
  OPERATION_STATUSES,
  processProjectOperationRetryQueue,
  replayOperationAttempt,
  runOperationPreview,
  updateIntegrationProviderStatus,
  updateOperationStatus,
} from "@/lib/operations";

const providerDetailsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  providerType: z.enum(INTEGRATION_PROVIDER_TYPES),
  config: z.string().optional(),
});

const operationDetailsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  operationType: z.string().trim().min(1).max(120),
  providerId: z.coerce.number().int().positive(),
  status: z.enum(OPERATION_STATUSES).default("active"),
  inputMapping: z.string().optional(),
  outputMapping: z.string().optional(),
  settings: z.string().optional(),
});

const apiRequestOperationSchema = z.object({
  autoRetryDelayMinutes: z.coerce.number().int().min(0).max(10080).default(5),
  autoRetryEnabled: z.coerce.boolean().optional(),
  autoRetryMaxAttempts: z.coerce.number().int().min(0).max(10).default(0),
  inputMapping: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  outputMapping: z.string().optional(),
  providerType: z.enum(["webhook", "n8n_webhook"]),
  retryCount: z.coerce.number().int().min(0).max(5).default(0),
  secret: z.string().trim().max(240).optional(),
  timeoutMs: z.coerce.number().int().min(1000).max(30000).default(15000),
  url: z.string().trim().url().max(1000),
});

const metaConversionOperationSchema = z.object({
  accessToken: z.string().trim().min(1).max(2000),
  actionSource: z.string().trim().min(1).max(80).default("website"),
  apiVersion: z.string().trim().min(1).max(40).default("v23.0"),
  datasetId: z.string().trim().min(1).max(120),
  eventName: z.string().trim().min(1).max(120).default("Lead"),
  eventSourceUrl: z
    .string()
    .trim()
    .url()
    .max(1000)
    .optional()
    .or(z.literal("")),
  inputMapping: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  testEventCode: z.string().trim().max(120).optional(),
});

const providerStatusSchema = z.object({
  providerId: z.coerce.number().int().positive(),
  status: z.enum(INTEGRATION_PROVIDER_STATUSES),
});

const operationStatusSchema = z.object({
  operationId: z.coerce.number().int().positive(),
  status: z.enum(OPERATION_STATUSES),
});

const operationPreviewSchema = z.object({
  fields: z.string().optional(),
  operationId: z.coerce.number().int().positive(),
});

const operationAttemptReplaySchema = z.object({
  attemptId: z.coerce.number().int().positive(),
});

function redirectWithError(message: string): never {
  redirect(`/projects/operations?error=${encodeURIComponent(message)}`);
}

function parseJsonObject(value: string | undefined, label: string) {
  if (!value?.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    redirectWithError(`${label} must be valid JSON.`);
  }

  redirectWithError(`${label} must be a JSON object.`);
}

export async function createIntegrationProviderAction(formData: FormData) {
  const parsed = providerDetailsSchema.safeParse({
    name: formData.get("name"),
    providerType: formData.get("providerType"),
    config: formData.get("config"),
  });

  if (!parsed.success) {
    redirectWithError("Please check the provider details.");
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.operations.manage");

  const provider = await createIntegrationProvider({
    projectId: context.project.id,
    name: parsed.data.name,
    providerType: parsed.data.providerType,
    config: parseJsonObject(parsed.data.config, "Provider config"),
  });

  await writeAuditLog({
    ...context,
    action: "integration_provider.created",
    targetType: "integration_provider",
    targetId: provider.id,
    metadata: {
      name: provider.name,
      providerType: provider.providerType,
      status: provider.status,
    },
  });

  revalidatePath("/projects/operations");
  redirect("/projects/operations?providerCreated=1");
}

export async function createOperationAction(formData: FormData) {
  const parsed = operationDetailsSchema.safeParse({
    name: formData.get("name"),
    operationType: formData.get("operationType"),
    providerId: formData.get("providerId"),
    status: formData.get("status") ?? "active",
    inputMapping: formData.get("inputMapping"),
    outputMapping: formData.get("outputMapping"),
    settings: formData.get("settings"),
  });

  if (!parsed.success) {
    redirectWithError("Please check the operation details.");
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.operations.manage");

  let operation: Awaited<ReturnType<typeof createOperation>>;
  try {
    operation = await createOperation({
      projectId: context.project.id,
      providerId: parsed.data.providerId,
      name: parsed.data.name,
      operationType: parsed.data.operationType,
      status: parsed.data.status,
      inputMapping: parseJsonObject(parsed.data.inputMapping, "Input mapping"),
      outputMapping: parseJsonObject(
        parsed.data.outputMapping,
        "Output mapping",
      ),
      settings: parseJsonObject(parsed.data.settings, "Settings"),
    });
  } catch {
    redirectWithError("Provider not found for this project.");
  }

  await writeAuditLog({
    ...context,
    action: "operation.created",
    targetType: "operation",
    targetId: operation.id,
    metadata: {
      name: operation.name,
      operationType: operation.operationType,
      providerId: operation.providerId,
      status: operation.status,
    },
  });

  revalidatePath("/projects/operations");
  revalidatePath("/projects/actions");
  redirect("/projects/operations?operationCreated=1");
}

export async function createApiRequestOperationAction(formData: FormData) {
  const parsed = apiRequestOperationSchema.safeParse({
    autoRetryDelayMinutes: formData.get("autoRetryDelayMinutes") || 5,
    autoRetryEnabled: formData.get("autoRetryEnabled") === "on",
    autoRetryMaxAttempts: formData.get("autoRetryMaxAttempts") || 0,
    inputMapping: formData.get("inputMapping"),
    name: formData.get("name"),
    outputMapping: formData.get("outputMapping"),
    providerType: formData.get("providerType") || "webhook",
    retryCount: formData.get("retryCount") || 0,
    secret: formData.get("secret"),
    timeoutMs: formData.get("timeoutMs") || 15000,
    url: formData.get("url"),
  });

  if (!parsed.success) {
    redirectWithError("Please check the API request details.");
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.operations.manage");

  const provider = await createIntegrationProvider({
    projectId: context.project.id,
    name: `${parsed.data.name} Endpoint`,
    providerType: parsed.data.providerType,
    config: {
      autoRetryDelayMinutes: parsed.data.autoRetryDelayMinutes,
      autoRetryEnabled: parsed.data.autoRetryEnabled === true,
      autoRetryMaxAttempts: parsed.data.autoRetryMaxAttempts,
      retryCount: parsed.data.retryCount,
      timeoutMs: parsed.data.timeoutMs,
      url: parsed.data.url,
      ...(parsed.data.secret ? { secret: parsed.data.secret } : {}),
    },
  });
  const operation = await createOperation({
    projectId: context.project.id,
    providerId: provider.id,
    name: parsed.data.name,
    operationType: "api_request",
    status: "active",
    inputMapping: parseJsonObject(parsed.data.inputMapping, "Input mapping"),
    outputMapping: parseJsonObject(parsed.data.outputMapping, "Output mapping"),
    settings: {
      operationKind: "api_request",
    },
  });

  await writeAuditLog({
    ...context,
    action: "operation.api_request_created",
    targetType: "operation",
    targetId: operation.id,
    metadata: {
      operationId: operation.id,
      providerId: provider.id,
      providerType: provider.providerType,
    },
  });

  revalidatePath("/projects/operations");
  revalidatePath("/projects/actions");
  redirect("/projects/operations?operationCreated=1");
}

export async function processOperationRetryQueueAction() {
  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.operations.manage");

  const result = await processProjectOperationRetryQueue({
    maxAttempts: 5,
    projectId: context.project.id,
  });

  await writeAuditLog({
    ...context,
    action: "operation_retry_queue.processed",
    targetType: "project",
    targetId: context.project.id,
    metadata: result,
  });

  revalidatePath("/projects/operations");
  redirect(
    `/projects/operations?retryQueueProcessed=1&retryProcessed=${result.processed}&retryCompleted=${result.completed}&retryFailed=${result.failed}&retrySkipped=${result.skipped}`,
  );
}

export async function createMetaConversionOperationAction(formData: FormData) {
  const parsed = metaConversionOperationSchema.safeParse({
    accessToken: formData.get("accessToken"),
    actionSource: formData.get("actionSource") || "website",
    apiVersion: formData.get("apiVersion") || "v23.0",
    datasetId: formData.get("datasetId"),
    eventName: formData.get("eventName") || "Lead",
    eventSourceUrl: formData.get("eventSourceUrl"),
    inputMapping: formData.get("inputMapping"),
    name: formData.get("name"),
    testEventCode: formData.get("testEventCode"),
  });

  if (!parsed.success) {
    redirectWithError("Please check the Meta Conversions details.");
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.operations.manage");

  const provider = await createIntegrationProvider({
    projectId: context.project.id,
    name: `${parsed.data.name} Meta CAPI`,
    providerType: "meta_conversions_api",
    config: {
      accessToken: parsed.data.accessToken,
      actionSource: parsed.data.actionSource,
      apiVersion: parsed.data.apiVersion,
      datasetId: parsed.data.datasetId,
      eventName: parsed.data.eventName,
      hashUserData: true,
      ...(parsed.data.eventSourceUrl
        ? { eventSourceUrl: parsed.data.eventSourceUrl }
        : {}),
      ...(parsed.data.testEventCode
        ? { testEventCode: parsed.data.testEventCode }
        : {}),
    },
  });
  const operation = await createOperation({
    projectId: context.project.id,
    providerId: provider.id,
    name: parsed.data.name,
    operationType: "meta_conversions_api",
    status: "active",
    inputMapping: parseJsonObject(parsed.data.inputMapping, "Input mapping"),
    outputMapping: {},
    settings: {
      operationKind: "meta_conversions_api",
    },
  });

  await writeAuditLog({
    ...context,
    action: "operation.meta_conversion_created",
    targetType: "operation",
    targetId: operation.id,
    metadata: {
      datasetId: parsed.data.datasetId,
      eventName: parsed.data.eventName,
      operationId: operation.id,
      providerId: provider.id,
    },
  });

  revalidatePath("/projects/operations");
  revalidatePath("/projects/actions");
  redirect("/projects/operations?operationCreated=1");
}

export async function updateIntegrationProviderStatusAction(
  formData: FormData,
) {
  const parsed = providerStatusSchema.safeParse({
    providerId: formData.get("providerId"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    redirectWithError("Invalid provider status.");
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.operations.manage");
  const provider = await updateIntegrationProviderStatus({
    projectId: context.project.id,
    providerId: parsed.data.providerId,
    status: parsed.data.status,
  });

  if (!provider) {
    redirectWithError("Provider not found.");
  }

  await writeAuditLog({
    ...context,
    action: "integration_provider.status_updated",
    targetType: "integration_provider",
    targetId: provider.id,
    metadata: {
      name: provider.name,
      providerType: provider.providerType,
      status: provider.status,
    },
  });

  revalidatePath("/projects/operations");
  redirect("/projects/operations?providerUpdated=1");
}

export async function updateOperationStatusAction(formData: FormData) {
  const parsed = operationStatusSchema.safeParse({
    operationId: formData.get("operationId"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    redirectWithError("Invalid operation status.");
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.operations.manage");
  const operation = await updateOperationStatus({
    projectId: context.project.id,
    operationId: parsed.data.operationId,
    status: parsed.data.status,
  });

  if (!operation) {
    redirectWithError("Operation not found.");
  }

  await writeAuditLog({
    ...context,
    action: "operation.status_updated",
    targetType: "operation",
    targetId: operation.id,
    metadata: {
      name: operation.name,
      operationType: operation.operationType,
      providerId: operation.providerId,
      status: operation.status,
    },
  });

  revalidatePath("/projects/operations");
  revalidatePath("/projects/actions");
  redirect("/projects/operations?operationUpdated=1");
}

export async function previewOperationAction(formData: FormData) {
  const parsed = operationPreviewSchema.safeParse({
    fields: formData.get("fields"),
    operationId: formData.get("operationId"),
  });

  if (!parsed.success) {
    redirectWithError("Please check the preview details.");
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.operations.manage");
  const preview = await runOperationPreview({
    fields: parseJsonObject(parsed.data.fields, "Preview fields"),
    operationId: parsed.data.operationId,
    projectId: context.project.id,
  });

  if (!preview) {
    redirectWithError("Operation or provider is not active.");
  }

  await writeAuditLog({
    ...context,
    action: "operation.preview_ran",
    targetType: "operation_attempt",
    targetId: preview.attempt.id,
    metadata: {
      operationId: parsed.data.operationId,
      status: preview.attempt.status,
    },
  });

  revalidatePath("/projects/operations");
  redirect(`/projects/operations?previewAttemptId=${preview.attempt.id}`);
}

export async function replayOperationAttemptAction(formData: FormData) {
  const parsed = operationAttemptReplaySchema.safeParse({
    attemptId: formData.get("attemptId"),
  });

  if (!parsed.success) {
    redirectWithError("Invalid operation attempt.");
  }

  const context = await resolveUserAndProject();
  assertPermission(context.membership, "company.operations.manage");
  const replay = await replayOperationAttempt({
    attemptId: parsed.data.attemptId,
    projectId: context.project.id,
  });

  if (!replay) {
    redirectWithError(
      "Operation attempt, operation, or provider is not active.",
    );
  }

  await writeAuditLog({
    ...context,
    action: "operation_attempt.replayed",
    targetType: "operation_attempt",
    targetId: replay.attempt.id,
    metadata: {
      sourceAttemptId: replay.sourceAttempt.id,
      status: replay.attempt.status,
    },
  });

  revalidatePath("/projects/operations");
  redirect(
    `/projects/operations?operationReplayed=1&previewAttemptId=${replay.attempt.id}`,
  );
}
