import { expect, test } from "@playwright/test";
import { NextRequest } from "next/server";
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
import {
  createHostedVoiceNoCallVerificationToken,
  HOSTED_VOICE_NO_CALL_VERIFICATION_HEADER,
  verifyHostedVoiceIntegrationSecretFreshness,
  verifyHostedVoiceNoCallVerificationToken,
  verifyHostedVoiceToolEndpoint,
} from "../../src/lib/hosted-voice-tool-preflight";
import proxy from "../../src/proxy";

const COMMIT_SECRET = "phase-18-11-commit-secret-at-least-32-characters";
const CREDENTIAL = "opaque-provider-binding-secret";

test("proxy lets hosted voice tools reach their bearer-authenticated route", async () => {
  const publicResponse = proxy(
    new NextRequest(
      "https://lia-staging.example.com/api/voice-tools/operation%3A85/read",
    ),
  );
  expect(publicResponse.status).toBe(200);
  expect(publicResponse.headers.get("x-middleware-next")).toBe("1");

  const protectedResponse = proxy(
    new NextRequest("https://lia-staging.example.com/api/private"),
  );
  expect(protectedResponse.status).toBe(401);
  await expect(protectedResponse.json()).resolves.toEqual({
    message: "Unauthorized",
  });
});

test("no-call preflight requires Lia bearer authentication and a current secret", async () => {
  let request: { init?: RequestInit; url: string } | null = null;
  await expect(
    verifyHostedVoiceToolEndpoint({
      fetchImpl: async (url, init) => {
        request = { init, url: String(url) };
        return Response.json(
          {
            error: "unauthorized",
            message: "Hosted voice tool authentication failed.",
          },
          { status: 401 },
        );
      },
      url: "https://staging.example.com/api/voice-tools/operation%3A85/read",
    }),
  ).resolves.toEqual({ status: "ready" });
  expect(request).toMatchObject({
    init: { body: "{}", method: "POST" },
  });

  await expect(
    verifyHostedVoiceToolEndpoint({
      fetchImpl: async () =>
        Response.json({ message: "Unauthorized" }, { status: 401 }),
      url: "https://staging.example.com/api/voice-tools/operation%3A85/read",
    }),
  ).rejects.toThrow("did not reach Lia bearer authentication");

  expect(
    verifyHostedVoiceIntegrationSecretFreshness({
      bindingUpdatedAt: new Date("2026-09-06T11:09:20.000Z"),
      integrationSecretUpdatedAt: "2026-09-06T11:10:00.000Z",
    }),
  ).toEqual({ status: "current" });
  expect(() =>
    verifyHostedVoiceIntegrationSecretFreshness({
      bindingUpdatedAt: new Date("2026-09-06T11:09:20.000Z"),
      integrationSecretUpdatedAt: "2026-09-06T11:09:00.000Z",
    }),
  ).toThrow("current binding credential");
});

test("no-call verification tokens are short-lived and route-bound", () => {
  const now = new Date("2026-09-07T10:00:00.000Z");
  const token = createHostedVoiceNoCallVerificationToken({
    now,
    phase: "read",
    secret: COMMIT_SECRET,
    toolId: "operation:85",
  });
  const valid = verifyHostedVoiceNoCallVerificationToken({
    now,
    phase: "read",
    secret: COMMIT_SECRET,
    token,
    toolId: "operation:85",
  });

  expect(HOSTED_VOICE_NO_CALL_VERIFICATION_HEADER).toBe(
    "X-Lia-No-Call-Verification",
  );
  expect(valid).toMatch(/^lia-no-call:[0-9a-f-]{36}$/);
  expect(
    verifyHostedVoiceNoCallVerificationToken({
      now,
      phase: "prepare",
      secret: COMMIT_SECRET,
      token,
      toolId: "operation:85",
    }),
  ).toBeNull();
  expect(
    verifyHostedVoiceNoCallVerificationToken({
      now,
      phase: "read",
      secret: COMMIT_SECRET,
      token,
      toolId: "operation:86",
    }),
  ).toBeNull();
  expect(
    verifyHostedVoiceNoCallVerificationToken({
      now: new Date(now.getTime() + 5 * 60 * 1000),
      phase: "read",
      secret: COMMIT_SECRET,
      token,
      toolId: "operation:85",
    }),
  ).toBeNull();
  expect(
    verifyHostedVoiceNoCallVerificationToken({
      now,
      phase: "read",
      secret: COMMIT_SECRET,
      token: `${token}x`,
      toolId: "operation:85",
    }),
  ).toBeNull();
});

