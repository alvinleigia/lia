import { z } from "zod";

// Recovery actions are selected by server policy, never by model-generated code.
const recoveryFailureSchema = z.enum([
  "invalid_output",
  "output_limit",
  "provider_transient",
  "retrieval_unavailable",
  "missing_evidence",
  "state_conflict",
  "unknown_operation",
  "job_failure",
  "configuration",
  "deadline",
  "budget",
  "safety",
]);
const recoveryActionSchema = z.enum([
  "repair_output",
  "retry_model",
  "fallback_model",
  "retry_read",
  "refresh_evidence",
  "reload_state",
  "retry_operation",
  "retry_job",
  "reconcile_operation",
  "clarify",
  "review",
  "stop",
]);
export type RecoveryFailure = z.infer<typeof recoveryFailureSchema>;
export type RecoveryAction = z.infer<typeof recoveryActionSchema>;

export type RecoveryDecision = {
  failure: RecoveryFailure;
  action: RecoveryAction;
  automatic: boolean;
  requiresReview: boolean;
  reason:
    | "eligible"
    | "unsafe_replay"
    | "permanent_failure"
    | "policy_block"
    | "limit_reached";
};

export const recoveryReportSchema = z.object({
  schemaVersion: z.literal(1),
  outcome: z.enum([
    "recovered",
    "clarification_required",
    "review_required",
    "stopped",
  ]),
  validated: z.boolean(),
  automaticSteps: z.number().int().min(0).max(5),
  decisions: z
    .array(
      z.object({
        failure: recoveryFailureSchema,
        action: recoveryActionSchema,
        automatic: z.boolean(),
        requiresReview: z.boolean(),
        reason: z.enum([
          "eligible",
          "unsafe_replay",
          "permanent_failure",
          "policy_block",
          "limit_reached",
        ]),
      }),
    )
    .max(12),
});
export type RecoveryReport = z.infer<typeof recoveryReportSchema>;

export type RecoveryOptions = {
  canRetry?: boolean;
  canRepair?: boolean;
  hasFallback?: boolean;
  // Set only by a provider adapter with an actual replay guarantee.
  protectedWrite?: boolean;
};

export function getRecoveryFailure(
  error: unknown,
  domain: "model" | "retrieval",
): RecoveryFailure {
  let value: unknown = error;
  for (
    let depth = 0;
    depth < 4 && value && typeof value === "object";
    depth += 1
  ) {
    const record = value as {
      statusCode?: unknown;
      status?: unknown;
      code?: unknown;
      cause?: unknown;
      message?: unknown;
      name?: unknown;
    };
    const status = record.statusCode ?? record.status;
    if (
      [400, 401, 403, 404].includes(Number(status)) ||
      record.code === "invalid_api_key"
    )
      return "configuration";
    if (record.code === "insufficient_quota") return "budget";
    if (
      record.name === "AbortError" ||
      record.message === "Turn deadline exceeded."
    )
      return "deadline";
    value = record.cause;
  }
  return domain === "retrieval"
    ? "retrieval_unavailable"
    : "provider_transient";
}

export class ConversationRecovery {
  private readonly decisions: RecoveryDecision[] = [];
  private automaticSteps = 0;

  constructor(
    private readonly limits: { maxAutomaticSteps: number; deadlineAt?: number },
  ) {}

  plan(
    failure: RecoveryFailure,
    options: RecoveryOptions = {},
  ): RecoveryDecision {
    let action: RecoveryAction = "clarify";
    let reason: RecoveryDecision["reason"] = "limit_reached";
    let requiresReview = true;
    const withinBudget =
      this.automaticSteps <
        Math.max(0, Math.min(this.limits.maxAutomaticSteps, 5)) &&
      (this.limits.deadlineAt === undefined ||
        Date.now() < this.limits.deadlineAt);
    if (failure === "safety" || failure === "budget") {
      action = "stop";
      reason = "policy_block";
      requiresReview = false;
    } else if (failure === "configuration") {
      action = "review";
      reason = "permanent_failure";
    } else if (
      failure === "unknown_operation" &&
      (!options.protectedWrite || !withinBudget || !options.canRetry)
    ) {
      action = "reconcile_operation";
      reason = "unsafe_replay";
    } else if (withinBudget && failure !== "deadline") {
      if (failure === "invalid_output" && options.canRepair)
        action = "repair_output";
      else if (failure === "provider_transient" && options.canRetry)
        action = "retry_model";
      else if (
        ["invalid_output", "output_limit", "provider_transient"].includes(
          failure,
        ) &&
        options.hasFallback
      )
        action = "fallback_model";
      else if (failure === "retrieval_unavailable" && options.canRetry)
        action = "retry_read";
      else if (failure === "missing_evidence" && options.canRetry)
        action = "refresh_evidence";
      else if (failure === "state_conflict" && options.canRetry)
        action = "reload_state";
      else if (
        failure === "unknown_operation" &&
        options.protectedWrite &&
        options.canRetry
      )
        action = "retry_operation";
      else if (failure === "job_failure" && options.canRetry)
        action = "retry_job";
      if (action !== "clarify") {
        reason = "eligible";
        requiresReview = false;
      }
    }
    const automatic = reason === "eligible";
    if (automatic) this.automaticSteps += 1;
    const decision = { failure, action, automatic, requiresReview, reason };
    // Bounded, structural metadata only: no error text, prompts, fields or credentials.
    if (this.decisions.length < 12) this.decisions.push(decision);
    return decision;
  }

  report(outcome: RecoveryReport["outcome"]): RecoveryReport | undefined {
    const last = this.decisions.at(-1);
    if (!last) return undefined;
    if (last.action === "stop") outcome = "stopped";
    else if (last.requiresReview) outcome = "review_required";
    return {
      schemaVersion: 1,
      outcome,
      validated: outcome === "recovered",
      automaticSteps: this.automaticSteps,
      decisions: [...this.decisions],
    };
  }

  async read<T>(operation: () => Promise<T>): Promise<T> {
    if (this.limits.deadlineAt === undefined) return operation();
    const remaining = this.limits.deadlineAt - Date.now();
    if (remaining <= 0) throw new Error("Turn deadline exceeded.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Turn deadline exceeded.")),
          remaining,
        );
      }),
    ]).finally(() => clearTimeout(timer));
  }
}
