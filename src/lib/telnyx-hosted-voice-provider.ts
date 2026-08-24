import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db-config";
import { integrationProviders, providerSecrets } from "@/lib/db-schema";
import {
  hydrateProviderConfig,
  prepareProviderConfig,
} from "@/lib/provider-secrets";
import { telnyxHostedVoiceSettingsSchema } from "@/lib/telnyx-hosted-voice";
import { createTelnyxHostedVoiceAdapter } from "@/lib/telnyx-hosted-voice-adapter";

export const telnyxHostedVoiceProviderConfigSchema =
  telnyxHostedVoiceSettingsSchema.extend({
    apiKey: z.string().trim().min(1),
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
  const { apiKey, ...settings } = config;
  return {
    adapter: createTelnyxHostedVoiceAdapter({
      apiKey,
      fetchImpl: input.fetchImpl,
      settings,
    }),
    provider,
  };
}
