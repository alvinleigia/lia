import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db-config";
import {
  hostedVoiceDeployments,
  hostedVoiceDeploymentVersions,
  integrationProviders,
  providerSecrets,
} from "@/lib/db-schema";
import { voiceAgentDefinitionV1Schema } from "@/lib/hosted-voice-contract";
import {
  hydrateProviderConfig,
  prepareProviderConfig,
} from "@/lib/provider-secrets";
import { telnyxHostedVoiceSettingsSchema } from "@/lib/telnyx-hosted-voice";
import { createTelnyxHostedVoiceAdapter } from "@/lib/telnyx-hosted-voice-adapter";

export const telnyxHostedVoiceProviderConfigSchema =
  telnyxHostedVoiceSettingsSchema.extend({
    apiKey: z.string().trim().min(1),
    costRateMicrounitsPerMinute: z
      .number()
      .int()
      .min(0)
      .max(1_000_000_000)
      .default(0),
    webhookPublicKey: z.string().trim().min(1).max(2_000).optional(),
  });

export async function createProjectTelnyxHostedVoiceProvider(input: {
  config: z.input<typeof telnyxHostedVoiceProviderConfigSchema>;
  name: string;
  projectId: number;
}) {
  const config = telnyxHostedVoiceProviderConfigSchema.parse(input.config);
  const prepared = prepareProviderConfig(config);

  return db.transaction(async (tx) => {
    const [provider] = await tx
      .insert(integrationProviders)
      .values({
        config: prepared.config,
        name: input.name,
        projectId: input.projectId,
        providerType: "telnyx_ai_assistant",
        status: "active",
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

export async function getProjectTelnyxHostedVoiceProvider(input: {
  fetchImpl?: typeof fetch;
  projectId: number;
  providerId: number;
}) {
  const [provider] = await db
    .select()
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
    throw new Error("Active Telnyx AI Assistant provider was not found.");
  }

  const config = telnyxHostedVoiceProviderConfigSchema.parse(
    await hydrateProviderConfig({
      config: provider.config,
      projectId: input.projectId,
      providerId: input.providerId,
    }),
  );
  const { apiKey, costRateMicrounitsPerMinute, webhookPublicKey, ...settings } =
    config;
  return {
    adapter: createTelnyxHostedVoiceAdapter({
      apiKey,
      fetchImpl: input.fetchImpl,
      settings,
    }),
    costRateMicrounitsPerMinute,
    provider,
    webhookPublicKey: webhookPublicKey ?? null,
  };
}

export async function getProjectTelnyxHostedVoiceRuntime(input: {
  deploymentId: number;
  projectId: number;
}) {
  const [deployment] = await db
    .select()
    .from(hostedVoiceDeployments)
    .where(
      and(
        eq(hostedVoiceDeployments.id, input.deploymentId),
        eq(hostedVoiceDeployments.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!deployment) return null;
  const config = await getHostedProviderConfig({
    projectId: input.projectId,
    providerId: deployment.providerId,
  });
  return config ? { ...config, deployment } : null;
}

export async function getTelnyxHostedVoiceEventContext(assistantId: string) {
  const [deployment] = await db
    .select()
    .from(hostedVoiceDeployments)
    .where(eq(hostedVoiceDeployments.remoteAssistantId, assistantId))
    .limit(1);
  if (!deployment) return null;
  const config = await getHostedProviderConfig({
    projectId: deployment.projectId,
    providerId: deployment.providerId,
  });
  if (!config?.webhookPublicKey) return null;
  const [version] = deployment.mainRemoteVersionId
    ? await db
        .select({
          definition: hostedVoiceDeploymentVersions.definition,
          id: hostedVoiceDeploymentVersions.id,
        })
        .from(hostedVoiceDeploymentVersions)
        .where(
          and(
            eq(hostedVoiceDeploymentVersions.deploymentId, deployment.id),
            eq(hostedVoiceDeploymentVersions.projectId, deployment.projectId),
            eq(
              hostedVoiceDeploymentVersions.remoteVersionId,
              deployment.mainRemoteVersionId,
            ),
          ),
        )
        .limit(1)
    : [];
  if (!version?.definition) return null;
  const definition = voiceAgentDefinitionV1Schema.parse(version.definition);
  return {
    ...config,
    deploymentId: deployment.id,
    deploymentVersionId: version.id,
    projectId: deployment.projectId,
    retention: definition.retention,
  };
}

async function getHostedProviderConfig(input: {
  projectId: number;
  providerId: number;
}) {
  const [provider] = await db
    .select()
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
  if (!provider) return null;
  return telnyxHostedVoiceProviderConfigSchema.parse(
    await hydrateProviderConfig({
      config: provider.config,
      projectId: input.projectId,
      providerId: input.providerId,
    }),
  );
}
