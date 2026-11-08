export type QualityMessage = {
  id: number;
  direction: string;
  text: string | null;
  createdAt: Date;
};

export type QualityFlag = {
  code:
    | "fallback"
    | "repeated_prompt"
    | "slow_reply"
    | "inactive_enquiry"
    | "failed_action"
    | "recovery_review"
    | "exception_review";
  messageId: number | null;
  detail: string;
};

export const QUALITY_FEEDBACK = {
  correct: "Correct",
  wrong_answer: "Wrong answer",
  unnecessary_detail: "Unnecessary detail",
  missed_intent: "Missed intent",
} as const;

export function qualityNextStep(category: string) {
  switch (category) {
    case "correct":
      return "Keep this as a positive example; no live change is needed.";
    case "wrong_answer":
    case "fallback":
      return "Check the source facts and retrieval. Prepare any correction in Documents, then review and publish it.";
    case "unnecessary_detail":
      return "Review answer selection and relevance. Preserve material conditions; do not add a client-specific override.";
    case "missed_intent":
    case "repeated_prompt":
      return "Check field mapping and the pending workflow step. Reproduce with synthetic inputs before changing shared logic.";
    case "slow_reply":
      return "Compare request timing and model usage. Check repeated retrieval or model calls before changing providers.";
    case "failed_action":
      return "Inspect the linked execution or tool failure before retrying an operation.";
    case "recovery_review":
      return "Inspect the recorded recovery decisions and saved workflow state. Reconcile uncertain writes before considering another attempt.";
    case "exception_review":
      return "Review the unresolved question and saved workflow state. Check the configured handoff, record the expected behavior, and add a synthetic regression case before changing shared logic.";
    default:
      return "Review the conversation, record the expected behaviour and add a synthetic regression case.";
  }
}

// Signals for human review, not assertions that an agent made a mistake.
export function detectConversationQuality(input: {
  messages: QualityMessage[];
  lastMessageAt: Date | null;
  activeTask: boolean;
  humanOwned?: boolean;
  failedActions?: number;
  recoveryFailures?: number;
  exceptionNeedsReview?: boolean;
  now?: Date;
}) {
  const flags: QualityFlag[] = [];
  if (input.exceptionNeedsReview)
    flags.push({
      code: "exception_review",
      messageId: null,
      detail:
        "Repeated ambiguity or an unresolved answer reached the clarification limit. Review the assistance decision and retained workflow context.",
    });
  if (input.recoveryFailures)
    flags.push({
      code: "recovery_review",
      messageId: null,
      detail: `${input.recoveryFailures} recovery attempt(s) need review. Saved state is retained; check the recorded failure and approved next action.`,
    });
  let waitingSince: Date | null = null;
  let previousReply = "";
  let visitorQuestion = false;
  for (const message of [...input.messages].sort((a, b) => a.id - b.id)) {
    if (message.direction === "inbound") {
      waitingSince ??= message.createdAt;
      visitorQuestion = /\?|^(?:what|how|why|can|do|is|are|where)\b/i.test(
        message.text?.trim() ?? "",
      );
      continue;
    }
    if (message.direction !== "outbound") continue;
    const text = message.text?.trim() ?? "";
    if (
      /could not prepare a reliable answer|don't have (?:verified|confirmed) information|do not have (?:verified|confirmed) information|unable to (?:answer|process)/i.test(
        text,
      )
    )
      flags.push({
        code: "fallback",
        messageId: message.id,
        detail:
          "The reply contains an unavailable-answer or processing fallback. Check whether the knowledge or flow could have answered it.",
      });
    const normalized = text.toLowerCase().replace(/\s+/g, " ");
    if (
      waitingSince &&
      !visitorQuestion &&
      normalized &&
      normalized === previousReply &&
      text.includes("?")
    )
      flags.push({
        code: "repeated_prompt",
        messageId: message.id,
        detail:
          "The same question was repeated after a visitor reply. Validation may justify it; check the context.",
      });
    if (waitingSince && !input.humanOwned) {
      const delay = message.createdAt.getTime() - waitingSince.getTime();
      if (delay >= 10_000 && delay <= 300_000)
        flags.push({
          code: "slow_reply",
          messageId: message.id,
          detail: `The first recorded reply followed the visitor message by ${(delay / 1000).toFixed(1)} seconds. This includes processing/transport and is not model latency alone.`,
        });
    }
    waitingSince = null;
    previousReply = normalized;
  }
  if (
    input.activeTask &&
    !input.humanOwned &&
    input.lastMessageAt &&
    (input.now ?? new Date()).getTime() - input.lastMessageAt.getTime() >=
      86_400_000
  )
    flags.push({
      code: "inactive_enquiry",
      messageId: null,
      detail:
        "An active enquiry has had no messages for at least 24 hours. It may be awaiting the customer; abandonment is not confirmed.",
    });
  if (input.failedActions)
    flags.push({
      code: "failed_action",
      messageId: null,
      detail: `${input.failedActions} recorded tool/action failure(s). Check execution details before retrying.`,
    });
  return flags;
}