test("Telnyx normalization accepts only a server-verified no-call identity fallback", () => {
  const fallback = telnyxHostedVoiceToolAdapter.normalize({
    phase: "read",
    raw: {
      body: { date: "2026-09-10" },
      headers: new Headers(),
      verifiedConversationId: "lia-no-call:verification-id",
    },
    toolId: "operation:85",
  });
  expect(fallback.conversationId).toBe("lia-no-call:verification-id");

  const realCall = telnyxHostedVoiceToolAdapter.normalize({
    phase: "read",
    raw: {
      body: { date: "2026-09-10" },
      headers: new Headers({
        "x-telnyx-call-control-id": "real-call-control-id",
      }),
      verifiedConversationId: "lia-no-call:verification-id",
    },
    toolId: "operation:85",
  });
  expect(realCall.conversationId).toBe("real-call-control-id");

  expect(() =>
    telnyxHostedVoiceToolAdapter.normalize({
      phase: "read",
      raw: { body: { date: "2026-09-10" }, headers: new Headers() },
      toolId: "operation:85",
    }),
  ).toThrow(HostedVoiceToolRequestError);
});

test("Telnyx read retries share only a bounded delivery window", () => {
  const raw = {
    body: { date: "2026-09-10" },
    headers: new Headers({
      "x-telnyx-call-control-id": "real-call-control-id",
    }),
  };
  const first = telnyxHostedVoiceToolAdapter.normalize({
    phase: "read",
    raw: { ...raw, receivedAt: new Date("2026-09-07T00:00:00.000Z") },
    toolId: "operation:87",
  });
  const retry = telnyxHostedVoiceToolAdapter.normalize({
    phase: "read",
    raw: { ...raw, receivedAt: new Date("2026-09-07T00:00:04.999Z") },
    toolId: "operation:87",
  });
  const laterRead = telnyxHostedVoiceToolAdapter.normalize({
    phase: "read",
    raw: { ...raw, receivedAt: new Date("2026-09-07T00:00:05.000Z") },
    toolId: "operation:87",
  });

  expect(retry.providerCallId).toBe(first.providerCallId);
  expect(laterRead.providerCallId).not.toBe(first.providerCallId);
});

test("the same Telnyx read executes fresh after the replay window", async () => {
  const definition = toolDefinition("read");
  const repository = new MemoryRepository({ definition, provider: "telnyx" });
  const executor = new MemoryExecutor();
  const raw = {
    body: { phone: "+61 412 345 678" },
    headers: new Headers({
      "x-telnyx-call-control-id": "real-call-control-id",
    }),
  };

  for (const receivedAt of [
    new Date("2026-09-07T00:00:00.000Z"),
    new Date("2026-09-07T00:00:05.000Z"),
  ]) {
    await executeHostedVoiceToolEnvelope({
      commitSecret: COMMIT_SECRET,
      credential: CREDENTIAL,
      envelope: telnyxHostedVoiceToolAdapter.normalize({
        phase: "read",
        raw: { ...raw, receivedAt },
        toolId: definition.id,
      }),
      executor,
      repository,
    });
  }

  expect(repository.calls).toHaveLength(2);
  expect(executor.calls).toHaveLength(2);
});

function toolDefinition(
  access: "read" | "write",
  mode: "asynchronous" | "synchronous" = "synchronous",
): ToolDefinitionV1 {
  return {
    access,
    description: `${access} appointment tool`,
    execution: {
      adapter: "operation",
      cancellation: "unsupported",
      handler: access === "read" ? "701" : "702",
      mode,
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
  expect(prepared.commitToken).toMatch(/^ct_[A-Za-z0-9_-]{24}$/);
  expect(prepared.assistantInstruction).toContain(
    "until a later caller message explicitly confirms",
  );
  expect(executor.calls).toHaveLength(0);
  expect(JSON.stringify(repository.calls)).not.toContain(prepared.commitToken);

  const mutatedToken = `${prepared.commitToken.slice(0, -1)}${
    prepared.commitToken.endsWith("A") ? "B" : "A"
  }`;
  const mutated = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: envelope(definition, "commit", {
      commitToken: mutatedToken,
    }),
    executor,
    now: new Date("2026-08-24T10:00:30.000Z"),
    repository,
  }).catch((caught) => caught);
  expect(mutated.code).toBe("invalid_commit_token");
  expect(executor.calls).toHaveLength(0);

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

test("asynchronous reads acknowledge pending once without blocking the call", async () => {
  const definition = toolDefinition("read", "asynchronous");
  const repository = new MemoryRepository({ definition, provider: "telnyx" });
  const executor = new MemoryExecutor();
  const request = envelope(definition, "read", { phone: "+61412345678" });
  const first = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: request,
    executor,
    repository,
  });
  const replay = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: request,
    executor,
    repository,
  });
  expect(first).toEqual({
    assistantInstruction: 'Say only "One moment."',
    status: "pending",
  });
  expect(replay).toEqual(first);
  expect(executor.calls).toHaveLength(0);
  expect(executor.queued).toEqual([{ callId: 1, projectId: 10 }]);
});

