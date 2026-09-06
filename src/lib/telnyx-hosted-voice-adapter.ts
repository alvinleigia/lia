import { z } from "zod";
import type {
  HostedVoiceProviderAdapter,
  HostedVoiceRemoteVersion,
} from "@/lib/hosted-voice-contract";
import { hashHostedVoiceToolValue } from "@/lib/hosted-voice-tool-contract";
import {
  createTelnyxHostedVoiceCompiler,
  type TelnyxHostedAssistantManagedConfig,
  type TelnyxHostedVoiceSettings,
} from "@/lib/telnyx-hosted-voice";

const TELNYX_API_BASE_URL = "https://api.telnyx.com/v2";

const telnyxToolBodyParametersSchema = z
  .object({
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()),
    type: z.literal("object"),
  })
  .strict();

const telnyxHostedVoiceToolSetupEntrySchema = z
  .object({
    async: z.boolean(),
    body_parameters: telnyxToolBodyParametersSchema,
    description: z.string().trim().min(1),
    method: z.literal("POST"),
    name: z.string().trim().min(1).max(120).regex(/^lia_/),
    phase: z.enum(["read", "prepare", "commit"]),
    timeout_ms: z.number().int().min(1).max(15_000),
    url: z.string().url(),
  })
  .strict();

const telnyxWebhookToolSchema = z
  .object({
    type: z.literal("webhook"),
    webhook: z
      .object({
        async: z.boolean(),
        async_timeout_ms: z.number().int().positive().optional(),
        body_parameters: telnyxToolBodyParametersSchema,
        description: z.string(),
        headers: z.array(
          z.object({ name: z.string(), value: z.string() }).passthrough(),
        ),
        method: z.literal("POST"),
        name: z.string(),
        timeout_ms: z.number().int().positive().optional(),
        url: z.string().url(),
      })
      .passthrough(),
  })
  .passthrough();

const telnyxWebhookToolIdentitySchema = z
  .object({
    type: z.literal("webhook"),
    webhook: z.object({ name: z.string() }).passthrough(),
  })
  .passthrough();

const telnyxIntegrationSecretIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._-]+$/);

const telnyxIntegrationSecretListSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string().trim().min(1),
          identifier: z.string().trim().min(1),
          updated_at: z.string().trim().min(1),
        })
        .passthrough(),
    ),
    meta: z
      .object({
        page_number: z.number().int().positive(),
        total_pages: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();

const telnyxSharedToolSchema = z
  .object({
    display_name: z.string().optional(),
    id: z.string().trim().min(1),
    tool_definition: z.record(z.string(), z.unknown()),
    type: z.string(),
  })
  .passthrough();

const telnyxSharedToolListSchema = z
  .object({
    data: z.array(telnyxSharedToolSchema),
  })
  .passthrough();

const telnyxApiErrorSchema = z
  .object({
    detail: z
      .array(
        z
          .object({
            loc: z.array(z.union([z.string(), z.number()])).optional(),
            type: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    errors: z
      .array(
        z
          .object({
            code: z.union([z.string(), z.number()]).optional(),
            source: z
              .object({
                parameter: z.string().optional(),
                pointer: z.string().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const telnyxAssistantSchema = z
  .object({
    enabled_features: z.array(z.enum(["telephony", "messaging"])),
    greeting: z.string(),
    id: z.string().trim().min(1),
    instructions: z.string(),
    model: z.string().trim().min(1),
    name: z.string().trim().min(1),
    privacy_settings: z.object({ data_retention: z.boolean() }).passthrough(),
    transcription: z
      .object({
        language: z.string().trim().min(1),
        model: z.string().trim().min(1),
      })
      .passthrough(),
    version_id: z.string().trim().min(1),
    voice_settings: z.object({ voice: z.string().trim().min(1) }).passthrough(),
    tool_ids: z.array(z.string().trim().min(1)).optional().default([]),
    tools: z.array(z.unknown()).optional().default([]),
  })
  .passthrough();

const telnyxCanaryRuleSchema = z.object({
  match: z
    .array(
      z.object({
        attribute: z.string(),
        operator: z.enum(["in", "not_in", "starts_with"]),
        values: z.array(z.string()),
      }),
    )
    .optional(),
  serve: z.object({
    rollout: z
      .array(
        z.object({
          version_id: z.string().trim().min(1),
          weight: z.number(),
        }),
      )
      .optional(),
    version_id: z.string().trim().min(1).optional(),
  }),
});

const telnyxCanaryDeploymentSchema = z
  .object({
    assistant_id: z.string().trim().min(1),
    rules: z.array(telnyxCanaryRuleSchema),
  })
  .passthrough();

type TelnyxHostedVoiceToolSetupEntry = z.infer<
  typeof telnyxHostedVoiceToolSetupEntrySchema
>;

export type TelnyxHostedVoiceAdapter =
  HostedVoiceProviderAdapter<TelnyxHostedAssistantManagedConfig> & {
    inspectIntegrationSecret(input: {
      identifier: string;
    }): Promise<{ id: string; updatedAt: string }>;
    pushCandidateTools(input: {
      assistantId: string;
      candidateVersionId: string;
      integrationSecretIdentifier: string;
      mainVersionId: string | null;
      tools: unknown[];
    }): Promise<{ routingWasSuspended: boolean; toolCount: number }>;
  };

export class TelnyxHostedVoiceApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "TelnyxHostedVoiceApiError";
  }
}

export function createTelnyxHostedVoiceAdapter(input: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  settings: TelnyxHostedVoiceSettings;
}): TelnyxHostedVoiceAdapter {
  const apiKey = z.string().trim().min(1).parse(input.apiKey);
  const fetchImpl = input.fetchImpl ?? fetch;
  const compiler = createTelnyxHostedVoiceCompiler(input.settings);

  async function requestPayload(
    path: string,
    init?: RequestInit,
    operation = "Telnyx Assistant request",
  ) {
    let response: Response;
    try {
      response = await fetchImpl(`${TELNYX_API_BASE_URL}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
    } catch {
      throw new TelnyxHostedVoiceApiError(
        `${operation} failed before a response was received.`,
        true,
        null,
      );
    }

    if (!response.ok) {
      const diagnostic = buildTelnyxApiErrorDiagnostic(
        response,
        await response.json().catch(() => null),
      );
      console.error("Telnyx provider request failed.", {
        diagnostic: diagnostic || null,
        operation,
        status: response.status,
      });
      throw new TelnyxHostedVoiceApiError(
        `${operation} failed with status ${response.status}${diagnostic}.`,
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
        response.status,
      );
    }

    if (response.status === 204) {
      return { payload: null, status: response.status };
    }
    return {
      payload: await response.json().catch(() => null),
      status: response.status,
    };
  }

  async function request(path: string, init?: RequestInit, operation?: string) {
    const { payload, status } = await requestPayload(path, init, operation);
    if (payload === null) return null;
    const parsed = telnyxAssistantSchema.safeParse(payload);
    if (!parsed.success) {
      throw new TelnyxHostedVoiceApiError(
        "Telnyx Assistant returned an invalid response.",
        false,
        status,
      );
    }

    return parsed.data;
  }

  async function upsertSharedWebhookTool(
    expected: z.infer<typeof telnyxWebhookToolSchema>,
    namespace: string,
  ) {
    const name = expected.webhook.name;
    const displayName = `${namespace}-${name}`;
    const listPath = `/ai/tools?filter%5Bname%5D=${encodeURIComponent(displayName)}`;
    const { payload: listPayload } = await requestPayload(
      listPath,
      undefined,
      `Telnyx shared tool lookup for ${name}`,
    );
    const list = telnyxSharedToolListSchema.safeParse(listPayload);
    if (!list.success) {
      throw new TelnyxHostedVoiceApiError(
        "Telnyx returned an invalid shared tool list.",
        false,
        200,
      );
    }
    const existing = list.data.data.find(
      (tool) => tool.display_name === displayName && tool.type === "webhook",
    );
    const body = JSON.stringify({
      display_name: displayName,
      type: "webhook",
      webhook: expected.webhook,
    });
    const { payload, status } = await requestPayload(
      existing ? `/ai/tools/${encodeURIComponent(existing.id)}` : "/ai/tools",
      {
        body,
        method: existing ? "PATCH" : "POST",
      },
      `Telnyx shared tool upsert for ${name}`,
    );
    const tool = telnyxSharedToolSchema.safeParse(payload);
    if (!tool.success) {
      throw new TelnyxHostedVoiceApiError(
        "Telnyx returned an invalid shared tool.",
        false,
        status,
      );
    }
    verifyTelnyxSharedWebhookTool(tool.data, expected);
    return tool.data.id;
  }

  return {
    ...compiler,
    async createDraft({
      definitionHash,
      managedConfig,
      remoteAssistantId,
      versionName,
    }) {
      let assistantId = remoteAssistantId;
      let previousMainVersionId: string | null = null;

      if (!assistantId) {
        const bootstrap = await request("/ai/assistants", {
          body: JSON.stringify({
            ...managedConfig,
            version_name: `Lia bootstrap ${definitionHash.slice(0, 8)}`,
          }),
          headers: {
            "Idempotency-Key": `lia_${definitionHash}_bootstrap`,
          },
          method: "POST",
        });
        if (!bootstrap) {
          throw new TelnyxHostedVoiceApiError(
            "Telnyx Assistant creation returned no configuration.",
            false,
            null,
          );
        }
        assistantId = bootstrap.id;
        previousMainVersionId = bootstrap.version_id;
      }

      const candidate = await request(
        `/ai/assistants/${encodeURIComponent(assistantId)}`,
        {
          body: JSON.stringify({
            ...managedConfig,
            promote_to_main: false,
            version_name: z.string().trim().min(1).max(50).parse(versionName),
          }),
          headers: {
            "Idempotency-Key": `lia_${definitionHash}_candidate`,
          },
          method: "POST",
        },
      );
      if (!candidate) {
        throw new TelnyxHostedVoiceApiError(
          "Telnyx Assistant candidate returned no configuration.",
          false,
          null,
        );
      }

      return {
        assistantId: candidate.id,
        previousMainVersionId,
        versionId: candidate.version_id,
      };
    },
    async deactivate({ assistantId }) {
      await request(`/ai/assistants/${encodeURIComponent(assistantId)}`, {
        method: "DELETE",
      });
    },
    async inspect({ assistantId, versionId }) {
      const path = versionId
        ? `/ai/assistants/${encodeURIComponent(assistantId)}/versions/${encodeURIComponent(versionId)}`
        : `/ai/assistants/${encodeURIComponent(assistantId)}`;
      const assistant = await request(path);
      if (!assistant) {
        throw new TelnyxHostedVoiceApiError(
          "Telnyx Assistant inspection returned no configuration.",
          false,
          null,
        );
      }

      return {
        activeVersionId: versionId ? null : assistant.version_id,
        assistantId: assistant.id,
        managedConfig: selectManagedConfig(assistant),
        versionId: assistant.version_id,
      };
    },
    async inspectIntegrationSecret({ identifier }) {
      const expected =
        telnyxIntegrationSecretIdentifierSchema.parse(identifier);
      for (let page = 1; ; page += 1) {
        const path =
          page === 1
            ? "/integration_secrets"
            : `/integration_secrets?page%5Bnumber%5D=${page}`;
        const { payload } = await requestPayload(
          path,
          undefined,
          "Telnyx Integration Secret lookup",
        );
        const parsed = telnyxIntegrationSecretListSchema.safeParse(payload);
        if (!parsed.success) {
          throw new TelnyxHostedVoiceApiError(
            "Telnyx returned an invalid Integration Secret list.",
            false,
            200,
          );
        }
        const secret = parsed.data.data.find(
          ({ identifier: candidate }) => candidate === expected,
        );
        if (secret) return { id: secret.id, updatedAt: secret.updated_at };
        if (page >= parsed.data.meta.total_pages) break;
      }
      throw new Error(`Telnyx Integration Secret "${expected}" was not found.`);
    },
    async pushCandidateTools({
      assistantId,
      candidateVersionId,
      integrationSecretIdentifier,
      mainVersionId,
      tools,
    }) {
      if (candidateVersionId === mainVersionId) {
        throw new Error(
          "Webhook tools can only be pushed to a non-main candidate.",
        );
      }
      const identifier = telnyxIntegrationSecretIdentifierSchema.parse(
        integrationSecretIdentifier,
      );
      const setupTools = z
        .array(telnyxHostedVoiceToolSetupEntrySchema)
        .min(1)
        .max(100)
        .parse(tools);
      const path = `/ai/assistants/${encodeURIComponent(assistantId)}/versions/${encodeURIComponent(candidateVersionId)}`;
      const candidate = await request(
        path,
        undefined,
        "Telnyx candidate inspection",
      );
      if (!candidate || candidate.version_id !== candidateVersionId) {
        throw new Error(
          "The exact Telnyx candidate version could not be verified.",
        );
      }
      const expectedTools = setupTools.map((tool) =>
        buildTelnyxWebhookTool(tool, identifier),
      );
      const sharedToolIds: string[] = [];
      for (const expectedTool of expectedTools) {
        sharedToolIds.push(
          await upsertSharedWebhookTool(expectedTool, identifier),
        );
      }
      const preservedTools = candidate.tools
        .filter((tool) => !isLiaWebhookTool(tool))
        .map(normalizeTelnyxInlineToolForUpdate);
      const toolIds = [...new Set([...candidate.tool_ids, ...sharedToolIds])];
      const updateCandidate = () =>
        request(
          path,
          {
            body: JSON.stringify({
              tool_ids: toolIds,
              tools: preservedTools,
            }),
            method: "POST",
          },
          "Telnyx candidate tool update",
        );
      let routingWasSuspended = false;
      let updated: Awaited<ReturnType<typeof updateCandidate>> | undefined;
      try {
        updated = await updateCandidate();
      } catch (error) {
        if (
          !(error instanceof TelnyxHostedVoiceApiError) ||
          error.status !== 400
        ) {
          throw error;
        }

        const canaryPath = `/ai/assistants/${encodeURIComponent(assistantId)}/canary-deploys`;
        let canaryPayload: unknown;
        try {
          ({ payload: canaryPayload } = await requestPayload(
            canaryPath,
            undefined,
            "Telnyx candidate routing inspection",
          ));
        } catch (inspectionError) {
          if (
            inspectionError instanceof TelnyxHostedVoiceApiError &&
            inspectionError.status === 404
          ) {
            throw error;
          }
          throw inspectionError;
        }
        const canary = telnyxCanaryDeploymentSchema.safeParse(canaryPayload);
        if (
          !canary.success ||
          canary.data.assistant_id !== assistantId ||
          !canary.data.rules.some((rule) =>
            canaryRuleReferencesVersion(rule, candidateVersionId),
          )
        ) {
          throw error;
        }

        await requestPayload(
          canaryPath,
          { method: "DELETE" },
          "Telnyx candidate routing suspension",
        );
        routingWasSuspended = true;

        let updateError: unknown;
        try {
          updated = await updateCandidate();
        } catch (retryError) {
          updateError = retryError;
        }
        await requestPayload(
          canaryPath,
          {
            body: JSON.stringify({ rules: canary.data.rules }),
            method: "POST",
          },
          "Telnyx candidate routing restoration",
        );
        if (updateError) throw updateError;
      }
      if (!updated || updated.version_id !== candidateVersionId) {
        throw new Error("Telnyx did not update the exact candidate version.");
      }
      return { routingWasSuspended, toolCount: expectedTools.length };
    },
    async promote(remote: HostedVoiceRemoteVersion) {
      await request(
        `/ai/assistants/${encodeURIComponent(remote.assistantId)}/versions/${encodeURIComponent(remote.versionId)}/promote`,
        { method: "POST" },
      );
    },
  };
}

function canaryRuleReferencesVersion(
  rule: z.infer<typeof telnyxCanaryRuleSchema>,
  versionId: string,
) {
  return (
    rule.serve.version_id === versionId ||
    rule.serve.rollout?.some((slot) => slot.version_id === versionId) === true
  );
}

function verifyTelnyxSharedWebhookTool(
  tool: z.infer<typeof telnyxSharedToolSchema>,
  expected: z.infer<typeof telnyxWebhookToolSchema>,
) {
  const webhook =
    "webhook" in tool.tool_definition
      ? tool.tool_definition.webhook
      : tool.tool_definition;
  verifyTelnyxWebhookTools([{ type: "webhook", webhook }], [expected]);
}

function buildTelnyxApiErrorDiagnostic(response: Response, payload: unknown) {
  const parts: string[] = [];
  const requestId = toSafeTelnyxDiagnosticToken(
    response.headers.get("x-request-id") ??
      response.headers.get("telnyx-request-id"),
  );
  if (requestId) parts.push(`request ${requestId}`);

  const parsed = telnyxApiErrorSchema.safeParse(payload);
  if (parsed.success) {
    const providerError = parsed.data.errors?.[0];
    const code = toSafeTelnyxDiagnosticToken(providerError?.code);
    if (code) parts.push(`code ${code}`);
    const pointer = toSafeTelnyxDiagnosticPath(providerError?.source?.pointer);
    if (pointer) parts.push(`field ${pointer}`);
    const parameter = toSafeTelnyxDiagnosticToken(
      providerError?.source?.parameter,
    );
    if (parameter && !pointer) parts.push(`field ${parameter}`);

    const validationError = parsed.data.detail?.[0];
    const location = toSafeTelnyxDiagnosticPath(validationError?.loc);
    if (location && !pointer) parts.push(`field ${location}`);
    const type = toSafeTelnyxDiagnosticToken(validationError?.type);
    if (type) parts.push(`type ${type}`);
  }

  return parts.length > 0 ? ` [${parts.join("; ")}]` : "";
}

function toSafeTelnyxDiagnosticToken(value: unknown) {
  const token = typeof value === "number" ? String(value) : value;
  return typeof token === "string" && /^[a-zA-Z0-9_.:-]{1,64}$/.test(token)
    ? token
    : null;
}

function toSafeTelnyxDiagnosticPath(value: unknown) {
  const path = Array.isArray(value)
    ? value.join(".")
    : typeof value === "string"
      ? value.replace(/^\/+/, "").replaceAll("/", ".")
      : "";
  return /^[a-zA-Z0-9_.:-]{1,120}$/.test(path) ? path : null;
}

function normalizeTelnyxInlineToolForUpdate(tool: unknown) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return tool;
  const record = tool as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !(type in record)) return tool;
  return { [type]: record[type], type };
}

function buildTelnyxWebhookTool(
  tool: TelnyxHostedVoiceToolSetupEntry,
  integrationSecretIdentifier: string,
) {
  return telnyxWebhookToolSchema.parse({
    type: "webhook",
    webhook: {
      async: tool.async,
      async_timeout_ms: tool.async ? tool.timeout_ms : undefined,
      body_parameters: tool.body_parameters,
      description: tool.description,
      headers: [
        {
          name: "Authorization",
          value: `Bearer {{#integration_secret}}${integrationSecretIdentifier}{{/integration_secret}}`,
        },
      ],
      method: tool.method,
      name: tool.name,
      timeout_ms: tool.async ? undefined : tool.timeout_ms,
      url: tool.url,
    },
  });
}

function isLiaWebhookTool(tool: unknown) {
  const parsed = telnyxWebhookToolIdentitySchema.safeParse(tool);
  return parsed.success && parsed.data.webhook.name.startsWith("lia_");
}

function verifyTelnyxWebhookTools(
  tools: unknown[],
  expectedTools: Array<z.infer<typeof telnyxWebhookToolSchema>>,
) {
  const actualByName = new Map(
    tools.flatMap((tool) => {
      const parsed = telnyxWebhookToolSchema.safeParse(tool);
      return parsed.success
        ? [[parsed.data.webhook.name, parsed.data] as const]
        : [];
    }),
  );
  const missingOrChanged = expectedTools
    .filter((expected) => {
      const actual = actualByName.get(expected.webhook.name);
      return (
        !actual ||
        hashHostedVoiceToolValue(selectVerifiedWebhookFields(actual)) !==
          hashHostedVoiceToolValue(selectVerifiedWebhookFields(expected))
      );
    })
    .map(({ webhook }) => webhook.name);
  if (missingOrChanged.length > 0) {
    throw new Error(
      `Telnyx did not verify the candidate webhook tools: ${missingOrChanged.join(", ")}.`,
    );
  }
}

function selectVerifiedWebhookFields(
  tool: z.infer<typeof telnyxWebhookToolSchema>,
) {
  return {
    async: tool.webhook.async,
    async_timeout_ms: tool.webhook.async_timeout_ms ?? null,
    body_parameters: tool.webhook.body_parameters,
    description: tool.webhook.description,
    headers: tool.webhook.headers.map(({ name, value }) => ({ name, value })),
    method: tool.webhook.method,
    name: tool.webhook.name,
    timeout_ms: tool.webhook.async ? null : (tool.webhook.timeout_ms ?? null),
    url: tool.webhook.url,
  };
}

function selectManagedConfig(
  assistant: z.infer<typeof telnyxAssistantSchema>,
): TelnyxHostedAssistantManagedConfig {
  return {
    enabled_features: [...assistant.enabled_features].sort(),
    greeting: assistant.greeting,
    instructions: assistant.instructions,
    model: assistant.model,
    name: assistant.name,
    privacy_settings: {
      data_retention: assistant.privacy_settings.data_retention,
    },
    transcription: {
      language: assistant.transcription.language,
      model: assistant.transcription.model,
    },
    voice_settings: {
      voice: assistant.voice_settings.voice,
    },
  };
}
