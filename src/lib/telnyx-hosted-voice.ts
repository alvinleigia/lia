import { z } from "zod";
import {
  HOSTED_VOICE_CAPABILITIES,
  type HostedVoiceProviderCompiler,
  type HostedVoiceProviderProfile,
  type VoiceAgentDefinitionV1,
} from "@/lib/hosted-voice-contract";

export const TELNYX_HOSTED_VOICE_PROVIDER = "telnyx_ai_assistant" as const;

export const telnyxHostedVoiceSettingsSchema = z
  .object({
    modelId: z.string().trim().min(1).max(160),
    transcriptionLanguage: z.string().trim().min(2).max(40),
    transcriptionModelId: z.string().trim().min(1).max(160),
    voiceId: z.string().trim().min(1).max(240),
  })
  .strict();

export type TelnyxHostedVoiceSettings = z.infer<
  typeof telnyxHostedVoiceSettingsSchema
>;

export type TelnyxHostedAssistantDraftPlan = {
  assistant: {
    enabled_features: ["telephony"];
    greeting: string;
    instructions: string;
    model: string;
    name: string;
    transcription: {
      language: string;
      model: string;
    };
    voice_settings: {
      voice: string;
    };
  };
  policies: Pick<
    VoiceAgentDefinitionV1,
    "confirmation" | "handoff" | "identity" | "retention"
  >;
  taskVersionReferences: VoiceAgentDefinitionV1["publishedTaskVersions"];
  toolReferences: VoiceAgentDefinitionV1["tools"];
};

export const TELNYX_HOSTED_VOICE_PROFILE = {
  provider: TELNYX_HOSTED_VOICE_PROVIDER,
  capabilities: Object.fromEntries(
    HOSTED_VOICE_CAPABILITIES.map((capability) => [capability, true]),
  ) as Record<(typeof HOSTED_VOICE_CAPABILITIES)[number], boolean>,
} satisfies HostedVoiceProviderProfile;

export function createTelnyxHostedVoiceCompiler(
  value: TelnyxHostedVoiceSettings,
) {
  const settings = telnyxHostedVoiceSettingsSchema.parse(value);

  return {
    profile: TELNYX_HOSTED_VOICE_PROFILE,
    compile({ definition }) {
      return {
        assistant: {
          enabled_features: ["telephony"],
          greeting: compileGreeting(definition),
          instructions: definition.instructions,
          model: settings.modelId,
          name: definition.name,
          transcription: {
            language: settings.transcriptionLanguage,
            model: settings.transcriptionModelId,
          },
          voice_settings: {
            voice: settings.voiceId,
          },
        },
        policies: {
          confirmation: definition.confirmation,
          handoff: definition.handoff,
          identity: definition.identity,
          retention: definition.retention,
        },
        taskVersionReferences: definition.publishedTaskVersions,
        toolReferences: definition.tools,
      } satisfies TelnyxHostedAssistantDraftPlan;
    },
  } satisfies HostedVoiceProviderCompiler<TelnyxHostedAssistantDraftPlan>;
}

function compileGreeting(definition: VoiceAgentDefinitionV1) {
  if (definition.greeting.strategy === "wait") return "";
  if (definition.greeting.strategy === "generated") {
    return "<assistant-speaks-first-with-model-generated-message>";
  }
  return definition.greeting.text;
}
