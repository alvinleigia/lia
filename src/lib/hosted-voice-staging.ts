import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  conversationalTaskSnapshotV1Schema,
  type ToolDefinitionV1,
} from "@/lib/conversation-contracts";
import { db } from "@/lib/db-config";
import {
  conversationalTasks,
  conversationalTaskVersions,
  hostedVoiceDeployments,
  hostedVoiceDeploymentVersions,
  hostedVoiceToolBindings,
} from "@/lib/db-schema";
import {
  HOSTED_VOICE_CAPABILITIES,
  type VoiceAgentDefinitionV1,
  voiceAgentDefinitionV1Schema,
} from "@/lib/hosted-voice-contract";
import { hashHostedVoiceToolValue } from "@/lib/hosted-voice-tool-contract";
import {
  getProjectTelnyxHostedVoiceProviderRecord,
  telnyxHostedVoiceProviderConfigSchema,
} from "@/lib/telnyx-hosted-voice-provider";

export const hostedVoiceStagingDefinitionInputSchema = z.object({
  greeting: z.string().trim().min(1).max(2_000),
  handoffMode: z.enum(["disabled", "available", "required"]),
  identityRequirement: z.enum(["anonymous", "verified"]),
  instructions: z.string().trim().min(1).max(32_000),
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-zA-Z0-9_]*$/),
  language: z.string().trim().min(2).max(40),
  name: z.string().trim().min(1).max(160),
  retentionDays: z.number().int().min(1).max(365),
  taskVersionIds: z.array(z.number().int().positive()).min(1).max(100),
  timezone: z.string().trim().min(1).max(120),
  verificationFactors: z.array(
    z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-zA-Z0-9_]*$/),
  ),
});

export async function buildHostedVoiceStagingDefinition(input: {
  projectId: number;
  value: z.infer<typeof hostedVoiceStagingDefinitionInputSchema>;
}) {
  const value = hostedVoiceStagingDefinitionInputSchema.parse(input.value);
  const versionIds = [...new Set(value.taskVersionIds)];
  const versions = await db
    .select({
      snapshot: conversationalTaskVersions.snapshot,
      taskId: conversationalTaskVersions.taskId,
      taskVersionId: conversationalTaskVersions.id,
    })
    .from(conversationalTaskVersions)
    .innerJoin(
      conversationalTasks,
      and(
        eq(conversationalTasks.id, conversationalTaskVersions.taskId),
        eq(conversationalTasks.projectId, conversationalTaskVersions.projectId),
      ),
    )
    .where(
      and(
        eq(conversationalTaskVersions.projectId, input.projectId),
        eq(conversationalTasks.isArchived, false),
        inArray(conversationalTaskVersions.id, versionIds),
      ),
    );
  if (versions.length !== versionIds.length) {
    throw new Error(
      "Every hosted voice task must be an available published version in this project.",
    );
  }

  const tools = new Map<string, VoiceAgentDefinitionV1["tools"][number]>();
  const toolDefinitions = new Map<string, ToolDefinitionV1>();
  for (const version of versions) {
    const snapshot = conversationalTaskSnapshotV1Schema.parse(version.snapshot);
    for (const definition of snapshot.toolDefinitions) {
      tools.set(`${definition.id}:${definition.version}`, {
        id: definition.id,
        version: definition.version,
      });
      toolDefinitions.set(`${definition.id}:${definition.version}`, definition);
    }
  }
  validateHostedVoiceVerificationFactors({
    identityRequirement: value.identityRequirement,
    toolDefinitions: [...toolDefinitions.values()],
    verificationFactors: value.verificationFactors,
  });

  return voiceAgentDefinitionV1Schema.parse({
    confirmation: { writeOperations: "explicit" },
    greeting: { strategy: "exact", text: value.greeting },
    handoff: { mode: value.handoffMode },
    identity: {
      defaultRequirement: value.identityRequirement,
      verificationFactors: [...new Set(value.verificationFactors)].sort(),
    },
    instructions: value.instructions,
    key: value.key,
    locale: { language: value.language, timezone: value.timezone },
    name: value.name,
    publishedTaskVersions: versions
      .map((version) => ({
        taskId: version.taskId,
        taskVersionId: version.taskVersionId,
      }))
      .sort((left, right) => left.taskVersionId - right.taskVersionId),
    requiredCapabilities: [...HOSTED_VOICE_CAPABILITIES],
    retention: { days: value.retentionDays, mode: "metadata_only" },
    schemaVersion: 1,
    tools: [...tools.values()],
  });
}

