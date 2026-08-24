import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ToolDefinitionV1 } from "@/lib/conversation-contracts";
import {
  canonicalizeTaskFieldValue,
  createToolOutputField,
} from "@/lib/conversational-task-field-validation";
import { resolveProjectTaskResource } from "@/lib/conversational-task-project-resources";
import { validateToolResultPayload } from "@/lib/conversational-task-tool-runtime";
import {
  type HostedVoiceToolEnvelope,
  HostedVoiceToolRequestError,
  hashHostedVoiceToolValue,
} from "@/lib/hosted-voice-tool-contract";

export { HostedVoiceToolRequestError } from "@/lib/hosted-voice-tool-contract";

const COMMIT_TOKEN_TTL_MS = 5 * 60 * 1000;
const FORBIDDEN_SCOPE_KEYS = new Set([
  "calendarid",
  "companyid",
  "deploymentid",
  "operationid",
  "projectid",
  "provideroid",
  "taskid",
  "taskversionid",
  "tenantid",
]);

export type HostedVoiceToolBinding = {
  definition: ToolDefinitionV1;
  deploymentId: number;
  id: number;
  locale: string;
  projectId: number;
  provider: string;
  timezone: string;
};

export type HostedVoiceToolCall = {
  access: "read" | "write";
  bindingId: number;
  canonicalInput: Record<string, unknown>;
  canonicalInputHash: string;
  commitExpiresAt: Date | null;
  commitTokenHash: string | null;
  createdAt: Date;
  id: number;
  providerConversationHash: string | null;
  providerConversationId: string | null;
  phase: "prepare" | "read";
  projectId: number;
  providerCallId: string;
  result: Record<string, unknown> | null;
  status:
    | "cancelled"
    | "completed"
    | "executing"
    | "failed"
    | "pending"
    | "prepared";
  startedAt: Date | null;
  toolId: string;
  toolVersion: number;
};

export interface HostedVoiceToolGatewayRepository {
  claimCommit(input: {
    bindingId: number;
    executionStatus: "executing" | "pending";
    now: Date;
    projectId: number;
    providerCallId: string;
    tokenHash: string;
  }): Promise<{
    call: HostedVoiceToolCall;
    state: "claimed" | "completed" | "pending";
  } | null>;
  complete(input: {
    call: HostedVoiceToolCall;
    committedAt?: Date;
    result: Record<string, unknown>;
  }): Promise<HostedVoiceToolCall>;
  fail(input: { call: HostedVoiceToolCall; errorCode: string }): Promise<void>;
  reserve(
    input: Omit<
      HostedVoiceToolCall,
      "createdAt" | "id" | "result" | "startedAt" | "status"
    > & {
      status: "pending" | "prepared";
    },
  ): Promise<{ call: HostedVoiceToolCall; created: boolean }>;
  resolveBinding(input: {
    credentialHash: string;
    provider: string;
    toolId: string;
  }): Promise<HostedVoiceToolBinding | null>;
}

export interface HostedVoiceToolExecutor {
  enqueue?(input: { callId: number; projectId: number }): Promise<void>;
  execute(input: {
    definition: ToolDefinitionV1;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    projectId: number;
  }): Promise<Record<string, unknown>>;
}

