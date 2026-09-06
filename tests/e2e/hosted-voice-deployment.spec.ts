import { expect, test } from "@playwright/test";
import type {
  HostedVoiceProviderAdapter,
  VoiceAgentDefinitionV1,
} from "../../src/lib/hosted-voice-contract";
import {
  discardHostedVoiceCandidate,
  type HostedVoiceDeploymentRecord,
  type HostedVoiceDeploymentRepository,
  HostedVoiceDeploymentStateError,
  type HostedVoiceDeploymentVersionRecord,
  HostedVoiceDriftError,
  inspectHostedVoiceDeployment,
  promoteHostedVoiceCandidate,
  publishHostedVoiceCandidate,
  resolveHostedVoiceDrift,
  rollbackHostedVoiceDeployment,
} from "../../src/lib/hosted-voice-deployment";
import {
  createTelnyxHostedVoiceCompiler,
  type TelnyxHostedAssistantManagedConfig,
} from "../../src/lib/telnyx-hosted-voice";
import {
  createTelnyxHostedVoiceAdapter,
  TelnyxHostedVoiceApiError,
} from "../../src/lib/telnyx-hosted-voice-adapter";

const definition: VoiceAgentDefinitionV1 = {
  schemaVersion: 1,
  key: "dentalReceptionist",
  name: "Dental Receptionist",
  instructions: "Use Lia tools for appointment work and verify every write.",
  greeting: { strategy: "exact", text: "Thanks for calling." },
  locale: { language: "en-AU", timezone: "Australia/Sydney" },
  publishedTaskVersions: [{ taskId: 95, taskVersionId: 501 }],
  tools: [{ id: "operation:901", version: 1 }],
  confirmation: { writeOperations: "explicit" },
  identity: {
    defaultRequirement: "verified",
    verificationFactors: ["patientName", "dateOfBirth"],
  },
  handoff: { mode: "available" },
  retention: { mode: "metadata_only", days: 30 },
  requiredCapabilities: [
    "native_conversation",
    "interruptions",
    "synchronous_tools",
    "versioned_deployment",
  ],
};

const settings = {
  modelId: "moonshotai/Kimi-K2.6",
  transcriptionLanguage: "en",
  transcriptionModelId: "deepgram/flux",
  voiceId: "Telnyx.Ultra.australian_female",
};

function managedConfig(
  name = definition.name,
): TelnyxHostedAssistantManagedConfig {
  return {
    ...createTelnyxHostedVoiceCompiler(settings).compile({
      definition,
      definitionHash: "fixture-hash",
    }),
    name,
  };
}

function telnyxResponse(versionId: string, config = managedConfig()) {
  return {
    ...config,
    created_at: "2026-08-24T00:00:00Z",
    id: "assistant-1",
    version_created_at: "2026-08-24T00:00:00Z",
    version_id: versionId,
    version_name: `Version ${versionId}`,
  };
}

function telnyxWebhookSetup() {
  return [
    {
      async: true,
      body_parameters: {
        properties: {
          date: { description: "Canonical Lia input: date", type: "string" },
        },
        required: ["date"],
        type: "object" as const,
      },
      description: "Check calendar availability.",
      method: "POST" as const,
      name: "lia_read_operation_85",
      phase: "read" as const,
      timeout_ms: 8_000,
      url: "https://staging.example.com/api/voice-tools/operation%3A85/read",
    },
  ];
}

test("Telnyx adapter creates a non-main candidate with idempotent API requests", async () => {
  const requests: Array<{ body: Record<string, unknown>; init?: RequestInit }> =
    [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ body, init });
    return Response.json(
      telnyxResponse(requests.length === 1 ? "main-1" : "candidate-2"),
    );
  };
  const adapter = createTelnyxHostedVoiceAdapter({
    apiKey: "restricted-test-key",
    fetchImpl,
    settings,
  });
  const config = managedConfig();

  const remote = await adapter.createDraft({
    definitionHash: "a".repeat(64),
    managedConfig: config,
    remoteAssistantId: null,
    versionName: "Lia dental candidate",
  });

  expect(remote).toEqual({
    assistantId: "assistant-1",
    previousMainVersionId: "main-1",
    versionId: "candidate-2",
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]?.body).not.toHaveProperty("promote_to_main");
  expect(requests[1]?.body).toMatchObject({
    promote_to_main: false,
    version_name: "Lia dental candidate",
  });
  expect(requests[0]?.init?.headers).toMatchObject({
    Authorization: "Bearer restricted-test-key",
    "Idempotency-Key": `lia_${"a".repeat(64)}_bootstrap`,
  });
  expect(JSON.stringify(requests.map(({ body }) => body))).not.toContain(
    "restricted-test-key",
  );
});

