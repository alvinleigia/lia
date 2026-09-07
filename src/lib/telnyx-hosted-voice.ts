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
        instructions: compileInstructions(definition),
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

function compileInstructions(definition: VoiceAgentDefinitionV1) {
  const identityPolicy =
    definition.identity.defaultRequirement === "verified"
      ? `- Identity: Before using a tool that accesses or changes an existing appointment, collect every configured verification factor: ${definition.identity.verificationFactors.join(", ")}. Reuse unambiguous verification values already supplied or confirmed in this conversation, including the latest prepared or verified appointment action; do not ask for them again. If speech recognition produces a conflicting or uncertain value, clarify only that factor and preserve the prior confirmed value until the caller corrects it. If a lookup returns identity_mismatch, the primary lookup matched but another verification factor did not; do not say that no appointment exists, reveal any appointment details, or repeat every question. Ask the caller to repeat or spell only the remaining verification factor, then retry the lookup. Treat the caller as verified only after an approved lookup tool returns a matching appointment. Do not reveal appointment details or prepare or commit a change before verification succeeds.`
      : "- Identity: No additional hosted-voice verification factors are configured. Continue to follow every approved tool's required inputs.";
  const handoffPolicy = {
    available:
      "- Handoff: Offer and use the configured transfer tool when the caller requests it or the approved workflow cannot continue safely.",
    disabled: "- Handoff: Do not offer or attempt a transfer.",
    required:
      "- Handoff: Use the configured transfer tool whenever the approved workflow requires human handling.",
  }[definition.handoff.mode];

  return [
    definition.instructions,
    "Lia managed policies:",
    `- Locale: Speak ${definition.locale.language} and interpret dates and times in ${definition.locale.timezone}.`,
    identityPolicy,
    "- Writes: Once all required inputs are known, call the prepare tool immediately; do not recap or ask for confirmation first. After prepare returns, give one concise summary of that exact action, ask exactly one explicit caller confirmation, and stop. Call commit only after a later caller message explicitly confirms the prepared action. Confirmation given before prepare is invalid. If the caller corrects a field, prepare the corrected action and ask one new confirmation. Copy the returned short commit token exactly; never type, edit, reconstruct, or reuse it. Never claim success unless the approved tool returns verified success.",
    handoffPolicy,
  ].join("\\n\\n");
}