export function validateHostedVoiceVerificationFactors(input: {
  identityRequirement: "anonymous" | "verified";
  toolDefinitions: ToolDefinitionV1[];
  verificationFactors: string[];
}) {
  if (input.identityRequirement !== "verified") return;
  const available = new Set(
    input.toolDefinitions.flatMap((tool) =>
      tool.inputSchema.fields
        .filter(({ source }) => source.kind !== "literal")
        .map(({ key }) => key),
    ),
  );
  const missing = [...new Set(input.verificationFactors)]
    .filter((factor) => !available.has(factor))
    .sort();
  if (missing.length > 0) {
    throw new Error(
      `Verification factors are unavailable in the selected task tools: ${missing.join(", ")}.`,
    );
  }
  const hasVerifyingLookup = input.toolDefinitions
    .filter(({ access }) => access === "read")
    .some((tool) => {
      const inputKeys = new Set(
        tool.inputSchema.fields
          .filter(({ source }) => source.kind !== "literal")
          .map(({ key }) => key),
      );
      return input.verificationFactors.every((factor) => inputKeys.has(factor));
    });
  if (!hasVerifyingLookup) {
    throw new Error(
      "No selected read tool accepts every configured verification factor.",
    );
  }
}

export async function getHostedVoiceStagingState(projectId: number) {
  const provider = await getProjectTelnyxHostedVoiceProviderRecord(projectId);
  if (!provider) return { deployment: null, provider: null };
  const publicProviderConfig = {
    costRateMicrounitsPerMinute: provider.config.costRateMicrounitsPerMinute,
    modelId: provider.config.modelId,
    transcriptionLanguage: provider.config.transcriptionLanguage,
    transcriptionModelId: provider.config.transcriptionModelId,
    voiceId: provider.config.voiceId,
    webhookPublicKey: provider.config.webhookPublicKey,
  };
  const parsedConfig = telnyxHostedVoiceProviderConfigSchema
    .omit({ apiKey: true })
    .safeParse(publicProviderConfig);
  const [deployment] = await db
    .select()
    .from(hostedVoiceDeployments)
    .where(
      and(
        eq(hostedVoiceDeployments.projectId, projectId),
        eq(hostedVoiceDeployments.providerId, provider.id),
      ),
    )
    .orderBy(desc(hostedVoiceDeployments.updatedAt))
    .limit(1);
  if (!deployment) {
    return {
      deployment: null,
      provider: {
        config: parsedConfig.success ? parsedConfig.data : null,
        hasApiKey: Boolean(provider.config.apiKey),
        id: provider.id,
        name: provider.name,
      },
    };
  }
  const [candidateVersion] = deployment.candidateRemoteVersionId
    ? await db
        .select({
          definition: hostedVoiceDeploymentVersions.definition,
          definitionHash: hostedVoiceDeploymentVersions.definitionHash,
          id: hostedVoiceDeploymentVersions.id,
        })
        .from(hostedVoiceDeploymentVersions)
        .where(
          and(
            eq(hostedVoiceDeploymentVersions.projectId, projectId),
            eq(hostedVoiceDeploymentVersions.deploymentId, deployment.id),
            eq(
              hostedVoiceDeploymentVersions.remoteVersionId,
              deployment.candidateRemoteVersionId,
            ),
          ),
        )
        .limit(1)
    : [];
  const [binding] = candidateVersion
    ? await db
        .select({
          id: hostedVoiceToolBindings.id,
          updatedAt: hostedVoiceToolBindings.updatedAt,
        })
        .from(hostedVoiceToolBindings)
        .where(
          and(
            eq(hostedVoiceToolBindings.projectId, projectId),
            eq(
              hostedVoiceToolBindings.deploymentVersionId,
              candidateVersion.id,
            ),
            eq(hostedVoiceToolBindings.provider, "telnyx"),
            eq(hostedVoiceToolBindings.status, "active"),
          ),
        )
        .limit(1)
    : [];

  return {
    deployment: {
      bindingId: binding?.id ?? null,
      bindingUpdatedAt: binding?.updatedAt ?? null,
      candidateDefinitionHash: candidateVersion?.definitionHash ?? null,
      candidateDeploymentVersionId: candidateVersion?.id ?? null,
      candidateRemoteVersionId: deployment.candidateRemoteVersionId,
      definitionKey: deployment.definitionKey,
      id: deployment.id,
      mainRemoteVersionId: deployment.mainRemoteVersionId,
      remoteAssistantId: deployment.remoteAssistantId,
      rollbackRemoteVersionId: deployment.rollbackRemoteVersionId,
      status: deployment.status,
    },
    provider: {
      config: parsedConfig.success ? parsedConfig.data : null,
      hasApiKey: Boolean(provider.config.apiKey),
      id: provider.id,
      name: provider.name,
    },
  };
}

