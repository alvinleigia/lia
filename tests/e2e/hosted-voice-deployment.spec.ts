import { expect, test } from "@playwright/test";
import type {
  HostedVoiceProviderAdapter,
  VoiceAgentDefinitionV1,
} from "../../src/lib/hosted-voice-contract";
import {
  type HostedVoiceDeploymentRecord,
  type HostedVoiceDeploymentRepository,
  HostedVoiceDeploymentStateError,
  type HostedVoiceDeploymentVersionRecord,
  HostedVoiceDriftError,
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
  }) {
    this.events.push("inspected");
    return this.update({ observedManagedHash: input.observedManagedHash });
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
