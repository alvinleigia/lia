import type { StructuredTurnValidationContext } from "@/lib/conversation-turn-compiler";
import {
  type TurnResultV1,
  turnResultV1Schema,
} from "@/lib/conversation-turn-contracts";

const SEMANTIC_PROPOSAL_CONFIDENCE_MINIMUM = 0.7;

export class TurnProposalValidationError extends Error {
  readonly codes: string[];

  constructor(codes: string[]) {
    super("The structured turn proposal failed server validation.");
    this.name = "TurnProposalValidationError";
    this.codes = codes;
  }
}

function schemaIssueCode(path: PropertyKey[], message: string) {
  const location = path.length > 0 ? path.join(".") : "result";
  return `schema:${location}:${message}`;
}

export function validateStructuredTurnProposal(
  value: unknown,
  allowed: StructuredTurnValidationContext,
): TurnResultV1 {
  const parsed = turnResultV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new TurnProposalValidationError(
      parsed.error.issues.map((issue) =>
        schemaIssueCode(issue.path, issue.message),
      ),
    );
  }

  const proposal = parsed.data;
  const issues: string[] = [];
  const hasActionProposal =
    proposal.fieldCandidates.length > 0 ||
    proposal.taskRecommendation !== null ||
    proposal.toolRequest !== null ||
    proposal.routeRecommendation !== null ||
    proposal.outcomeRecommendation !== null;

  if (
    proposal.turnKind === "greeting" &&
    (proposal.nextAction !== "ask" ||
      proposal.grounding.status !== "not_needed" ||
      proposal.ambiguity.requiresClarification ||
      hasActionProposal)
  ) {
    issues.push("invalid_greeting");
  }

  for (const excerptId of proposal.grounding.excerptIds) {
    if (!allowed.allowedExcerptIds.has(excerptId)) {
      issues.push("unknown_excerpt");
    }
  }
  for (const candidate of proposal.fieldCandidates) {
    const allowedFields =
      allowed.activeTaskId === null && proposal.taskRecommendation
        ? allowed.allowedTaskFieldKeys.get(proposal.taskRecommendation.taskId)
        : allowed.allowedFieldKeys;
    if (!allowedFields?.has(candidate.fieldKey)) {
      issues.push("unknown_field");
    }
  }
  if (
    proposal.taskRecommendation &&
    !allowed.allowedTaskIds.has(proposal.taskRecommendation.taskId)
  ) {
    issues.push("unknown_or_disallowed_task");
  }
  if (proposal.toolRequest) {
    const stages = allowed.allowedTools.get(proposal.toolRequest.toolId);
    if (!stages) {
      issues.push("unknown_or_disallowed_tool");
    } else if (!stages.has(proposal.toolRequest.stage)) {
      issues.push("disallowed_tool_stage");
    }
  }
  if (
    proposal.routeRecommendation &&
    !allowed.allowedOutputPorts.has(proposal.routeRecommendation.outputPort)
  ) {
    issues.push("unknown_output_port");
  }
  if (
    proposal.outcomeRecommendation &&
    !allowed.allowedOutcomeKeys.has(proposal.outcomeRecommendation.outcomeKey)
  ) {
    issues.push("unknown_outcome");
  }

  if (
    allowed.activeTaskId === null &&
    ((proposal.fieldCandidates.length > 0 &&
      proposal.taskRecommendation === null) ||
      proposal.toolRequest ||
      proposal.routeRecommendation ||
      proposal.outcomeRecommendation)
  ) {
    issues.push("active_task_required");
  }
  if (
    proposal.turnKind === "task_switch" &&
    (!proposal.taskRecommendation ||
      proposal.taskRecommendation.taskId === allowed.activeTaskId)
  ) {
    issues.push("task_switch_target_required");
  }
  if (
    proposal.turnKind === "task_recommendation" &&
    !proposal.taskRecommendation
  ) {
    issues.push("task_recommendation_required");
  }
  if (proposal.nextAction === "complete" && !proposal.outcomeRecommendation) {
    issues.push("completion_outcome_required");
  }
  if (
    proposal.taskRecommendation &&
    proposal.taskRecommendation.confidence <
      SEMANTIC_PROPOSAL_CONFIDENCE_MINIMUM &&
    !proposal.ambiguity.requiresClarification
  ) {
    issues.push("ambiguous_task_requires_clarification");
  }
  if (
    proposal.routeRecommendation &&
    proposal.routeRecommendation.confidence <
      SEMANTIC_PROPOSAL_CONFIDENCE_MINIMUM &&
    !proposal.ambiguity.requiresClarification
  ) {
    issues.push("ambiguous_route_requires_clarification");
  }

  if (proposal.safety.decision !== "allow") {
    if (
      proposal.fieldCandidates.length > 0 ||
      proposal.taskRecommendation ||
      proposal.toolRequest ||
      proposal.routeRecommendation ||
      proposal.outcomeRecommendation
    ) {
      issues.push("blocked_turn_contains_proposals");
    }
    const expectedAction =
      proposal.safety.decision === "clarify"
        ? "clarify"
        : proposal.safety.decision === "handoff"
          ? "handoff"
          : "fail";
    if (proposal.nextAction !== expectedAction) {
      issues.push("blocked_turn_action_mismatch");
    }
  }

  if (issues.length > 0) {
    throw new TurnProposalValidationError([...new Set(issues)]);
  }

  return proposal;
}