export async function executeHostedVoiceToolEnvelope(input: {
  commitSecret: string;
  credential: string;
  envelope: HostedVoiceToolEnvelope;
  executor: HostedVoiceToolExecutor;
  now?: Date;
  repository: HostedVoiceToolGatewayRepository;
}) {
  const now = input.now ?? new Date();
  const binding = await input.repository.resolveBinding({
    credentialHash: hashHostedVoiceToolValue(input.credential),
    provider: input.envelope.provider,
    toolId: input.envelope.toolId,
  });
  if (!binding) {
    throw new HostedVoiceToolRequestError(
      "unauthorized",
      "Hosted voice tool authentication failed.",
      401,
    );
  }

  if (input.envelope.phase === "commit") {
    return commitHostedVoiceTool({ ...input, binding, now });
  }

  const definition = binding.definition;
  const expectedAccess = input.envelope.phase === "read" ? "read" : "write";
  if (definition.access !== expectedAccess) {
    throw new HostedVoiceToolRequestError(
      "tool_phase_not_allowed",
      "This tool is not allowed for the requested phase.",
      403,
    );
  }
  if (
    definition.execution.mode === "synchronous" &&
    definition.execution.timeoutMs > 10_000
  ) {
    throw new HostedVoiceToolRequestError(
      "synchronous_tool_timeout_too_long",
      "This tool must use asynchronous continuation.",
      409,
    );
  }

  const canonicalInput = await canonicalizeHostedVoiceToolInput({
    binding,
    proposedInput: input.envelope.input,
    referenceDate: now,
  });
  const canonicalInputHash = hashHostedVoiceToolValue(canonicalInput);

  if (input.envelope.phase === "prepare") {
    const commitExpiresAt = new Date(now.getTime() + COMMIT_TOKEN_TTL_MS);
    const tokenPayload = {
      bindingId: binding.id,
      expiresAt: commitExpiresAt.toISOString(),
      inputHash: canonicalInputHash,
      projectId: binding.projectId,
      providerCallId: input.envelope.providerCallId,
      toolId: definition.id,
      toolVersion: definition.version,
    };
    const commitToken = signCommitToken(tokenPayload, input.commitSecret);
    const reserved = await input.repository.reserve({
      access: "write",
      bindingId: binding.id,
      canonicalInput,
      canonicalInputHash,
      commitExpiresAt,
      commitTokenHash: hashHostedVoiceToolValue(commitToken),
      phase: "prepare",
      projectId: binding.projectId,
      providerCallId: input.envelope.providerCallId,
      providerConversationHash: hashHostedVoiceToolValue(
        input.envelope.conversationId,
      ),
      providerConversationId: input.envelope.conversationId,
      status: "prepared",
      toolId: definition.id,
      toolVersion: definition.version,
    });
    assertMatchingCall(reserved.call, {
      binding,
      canonicalInputHash,
      definition,
      phase: "prepare",
    });
    const expiresAt = reserved.call.commitExpiresAt;
    if (!expiresAt || expiresAt <= now) {
      throw new HostedVoiceToolRequestError(
        "commit_token_expired",
        "The prepared write expired. Prepare it again.",
        409,
      );
    }
    const replayToken = signCommitToken(
      { ...tokenPayload, expiresAt: expiresAt.toISOString() },
      input.commitSecret,
    );
    return {
      commitToken: replayToken,
      expiresAt: expiresAt.toISOString(),
      status: "prepared" as const,
    };
  }

  const reserved = await input.repository.reserve({
    access: "read",
    bindingId: binding.id,
    canonicalInput,
    canonicalInputHash,
    commitExpiresAt: null,
    commitTokenHash: null,
    phase: "read",
    projectId: binding.projectId,
    providerCallId: input.envelope.providerCallId,
    providerConversationHash: hashHostedVoiceToolValue(
      input.envelope.conversationId,
    ),
    providerConversationId: input.envelope.conversationId,
    status: "pending",
    toolId: definition.id,
    toolVersion: definition.version,
  });
  assertMatchingCall(reserved.call, {
    binding,
    canonicalInputHash,
    definition,
    phase: "read",
  });
  if (!reserved.created) {
    if (reserved.call.status === "completed" && reserved.call.result) {
      return { result: reserved.call.result, status: "completed" as const };
    }
    if (
      definition.execution.mode === "asynchronous" &&
      ["pending", "executing"].includes(reserved.call.status)
    ) {
      return { status: "pending" as const };
    }
    throw new HostedVoiceToolRequestError(
      "tool_call_in_progress",
      "This tool call is already being processed.",
      409,
    );
  }

  if (definition.execution.mode === "asynchronous") {
    return queueAndAcknowledge({
      call: reserved.call,
      executor: input.executor,
      repository: input.repository,
    });
  }

  return executeAndCompleteHostedVoiceTool({
    binding,
    call: reserved.call,
    executor: input.executor,
    now,
    repository: input.repository,
  });
}