test("Telnyx adapter uses version inspection and promotion endpoints", async () => {
  const urls: string[] = [];
  const methods: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    urls.push(String(url));
    methods.push(init?.method ?? "GET");
    return Response.json(telnyxResponse("candidate-2"));
  };
  const adapter = createTelnyxHostedVoiceAdapter({
    apiKey: "restricted-test-key",
    fetchImpl,
    settings,
  });

  await adapter.inspect({
    assistantId: "assistant-1",
    versionId: "candidate-2",
  });
  await adapter.promote({
    assistantId: "assistant-1",
    previousMainVersionId: "main-1",
    versionId: "candidate-2",
  });

  expect(urls[0]).toContain("/ai/assistants/assistant-1/versions/candidate-2");
  expect(urls[1]).toContain(
    "/ai/assistants/assistant-1/versions/candidate-2/promote",
  );
  expect(methods).toEqual(["GET", "POST"]);
});

test("Telnyx adapter finds the exact Integration Secret without exposing its value", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    urls.push(String(url));
    const page = urls.length;
    return Response.json({
      data:
        page === 1
          ? [
              {
                id: "secret-old",
                identifier: "unrelated-secret",
                updated_at: "2026-09-06T10:00:00.000Z",
              },
            ]
          : [
              {
                id: "secret-current",
                identifier: "lia-phase18-candidate-1",
                updated_at: "2026-09-06T11:10:00.000Z",
              },
            ],
      meta: { page_number: page, total_pages: 2 },
    });
  };
  const adapter = createTelnyxHostedVoiceAdapter({
    apiKey: "restricted-test-key",
    fetchImpl,
    settings,
  });

  await expect(
    adapter.inspectIntegrationSecret({
      identifier: "lia-phase18-candidate-1",
    }),
  ).resolves.toEqual({
    id: "secret-current",
    updatedAt: "2026-09-06T11:10:00.000Z",
  });
  expect(urls).toHaveLength(2);
  expect(urls[0]).toBe("https://api.telnyx.com/v2/integration_secrets");
  expect(urls[1]).toBe(
    "https://api.telnyx.com/v2/integration_secrets?page%5Bnumber%5D=2",
  );
  expect(JSON.stringify(urls)).not.toContain("restricted-test-key");
});

