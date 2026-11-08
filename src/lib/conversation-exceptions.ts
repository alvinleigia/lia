import { createHash } from "node:crypto";
import { z } from "zod";
import { getClearCandidatesDuringClarification } from "@/lib/conversation-field-extraction";
import type {
  ExecuteStructuredTurnInput,
  StructuredTurnExecution,
} from "@/lib/conversation-turn-engine";
import { validateTaskFieldValue } from "@/lib/conversational-task-field-validation";

export const EXCEPTION_METADATA_KEY = "liaException";
export const ASSISTANCE_OFFER =
  "I'm having trouble resolving this. Would you like our team to help?";
const OFFER_LIFETIME_MS = 30 * 60_000;
const reasonSchema = z.enum([
  "ambiguity",
  "knowledge_gap",
  "processing_failure",
]);
export type ExceptionReason = z.infer<typeof reasonSchema>;
export const exceptionStateSchema = z.object({
  scope: z.string().regex(/^[a-f0-9]{64}$/),
  messageId: z.number().int().positive(),
  failures: z.number().int().min(0).max(4),
  limit: z.number().int().min(0).max(3),
  reason: reasonSchema.nullable(),
  action: z.enum([
    "clarify",
    "offer_assistance",
    "review",
    "resume",
    "handoff",
    "resolved",
  ]),
  assistanceDeclined: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type ExceptionState = z.infer<typeof exceptionStateSchema>;

export function readConversationException(metadata: Record<string, unknown>) {
  const parsed = exceptionStateSchema.safeParse(
    metadata[EXCEPTION_METADATA_KEY],
  );
  return parsed.success ? parsed.data : null;
}

export function hasPendingExceptionOffer(
  metadata: Record<string, unknown>,
  now = Date.now(),
) {
  const state = readConversationException(metadata);
  return (
    state?.action === "offer_assistance" &&
    now - Date.parse(state.updatedAt) <= OFFER_LIFETIME_MS
  );
}

export function hasUnresolvedConversationException(
  metadata: Record<string, unknown>,
) {
  return ["offer_assistance", "resume", "review"].includes(
    readConversationException(metadata)?.action ?? "",
  );
}

export function getExceptionScope(
  input: ExecuteStructuredTurnInput,
  scope?: string,
) {
  if (scope) return createHash("sha256").update(scope).digest("hex");
  // Progress changes the scope without retaining the visitor's values in telemetry.
  const retained = input.fieldState
    .filter((field) => ["valid", "confirmed"].includes(field.state))
    .map((field) => [field.fieldKey, field.value])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  return createHash("sha256")
    .update(
      JSON.stringify([
        scope ?? input.activeTask?.task.id ?? "knowledge",
        retained,
      ]),
    )
    .digest("hex");
}

export function classifyConversationException(
  input: ExecuteStructuredTurnInput,
  execution: StructuredTurnExecution,
): ExceptionReason | null | "defer" {
  const proposal = execution.proposal;
  if (
    proposal.safety.decision === "refuse" ||
    ["cancel", "handoff", "complete", "confirm"].includes(
      proposal.nextAction,
    ) ||
    proposal.taskRecommendation ||
    proposal.toolRequest ||
    proposal.outcomeRecommendation
  )
    return null;
  if (execution.recovery?.outcome === "review_required")
    return "processing_failure";
  const fields =
    input.activeTask?.task.definition.fields ?? input.collection?.fields ?? [];
  const clearCandidates = proposal.ambiguity.requiresClarification
    ? getClearCandidatesDuringClarification(proposal, fields)
    : proposal.fieldCandidates;
  const invalidFields = new Set<string>();
  if (
    clearCandidates.some((candidate) => {
      const field = fields.find((field) => field.key === candidate.fieldKey);
      if (!field) return false;
      const result = validateTaskFieldValue({
        field,
        value: candidate.naturalValue,
        contextValues: new Map(
          input.context.map((value) => [value.key, value.value]),
        ),
      });
      const previous = input.fieldState.find(
        (value) => value.fieldKey === candidate.fieldKey,
      );
      if (!result.ok) invalidFields.add(candidate.fieldKey);
      return (
        result.ok &&
        (!previous ||
          !["valid", "confirmed"].includes(previous.state) ||
          String(previous.value) !== String(result.value))
      );
    })
  )
    return null;
  if (proposal.ambiguity.requiresClarification) return "ambiguity";
  if (invalidFields.size) return "ambiguity";
  if (input.stage === "knowledge" && proposal.grounding.status === "no_answer")
    return "knowledge_gap";
  if (input.stage === "extraction") {
    if (proposal.knowledgeRequest) return "defer";
    if (!proposal.fieldCandidates.length) return "ambiguity";
  }
  return null;
}

export function planConversationException(input: {
  previous: ExceptionState | null;
  scope: string;
  messageId: number;
  reason: ExceptionReason | null;
  limit: number;
  canHandoff: boolean;
  consent?: boolean;
  offeredMessageId?: number;
  now?: Date;
}): ExceptionState | null {
  if (input.previous && input.previous.messageId > input.messageId)
    return input.previous;
  const previous =
    input.previous?.scope === input.scope ? input.previous : null;
  if (previous && previous.messageId >= input.messageId) return previous;
  const limit = Math.max(0, Math.min(3, input.limit));
  const base = {
    scope: input.scope,
    messageId: input.messageId,
    limit,
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
  const currentOffer =
    previous?.action === "offer_assistance" &&
    previous.messageId === input.offeredMessageId;
  if (input.consent !== undefined && currentOffer)
    return {
      ...base,
      failures: previous.failures,
      reason: previous.reason,
      action: input.consent
        ? input.canHandoff
          ? "handoff"
          : "review"
        : "resume",
      assistanceDeclined: !input.consent,
    };
  // A consent decision made against an older offer cannot authorize a handoff.
  if (input.consent !== undefined)
    return {
      ...base,
      failures: previous?.failures ?? 0,
      reason: previous?.reason ?? "ambiguity",
      action: "review",
      assistanceDeclined: previous?.assistanceDeclined ?? false,
    };
  if (input.reason === null)
    return previous && previous.action !== "resolved"
      ? {
          ...base,
          failures: 0,
          reason: null,
          action: "resolved",
          assistanceDeclined: false,
        }
      : null;
  const failures = Math.min(4, (previous?.failures ?? 0) + 1);
  const assistanceDeclined = previous?.assistanceDeclined ?? false;
  return {
    ...base,
    failures,
    reason: input.reason,
    assistanceDeclined,
    action:
      failures <= limit
        ? "clarify"
        : input.canHandoff &&
            !assistanceDeclined &&
            previous?.action !== "offer_assistance" &&
            previous?.action !== "review"
          ? "offer_assistance"
          : "review",
  };
}

export function applyConversationExceptionDecision(
  execution: StructuredTurnExecution,
  state: ExceptionState,
  input: ExecuteStructuredTurnInput,
): StructuredTurnExecution {
  if (["clarify", "resolved"].includes(state.action))
    return { ...execution, exception: state };
  const requested = (
    input.activeTask?.task.definition.fields ??
    input.collection?.fields ??
    []
  ).find((field) => field.key === input.requestedFieldKey);
  const reply =
    state.action === "offer_assistance"
      ? ASSISTANCE_OFFER
      : state.action === "resume"
        ? `No problem. Let's keep trying here. ${requested?.prompt ?? "Could you rephrase what you need help with?"}`
        : state.action === "handoff"
          ? "I'll request help from our team."
          : "I'm still unable to resolve this reliably. You can rephrase your request or contact our team directly for help.";
  return {
    ...execution,
    exception: state,
    proposal: {
      ...execution.proposal,
      nextAction: state.action === "handoff" ? "handoff" : "clarify",
      reply,
      grounding: { status: "not_needed", excerptIds: [] },
      fieldCandidates:
        state.action === "offer_assistance"
          ? execution.proposal.fieldCandidates
          : [],
      answerSelections: null,
      knowledgeRequest: null,
      taskRecommendation: null,
      toolRequest: null,
      routeRecommendation: null,
      outcomeRecommendation: null,
      safety: {
        decision: state.action === "handoff" ? "handoff" : "allow",
        reasonCode: `exception_${state.action}`,
      },
      ambiguity:
        state.action === "handoff"
          ? { requiresClarification: false, question: null, fieldKeys: null }
          : {
              requiresClarification: true,
              question: reply,
              fieldKeys:
                execution.proposal.ambiguity.fieldKeys ??
                (input.requestedFieldKey ? [input.requestedFieldKey] : null),
            },
    },
  };
}
