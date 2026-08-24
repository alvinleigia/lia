import { z } from "zod";
import type {
  HostedVoiceProviderAdapter,
  HostedVoiceRemoteVersion,
} from "@/lib/hosted-voice-contract";
import {
  createTelnyxHostedVoiceCompiler,
  type TelnyxHostedAssistantManagedConfig,
  type TelnyxHostedVoiceSettings,
} from "@/lib/telnyx-hosted-voice";

const TELNYX_API_BASE_URL = "https://api.telnyx.com/v2";

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
  })
  .passthrough();

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
}): HostedVoiceProviderAdapter<TelnyxHostedAssistantManagedConfig> {
  const apiKey = z.string().trim().min(1).parse(input.apiKey);
  const fetchImpl = input.fetchImpl ?? fetch;
  const compiler = createTelnyxHostedVoiceCompiler(input.settings);

  async function request(path: string, init?: RequestInit) {
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
        "Telnyx Assistant request failed before a response was received.",
        true,
        null,
      );
    }

    if (!response.ok) {
      throw new TelnyxHostedVoiceApiError(
        `Telnyx Assistant request failed with status ${response.status}.`,
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
        response.status,
      );
    }

    if (response.status === 204) return null;
    const payload = await response.json().catch(() => null);
    const parsed = telnyxAssistantSchema.safeParse(payload);
    if (!parsed.success) {
      throw new TelnyxHostedVoiceApiError(
        "Telnyx Assistant returned an invalid response.",
        false,
        response.status,
      );
    }

    return parsed.data;
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
    async promote(remote: HostedVoiceRemoteVersion) {
      await request(
        `/ai/assistants/${encodeURIComponent(remote.assistantId)}/versions/${encodeURIComponent(remote.versionId)}/promote`,
        { method: "POST" },
      );
    },
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