test("a verified no-call probe executes an asynchronous read synchronously", async () => {
  const definition = toolDefinition("read", "asynchronous");
  const repository = new MemoryRepository({ definition, provider: "telnyx" });
  const executor = new MemoryExecutor();
  const result = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: envelope(definition, "read", { phone: "+61412345678" }),
    executor,
    forceSynchronous: true,
    repository,
  });

  expect(result).toEqual({
    result: { status: "available" },
    status: "completed",
  });
  expect(executor.calls).toHaveLength(1);
  expect(executor.queued).toHaveLength(0);
});

test("trusted hosted result details survive an older declared output contract", async () => {
  const definition = toolDefinition("read", "synchronous");
  const repository = new MemoryRepository({ definition, provider: "telnyx" });
  const executor = new MemoryExecutor();
  executor.trustedResult = { reason: "slot_taken", status: "rejected" };
  const result = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: envelope(definition, "read", { phone: "+61412345678" }),
    executor,
    repository,
  });

  expect(result).toEqual({
    result: { reason: "slot_taken", status: "rejected" },
    status: "completed",
  });
});

test("an asynchronous committed write stays pending and cannot enqueue twice", async () => {
  const definition = toolDefinition("write", "asynchronous");
  const repository = new MemoryRepository({ definition, provider: "telnyx" });
  const executor = new MemoryExecutor();
  const prepared = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: envelope(definition, "prepare", { phone: "+61412345678" }),
    executor,
    repository,
  });
  if (prepared.status !== "prepared") throw new Error("Expected preparation.");
  const request = envelope(definition, "commit", {
    commitToken: prepared.commitToken,
  });
  const first = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: request,
    executor,
    repository,
  });
  const replay = await executeHostedVoiceToolEnvelope({
    commitSecret: COMMIT_SECRET,
    credential: CREDENTIAL,
    envelope: request,
    executor,
    repository,
  });
  expect(first).toEqual({
    assistantInstruction: 'Say only "One moment."',
    status: "pending",
  });
  expect(replay).toEqual(first);
  expect(executor.calls).toHaveLength(0);
  expect(executor.queued).toEqual([{ callId: 1, projectId: 10 }]);
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
  readonly queued: Array<{ callId: number; projectId: number }> = [];
  trustedResult: Record<string, unknown> = {};

  async enqueue(input: { callId: number; projectId: number }) {
    this.queued.push(input);
  }

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

  getTrustedResult() {
    return structuredClone(this.trustedResult);
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
    input: Omit<
      HostedVoiceToolCall,
      "createdAt" | "id" | "result" | "startedAt" | "status"
    > & {
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
      createdAt: new Date(),
      id: this.calls.length + 1,
      result: null,
      startedAt: null,
    };
    this.calls.push(call);
    return { call, created: true };
  }

  async claimCommit(input: {
    bindingId: number;
    executionStatus: "executing" | "pending";
    now: Date;
    projectId: number;
    tokenHash: string;
    toolId: string;
    toolVersion: number;
  }) {
    const call = this.calls.find(
      (candidate) =>
        candidate.bindingId === input.bindingId &&
        candidate.projectId === input.projectId &&
        candidate.commitTokenHash === input.tokenHash &&
        candidate.toolId === input.toolId &&
        candidate.toolVersion === input.toolVersion,
    );
    if (!call) return null;
    if (call.status === "completed") {
      return { call, state: "completed" as const };
    }
    if (["executing", "pending"].includes(call.status)) {
      return { call, state: "pending" as const };
    }
    if (call.commitExpiresAt && call.commitExpiresAt <= input.now) {
      return { call, state: "expired" as const };
    }
    if (call.status !== "prepared" || !call.commitExpiresAt) {
      return { call, state: "consumed" as const };
    }
    call.status = input.executionStatus;
    call.startedAt = input.executionStatus === "executing" ? input.now : null;
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
