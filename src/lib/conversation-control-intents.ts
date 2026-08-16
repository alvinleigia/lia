const EXPLICIT_HUMAN_HANDOFF_PATTERNS = [
  /\b(?:i\s+)?(?:need|want|would like)\s+(?:a\s+|an\s+)?(?:person|human|agent|representative|team member)\s+to\s+help\b/i,
  /\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:a\s+|an\s+)?(?:person|human|agent|representative|team member)\b/i,
  /\b(?:human|live agent|team member)\s+(?:help|support)\b/i,
];

export function isExplicitHumanHandoffRequest(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (/\b(?:do not|don(?:'|\u2019)?t|no need to)\b/i.test(normalized)) {
    return false;
  }

  return EXPLICIT_HUMAN_HANDOFF_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}