test("Telnyx adapter replaces Lia webhooks on only the verified non-main candidate", async () => {
  const nativeTool = {
    hangup: { description: "End the completed conversation." },
    id: "tool-provider-managed",
    type: "hangup",
  };
  const staleLiaTool = {
    type: "webhook",
    webhook: { name: "lia_read_stale" },
  };
  const requests: Array<{
    body: Record<string, unknown>;
    method: string;
    url: string;
  }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({
      body,
      method: init?.method ?? "GET",
      url: String(url),
    });
    return Response.json({
      ...telnyxResponse("candidate-2"),
      tools:
        init?.method === "POST"
          ? (body.tools as unknown[])
          : [nativeTool, staleLiaTool],
    });
  };
  const adapter = createTelnyxHostedVoiceAdapter({
    apiKey: "restricted-test-key",
    fetchImpl,
    settings,
  });

  const result = await adapter.pushCandidateTools({
    assistantId: "assistant-1",
    candidateVersionId: "candidate-2",
    integrationSecretIdentifier: "lia-phase18-candidate-1",
    mainVersionId: "main-1",
    tools: telnyxWebhookSetup(),
  });

  expect(result).toEqual({ routingWasSuspended: false, toolCount: 1 });
  expect(requests.map(({ method }) => method)).toEqual(["GET", "POST"]);
  expect(
    requests.every(({ url }) =>
      url.endsWith("/ai/assistants/assistant-1/versions/candidate-2"),
    ),
  ).toBe(true);
  const pushedTools = requests[1]?.body.tools as Array<Record<string, unknown>>;
  expect(requests[1]?.body.name).toBe(definition.name);
  expect(pushedTools).toHaveLength(2);
  expect(pushedTools[0]).toEqual({
    hangup: { description: "End the completed conversation." },
    type: "hangup",
  });
  expect(pushedTools[1]).toMatchObject({
    type: "webhook",
    webhook: {
      async: true,
      async_timeout_ms: 8_000,
      headers: [
        {
          name: "Authorization",
          value:
            "Bearer {{#integration_secret}}lia-phase18-candidate-1{{/integration_secret}}",
        },
      ],
      name: "lia_read_operation_85",
    },
  });
  expect(pushedTools[1]?.webhook).not.toHaveProperty("timeout_ms");
  expect(JSON.stringify(requests)).not.toContain("restricted-test-key");
  expect(JSON.stringify(pushedTools)).not.toContain("must-never-leak");
});

test("Telnyx adapter restores canary routing after updating a locked live candidate", async () => {
  const canary = {
    assistant_id: "assistant-1",
    created_at: "2026-09-06T11:00:00.000Z",
    rules: [
      {
        match: [
          {
            attribute: "end_user_target",
            operator: "in",
            values: ["test@sip.telnyx.com"],
          },
        ],
        serve: { version_id: "candidate-2" },
      },
    ],
    updated_at: "2026-09-06T11:00:00.000Z",
  };
  const requests: Array<{
    body: Record<string, unknown>;
    method: string;
    url: string;
  }> = [];
  let updateAttempts = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const request = { body, method, url: String(url) };
    requests.push(request);

    if (request.url.endsWith("/canary-deploys")) {
      if (method === "DELETE") return new Response(null, { status: 204 });
      return Response.json(canary);
    }
    if (method === "POST") {
      updateAttempts += 1;
      if (updateAttempts === 1) {
        return Response.json({ errors: [{ code: "10015" }] }, { status: 400 });
      }
      return Response.json({
        ...telnyxResponse("candidate-2"),
        tools: body.tools as unknown[],
      });
    }
    return Response.json({ ...telnyxResponse("candidate-2"), tools: [] });
  };
  const adapter = createTelnyxHostedVoiceAdapter({
    apiKey: "restricted-test-key",
    fetchImpl,
    settings,
  });

  await expect(
    adapter.pushCandidateTools({
      assistantId: "assistant-1",
      candidateVersionId: "candidate-2",
      integrationSecretIdentifier: "lia-phase18-candidate-1",
      mainVersionId: "main-1",
      tools: telnyxWebhookSetup(),
    }),
  ).resolves.toEqual({ routingWasSuspended: true, toolCount: 1 });
  expect(requests.map(({ method }) => method)).toEqual([
    "GET",
    "POST",
    "GET",
    "DELETE",
    "POST",
    "POST",
  ]);
  expect(requests[5]?.url).toContain("/canary-deploys");
  expect(requests[5]?.body).toEqual({ rules: canary.rules });
});