async function commitHostedVoiceTool(input: {
  binding: HostedVoiceToolBinding;
  commitSecret: string;
  envelope: HostedVoiceToolEnvelope;
  executor: HostedVoiceToolExecutor;
  now: Date;
  repository: HostedVoiceToolGatewayRepository;
}) {
  const parsed = z
    .object({ commitToken: z.string().trim().min(1).max(4000) })
    .strict()
    .safeParse(input.envelope.input);
  if (!parsed.success) {
    throw new HostedVoiceToolRequestError(
      "invalid_commit_token",
      "A valid prepared-write token is required.",
      400,
    );
  }
  const payload = verifyCommitToken(
    parsed.data.commitToken,
    input.commitSecret,
  );
  if (
    payload.bindingId !== input.binding.id ||
    payload.projectId !== input.binding.projectId ||
    payload.toolId !== input.binding.definition.id ||
    payload.toolVersion !== input.binding.definition.version
  ) {
    throw new HostedVoiceToolRequestError(
      "invalid_commit_token",
      "The prepared-write token does not match this tool.",
      403,
    );
  }
  const claimed = await input.repository.claimCommit({
    bindingId: payload.bindingId,
    executionStatus:
      input.binding.definition.execution.mode === "asynchronous"
        ? "pending"
        : "executing",
    now: input.now,
    projectId: payload.projectId,
    providerCallId: payload.providerCallId,
    tokenHash: hashHostedVoiceToolValue(parsed.data.commitToken),
  });
  if (!claimed) {
    if (new Date(payload.expiresAt) <= input.now) {
      throw new HostedVoiceToolRequestError(
        "commit_token_expired",
        "The prepared write expired. Prepare it again.",
        409,
      );
    }
    throw new HostedVoiceToolRequestError(
      "commit_token_consumed",
      "The prepared-write token is invalid, expired, or already consumed.",
      409,
    );
  }
  assertMatchingCall(claimed.call, {
    binding: input.binding,
    canonicalInputHash: payload.inputHash,
    definition: input.binding.definition,
    phase: "prepare",
  });
  if (claimed.state === "completed" && claimed.call.result) {
    return { result: claimed.call.result, status: "completed" as const };
  }
  if (claimed.state === "pending") return { status: "pending" as const };
  if (input.binding.definition.execution.mode === "asynchronous") {
    return queueAndAcknowledge({
      call: claimed.call,
      executor: input.executor,
      repository: input.repository,
    });
  }
  return executeAndCompleteHostedVoiceTool({
    binding: input.binding,
    call: claimed.call,
    executor: input.executor,
    now: input.now,
    repository: input.repository,
  });
}

export async function executeAndCompleteHostedVoiceTool(input: {
  binding: HostedVoiceToolBinding;
  call: HostedVoiceToolCall;
  executor: HostedVoiceToolExecutor;
  now: Date;
  repository: HostedVoiceToolGatewayRepository;
}) {
  try {
    const result = await input.executor.execute({
      definition: input.binding.definition,
      idempotencyKey: `voice:${input.binding.id}:${input.call.providerCallId}:${input.call.canonicalInputHash}`,
      payload: input.call.canonicalInput,
      projectId: input.binding.projectId,
    });
    const validated = await validateToolResultPayload({
      contextValues: new Map(),
      definition: input.binding.definition,
      fieldValues: new Map(),
      projectId: input.binding.projectId,
      referenceDate: input.now,
      result,
    });
    if (!validated.ok) {
      throw new HostedVoiceToolRequestError(
        validated.error.code,
        "The tool returned an invalid result.",
        502,
      );
    }
    const completed = await input.repository.complete({
      call: input.call,
      committedAt: input.call.access === "write" ? input.now : undefined,
      result: validated.result,
    });
    return { result: completed.result ?? {}, status: "completed" as const };
  } catch (error) {
    const code =
      error instanceof HostedVoiceToolRequestError
        ? error.code
        : "tool_execution_failed";
    await input.repository.fail({ call: input.call, errorCode: code });
    if (error instanceof HostedVoiceToolRequestError) throw error;
    throw new HostedVoiceToolRequestError(
      code,
      "The hosted voice tool could not be completed.",
      502,
    );
  }
}

async function queueAndAcknowledge(input: {
  call: HostedVoiceToolCall;
  executor: HostedVoiceToolExecutor;
  repository: HostedVoiceToolGatewayRepository;
}) {
  if (!input.executor.enqueue) {
    await input.repository.fail({
      call: input.call,
      errorCode: "asynchronous_executor_unavailable",
    });
    throw new HostedVoiceToolRequestError(
      "asynchronous_executor_unavailable",
      "The asynchronous tool executor is unavailable.",
      503,
    );
  }
  try {
    await input.executor.enqueue({
      callId: input.call.id,
      projectId: input.call.projectId,
    });
    return { status: "pending" as const };
  } catch {
    await input.repository.fail({
      call: input.call,
      errorCode: "asynchronous_enqueue_failed",
    });
    throw new HostedVoiceToolRequestError(
      "asynchronous_enqueue_failed",
      "The asynchronous tool could not be queued.",
      503,
    );
  }
}

