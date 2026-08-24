import {
  compileHostedVoiceAgent,
  type HostedVoiceProviderAdapter,
  type HostedVoiceRemoteInspection,
  hashHostedVoiceManagedConfig,
  type VoiceAgentDefinitionV1,
} from "@/lib/hosted-voice-contract";

export type HostedVoiceDeploymentStatus =
  | "candidate"
  | "disabled"
  | "draft"
  | "drifted"
  | "main";

export type HostedVoiceDeploymentRecord = {
  candidateManagedHash: string | null;
  candidateRemoteVersionId: string | null;
  definitionKey: string;
  id: number;
  mainManagedHash: string | null;
  mainRemoteVersionId: string | null;
  observedManagedHash: string | null;
  projectId: number;
  providerId: number;
  remoteAssistantId: string | null;
  revision: number;
  rollbackRemoteVersionId: string | null;
  status: HostedVoiceDeploymentStatus;
};

export type HostedVoiceDeploymentVersionRecord<TManagedConfig> = {
  definition: VoiceAgentDefinitionV1 | null;
  definitionHash: string | null;
  deploymentId: number;
  managedConfig: TManagedConfig;
  managedHash: string;
  observedManagedHash: string;
  projectId: number;
  remoteVersionId: string;
  source: "lia" | "remote_import";
  status: "candidate" | "main" | "superseded";
};

export interface HostedVoiceDeploymentRepository<TManagedConfig> {
  findDeployment(input: {
    definitionKey: string;
    projectId: number;
    providerId: number;
  }): Promise<HostedVoiceDeploymentRecord | null>;
  findDeploymentById(input: {
    deploymentId: number;
    projectId: number;
  }): Promise<HostedVoiceDeploymentRecord | null>;
  findVersion(input: {
    deploymentId: number;
    projectId: number;
    remoteVersionId: string;
  }): Promise<HostedVoiceDeploymentVersionRecord<TManagedConfig> | null>;
  importRemote(input: {
    deployment: HostedVoiceDeploymentRecord;
    inspection: HostedVoiceRemoteInspection<TManagedConfig>;
    managedHash: string;
    resolution: "import" | "overwrite";
  }): Promise<HostedVoiceDeploymentRecord>;
  markCandidate(input: {
    bootstrapMainVersionId: string | null;
    definition: VoiceAgentDefinitionV1;
    definitionHash: string;
    deployment: HostedVoiceDeploymentRecord | null;
    managedConfig: TManagedConfig;
    managedHash: string;
    observedManagedHash: string;
    projectId: number;
    providerId: number;
    remoteAssistantId: string;
    remoteVersionId: string;
  }): Promise<HostedVoiceDeploymentRecord>;
  markDrift(input: {
    deployment: HostedVoiceDeploymentRecord;
    observedManagedHash: string;
    observedRemoteVersionId: string;
  }): Promise<HostedVoiceDeploymentRecord>;
  markPromoted(input: {
    deployment: HostedVoiceDeploymentRecord;
    managedHash: string;
    remoteVersionId: string;
  }): Promise<HostedVoiceDeploymentRecord>;
  recordInspection(input: {
    deployment: HostedVoiceDeploymentRecord;
    observedManagedHash: string;
  }): Promise<HostedVoiceDeploymentRecord>;
}

export type HostedVoiceDriftReport = {
  deploymentId: number;
  expectedManagedHash: string | null;
  expectedRemoteVersionId: string | null;
  observedManagedHash: string;
  observedRemoteVersionId: string;
};

export class HostedVoiceDriftError extends Error {
  constructor(readonly report: HostedVoiceDriftReport) {
    super("Hosted voice deployment has remote drift requiring a decision.");
    this.name = "HostedVoiceDriftError";
  }
}

export class HostedVoiceDeploymentStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedVoiceDeploymentStateError";
  }
}

export class HostedVoiceDeploymentVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedVoiceDeploymentVerificationError";
  }
}

export async function inspectHostedVoiceDeployment<TManagedConfig>(input: {
  adapter: HostedVoiceProviderAdapter<TManagedConfig>;
  deployment: HostedVoiceDeploymentRecord;
  repository: HostedVoiceDeploymentRepository<TManagedConfig>;
}) {
  const assistantId = requireRemoteAssistantId(input.deployment);
  const inspection = await input.adapter.inspect({ assistantId });
  const observedManagedHash = hashHostedVoiceManagedConfig(
    inspection.managedConfig,
  );
  const report = getDriftReport({
    deployment: input.deployment,
    inspection,
    observedManagedHash,
  });

  if (report) {
    const deployment = await input.repository.markDrift({
      deployment: input.deployment,
      observedManagedHash,
      observedRemoteVersionId: inspection.versionId,
    });
    return { deployment, inspection, report, status: "drifted" as const };
  }

  const deployment = await input.repository.recordInspection({
    deployment: input.deployment,
    observedManagedHash,
  });
  return { deployment, inspection, report: null, status: "in_sync" as const };
}

