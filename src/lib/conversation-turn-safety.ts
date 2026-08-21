import type { ConversationProjectPolicyV1 } from "@/lib/conversation-contracts";
import type {
  TurnMessageV1,
  ValidatedTurnProposalV1,
} from "@/lib/conversation-turn-contracts";

export type TurnAdmissionDecision =
  | { allowed: true }
  | {
      allowed: false;
      nextAction: "clarify" | "fail" | "handoff";
      reasonCode: string;
      reply: string;
    };

export type TurnBudgetAdmission = {
  allowed: boolean;
  reasonCode?: string;
};

export interface TurnBudgetGate {
  admit(input: {
    estimatedCostUnits: number;
    estimatedInputTokens: number;
    maxTurnsPerMinute: number;
    modelId: string;
    projectId: number;
  }): Promise<TurnBudgetAdmission>;
}

export const allowTurnBudget: TurnBudgetGate = {
  async admit() {
    return { allowed: true };
  },
};

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export const MAX_MODEL_HISTORY_CHARACTERS = 8_000;

export function selectBoundedTurnHistory(
  history: TurnMessageV1[],
  maxMessages: number,
) {
  const candidates = history.slice(-maxMessages);
  const selected: TurnMessageV1[] = [];
  let characters = 0;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = candidates[index];
    if (!message) continue;
    if (characters + message.content.length > MAX_MODEL_HISTORY_CHARACTERS) {
      break;
    }
    selected.unshift(message);
    characters += message.content.length;
  }

  return selected;
}

const PROMPT_EXTRACTION_PATTERNS = [
  /\bignore (?:all |the |your )?(?:previous|system|developer) instructions?\b/i,
  /\breveal (?:the )?(?:system prompt|hidden instructions?|developer message)\b/i,
  /\b(?:show|send|give) me (?:your |the )?(?:api key|credentials?|secret key)\b/i,
];

export function evaluateTurnAdmission(input: {
  history: TurnMessageV1[];
  policy: ConversationProjectPolicyV1;
  visitorMessage: string;
}): TurnAdmissionDecision & {
  estimatedCostUnits?: number;
  estimatedInputTokens?: number;
} {
  const visitorMessage = input.visitorMessage.trim();
  const modelPolicy = input.policy.assistant.modelPolicy;

  if (!visitorMessage) {
    return {
      allowed: false,
      nextAction: "clarify",
      reasonCode: "empty_message",
      reply: "Please enter a question or request.",
    };
  }
  if (visitorMessage.length > modelPolicy.maxVisitorCharacters) {
    return {
      allowed: false,
      nextAction: "clarify",
      reasonCode: "message_too_long",
      reply: "Please shorten your message and send the main question.",
    };
  }
  if (
    PROMPT_EXTRACTION_PATTERNS.some((pattern) => pattern.test(visitorMessage))
  ) {
    return {
      allowed: false,
      nextAction: "fail",
      reasonCode: "private_instruction_request",
      reply:
        "I can help with this business, but I cannot expose private instructions or credentials.",
    };
  }

  const boundedHistory = selectBoundedTurnHistory(
    input.history,
    modelPolicy.maxHistoryMessages,
  );
  const estimatedInputTokens = estimateTokens(
    [...boundedHistory.map(({ content }) => content), visitorMessage].join(
      "\n",
    ),
  );
  const estimatedCostUnits =
    estimatedInputTokens + modelPolicy.maxOutputTokens * 4;
  if (estimatedCostUnits > modelPolicy.maxCostUnitsPerTurn) {
    return {
      allowed: false,
      nextAction: "clarify",
      reasonCode: "turn_budget_exceeded",
      reply: "Please shorten the request so I can process it safely.",
    };
  }

  return { allowed: true, estimatedCostUnits, estimatedInputTokens };
}

export function hasUnsafeTurnOutput(reply: string) {
  return (
    /instruction hierarchy, highest to lowest/i.test(reply) ||
    /\b(?:OPENAI_API_KEY|DATABASE_URL|AUTH_SECRET)\b/.test(reply) ||
    /\bsk-[A-Za-z0-9_-]{20,}\b/.test(reply)
  );
}

export function buildSafeTurnDecisionSummary(
  input: {
    attempts: number;
    modelEscalationReason: string | null;
    proposal: ValidatedTurnProposalV1;
    source: "model" | "deterministic";
  },
  metrics?: {
    estimatedCostUnits?: number | null;
    inputTokens?: number | null;
    latencyMs?: number;
    outputTokens?: number | null;
    totalTokens?: number | null;
  },
) {
  const citationCount = input.proposal.grounding.excerptIds.length;

  return {
    schemaVersion: 2,
    source: input.source,
    attempts: input.attempts,
    modelEscalationReason: input.modelEscalationReason,
    providerModelId: input.proposal.validation.providerModelId,
    turnKind: input.proposal.turnKind,
    nextAction: input.proposal.nextAction,
    groundingStatus: input.proposal.grounding.status,
    safetyDecision: input.proposal.safety.decision,
    safetyReasonCode: input.proposal.safety.reasonCode,
    fieldCandidateCount: input.proposal.fieldCandidates.length,
    hasTaskRecommendation: input.proposal.taskRecommendation !== null,
    hasToolRequest: input.proposal.toolRequest !== null,
    hasRouteRecommendation: input.proposal.routeRecommendation !== null,
    hasOutcomeRecommendation: input.proposal.outcomeRecommendation !== null,
    recommendedTaskId: input.proposal.taskRecommendation?.taskId ?? null,
    recommendedTaskConfidence:
      input.proposal.taskRecommendation?.confidence ?? null,
    recommendedOutcomeKey:
      input.proposal.outcomeRecommendation?.outcomeKey ?? null,
    recommendedOutcomeConfidence:
      input.proposal.outcomeRecommendation?.confidence ?? null,
    retrievalExcerptCount: citationCount,
    citationCount,
    latencyMs: metrics?.latencyMs ?? null,
    inputTokens: metrics?.inputTokens ?? null,
    outputTokens: metrics?.outputTokens ?? null,
    totalTokens: metrics?.totalTokens ?? null,
    estimatedCostUnits: metrics?.estimatedCostUnits ?? null,
  };
}