export async function buildTelnyxHostedVoiceToolSetup(input: {
  deploymentVersionId: number;
  projectId: number;
}) {
  const [version] = await db
    .select({ definition: hostedVoiceDeploymentVersions.definition })
    .from(hostedVoiceDeploymentVersions)
    .where(
      and(
        eq(hostedVoiceDeploymentVersions.id, input.deploymentVersionId),
        eq(hostedVoiceDeploymentVersions.projectId, input.projectId),
        eq(hostedVoiceDeploymentVersions.status, "candidate"),
        eq(hostedVoiceDeploymentVersions.source, "lia"),
      ),
    )
    .limit(1);
  if (!version?.definition) {
    throw new Error("A Lia-authored candidate is required for tool setup.");
  }
  const definition = voiceAgentDefinitionV1Schema.parse(version.definition);
  const toolDefinitions = await loadPinnedToolDefinitions(
    input.projectId,
    definition,
  );
  return buildTelnyxHostedVoiceToolSetupManifest({
    baseUrl: getHostedVoicePublicBaseUrl(),
    toolDefinitions,
  });
}

export function buildTelnyxHostedVoiceToolSetupManifest(input: {
  baseUrl: string;
  toolDefinitions: ToolDefinitionV1[];
}) {
  return {
    assistantVersionUpdate: {
      method: "POST",
      note: "Update the exact non-main candidate version, not the main Assistant.",
    },
    authentication: {
      header: "Authorization",
      scheme: "Bearer",
      storage:
        "Store the one-time credential as a Telnyx Integration Secret. Never paste it into the tool URL or Lia configuration.",
    },
    eventWebhookUrl: `${input.baseUrl}/api/hosted-voice/telnyx/events`,
    schemaVersion: 1,
    tools: input.toolDefinitions.flatMap((tool) =>
      buildToolSetupEntries(input.baseUrl, tool),
    ),
  };
}

export function getHostedVoicePublicBaseUrl() {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("A public staging application URL is required.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("The hosted voice staging URL must be public HTTPS.");
  }
  return url.origin;
}