export async function publishHostedVoiceCandidate<TManagedConfig>(input: {
  adapter: HostedVoiceProviderAdapter<TManagedConfig>;
  definition: unknown;
  driftResolution?: "cancel" | "overwrite";
  projectId: number;
  providerId: number;
  repository: HostedVoiceDeploymentRepository<TManagedConfig>;
}) {
  const compiled = compileHostedVoiceAgent({
    compiler: input.adapter,
    definition: input.definition,
  });
  const managedHash = hashHostedVoiceManagedConfig(compiled.managedConfig);
  let deployment = await input.repository.findDeployment({
    definitionKey: compiled.definition.key,
    projectId: input.projectId,
    providerId: input.providerId,
  });

  if (deployment?.remoteAssistantId) {
    const inspected = await inspectHostedVoiceDeployment({
      adapter: input.adapter,
      deployment,
      repository: input.repository,
    });
    deployment = inspected.deployment;
    if (inspected.report) {
      if (input.driftResolution !== "overwrite") {
        throw new HostedVoiceDriftError(inspected.report);
      }
      deployment = await input.repository.importRemote({
        deployment,
        inspection: inspected.inspection,
        managedHash: inspected.report.observedManagedHash,
        resolution: "overwrite",
      });
    }
  }

  if (deployment?.candidateRemoteVersionId) {
    if (deployment.candidateManagedHash !== managedHash) {
      throw new HostedVoiceDeploymentStateError(
        "Promote or discard the existing hosted voice candidate first.",
      );
    }
    const inspection = await input.adapter.inspect({
      assistantId: requireRemoteAssistantId(deployment),
      versionId: deployment.candidateRemoteVersionId,
    });
    verifyManagedConfig({
      expectedHash: managedHash,
      expectedVersionId: deployment.candidateRemoteVersionId,
      inspection,
    });
    return { compiled, deployment, reused: true };
  }

  const remote = await input.adapter.createDraft({
    definitionHash: compiled.definitionHash,
    managedConfig: compiled.managedConfig,
    remoteAssistantId: deployment?.remoteAssistantId ?? null,
    versionName: buildVersionName(
      compiled.definition.key,
      compiled.definitionHash,
    ),
  });
  const inspection = await input.adapter.inspect({
    assistantId: remote.assistantId,
    versionId: remote.versionId,
  });
  const observedManagedHash = verifyManagedConfig({
    expectedHash: managedHash,
    expectedVersionId: remote.versionId,
    inspection,
  });
  const saved = await input.repository.markCandidate({
    bootstrapMainVersionId: remote.previousMainVersionId,
    definition: compiled.definition,
    definitionHash: compiled.definitionHash,
    deployment,
    managedConfig: compiled.managedConfig,
    managedHash,
    observedManagedHash,
    projectId: input.projectId,
    providerId: input.providerId,
    remoteAssistantId: remote.assistantId,
    remoteVersionId: remote.versionId,
  });

  return { compiled, deployment: saved, reused: false };
}

export async function resolveHostedVoiceDrift<TManagedConfig>(input: {
  adapter: HostedVoiceProviderAdapter<TManagedConfig>;
  deploymentId: number;
  projectId: number;
  repository: HostedVoiceDeploymentRepository<TManagedConfig>;
  resolution: "cancel" | "import";
}) {
  const deployment = await requireDeployment(input);
  const inspected = await inspectHostedVoiceDeployment({
    adapter: input.adapter,
    deployment,
    repository: input.repository,
  });
  if (!inspected.report || input.resolution === "cancel") return inspected;

  const imported = await input.repository.importRemote({
    deployment: inspected.deployment,
    inspection: inspected.inspection,
    managedHash: inspected.report.observedManagedHash,
    resolution: "import",
  });
  return {
    deployment: imported,
    inspection: inspected.inspection,
    report: inspected.report,
    status: "imported" as const,
  };
}

export async function promoteHostedVoiceCandidate<TManagedConfig>(input: {
  adapter: HostedVoiceProviderAdapter<TManagedConfig>;
  deploymentId: number;
  projectId: number;
  repository: HostedVoiceDeploymentRepository<TManagedConfig>;
}) {
  let deployment = await requireDeployment(input);
  if (
    !deployment.candidateRemoteVersionId ||
    !deployment.candidateManagedHash
  ) {
    throw new HostedVoiceDeploymentStateError(
      "Hosted voice deployment has no candidate to promote.",
    );
  }
  const inspected = await inspectHostedVoiceDeployment({
    adapter: input.adapter,
    deployment,
    repository: input.repository,
  });
  if (inspected.report) throw new HostedVoiceDriftError(inspected.report);
  deployment = inspected.deployment;
  if (
    !deployment.candidateRemoteVersionId ||
    !deployment.candidateManagedHash
  ) {
    throw new HostedVoiceDeploymentStateError(
      "Hosted voice candidate changed during inspection.",
    );
  }

  const assistantId = requireRemoteAssistantId(deployment);
  const candidateVersionId = deployment.candidateRemoteVersionId;
  const candidate = await input.adapter.inspect({
    assistantId,
    versionId: candidateVersionId,
  });
  verifyManagedConfig({
    expectedHash: deployment.candidateManagedHash,
    expectedVersionId: candidateVersionId,
    inspection: candidate,
  });
  await input.adapter.promote({
    assistantId,
    previousMainVersionId: deployment.mainRemoteVersionId,
    versionId: candidateVersionId,
  });
  const promoted = await input.adapter.inspect({ assistantId });
  const managedHash = verifyManagedConfig({
    expectedHash: deployment.candidateManagedHash,
    expectedVersionId: candidateVersionId,
    inspection: promoted,
  });

  return input.repository.markPromoted({
    deployment,
    managedHash,
    remoteVersionId: candidateVersionId,
  });
}