async function canonicalizeHostedVoiceToolInput(input: {
  binding: HostedVoiceToolBinding;
  proposedInput: Record<string, unknown>;
  referenceDate: Date;
}) {
  assertNoScopeKeys(input.proposedInput);
  const allowed = new Set(
    input.binding.definition.inputSchema.fields.map(({ key }) => key),
  );
  if (Object.keys(input.proposedInput).some((key) => !allowed.has(key))) {
    throw new HostedVoiceToolRequestError(
      "tool_input_not_allowed",
      "The tool request included an input that is not allowed.",
      400,
    );
  }
  const canonical: Record<string, unknown> = {};
  const contextValues = new Map<string, unknown>([
    ["lia_locale", input.binding.locale],
    ["lia_timezone", input.binding.timezone],
  ]);
  for (const field of input.binding.definition.inputSchema.fields) {
    const value =
      field.source.kind === "literal"
        ? field.source.value
        : input.proposedInput[field.key];
    if ((value === null || value === undefined) && field.required) {
      throw new HostedVoiceToolRequestError(
        "tool_input_missing",
        `The required value "${field.key}" is missing.`,
        400,
      );
    }
    if (value === null || value === undefined) continue;
    if (
      field.source.kind === "literal" &&
      input.proposedInput[field.key] !== undefined &&
      hashHostedVoiceToolValue(input.proposedInput[field.key]) !==
        hashHostedVoiceToolValue(value)
    ) {
      throw new HostedVoiceToolRequestError(
        "tool_input_mismatch",
        `The supplied value for "${field.key}" is not allowed.`,
        400,
      );
    }
    const validation = await canonicalizeTaskFieldValue({
      contextValues,
      field: createToolOutputField({ key: field.key, type: field.type }),
      projectId: input.binding.projectId,
      referenceDate: input.referenceDate,
      resolveProjectResource: resolveProjectTaskResource,
      value,
    });
    if (!validation.ok) {
      throw new HostedVoiceToolRequestError(
        "tool_input_invalid",
        `The supplied value for "${field.key}" is invalid.`,
        400,
      );
    }
    canonical[field.key] = validation.value;
  }
  return canonical;
}

function assertNoScopeKeys(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(assertNoScopeKeys);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (FORBIDDEN_SCOPE_KEYS.has(normalized)) {
      throw new HostedVoiceToolRequestError(
        "scope_identifier_not_allowed",
        "Tool calls cannot supply project or provider scope identifiers.",
        400,
      );
    }
    assertNoScopeKeys(child);
  }
}

function assertMatchingCall(
  call: HostedVoiceToolCall,
  input: {
    binding: HostedVoiceToolBinding;
    canonicalInputHash: string;
    definition: ToolDefinitionV1;
    phase: "prepare" | "read";
  },
) {
  if (
    call.bindingId !== input.binding.id ||
    call.projectId !== input.binding.projectId ||
    call.toolId !== input.definition.id ||
    call.toolVersion !== input.definition.version ||
    call.phase !== input.phase ||
    call.canonicalInputHash !== input.canonicalInputHash
  ) {
    throw new HostedVoiceToolRequestError(
      "provider_call_id_conflict",
      "The provider call identifier was already used for different input.",
      409,
    );
  }
}

const commitTokenPayloadSchema = z.object({
  bindingId: z.number().int().positive(),
  expiresAt: z.string().datetime({ offset: true }),
  inputHash: z.string().length(64),
  projectId: z.number().int().positive(),
  providerCallId: z.string().min(1).max(240),
  toolId: z.string().min(1).max(120),
  toolVersion: z.number().int().positive(),
});

type CommitTokenPayload = z.infer<typeof commitTokenPayloadSchema>;

function signCommitToken(payload: CommitTokenPayload, secret: string) {
  const valid = commitTokenPayloadSchema.parse(payload);
  const encoded = Buffer.from(JSON.stringify(valid)).toString("base64url");
  const signature = createHmac("sha256", requireCommitSecret(secret))
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyCommitToken(token: string, secret: string) {
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) return invalidCommitToken();
  const expectedSignature = createHmac("sha256", requireCommitSecret(secret))
    .update(encoded)
    .digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return invalidCommitToken();
  }
  try {
    return commitTokenPayloadSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
  } catch {
    return invalidCommitToken();
  }
}

function invalidCommitToken(): never {
  throw new HostedVoiceToolRequestError(
    "invalid_commit_token",
    "The prepared-write token is invalid.",
    403,
  );
}

function requireCommitSecret(secret: string) {
  if (secret.trim().length < 32) {
    throw new Error(
      "Hosted voice commit signing requires a 32-character secret.",
    );
  }
  return secret;
}
