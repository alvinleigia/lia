import { createHash } from "node:crypto";
import { z } from "zod";

export const HOSTED_VOICE_CAPABILITIES = [
  "asynchronous_tools",
  "dynamic_context",
  "interruptions",
  "native_conversation",
  "post_call_events",
  "synchronous_tools",
  "transfer",
  "versioned_deployment",
] as const;

export type HostedVoiceCapability = (typeof HOSTED_VOICE_CAPABILITIES)[number];

const stableKey = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-zA-Z0-9_]*$/);

const publishedTaskVersionRefV1Schema = z
  .object({
    taskId: z.number().int().positive(),
    taskVersionId: z.number().int().positive(),
  })
  .strict();

const hostedVoiceToolRefV1Schema = z
  .object({
    id: z.string().trim().min(1).max(120),
    version: z.number().int().positive(),
  })
  .strict();

export const voiceAgentDefinitionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    key: stableKey,
    name: z.string().trim().min(1).max(160),
    instructions: z.string().trim().min(1).max(32_000),
    greeting: z.discriminatedUnion("strategy", [
      z.object({ strategy: z.literal("wait"), text: z.null() }).strict(),
      z
        .object({
          strategy: z.literal("exact"),
          text: z.string().trim().min(1).max(2_000),
        })
        .strict(),
      z.object({ strategy: z.literal("generated"), text: z.null() }).strict(),
    ]),
    locale: z
      .object({
        language: z.string().trim().min(2).max(40),
        timezone: z.string().trim().min(1).max(120),
      })
      .strict(),
    publishedTaskVersions: z.array(publishedTaskVersionRefV1Schema).max(100),
    tools: z.array(hostedVoiceToolRefV1Schema).max(100),
    confirmation: z
      .object({
        writeOperations: z.literal("explicit"),
      })
      .strict(),
    identity: z
      .object({
        defaultRequirement: z.enum(["anonymous", "verified"]),
        verificationFactors: z.array(stableKey).max(20),
      })
      .strict(),
    handoff: z
      .object({
        mode: z.enum(["disabled", "available", "required"]),
      })
      .strict(),
    retention: z
      .object({
        mode: z.enum(["disabled", "metadata_only", "transcript"]),
        days: z.number().int().min(1).max(3_650).nullable(),
      })
      .strict(),
    requiredCapabilities: z.array(z.enum(HOSTED_VOICE_CAPABILITIES)).min(1),
  })
  .strict()
  .superRefine((definition, context) => {
    if (
      definition.identity.defaultRequirement === "verified" &&
      definition.identity.verificationFactors.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Verified identity requires at least one factor.",
        path: ["identity", "verificationFactors"],
      });
    }
    if (
      definition.retention.mode === "disabled" &&
      definition.retention.days !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Disabled retention cannot declare a retention period.",
        path: ["retention", "days"],
      });
    }
    if (
      definition.retention.mode !== "disabled" &&
      definition.retention.days === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Enabled retention requires an explicit retention period.",
        path: ["retention", "days"],
      });
    }
  });

export type VoiceAgentDefinitionV1 = z.infer<
  typeof voiceAgentDefinitionV1Schema
>;

export type HostedVoiceProviderProfile = {
  capabilities: Record<HostedVoiceCapability, boolean>;
  provider: string;
};

export type HostedVoiceCompatibilityReport = {
  compatible: boolean;
  missingCapabilities: HostedVoiceCapability[];
  provider: string;
};

export type HostedVoiceCompilerInput = {
  definition: VoiceAgentDefinitionV1;
  definitionHash: string;
};

export type HostedVoiceCompileResult<TManagedConfig> = {
  definition: VoiceAgentDefinitionV1;
  definitionHash: string;
  managedConfig: TManagedConfig;
  provider: string;
};

export interface HostedVoiceProviderCompiler<TManagedConfig> {
  profile: HostedVoiceProviderProfile;
  compile(input: HostedVoiceCompilerInput): TManagedConfig;
}

export type HostedVoiceRemoteVersion = {
  assistantId: string;
  previousMainVersionId: string | null;
  versionId: string;
};

export type HostedVoiceRemoteInspection<TManagedConfig> = {
  activeVersionId: string | null;
  assistantId: string;
  managedConfig: TManagedConfig;
  versionId: string;
};

export interface HostedVoiceProviderAdapter<TManagedConfig>
  extends HostedVoiceProviderCompiler<TManagedConfig> {
  createDraft(input: {
    definitionHash: string;
    managedConfig: TManagedConfig;
    remoteAssistantId: string | null;
    versionName: string;
  }): Promise<HostedVoiceRemoteVersion>;
  deactivate(input: { assistantId: string }): Promise<void>;
  inspect(input: {
    assistantId: string;
    versionId?: string;
  }): Promise<HostedVoiceRemoteInspection<TManagedConfig>>;
  promote(input: HostedVoiceRemoteVersion): Promise<void>;
}

export class HostedVoiceCapabilityError extends Error {
  constructor(readonly report: HostedVoiceCompatibilityReport) {
    super(
      `Hosted voice provider ${report.provider} is missing required capabilities: ${report.missingCapabilities.join(", ")}.`,
    );
    this.name = "HostedVoiceCapabilityError";
  }
}

export function normalizeVoiceAgentDefinitionV1(
  value: unknown,
): VoiceAgentDefinitionV1 {
  const parsed = voiceAgentDefinitionV1Schema.parse(value);

  return {
    ...parsed,
    identity: {
      ...parsed.identity,
      verificationFactors: [
        ...new Set(parsed.identity.verificationFactors),
      ].sort(),
    },
    publishedTaskVersions: [...parsed.publishedTaskVersions].sort(
      (left, right) =>
        left.taskVersionId - right.taskVersionId || left.taskId - right.taskId,
    ),
    requiredCapabilities: [...new Set(parsed.requiredCapabilities)].sort(),
    tools: [...parsed.tools].sort(
      (left, right) =>
        left.id.localeCompare(right.id) || left.version - right.version,
    ),
  };
}

export function hashVoiceAgentDefinitionV1(value: unknown) {
  return createHash("sha256")
    .update(stableJson(normalizeVoiceAgentDefinitionV1(value)))
    .digest("hex");
}

export function hashHostedVoiceManagedConfig(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function getHostedVoiceCompatibility(input: {
  definition: VoiceAgentDefinitionV1;
  profile: HostedVoiceProviderProfile;
}): HostedVoiceCompatibilityReport {
  const missingCapabilities = input.definition.requiredCapabilities.filter(
    (capability) => !input.profile.capabilities[capability],
  );

  return {
    compatible: missingCapabilities.length === 0,
    missingCapabilities,
    provider: input.profile.provider,
  };
}

export function compileHostedVoiceAgent<TManagedConfig>(input: {
  compiler: HostedVoiceProviderCompiler<TManagedConfig>;
  definition: unknown;
}): HostedVoiceCompileResult<TManagedConfig> {
  const definition = normalizeVoiceAgentDefinitionV1(input.definition);
  const compatibility = getHostedVoiceCompatibility({
    definition,
    profile: input.compiler.profile,
  });

  if (!compatibility.compatible) {
    throw new HostedVoiceCapabilityError(compatibility);
  }

  const definitionHash = hashVoiceAgentDefinitionV1(definition);
  return {
    definition,
    definitionHash,
    managedConfig: input.compiler.compile({ definition, definitionHash }),
    provider: input.compiler.profile.provider,
  };
}

function stableJson(value: unknown) {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJsonValue(item)]),
    );
  }

  return value;
}
