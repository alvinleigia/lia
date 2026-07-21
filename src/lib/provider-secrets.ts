import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { integrationProviders, providerSecrets } from "@/lib/db-schema";
import {
  decryptSecretValue,
  encryptSecretValue,
  getEncryptedSecretPayload,
} from "@/lib/encrypted-secrets";

const PROVIDER_SECRET_REFERENCE_KEY = "$liaProviderSecret";

type ProviderSecretReference = {
  [PROVIDER_SECRET_REFERENCE_KEY]: string;
};

export type PreparedProviderSecret = {
  authenticationTag: string;
  ciphertext: string;
  initializationVector: string;
  keyVersion: number;
  secretName: string;
};

function isProviderSecretReference(
  value: unknown,
): value is ProviderSecretReference {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)[PROVIDER_SECRET_REFERENCE_KEY] ===
      "string"
  );
}

function isSensitiveConfigKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");

  return (
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("token") ||
    normalized.includes("apikey") ||
    normalized.includes("authorization") ||
    normalized.includes("privatekey") ||
    normalized.includes("signingkey") ||
    normalized.includes("credential")
  );
}

export function prepareProviderConfig(config: Record<string, unknown>): {
  config: Record<string, unknown>;
  secrets: PreparedProviderSecret[];
} {
  const secrets: PreparedProviderSecret[] = [];

  function visit(value: unknown, path: string[], sensitive: boolean): unknown {
    if (isProviderSecretReference(value)) {
      return value;
    }

    if (typeof value === "string" && sensitive && value.length > 0) {
      const secretName = path.join(".");
      const payload = getEncryptedSecretPayload(encryptSecretValue(value));
      secrets.push({ secretName, ...payload });
      return { [PROVIDER_SECRET_REFERENCE_KEY]: secretName };
    }

    if (Array.isArray(value)) {
      return value.map((entry, index) =>
        visit(entry, [...path, String(index)], sensitive),
      );
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          visit(entry, [...path, key], sensitive || isSensitiveConfigKey(key)),
        ]),
      );
    }

    return value;
  }

  return {
    config: visit(config, [], false) as Record<string, unknown>,
    secrets,
  };
}

export async function hydrateProviderConfig(input: {
  config: Record<string, unknown>;
  projectId: number;
  providerId: number;
}) {
  const prepared = prepareProviderConfig(input.config);
  let storedConfig = input.config;

  if (prepared.secrets.length > 0) {
    await db.transaction(async (tx) => {
      const [provider] = await tx
        .update(integrationProviders)
        .set({ config: prepared.config, updatedAt: new Date() })
        .where(
          and(
            eq(integrationProviders.projectId, input.projectId),
            eq(integrationProviders.id, input.providerId),
          ),
        )
        .returning({ id: integrationProviders.id });

      if (!provider) {
        throw new Error("Provider was not found for this project.");
      }

      for (const secret of prepared.secrets) {
        await tx
          .insert(providerSecrets)
          .values({
            ...secret,
            projectId: input.projectId,
            providerId: input.providerId,
          })
          .onConflictDoUpdate({
            target: [providerSecrets.providerId, providerSecrets.secretName],
            set: {
              authenticationTag: secret.authenticationTag,
              ciphertext: secret.ciphertext,
              initializationVector: secret.initializationVector,
              keyVersion: secret.keyVersion,
              projectId: input.projectId,
              updatedAt: new Date(),
            },
          });
      }
    });
    storedConfig = prepared.config;
  }

  const rows = await db
    .select()
    .from(providerSecrets)
    .where(
      and(
        eq(providerSecrets.projectId, input.projectId),
        eq(providerSecrets.providerId, input.providerId),
      ),
    );
  const secretsByName = new Map(
    rows.map((row) => [
      row.secretName,
      decryptSecretValue({
        $liaEncryptedSecret: {
          authenticationTag: row.authenticationTag,
          ciphertext: row.ciphertext,
          initializationVector: row.initializationVector,
          keyVersion: row.keyVersion,
        },
      }),
    ]),
  );

  function visit(value: unknown): unknown {
    if (isProviderSecretReference(value)) {
      const secretName = value[PROVIDER_SECRET_REFERENCE_KEY];
      const secret = secretsByName.get(secretName);
      if (typeof secret !== "string") {
        throw new Error(`Provider credential ${secretName} is unavailable.`);
      }

      return secret;
    }

    if (Array.isArray(value)) {
      return value.map(visit);
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, visit(entry)]),
      );
    }

    return value;
  }

  return visit(storedConfig) as Record<string, unknown>;
}
