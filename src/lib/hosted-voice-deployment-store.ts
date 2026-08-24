import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db-config";
import {
  auditLogs,
  hostedVoiceDeployments,
  hostedVoiceDeploymentVersions,
  integrationProviders,
} from "@/lib/db-schema";
import { voiceAgentDefinitionV1Schema } from "@/lib/hosted-voice-contract";
import {
  type HostedVoiceDeploymentRecord,
  type HostedVoiceDeploymentRepository,
  HostedVoiceDeploymentStateError,
} from "@/lib/hosted-voice-deployment";
import {
  type TelnyxHostedAssistantManagedConfig,
  telnyxHostedAssistantManagedConfigSchema,
} from "@/lib/telnyx-hosted-voice";

const deploymentStatusSchema = z.enum([
  "candidate",
  "disabled",
  "draft",
  "drifted",
  "main",
]);

export const telnyxHostedVoiceDeploymentRepository = {
  async findDeployment({ definitionKey, projectId, providerId }) {
    const [row] = await db
      .select()
      .from(hostedVoiceDeployments)
      .where(
        and(
          eq(hostedVoiceDeployments.projectId, projectId),
          eq(hostedVoiceDeployments.providerId, providerId),
          eq(hostedVoiceDeployments.definitionKey, definitionKey),
        ),
      )
      .limit(1);
    return row ? mapDeployment(row) : null;
  },

  async findDeploymentById({ deploymentId, projectId }) {
    const [row] = await db
      .select()
      .from(hostedVoiceDeployments)
      .where(
        and(
          eq(hostedVoiceDeployments.id, deploymentId),
          eq(hostedVoiceDeployments.projectId, projectId),
        ),
      )
      .limit(1);
    return row ? mapDeployment(row) : null;
  },

  async findVersion({ deploymentId, projectId, remoteVersionId }) {
    const [row] = await db
      .select()
      .from(hostedVoiceDeploymentVersions)
      .where(
        and(
          eq(hostedVoiceDeploymentVersions.deploymentId, deploymentId),
          eq(hostedVoiceDeploymentVersions.projectId, projectId),
          eq(hostedVoiceDeploymentVersions.remoteVersionId, remoteVersionId),
        ),
      )
      .limit(1);
    if (!row) return null;

    return {
      definition: row.definition
        ? voiceAgentDefinitionV1Schema.parse(row.definition)
        : null,
      definitionHash: row.definitionHash,
      deploymentId: row.deploymentId,
      managedConfig: telnyxHostedAssistantManagedConfigSchema.parse(
        row.managedConfig,
      ),
      managedHash: row.managedHash,
      observedManagedHash: row.observedManagedHash,
      projectId: row.projectId,
      remoteVersionId: row.remoteVersionId,
      source: z.enum(["lia", "remote_import"]).parse(row.source),
      status: z.enum(["candidate", "main", "superseded"]).parse(row.status),
    };
  },

  async importRemote({ deployment, inspection, managedHash, resolution }) {
    return db.transaction(async (tx) => {
      await tx
        .update(hostedVoiceDeploymentVersions)
        .set({ status: "superseded" })
        .where(
          and(
            eq(hostedVoiceDeploymentVersions.projectId, deployment.projectId),
            eq(hostedVoiceDeploymentVersions.deploymentId, deployment.id),
            sql`${hostedVoiceDeploymentVersions.status} in ('main', 'candidate')`,
          ),
        );
      await tx
        .insert(hostedVoiceDeploymentVersions)
        .values({
          definition: null,
          definitionHash: null,
          deploymentId: deployment.id,
          managedConfig: asJsonRecord(inspection.managedConfig),
          managedHash,
          observedManagedHash: managedHash,
          projectId: deployment.projectId,
          promotedAt: new Date(),
          remoteVersionId: inspection.versionId,
          source: "remote_import",
          status: "main",
        })
        .onConflictDoUpdate({
          target: [
            hostedVoiceDeploymentVersions.deploymentId,
            hostedVoiceDeploymentVersions.remoteVersionId,
          ],
          set: {
            definition: null,
            definitionHash: null,
            managedConfig: asJsonRecord(inspection.managedConfig),
            managedHash,
            observedManagedHash: managedHash,
            promotedAt: new Date(),
            source: "remote_import",
            status: "main",
          },
        });
      const updated = await updateDeployment(tx, {
        deployment,
        values: {
          candidateManagedHash: null,
          candidateRemoteVersionId: null,
          mainManagedHash: managedHash,
          mainRemoteVersionId: inspection.versionId,
          observedManagedHash: managedHash,
          rollbackRemoteVersionId: deployment.mainRemoteVersionId,
          status: "main",
        },
      });
      await insertAudit(
        tx,
        updated,
        resolution === "import"
          ? "hosted_voice.drift_imported"
          : "hosted_voice.drift_overwrite_confirmed",
        {
          remoteVersionId: inspection.versionId,
          managedHash,
        },
      );
      return updated;
    });
  },

  async markCandidate(input) {
    return db.transaction(async (tx) => {
      const deployment = input.deployment
        ? await updateDeployment(tx, {
            deployment: input.deployment,
            values: {
              candidateManagedHash: input.managedHash,
              candidateRemoteVersionId: input.remoteVersionId,
              status: "candidate",
            },
          })
        : await insertDeployment(tx, input);

      if (input.bootstrapMainVersionId) {
        await tx.insert(hostedVoiceDeploymentVersions).values({
          definition: asJsonRecord(input.definition),
          definitionHash: input.definitionHash,
          deploymentId: deployment.id,
          managedConfig: asJsonRecord(input.managedConfig),
          managedHash: input.managedHash,
          observedManagedHash: input.managedHash,
          projectId: input.projectId,
          promotedAt: new Date(),
          remoteVersionId: input.bootstrapMainVersionId,
          source: "lia",
          status: "main",
        });
      }
      await tx.insert(hostedVoiceDeploymentVersions).values({
        definition: asJsonRecord(input.definition),
        definitionHash: input.definitionHash,
        deploymentId: deployment.id,
        managedConfig: asJsonRecord(input.managedConfig),
        managedHash: input.managedHash,
        observedManagedHash: input.observedManagedHash,
        projectId: input.projectId,
        remoteVersionId: input.remoteVersionId,
        source: "lia",
        status: "candidate",
      });
      await insertAudit(tx, deployment, "hosted_voice.candidate_created", {
        definitionHash: input.definitionHash,
        managedHash: input.managedHash,
        remoteVersionId: input.remoteVersionId,
      });
      return deployment;
    });
  },

  async markDrift({
    deployment,
    observedManagedHash,
    observedRemoteVersionId,
  }) {
    return db.transaction(async (tx) => {
      const updated = await updateDeployment(tx, {
        deployment,
        values: {
          lastInspectedAt: new Date(),
          observedManagedHash,
          status: "drifted",
        },
      });
      await insertAudit(tx, updated, "hosted_voice.drift_detected", {
        expectedManagedHash: deployment.mainManagedHash,
        expectedRemoteVersionId: deployment.mainRemoteVersionId,
        observedManagedHash,
        observedRemoteVersionId,
      });
      return updated;
    });
  },

  async markPromoted({ deployment, managedHash, remoteVersionId }) {
    return db.transaction(async (tx) => {
      await tx
        .update(hostedVoiceDeploymentVersions)
        .set({ status: "superseded" })
        .where(
          and(
            eq(hostedVoiceDeploymentVersions.projectId, deployment.projectId),
            eq(hostedVoiceDeploymentVersions.deploymentId, deployment.id),
            eq(hostedVoiceDeploymentVersions.status, "main"),
          ),
        );
      await tx
        .update(hostedVoiceDeploymentVersions)
        .set({ promotedAt: new Date(), status: "main" })
        .where(
          and(
            eq(hostedVoiceDeploymentVersions.projectId, deployment.projectId),
            eq(hostedVoiceDeploymentVersions.deploymentId, deployment.id),
            eq(hostedVoiceDeploymentVersions.remoteVersionId, remoteVersionId),
          ),
        );
      const updated = await updateDeployment(tx, {
        deployment,
        values: {
          candidateManagedHash: null,
          candidateRemoteVersionId: null,
          mainManagedHash: managedHash,
          mainRemoteVersionId: remoteVersionId,
          observedManagedHash: managedHash,
          rollbackRemoteVersionId: deployment.mainRemoteVersionId,
          status: "main",
        },
      });
      await insertAudit(
        tx,
        updated,
        deployment.candidateRemoteVersionId === remoteVersionId
          ? "hosted_voice.candidate_promoted"
          : "hosted_voice.rollback_promoted",
        {
          managedHash,
          previousMainVersionId: deployment.mainRemoteVersionId,
          remoteVersionId,
        },
      );
      return updated;
    });
  },

  async recordInspection({ deployment, observedManagedHash }) {
    return db.transaction(async (tx) => {
      const updated = await updateDeployment(tx, {
        deployment,
        values: { lastInspectedAt: new Date(), observedManagedHash },
      });
      await insertAudit(tx, updated, "hosted_voice.inspected", {
        managedHash: observedManagedHash,
        remoteVersionId: deployment.mainRemoteVersionId,
      });
      return updated;
    });
  },
} satisfies HostedVoiceDeploymentRepository<TelnyxHostedAssistantManagedConfig>;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertDeployment(
  tx: Transaction,
  input: Parameters<
    HostedVoiceDeploymentRepository<TelnyxHostedAssistantManagedConfig>["markCandidate"]
  >[0],
) {
  const [provider] = await tx
    .select({ id: integrationProviders.id })
    .from(integrationProviders)
    .where(
      and(
        eq(integrationProviders.id, input.providerId),
        eq(integrationProviders.projectId, input.projectId),
        eq(integrationProviders.providerType, "telnyx_ai_assistant"),
        eq(integrationProviders.status, "active"),
      ),
    )
    .limit(1);
  if (!provider) {
    throw new HostedVoiceDeploymentStateError(
      "Active Telnyx AI Assistant provider was not found in this project.",
    );
  }

  const [row] = await tx
    .insert(hostedVoiceDeployments)
    .values({
      candidateManagedHash: input.managedHash,
      candidateRemoteVersionId: input.remoteVersionId,
      definitionKey: input.definition.key,
      mainManagedHash: input.bootstrapMainVersionId ? input.managedHash : null,
      mainRemoteVersionId: input.bootstrapMainVersionId,
      observedManagedHash: input.bootstrapMainVersionId
        ? input.managedHash
        : null,
      projectId: input.projectId,
      providerId: input.providerId,
      remoteAssistantId: input.remoteAssistantId,
      status: "candidate",
    })
    .returning();
  if (!row) {
    throw new HostedVoiceDeploymentStateError(
      "Hosted voice deployment could not be created.",
    );
  }
  return mapDeployment(row);
}