async function loadPinnedToolDefinitions(
  projectId: number,
  definition: VoiceAgentDefinitionV1,
) {
  const taskVersionIds = definition.publishedTaskVersions.map(
    ({ taskVersionId }) => taskVersionId,
  );
  if (taskVersionIds.length === 0) return [];
  const rows = await db
    .select({ snapshot: conversationalTaskVersions.snapshot })
    .from(conversationalTaskVersions)
    .where(
      and(
        eq(conversationalTaskVersions.projectId, projectId),
        inArray(conversationalTaskVersions.id, taskVersionIds),
      ),
    );
  const allowed = new Set(
    definition.tools.map(({ id, version }) => `${id}:${version}`),
  );
  const definitions = new Map<string, ToolDefinitionV1>();
  for (const row of rows) {
    const snapshot = conversationalTaskSnapshotV1Schema.parse(row.snapshot);
    for (const tool of snapshot.toolDefinitions) {
      const key = `${tool.id}:${tool.version}`;
      if (!allowed.has(key)) continue;
      const existing = definitions.get(key);
      if (
        existing &&
        hashHostedVoiceToolValue(existing) !== hashHostedVoiceToolValue(tool)
      ) {
        throw new Error(
          "A pinned tool has inconsistent published definitions.",
        );
      }
      definitions.set(key, tool);
    }
  }
  if (definitions.size !== allowed.size) {
    throw new Error("A pinned hosted voice tool definition is unavailable.");
  }
  return [...definitions.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function buildToolSetupEntries(baseUrl: string, tool: ToolDefinitionV1) {
  if (tool.access === "read") {
    return [
      buildToolSetupEntry({
        async: tool.execution.mode === "asynchronous",
        baseUrl,
        bodyParameters: buildBodyParameters(tool),
        description: tool.description,
        phase: "read",
        timeoutMs: tool.execution.timeoutMs,
        tool,
      }),
    ];
  }
  return [
    buildToolSetupEntry({
      async: false,
      baseUrl,
      bodyParameters: buildBodyParameters(tool),
      description: `${tool.description} Call this prepare tool before asking the caller for confirmation. It does not change the calendar. After it returns, summarize the prepared action, ask for explicit confirmation, and stop until a later caller message.`,
      phase: "prepare",
      timeoutMs: Math.min(tool.execution.timeoutMs, 10_000),
      tool,
    }),
    buildToolSetupEntry({
      async: tool.execution.mode === "asynchronous",
      baseUrl,
      bodyParameters: {
        properties: {
          commitToken: {
            description:
              "Copy the short commitToken returned by the matching prepare tool exactly. Never type, edit, reconstruct, or reuse it.",
            type: "string",
          },
        },
        required: ["commitToken"],
        type: "object",
      },
      description: `Commit ${tool.name} only in a later turn after the matching prepare tool returned and the caller then explicitly confirmed that prepared change. Confirmation given before prepare is not valid.`,
      phase: "commit",
      timeoutMs: Math.min(tool.execution.timeoutMs, 10_000),
      tool,
    }),
  ];
}

function buildToolSetupEntry(input: {
  async: boolean;
  baseUrl: string;
  bodyParameters: ReturnType<typeof buildBodyParameters>;
  description: string;
  phase: "commit" | "prepare" | "read";
  timeoutMs: number;
  tool: ToolDefinitionV1;
}) {
  return {
    async: input.async,
    body_parameters: input.bodyParameters,
    description: input.description,
    method: "POST",
    name: `lia_${input.phase}_${input.tool.id}`
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .slice(0, 120),
    phase: input.phase,
    timeout_ms: Math.min(input.timeoutMs, 10_000),
    url: `${input.baseUrl}/api/voice-tools/${encodeURIComponent(input.tool.id)}/${input.phase}`,
  };
}

function buildBodyParameters(tool: ToolDefinitionV1) {
  const fields = tool.inputSchema.fields.filter(
    ({ source }) => source.kind !== "literal",
  );
  return {
    properties: Object.fromEntries(
      fields.map((field) => [
        field.key,
        {
          description: `Canonical Lia input: ${field.key}`,
          type: getJsonSchemaType(field.type),
        },
      ]),
    ),
    required: fields.filter(({ required }) => required).map(({ key }) => key),
    type: "object",
  };
}

function getJsonSchemaType(type: string) {
  if (type === "boolean") return "boolean";
  if (type === "decimal") return "number";
  if (type === "integer") return "integer";
  return "string";
}
