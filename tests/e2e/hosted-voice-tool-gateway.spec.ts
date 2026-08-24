import { expect, test } from "@playwright/test";
import type { ToolDefinitionV1 } from "../../src/lib/conversation-contracts";
import {
  getHostedVoiceBearerCredential,
  type HostedVoiceToolEnvelope,
  type HostedVoiceToolProviderAdapter,
  hashHostedVoiceToolValue,
  telnyxHostedVoiceToolAdapter,
} from "../../src/lib/hosted-voice-tool-contract";
import {
  executeHostedVoiceToolEnvelope,
  type HostedVoiceToolBinding,
  type HostedVoiceToolCall,
  type HostedVoiceToolExecutor,
  type HostedVoiceToolGatewayRepository,
  HostedVoiceToolRequestError,
} from "../../src/lib/hosted-voice-tool-gateway";

const COMMIT_SECRET = "phase-18-11-commit-secret-at-least-32-characters";
const CREDENTIAL = "opaque-provider-binding-secret";

function toolDefinition(access: "read" | "write"): ToolDefinitionV1 {
  return {
    access,
    description: `${access} appointment tool`,
    execution: {
      adapter: "operation",
      cancellation: "unsupported",
      handler: access === "read" ? "701" : "702",
      mode: "synchronous",
      retryAttempts: 0,
      retryDelayMs: 0,
      timeoutMs: 3000,
    },
    id: access === "read" ? "availability.lookup" : "appointment.book",
    inputSchema: {
      fields: [
        {
          key: "phone",
          required: true,
          source: { key: "phone", kind: "field" },
          type: "phone",
        },
      ],
    },
    name: `${access} appointment`,
    outputSchema: {
      fields: [{ path: "status", required: true, type: "text" }],
    },
    projectId: 10,
    requiredForCompletion: access === "write",
    resultMappings: [],
    schemaVersion: 1,
    version: 1,
  };
}

test("Telnyx and a fake provider pass the same read gateway conformance", async () => {
  const adapters: Array<{
    adapter: HostedVoiceToolProviderAdapter<unknown>;
    raw: unknown;
  }> = [
    {
      adapter:
        telnyxHostedVoiceToolAdapter as HostedVoiceToolProviderAdapter<unknown>,
      raw: {
        body: { phone: "+61 412 345 678" },
        headers: new Headers({
          "x-telnyx-call-control-id": "call-control-1",
        }),
      },
    },
    {
      adapter: {
        normalize({ phase, raw, toolId }) {
          const request = raw as {
            conversationId: string;
            input: Record<string, unknown>;
            requestId: string;
          };
          return {
            conversationId: request.conversationId,
            input: request.input,
            phase,
            provider: "fake_hosted",
            providerCallId: request.requestId,
            toolId,
          };
        },
        provider: "fake_hosted",
      },
      raw: {
        conversationId: "fake-conversation-1",
        input: { phone: "+61 412 345 678" },
        requestId: "fake-call-1",
      },
    },
  ];

  for (const { adapter, raw } of adapters) {
    const definition = toolDefinition("read");
    const repository = new MemoryRepository({
      definition,
      provider: adapter.provider,
    });
    const executor = new MemoryExecutor();
    const envelope = adapter.normalize({
      phase: "read",
      raw,
      toolId: definition.id,
    });
    const first = await executeHostedVoiceToolEnvelope({
      commitSecret: COMMIT_SECRET,
      credential: CREDENTIAL,
      envelope,
      executor,
      repository,
    });
    const replay = await executeHostedVoiceToolEnvelope({
      commitSecret: COMMIT_SECRET,
      credential: CREDENTIAL,
      envelope,
      executor,
      repository,
    });

    expect(first).toEqual({
      result: { status: "available" },
      status: "completed",
    });
    expect(replay).toEqual(first);
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]?.payload).toEqual({ phone: "+61412345678" });
  }
});

test("authentication and the opaque binding own all scope", async () => {
  expect(
    getHostedVoiceBearerCredential(
      new Headers({ authorization: `Bearer ${CREDENTIAL}` }),
    ),
  ).toBe(CREDENTIAL);
  expect(() => getHostedVoiceBearerCredential(new Headers())).toThrow(
    HostedVoiceToolRequestError,
  );

  const definition = toolDefinition("read");
  const repository = new MemoryRepository({ definition, provider: "telnyx" });
  const error = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: envelope(definition, "read", {
      phone: "+61412345678",
      projectId: 99,
    }),
    executor: new MemoryExecutor(),
    repository,
  }).catch((caught) => caught);
  expect(error).toBeInstanceOf(HostedVoiceToolRequestError);
  expect(error.code).toBe("scope_identifier_not_allowed");
  expect(repository.calls).toHaveLength(0);

  const unauthorized = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: "wrong-secret",
    envelope: envelope(definition, "read", { phone: "+61412345678" }),
    executor: new MemoryExecutor(),
    repository,
  }).catch((caught) => caught);
  expect(unauthorized.code).toBe("unauthorized");
});