test("Telnyx adapter restores canary routing when the unlocked update still fails", async () => {
  const canary = {
    assistant_id: "assistant-1",
    created_at: "2026-09-06T11:00:00.000Z",
    rules: [{ serve: { version_id: "candidate-2" } }],
    updated_at: "2026-09-06T11:00:00.000Z",
  };
  const requests: Array<{ method: string; url: string }> = [];
  let updateAttempts = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    const method = init?.method ?? "GET";
    const request = { method, url: String(url) };
    requests.push(request);

    if (request.url.endsWith("/canary-deploys")) {
      if (method === "DELETE") return new Response(null, { status: 204 });
      return Response.json(canary);
    }
    if (method === "POST") {
      updateAttempts += 1;
      return Response.json(
        { errors: [{ code: updateAttempts === 1 ? "10015" : "20001" }] },
        { status: updateAttempts === 1 ? 400 : 422 },
      );
    }
    return Response.json({ ...telnyxResponse("candidate-2"), tools: [] });
  };
  const adapter = createTelnyxHostedVoiceAdapter({
    apiKey: "restricted-test-key",
    fetchImpl,
    settings,
  });

  await expect(
    adapter.pushCandidateTools({
      assistantId: "assistant-1",
      candidateVersionId: "candidate-2",
      integrationSecretIdentifier: "lia-phase18-candidate-1",
      mainVersionId: "main-1",
      tools: telnyxWebhookSetup(),
    }),
  ).rejects.toMatchObject({ status: 422 });
  expect(requests.at(-1)).toEqual({
    method: "POST",
    url: "https://api.telnyx.com/v2/ai/assistants/assistant-1/canary-deploys",
  });
});

test("Telnyx adapter refuses to push webhook tools to main", async () => {
  let requested = false;
  const adapter = createTelnyxHostedVoiceAdapter({
    apiKey: "restricted-test-key",
    fetchImpl: async () => {
      requested = true;
      return Response.json(telnyxResponse("main-1"));
    },
    settings,
  });

  await expect(
    adapter.pushCandidateTools({
      assistantId: "assistant-1",
      candidateVersionId: "main-1",
      integrationSecretIdentifier: "lia-phase18-candidate-1",
      mainVersionId: "main-1",
      tools: [],
    }),
  ).rejects.toThrow("only be pushed to a non-main candidate");
  expect(requested).toBe(false);
});

test("Telnyx adapter errors exclude credentials and provider response bodies", async () => {
  const adapter = createTelnyxHostedVoiceAdapter({
    apiKey: "must-never-leak",
    fetchImpl: async () =>
      Response.json(
        { error: "raw provider body with must-never-leak" },
        { status: 422 },
      ),
    settings,
  });

  const error = await adapter
    .inspect({ assistantId: "assistant-1" })
    .catch((caught) => caught);

  expect(error).toBeInstanceOf(TelnyxHostedVoiceApiError);
  expect(error.message).toBe(
    "Telnyx Assistant request failed with status 422.",
  );
  expect(JSON.stringify(error)).not.toContain("must-never-leak");
  expect(JSON.stringify(error)).not.toContain("raw provider body");
});

