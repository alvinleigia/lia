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

export const telnyxHostedAssistantManagedConfigSchema = z
  .object({
    enabled_features: z.array(z.enum(["messaging", "telephony"])),
    greeting: z.string(),
    instructions: z.string(),
    model: z.string().trim().min(1),
    name: z.string().trim().min(1),
    privacy_settings: z.object({ data_retention: z.boolean() }).strict(),
    transcription: z
      .object({
        language: z.string().trim().min(1),
        model: z.string().trim().min(1),
      })
      .strict(),
    voice_settings: z.object({ voice: z.string().trim().min(1) }).strict(),
  })
  .strict();

export type TelnyxHostedAssistantManagedConfig = z.infer<
  typeof telnyxHostedAssistantManagedConfigSchema
>;

export type TelnyxHostedAssistantDraftPlan = TelnyxHostedAssistantManagedConfig;

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
        enabled_features: ["telephony"],
        greeting: compileGreeting(definition),
        instructions: definition.instructions,
        model: settings.modelId,
        name: definition.name,
        privacy_settings: {
          data_retention: definition.retention.mode !== "disabled",
        },
        transcription: {
          language: settings.transcriptionLanguage,
          model: settings.transcriptionModelId,
        },
        voice_settings: {
          voice: settings.voiceId,
        },
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
