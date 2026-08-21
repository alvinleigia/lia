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
  "sales_enquiry",
  "lead_capture",
  "customer_support",
  "booking_appointment",
] as const;

export const MAX_APPROVED_KNOWLEDGE_ANSWERS = 50;

export type ApprovedKnowledgeAnswer = {
  question: string;
  answer: string | null;
};

export type ProjectAiSettings = {
  approvedKnowledgeAnswers: ApprovedKnowledgeAnswer[];
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
  approvedKnowledgeAnswers: [],
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

export const AI_RESPONSE_PRESET_LABELS: Record<
  (typeof AI_RESPONSE_PRESETS)[number],
  string
> = {
  booking_appointment: "Booking or Appointment",
  customer_support: "Customer Support",
  general_business: "General Business",
  lead_capture: "Lead Capture",
  sales_enquiry: "Sales Enquiry",
};

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

export function normalizeKnowledgeQuestion(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function readApprovedKnowledgeAnswers(
  value: unknown,
): ApprovedKnowledgeAnswer[] {
  if (!Array.isArray(value)) return [];

  const answers: ApprovedKnowledgeAnswer[] = [];
  const questions = new Set<string>();

  for (const candidate of value) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const question = readOptionalText(record.question);
    if (!question || question.length > 240) continue;

    const normalizedQuestion = normalizeKnowledgeQuestion(question);
    if (!normalizedQuestion || questions.has(normalizedQuestion)) continue;

    const answer = readOptionalText(record.answer);
    if (answer && answer.length > 1_000) continue;

    questions.add(normalizedQuestion);
    answers.push({ answer, question });
    if (answers.length === MAX_APPROVED_KNOWLEDGE_ANSWERS) break;
  }

  return answers;
}

export function formatApprovedKnowledgeAnswers(
  answers: ApprovedKnowledgeAnswer[],
) {
  return answers
    .map(({ answer, question }) => `${question} => ${answer ?? ""}`)
    .join("\n");
}

export function parseApprovedKnowledgeAnswersText(
  value: string,
):
  | { ok: true; answers: ApprovedKnowledgeAnswer[] }
  | { ok: false; error: string } {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > MAX_APPROVED_KNOWLEDGE_ANSWERS) {
    return {
      ok: false,
      error: `Add no more than ${MAX_APPROVED_KNOWLEDGE_ANSWERS} approved answers.`,
    };
  }

  const answers: ApprovedKnowledgeAnswer[] = [];
  const questions = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const separator = line.indexOf("=>");
    if (separator < 0) {
      return {
        ok: false,
        error: `Line ${index + 1} must use: Question => Answer`,
      };
    }

    const question = line.slice(0, separator).trim();
    const answer = line.slice(separator + 2).trim() || null;
    if (!question || question.length > 240) {
      return {
        ok: false,
        error: `Line ${index + 1} needs a question of 240 characters or fewer.`,
      };
    }
    if (answer && answer.length > 1_000) {
      return {
        ok: false,
        error: `Line ${index + 1} has an answer longer than 1,000 characters.`,
      };
    }

    const normalizedQuestion = normalizeKnowledgeQuestion(question);
    if (!normalizedQuestion || questions.has(normalizedQuestion)) {
      return {
        ok: false,
        error: `Line ${index + 1} duplicates another approved question.`,
      };
    }

    questions.add(normalizedQuestion);
    answers.push({ answer, question });
  }

  return { ok: true, answers };
}

export function normalizeProjectAiSettings(value: unknown): ProjectAiSettings {
  const settings =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    approvedKnowledgeAnswers: readApprovedKnowledgeAnswers(
      settings.approvedKnowledgeAnswers,
    ),
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

export function resolveApprovedKnowledgeAnswer(
  value: ProjectAiSettings | Record<string, unknown> | null | undefined,
  question: string,
) {
  const settings = normalizeProjectAiSettings(value);
  const normalizedQuestion = normalizeKnowledgeQuestion(question);
  if (!normalizedQuestion) return null;

  const matchIndex = settings.approvedKnowledgeAnswers.findIndex(
    (candidate) =>
      normalizeKnowledgeQuestion(candidate.question) === normalizedQuestion,
  );
  if (matchIndex < 0) return null;

  const match = settings.approvedKnowledgeAnswers[matchIndex];
  if (match.answer) {
    return {
      excerptId: `project_approved_answer:${matchIndex + 1}`,
      kind: "answer" as const,
      reply: match.answer,
    };
  }

  const contacts = [settings.fallbackPhone, settings.fallbackEmail].filter(
    (contact): contact is string => Boolean(contact),
  );
  const fallback =
    settings.fallbackMessage ?? "I don't have verified information for that.";

  return {
    excerptId: null,
    kind: "no_answer" as const,
    reply: contacts.length
      ? `${fallback} For current details, contact ${contacts.join(" or ")}.`
      : fallback,
  };
}