async function updateDeployment(
  tx: Transaction,
  input: {
    deployment: HostedVoiceDeploymentRecord;
    values: Partial<typeof hostedVoiceDeployments.$inferInsert>;
  },
) {
  const [row] = await tx
    .update(hostedVoiceDeployments)
    .set({
      ...input.values,
      revision: sql`${hostedVoiceDeployments.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(hostedVoiceDeployments.id, input.deployment.id),
        eq(hostedVoiceDeployments.projectId, input.deployment.projectId),
        eq(hostedVoiceDeployments.revision, input.deployment.revision),
      ),
    )
    .returning();
  if (!row) {
    throw new HostedVoiceDeploymentStateError(
      "Hosted voice deployment changed during this operation.",
    );
  }
  return mapDeployment(row);
}

async function insertAudit(
  tx: Transaction,
  deployment: HostedVoiceDeploymentRecord,
  action: string,
  metadata: Record<string, unknown>,
) {
  await tx.insert(auditLogs).values({
    action,
    metadata,
    projectId: deployment.projectId,
    targetId: String(deployment.id),
    targetType: "hosted_voice_deployment",
  });
}

function mapDeployment(
  row: typeof hostedVoiceDeployments.$inferSelect,
): HostedVoiceDeploymentRecord {
  return {
    candidateManagedHash: row.candidateManagedHash,
    candidateRemoteVersionId: row.candidateRemoteVersionId,
    definitionKey: row.definitionKey,
    id: row.id,
    mainManagedHash: row.mainManagedHash,
    mainRemoteVersionId: row.mainRemoteVersionId,
    observedManagedHash: row.observedManagedHash,
    projectId: row.projectId,
    providerId: row.providerId,
    remoteAssistantId: row.remoteAssistantId,
    revision: row.revision,
    rollbackRemoteVersionId: row.rollbackRemoteVersionId,
    status: deploymentStatusSchema.parse(row.status),
  };
}

function asJsonRecord(value: unknown) {
  return value as Record<string, unknown>;
}