test("writes require an expiring single-use token bound to exact canonical input", async () => {
  const definition = toolDefinition("write");
  const repository = new MemoryRepository({ definition, provider: "telnyx" });
  const executor = new MemoryExecutor();
  const now = new Date("2026-08-24T10:00:00.000Z");
  const prepared = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: envelope(definition, "prepare", { phone: "+61 412 345 678" }),
    executor,
    now,
    repository,
  });
  expect(prepared.status).toBe("prepared");
  if (prepared.status !== "prepared") throw new Error("Expected preparation.");
  expect(prepared.commitToken).toBeTruthy();
  expect(executor.calls).toHaveLength(0);
  expect(JSON.stringify(repository.calls)).not.toContain(prepared.commitToken);

  const commitEnvelope = envelope(definition, "commit", {
    commitToken: prepared.commitToken,
  });
  const committed = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: commitEnvelope,
    executor,
    now: new Date("2026-08-24T10:01:00.000Z"),
    repository,
  });
  const replay = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: commitEnvelope,
    executor,
    now: new Date("2026-08-24T10:06:00.000Z"),
    repository,
  });
  expect(committed).toEqual({
    result: { status: "available" },
    status: "completed",
  });
  expect(replay).toEqual(committed);
  expect(executor.calls).toHaveLength(1);
  expect(executor.calls[0]?.idempotencyKey).toContain(
    hashHostedVoiceToolValue({ phone: "+61412345678" }),
  );
});

test("expired or cross-binding commit tokens cannot execute", async () => {
  const definition = toolDefinition("write");
  const repository = new MemoryRepository({ definition, provider: "telnyx" });
  const prepared = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: envelope(definition, "prepare", { phone: "+61412345678" }),
    executor: new MemoryExecutor(),
    now: new Date("2026-08-24T10:00:00.000Z"),
    repository,
  });
  if (prepared.status !== "prepared") throw new Error("Expected preparation.");
  const expired = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: envelope(definition, "commit", {
      commitToken: prepared.commitToken,
    }),
    executor: new MemoryExecutor(),
    now: new Date("2026-08-24T10:06:00.000Z"),
    repository,
  }).catch((caught) => caught);
  expect(expired.code).toBe("commit_token_expired");

  const other = new MemoryRepository({ definition, provider: "telnyx" });
  other.binding.id = 2;
  const crossBinding = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: envelope(definition, "commit", {
      commitToken: prepared.commitToken,
    }),
    executor: new MemoryExecutor(),
    now: new Date("2026-08-24T10:01:00.000Z"),
    repository: other,
  }).catch((caught) => caught);
  expect(crossBinding.code).toBe("invalid_commit_token");
});

function envelope(
  definition: ToolDefinitionV1,
  phase: HostedVoiceToolEnvelope["phase"],
  input: Record<string, unknown>,
): HostedVoiceToolEnvelope {
  return {
    conversationId: "conversation-1",
    input,
    phase,
    provider: "telnyx",
    providerCallId:
      phase === "commit"
        ? "commit-call-1"
        : hashHostedVoiceToolValue({ input, phase }),
    toolId: definition.id,
  };
}

class MemoryExecutor implements HostedVoiceToolExecutor {
  readonly calls: Array<{
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }> = [];

  async execute(input: {
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }) {
    this.calls.push({
      idempotencyKey: input.idempotencyKey,
      payload: structuredClone(input.payload),
    });
    return { ignored: "not in output contract", status: "available" };
  }
}

class MemoryRepository implements HostedVoiceToolGatewayRepository {
  readonly binding: HostedVoiceToolBinding;
  readonly calls: HostedVoiceToolCall[] = [];

  constructor(input: { definition: ToolDefinitionV1; provider: string }) {
    this.binding = {
      definition: input.definition,
      deploymentId: 30,
      id: 1,
      locale: "en-AU",
      projectId: 10,
      provider: input.provider,
      timezone: "Australia/Sydney",
    };
  }

  async resolveBinding(input: {
    credentialHash: string;
    provider: string;
    toolId: string;
  }) {
    return input.credentialHash === hashHostedVoiceToolValue(CREDENTIAL) &&
      input.provider === this.binding.provider &&
      input.toolId === this.binding.definition.id
      ? this.binding
      : null;
  }

  async reserve(
    input: Omit<HostedVoiceToolCall, "id" | "result" | "status"> & {
      status: "pending" | "prepared";
    },
  ) {
    const existing = this.calls.find(
      (call) =>
        call.bindingId === input.bindingId &&
        call.providerCallId === input.providerCallId,
    );
    if (existing) return { call: existing, created: false };
    const call: HostedVoiceToolCall = {
      ...structuredClone(input),
      id: this.calls.length + 1,
      result: null,
    };
    this.calls.push(call);
    return { call, created: true };
  }

  async claimCommit(input: {
    bindingId: number;
    now: Date;
    projectId: number;
    providerCallId: string;
    tokenHash: string;
  }) {
    const call = this.calls.find(
      (candidate) =>
        candidate.bindingId === input.bindingId &&
        candidate.projectId === input.projectId &&
        candidate.providerCallId === input.providerCallId &&
        candidate.commitTokenHash === input.tokenHash,
    );
    if (!call) return null;
    if (call.status === "completed") {
      return { call, state: "completed" as const };
    }
    if (
      call.status !== "prepared" ||
      !call.commitExpiresAt ||
      call.commitExpiresAt <= input.now
    ) {
      return null;
    }
    call.status = "executing";
    return { call, state: "claimed" as const };
  }

  async complete(input: {
    call: HostedVoiceToolCall;
    result: Record<string, unknown>;
  }) {
    input.call.result = structuredClone(input.result);
    input.call.status = "completed";
    return input.call;
  }

  async fail(input: { call: HostedVoiceToolCall }) {
    input.call.status = "failed";
  }
}
