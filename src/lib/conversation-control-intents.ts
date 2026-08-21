const EXPLICIT_HUMAN_HANDOFF_PATTERNS = [
  /\b(?:i\s+)?(?:need|want|would like)\s+(?:a\s+|an\s+)?(?:person|human|agent|representative|team member)\s+to\s+help\b/i,
  /\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:a\s+|an\s+)?(?:person|human|agent|representative|team member)\b/i,
  /\b(?:human|live agent|team member)\s+(?:help|support)\b/i,
];

const EXPLICIT_CANCELLATION_PHRASES = new Set([
  "abort",
  "abort this",
  "abort this request",
  "cancel",
  "cancel booking",
  "cancel it",
  "cancel my booking",
  "cancel request",
  "cancel the booking",
  "cancel the request",
  "cancel this",
  "cancel this booking",
  "cancel this request",
  "do not continue",
  "don't continue",
  "end this",
  "end this request",
  "exit",
  "forget it",
  "i do not want to continue",
  "i don't want to continue",
  "i want to cancel",
  "i would like to cancel",
  "i'd like to cancel",
  "never mind",
  "nevermind",
  "please cancel",
  "please stop",
  "please stop this request",
  "quit",
  "stop",
  "stop this",
  "stop this booking",
  "stop this request",
]);

const EXPLICIT_CONFIRMATION_PHRASES = new Set([
  "confirm",
  "confirmed",
  "go ahead",
  "please confirm",
  "proceed",
  "submit",
  "yes",
  "yes, confirm",
  "yes confirm",
]);

function normalizeExplicitIntent(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
}

export function isPotentialKnowledgeSideQuestion(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (normalized.endsWith("?")) return true;

  const wordCount = normalized.split(" ").length;
  return (
    wordCount >= 3 &&
    /^(?:what|when|where|which|who|whose|why|how|is|are|was|were|can|could|do|does|did|will|would|should|may)\b/i.test(
      normalized,
    )
  );
}

export function shouldUseKnowledgeSideQuestion(input: {
  answerIsValid: boolean;
  groundingStatus: "grounded" | "not_needed" | "no_answer";
  safetyDecision: "allow" | "refuse" | "clarify" | "handoff";
}) {
  return (
    !input.answerIsValid ||
    input.groundingStatus === "grounded" ||
    input.safetyDecision !== "allow"
  );
}

export function isExplicitCancellationRequest(
  value: string,
  options: { allowBareNo?: boolean } = {},
) {
  const normalized = normalizeExplicitIntent(value);
  return (
    (options.allowBareNo === true && normalized === "no") ||
    EXPLICIT_CANCELLATION_PHRASES.has(normalized)
  );
}

export function isExplicitConfirmationRequest(value: string) {
  return EXPLICIT_CONFIRMATION_PHRASES.has(normalizeExplicitIntent(value));
}

export function isExplicitHumanHandoffRequest(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (/\b(?:do not|don(?:'|\u2019)?t|no need to)\b/i.test(normalized)) {
    return false;
  }

  return EXPLICIT_HUMAN_HANDOFF_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}
