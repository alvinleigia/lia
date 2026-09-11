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
  const appointmentDataPolicy =
    "- Appointment data boundary (mandatory): For every request to find, view, list, verify, reschedule, or cancel an existing appointment, call an approved appointment lookup tool after collecting only that tool's required inputs. The most recent successful approved lookup result is the only source of truth for appointment existence, name, date, time, service, location, status, or reference. Never use memory, prior examples, general knowledge, retrieval or knowledge-base content, model inference, or caller-supplied claims as appointment data. If no approved lookup tool returns a matching appointment, say that you cannot verify an appointment and reveal no appointment details. Do not present, summarize, reschedule, or cancel an appointment without that successful result.";
  const callerContactPolicy =
    "- Caller contact: On a phone call, use {{telnyx_end_user_target}} as contactNumber when it is a valid phone number. Ask for a contact number only when that value is missing or invalid, or the caller says the appointment used a different number. Treat the number only as a lookup input; every configured verification factor and a successful approved lookup are still required.";
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
    callerContactPolicy,
    appointmentDataPolicy,
    identityPolicy,
    "- Required input provenance (mandatory): Before calling any tool, verify every required non-literal input was explicitly supplied or confirmed by the caller, provided by an approved Telnyx system value permitted by these policies, or returned by an authoritative Lia tool. Never infer, synthesize, assume, default, or use a placeholder for a missing value. If a required input is unavailable, ask the caller for that value and do not call the tool. A plausible value is still missing unless it came from one of these approved sources.",
    "- Writes: Once all required inputs are known from approved sources, call the prepare tool immediately; do not recap or ask for confirmation first. A request to cancel or reschedule is not confirmation. Never present a cancellation or reschedule summary or ask for confirmation until the prepare tool returns. After prepare returns, give one concise summary containing every prepared caller-visible input, ask exactly one explicit caller confirmation, and stop. Do not omit, replace, or generalize a prepared value. Call commit only after a later caller message explicitly confirms the prepared action. Confirmation given before prepare is invalid. If the caller corrects a field, prepare the corrected action and ask one new confirmation. Copy the returned short commit token exactly; never type, edit, reconstruct, or reuse it. Never claim success unless the approved tool returns verified success.",
    handoffPolicy,
  ].join("\n\n");
}