export async function rollbackHostedVoiceDeployment<TManagedConfig>(input: {
  adapter: HostedVoiceProviderAdapter<TManagedConfig>;
  deploymentId: number;
  projectId: number;
  repository: HostedVoiceDeploymentRepository<TManagedConfig>;
}) {
  let deployment = await requireDeployment(input);
  if (!deployment.rollbackRemoteVersionId) {
    throw new HostedVoiceDeploymentStateError(
      "Hosted voice deployment has no verified rollback version.",
    );
  }
  const inspected = await inspectHostedVoiceDeployment({
    adapter: input.adapter,
    deployment,
    repository: input.repository,
  });
  if (inspected.report) throw new HostedVoiceDriftError(inspected.report);
  deployment = inspected.deployment;
  if (!deployment.rollbackRemoteVersionId) {
    throw new HostedVoiceDeploymentStateError(
      "Hosted voice rollback target changed during inspection.",
    );
  }

  const rollbackVersion = await input.repository.findVersion({
    deploymentId: deployment.id,
    projectId: deployment.projectId,
    remoteVersionId: deployment.rollbackRemoteVersionId,
  });
  if (!rollbackVersion) {
    throw new HostedVoiceDeploymentStateError(
      "The recorded rollback version is unavailable in this project.",
    );
  }
  const assistantId = requireRemoteAssistantId(deployment);
  const remote = await input.adapter.inspect({
    assistantId,
    versionId: rollbackVersion.remoteVersionId,
  });
  verifyManagedConfig({
    expectedHash: rollbackVersion.managedHash,
    expectedVersionId: rollbackVersion.remoteVersionId,
    inspection: remote,
  });
  await input.adapter.promote({
    assistantId,
    previousMainVersionId: deployment.mainRemoteVersionId,
    versionId: rollbackVersion.remoteVersionId,
  });
  const promoted = await input.adapter.inspect({ assistantId });
  const managedHash = verifyManagedConfig({
    expectedHash: rollbackVersion.managedHash,
    expectedVersionId: rollbackVersion.remoteVersionId,
    inspection: promoted,
  });

  return input.repository.markPromoted({
    deployment,
    managedHash,
    remoteVersionId: rollbackVersion.remoteVersionId,
  });
}

function getDriftReport<TManagedConfig>(input: {
  deployment: HostedVoiceDeploymentRecord;
  inspection: HostedVoiceRemoteInspection<TManagedConfig>;
  observedManagedHash: string;
}): HostedVoiceDriftReport | null {
  if (
    input.deployment.mainManagedHash === input.observedManagedHash &&
    input.deployment.mainRemoteVersionId === input.inspection.versionId
  ) {
    return null;
  }

  return {
    deploymentId: input.deployment.id,
    expectedManagedHash: input.deployment.mainManagedHash,
    expectedRemoteVersionId: input.deployment.mainRemoteVersionId,
    observedManagedHash: input.observedManagedHash,
    observedRemoteVersionId: input.inspection.versionId,
  };
}

function verifyManagedConfig<TManagedConfig>(input: {
  expectedHash: string;
  expectedVersionId: string;
  inspection: HostedVoiceRemoteInspection<TManagedConfig>;
}) {
  const observedHash = hashHostedVoiceManagedConfig(
    input.inspection.managedConfig,
  );
  if (
    observedHash !== input.expectedHash ||
    input.inspection.versionId !== input.expectedVersionId
  ) {
    throw new HostedVoiceDeploymentVerificationError(
      "Hosted voice provider did not persist the verified candidate configuration.",
    );
  }
  return observedHash;
}

function requireRemoteAssistantId(deployment: HostedVoiceDeploymentRecord) {
  if (!deployment.remoteAssistantId) {
    throw new HostedVoiceDeploymentStateError(
      "Hosted voice deployment has no remote assistant.",
    );
  }
  return deployment.remoteAssistantId;
}

async function requireDeployment<TManagedConfig>(input: {
  deploymentId: number;
  projectId: number;
  repository: HostedVoiceDeploymentRepository<TManagedConfig>;
}) {
  const deployment = await input.repository.findDeploymentById({
    deploymentId: input.deploymentId,
    projectId: input.projectId,
  });
  if (!deployment) {
    throw new HostedVoiceDeploymentStateError(
      "Hosted voice deployment was not found in this project.",
    );
  }
  return deployment;
}

function buildVersionName(definitionKey: string, definitionHash: string) {
  return `Lia ${definitionKey} ${definitionHash.slice(0, 8)}`.slice(0, 50);
}