test("Telnyx adapter reports only secret-safe provider diagnostics", async () => {
  const logged: unknown[] = [];
  const originalConsoleError = console.error;
  console.error = (...values) => logged.push(values);
  try {
    const adapter = createTelnyxHostedVoiceAdapter({
      apiKey: "must-never-leak",
      fetchImpl: async () =>
        Response.json(
          {
            detail: [
              {
                input: "Bearer must-never-leak",
                loc: ["body", "tools", 0, "webhook", "timeout_ms"],
                msg: "raw provider body with must-never-leak",
                type: "value_error",
              },
            ],
          },
          {
            headers: { "x-request-id": "req-safe-123" },
            status: 422,
          },
        ),
      settings,
    });

    const error = await adapter
      .inspect({ assistantId: "assistant-1" })
      .catch((caught) => caught);

    expect(error.message).toBe(
      "Telnyx Assistant request failed with status 422 [request req-safe-123; field body.tools.0.webhook.timeout_ms; type value_error].",
    );
    expect(JSON.stringify({ error, logged })).not.toContain("must-never-leak");
    expect(JSON.stringify({ error, logged })).not.toContain(
      "raw provider body",
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("Telnyx adapter identifies Integration Secret lookup failures", async () => {
  const adapter = createTelnyxHostedVoiceAdapter({
    apiKey: "must-never-leak",
    fetchImpl: async () =>
      Response.json(
        { error: "raw provider body with must-never-leak" },
        { status: 400 },
      ),
    settings,
  });

  const error = await adapter
    .inspectIntegrationSecret({ identifier: "lia-phase18-candidate-1" })
    .catch((caught) => caught);

  expect(error).toBeInstanceOf(TelnyxHostedVoiceApiError);
  expect(error.message).toBe(
    "Telnyx Integration Secret lookup failed with status 400.",
  );
  expect(JSON.stringify(error)).not.toContain("must-never-leak");
  expect(JSON.stringify(error)).not.toContain("raw provider body");
});

test("candidate deployment, promotion, and rollback preserve verified versions", async () => {
  const adapter = new MemoryAdapter();
  const repository = new MemoryRepository();
  const published = await publishHostedVoiceCandidate({
    adapter,
    definition,
    projectId: 10,
    providerId: 20,
    repository,
  });

  expect(published.deployment).toMatchObject({
    candidateRemoteVersionId: "candidate-2",
    mainRemoteVersionId: "main-1",
    projectId: 10,
    providerId: 20,
    status: "candidate",
  });
  expect(repository.versions.map(({ status }) => status)).toEqual([
    "main",
    "candidate",
  ]);

  const promoted = await promoteHostedVoiceCandidate({
    adapter,
    deploymentId: published.deployment.id,
    projectId: 10,
    repository,
  });
  expect(promoted).toMatchObject({
    mainRemoteVersionId: "candidate-2",
    rollbackRemoteVersionId: "main-1",
    status: "main",
  });

  const rolledBack = await rollbackHostedVoiceDeployment({
    adapter,
    deploymentId: promoted.id,
    projectId: 10,
    repository,
  });
  expect(rolledBack).toMatchObject({
    mainRemoteVersionId: "main-1",
    rollbackRemoteVersionId: "candidate-2",
    status: "main",
  });
  expect(repository.events).toEqual([
    "candidate_created",
    "inspected",
    "promoted",
    "inspected",
    "promoted",
  ]);
});

test("remote drift blocks publishing until overwrite is explicit", async () => {
  const adapter = new MemoryAdapter();
  const repository = new MemoryRepository();
  const published = await publishHostedVoiceCandidate({
    adapter,
    definition,
    projectId: 10,
    providerId: 20,
    repository,
  });
  await promoteHostedVoiceCandidate({
    adapter,
    deploymentId: published.deployment.id,
    projectId: 10,
    repository,
  });
  adapter.changeMainDirectly("Portal edited name");

  const blocked = await publishHostedVoiceCandidate({
    adapter,
    definition: { ...definition, instructions: "A new Lia instruction." },
    projectId: 10,
    providerId: 20,
    repository,
  }).catch((caught) => caught);
  expect(blocked).toBeInstanceOf(HostedVoiceDriftError);
  expect(blocked.report).toMatchObject({
    expectedRemoteVersionId: "candidate-2",
    observedRemoteVersionId: "portal-3",
  });
  expect(adapter.createCount).toBe(1);

  const overwritten = await publishHostedVoiceCandidate({
    adapter,
    definition: { ...definition, instructions: "A new Lia instruction." },
    driftResolution: "overwrite",
    projectId: 10,
    providerId: 20,
    repository,
  });
  expect(overwritten.deployment.candidateRemoteVersionId).toBe("candidate-4");
  expect(adapter.createCount).toBe(2);
  expect(repository.events).toContain("overwrite");

  const promoted = await promoteHostedVoiceCandidate({
    adapter,
    deploymentId: overwritten.deployment.id,
    projectId: 10,
    repository,
  });
  expect(promoted.mainRemoteVersionId).toBe("candidate-4");
});

test("remote drift can be explicitly cancelled or imported as the new baseline", async () => {
  const adapter = new MemoryAdapter();
  const repository = new MemoryRepository();
  const published = await publishHostedVoiceCandidate({
    adapter,
    definition,
    projectId: 10,
    providerId: 20,
    repository,
  });
  const promoted = await promoteHostedVoiceCandidate({
    adapter,
    deploymentId: published.deployment.id,
    projectId: 10,
    repository,
  });
  adapter.changeMainDirectly("Portal edited name");

  const cancelled = await resolveHostedVoiceDrift({
    adapter,
    deploymentId: promoted.id,
    projectId: 10,
    repository,
    resolution: "cancel",
  });
  expect(cancelled.status).toBe("drifted");
  expect(cancelled.deployment.status).toBe("drifted");

  const imported = await resolveHostedVoiceDrift({
    adapter,
    deploymentId: promoted.id,
    projectId: 10,
    repository,
    resolution: "import",
  });
  expect(imported.status).toBe("imported");
  expect(imported.deployment).toMatchObject({
    mainRemoteVersionId: "portal-3",
    status: "main",
  });
  expect(repository.versions.at(-1)).toMatchObject({
    definition: null,
    remoteVersionId: "portal-3",
    source: "remote_import",
  });
});

test("successful reinspection restores a drifted candidate deployment", async () => {
  const adapter = new MemoryAdapter();
  const repository = new MemoryRepository();
  const published = await publishHostedVoiceCandidate({
    adapter,
    definition,
    projectId: 10,
    providerId: 20,
    repository,
  });
  const originalMainVersionId = published.deployment.mainRemoteVersionId;
  if (!originalMainVersionId) throw new Error("Missing original main version.");

  adapter.changeMainDirectly("Portal edited name");
  const drifted = await inspectHostedVoiceDeployment({
    adapter,
    deployment: published.deployment,
    repository,
  });
  expect(drifted.deployment.status).toBe("drifted");

  await adapter.promote({
    assistantId: "assistant-1",
    versionId: originalMainVersionId,
  });
  const restored = await inspectHostedVoiceDeployment({
    adapter,
    deployment: drifted.deployment,
    repository,
  });
  expect(restored.status).toBe("in_sync");
  expect(restored.deployment).toMatchObject({
    candidateRemoteVersionId: "candidate-2",
    mainRemoteVersionId: originalMainVersionId,
    status: "candidate",
  });
});

test("a failed candidate can be discarded without changing main", async () => {
  const adapter = new MemoryAdapter();
  const repository = new MemoryRepository();
  const published = await publishHostedVoiceCandidate({
    adapter,
    definition,
    projectId: 10,
    providerId: 20,
    repository,
  });

  const discarded = await discardHostedVoiceCandidate({
    adapter,
    deploymentId: published.deployment.id,
    projectId: 10,
    repository,
  });

  expect(adapter.currentVersionId).toBe("main-1");
  expect(discarded).toMatchObject({
    candidateManagedHash: null,
    candidateRemoteVersionId: null,
    mainRemoteVersionId: "main-1",
    status: "main",
  });
  expect(repository.events).toContain("discarded");
  expect(
    repository.versions.find(
      ({ remoteVersionId }) => remoteVersionId === "candidate-2",
    )?.status,
  ).toBe("superseded");
});

test("deployment lookups cannot cross the project boundary", async () => {
  const adapter = new MemoryAdapter();
  const repository = new MemoryRepository();
  const published = await publishHostedVoiceCandidate({
    adapter,
    definition,
    projectId: 10,
    providerId: 20,
    repository,
  });

  const error = await promoteHostedVoiceCandidate({
    adapter,
    deploymentId: published.deployment.id,
    projectId: 11,
    repository,
  }).catch((caught) => caught);

  expect(error).toBeInstanceOf(HostedVoiceDeploymentStateError);
  expect(adapter.currentVersionId).toBe("main-1");
});

class MemoryAdapter
  implements HostedVoiceProviderAdapter<TelnyxHostedAssistantManagedConfig>
{
  readonly compiler = createTelnyxHostedVoiceCompiler(settings);
  readonly profile = this.compiler.profile;
  readonly versions = new Map<string, TelnyxHostedAssistantManagedConfig>();
  createCount = 0;
  currentVersionId: string | null = null;
  nextVersion = 1;

  compile = this.compiler.compile;

  async createDraft(input: {
    definitionHash: string;
    managedConfig: TelnyxHostedAssistantManagedConfig;
    remoteAssistantId: string | null;
    versionName: string;
  }) {
    this.createCount += 1;
    let previousMainVersionId: string | null = null;
    if (!input.remoteAssistantId) {
      previousMainVersionId = `main-${this.nextVersion++}`;
      this.versions.set(
        previousMainVersionId,
        structuredClone(input.managedConfig),
      );
      this.currentVersionId = previousMainVersionId;
    }
    const versionId = `candidate-${this.nextVersion++}`;
    this.versions.set(versionId, structuredClone(input.managedConfig));
    return {
      assistantId: "assistant-1",
      previousMainVersionId,
      versionId,
    };
  }

  async deactivate() {}

  async inspect(input: { assistantId: string; versionId?: string }) {
    const versionId = input.versionId ?? this.currentVersionId;
    const config = versionId ? this.versions.get(versionId) : null;
    if (!versionId || !config) throw new Error("Missing fake remote version.");
    return {
      activeVersionId: input.versionId ? null : versionId,
      assistantId: input.assistantId,
      managedConfig: structuredClone(config),
      versionId,
    };
  }

  async promote(input: { assistantId: string; versionId: string }) {
    if (!this.versions.has(input.versionId))
      throw new Error("Missing version.");
    this.currentVersionId = input.versionId;
  }

  changeMainDirectly(name: string) {
    const versionId = `portal-${this.nextVersion++}`;
    const current = this.currentVersionId
      ? this.versions.get(this.currentVersionId)
      : null;
    if (!current) throw new Error("Missing current version.");
    this.versions.set(versionId, { ...structuredClone(current), name });
    this.currentVersionId = versionId;
  }
}

class MemoryRepository
  implements HostedVoiceDeploymentRepository<TelnyxHostedAssistantManagedConfig>
{
  deployment: HostedVoiceDeploymentRecord | null = null;
  events: string[] = [];
  versions: Array<
    HostedVoiceDeploymentVersionRecord<TelnyxHostedAssistantManagedConfig>
  > = [];

  async findDeployment(input: {
    definitionKey: string;
    projectId: number;
    providerId: number;
  }) {
    return this.deployment?.projectId === input.projectId &&
      this.deployment.providerId === input.providerId &&
      this.deployment.definitionKey === input.definitionKey
      ? this.deployment
      : null;
  }

  async findDeploymentById(input: { deploymentId: number; projectId: number }) {
    return this.deployment?.id === input.deploymentId &&
      this.deployment.projectId === input.projectId
      ? this.deployment
      : null;
  }

  async findVersion(input: {
    deploymentId: number;
    projectId: number;
    remoteVersionId: string;
  }) {
    return (
      this.versions.find(
        (version) =>
          version.deploymentId === input.deploymentId &&
          version.projectId === input.projectId &&
          version.remoteVersionId === input.remoteVersionId,
      ) ?? null
    );
  }

  async importRemote(input: {
    deployment: HostedVoiceDeploymentRecord;
    inspection: Awaited<ReturnType<MemoryAdapter["inspect"]>>;
    managedHash: string;
    resolution: "import" | "overwrite";
  }) {
    this.versions.forEach((version) => {
      if (version.status === "main" || version.status === "candidate") {
        version.status = "superseded";
      }
    });
    this.versions.push({
      definition: null,
      definitionHash: null,
      deploymentId: input.deployment.id,
      managedConfig: structuredClone(input.inspection.managedConfig),
      managedHash: input.managedHash,
      observedManagedHash: input.managedHash,
      projectId: input.deployment.projectId,
      remoteVersionId: input.inspection.versionId,
      source: "remote_import",
      status: "main",
    });
    this.events.push(input.resolution);
    return this.update({
      candidateManagedHash: null,
      candidateRemoteVersionId: null,
      mainManagedHash: input.managedHash,
      mainRemoteVersionId: input.inspection.versionId,
      observedManagedHash: input.managedHash,
      rollbackRemoteVersionId: input.deployment.mainRemoteVersionId,
      status: "main",
    });
  }

  async markCandidate(input: {
    bootstrapMainVersionId: string | null;
    definition: VoiceAgentDefinitionV1;
    definitionHash: string;
    deployment: HostedVoiceDeploymentRecord | null;
    managedConfig: TelnyxHostedAssistantManagedConfig;
    managedHash: string;
    observedManagedHash: string;
    projectId: number;
    providerId: number;
    remoteAssistantId: string;
    remoteVersionId: string;
  }) {
    if (!this.deployment) {
      this.deployment = {
        candidateManagedHash: input.managedHash,
        candidateRemoteVersionId: input.remoteVersionId,
        definitionKey: input.definition.key,
        id: 1,
        mainManagedHash: input.bootstrapMainVersionId
          ? input.managedHash
          : null,
        mainRemoteVersionId: input.bootstrapMainVersionId,
        observedManagedHash: input.bootstrapMainVersionId
          ? input.managedHash
          : null,
        projectId: input.projectId,
        providerId: input.providerId,
        remoteAssistantId: input.remoteAssistantId,
        revision: 0,
        rollbackRemoteVersionId: null,
        status: "candidate",
      };
    } else {
      this.update({
        candidateManagedHash: input.managedHash,
        candidateRemoteVersionId: input.remoteVersionId,
        status: "candidate",
      });
    }
    if (input.bootstrapMainVersionId) {
      this.versions.push(
        this.version(input, input.bootstrapMainVersionId, "main"),
      );
    }
    this.versions.push(this.version(input, input.remoteVersionId, "candidate"));
    this.events.push("candidate_created");
    return this.deployment;
  }

  async discardCandidate(input: { deployment: HostedVoiceDeploymentRecord }) {
    this.versions.forEach((version) => {
      if (
        version.remoteVersionId === input.deployment.candidateRemoteVersionId
      ) {
        version.status = "superseded";
      }
    });
    this.events.push("discarded");
    return this.update({
      candidateManagedHash: null,
      candidateRemoteVersionId: null,
      status: input.deployment.mainRemoteVersionId ? "main" : "draft",
    });
  }

  async markDrift(input: {
    deployment: HostedVoiceDeploymentRecord;
    observedManagedHash: string;
    observedRemoteVersionId: string;
  }) {
    this.events.push("drifted");
    return this.update({
      observedManagedHash: input.observedManagedHash,
      status: "drifted",
    });
  }

  async markPromoted(input: {
    deployment: HostedVoiceDeploymentRecord;
    managedHash: string;
    remoteVersionId: string;
  }) {
    this.versions.forEach((version) => {
      if (version.status === "main") version.status = "superseded";
      if (version.remoteVersionId === input.remoteVersionId) {
        version.status = "main";
      }
    });
    this.events.push("promoted");
    return this.update({
      candidateManagedHash: null,
      candidateRemoteVersionId: null,
      mainManagedHash: input.managedHash,
      mainRemoteVersionId: input.remoteVersionId,
      observedManagedHash: input.managedHash,
      rollbackRemoteVersionId: input.deployment.mainRemoteVersionId,
      status: "main",
    });
  }

  async recordInspection(input: {
    deployment: HostedVoiceDeploymentRecord;
    observedManagedHash: string;
    status: HostedVoiceDeploymentRecord["status"];
  }) {
    this.events.push("inspected");
    return this.update({
      observedManagedHash: input.observedManagedHash,
      status: input.status,
    });
  }

  private update(values: Partial<HostedVoiceDeploymentRecord>) {
    if (!this.deployment) throw new Error("Missing deployment.");
    this.deployment = {
      ...this.deployment,
      ...values,
      revision: this.deployment.revision + 1,
    };
    return this.deployment;
  }

  private version(
    input: Parameters<MemoryRepository["markCandidate"]>[0],
    remoteVersionId: string,
    status: "candidate" | "main",
  ): HostedVoiceDeploymentVersionRecord<TelnyxHostedAssistantManagedConfig> {
    return {
      definition: structuredClone(input.definition),
      definitionHash: input.definitionHash,
      deploymentId: this.deployment?.id ?? 1,
      managedConfig: structuredClone(input.managedConfig),
      managedHash: input.managedHash,
      observedManagedHash: input.observedManagedHash,
      projectId: input.projectId,
      remoteVersionId,
      source: "lia",
      status,
    };
  }
}
