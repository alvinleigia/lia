export const AI_ASSISTANT_ROLES = [
  "general",
  "sales",
  "support",
  "booking",
] as const;

export const AI_TONES = [
  "professional",
  "friendly",
  "direct",
  "luxury",
] as const;

export const AI_ANSWER_LENGTHS = ["short", "balanced", "detailed"] as const;

export const AI_FOLLOW_UP_POLICIES = [
  "only_when_required",
  "proactive",
  "never",
] as const;

export const AI_EXTRA_HELP_POLICIES = [
  "only_when_asked",
  "offer_when_relevant",
  "never",
] as const;

export const AI_RESPONSE_PRESETS = [
  "general_business",
  "sales_lead_capture",
  "support_faq",
  "real_estate_enquiry",
  "booking_enquiry",
] as const;

export type ProjectAiSettings = {
  answerLength: (typeof AI_ANSWER_LENGTHS)[number];
  answerGuidance: string | null;
  assistantName: string | null;
  businessName: string | null;
  extraHelpPolicy: (typeof AI_EXTRA_HELP_POLICIES)[number];
  fallbackEmail: string | null;
  fallbackMessage: string | null;
  fallbackPhone: string | null;
  followUpPolicy: (typeof AI_FOLLOW_UP_POLICIES)[number];
  responsePreset: (typeof AI_RESPONSE_PRESETS)[number];
  role: (typeof AI_ASSISTANT_ROLES)[number];
  tone: (typeof AI_TONES)[number];
};

export const DEFAULT_PROJECT_AI_SETTINGS: ProjectAiSettings = {
  answerLength: "short",
  answerGuidance: null,
  assistantName: null,
  businessName: null,
  extraHelpPolicy: "only_when_asked",
  fallbackEmail: null,
  fallbackMessage: null,
  fallbackPhone: null,
  followUpPolicy: "only_when_required",
  responsePreset: "general_business",
  role: "general",
  tone: "professional",
};

const roleSet = new Set<string>(AI_ASSISTANT_ROLES);
const toneSet = new Set<string>(AI_TONES);
const answerLengthSet = new Set<string>(AI_ANSWER_LENGTHS);
const followUpPolicySet = new Set<string>(AI_FOLLOW_UP_POLICIES);
const extraHelpPolicySet = new Set<string>(AI_EXTRA_HELP_POLICIES);
const responsePresetSet = new Set<string>(AI_RESPONSE_PRESETS);

function readOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readEnumValue<T extends string>(
  value: unknown,
  allowed: Set<string>,
  fallback: T,
) {
  return typeof value === "string" && allowed.has(value)
    ? (value as T)
    : fallback;
}

export function normalizeProjectAiSettings(value: unknown): ProjectAiSettings {
  const settings =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    answerLength: readEnumValue(
      settings.answerLength,
      answerLengthSet,
      DEFAULT_PROJECT_AI_SETTINGS.answerLength,
    ),
    answerGuidance: readOptionalText(settings.answerGuidance),
    assistantName: readOptionalText(settings.assistantName),
    businessName: readOptionalText(settings.businessName),
    extraHelpPolicy: readEnumValue(
      settings.extraHelpPolicy,
      extraHelpPolicySet,
      DEFAULT_PROJECT_AI_SETTINGS.extraHelpPolicy,
    ),
    fallbackEmail: readOptionalText(settings.fallbackEmail),
    fallbackMessage: readOptionalText(settings.fallbackMessage),
    fallbackPhone: readOptionalText(settings.fallbackPhone),
    followUpPolicy: readEnumValue(
      settings.followUpPolicy,
      followUpPolicySet,
      DEFAULT_PROJECT_AI_SETTINGS.followUpPolicy,
    ),
    responsePreset: readEnumValue(
      settings.responsePreset,
      responsePresetSet,
      DEFAULT_PROJECT_AI_SETTINGS.responsePreset,
    ),
    role: readEnumValue(
      settings.role,
      roleSet,
      DEFAULT_PROJECT_AI_SETTINGS.role,
    ),
    tone: readEnumValue(
      settings.tone,
      toneSet,
      DEFAULT_PROJECT_AI_SETTINGS.tone,
    ),
  };
}

export function compactProjectAiSettings(settings: ProjectAiSettings) {
  return Object.fromEntries(
    Object.entries(settings).filter(([, value]) => value !== null),
  );
}
