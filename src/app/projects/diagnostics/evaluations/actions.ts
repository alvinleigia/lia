"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionFormState } from "@/lib/action-form-state";
import { writeAuditLog } from "@/lib/audit";
import { resolveStrictUserAndProject } from "@/lib/auth-project";
import {
  getConversationEvaluationDashboard,
  saveConversationEvaluationPolicy,
  saveConversationEvaluationResult,
} from "@/lib/conversation-evaluations";
import { getPhase17aCandidateSnapshot } from "@/lib/phase17a-release-data";
import {
  PHASE17A_RELEASE_AUDIT_ACTION,
  PHASE17A_RELEASE_TARGET_TYPE,
  summarizePhase17aReleaseGate,
} from "@/lib/phase17a-release-gate";

const resultSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  regressionCaseId: z.coerce.number().int().positive(),
  candidateLabel: z.string().trim().min(1).max(120),
  observedBehavior: z.string().trim().min(3).max(4000),
  passed: z.enum(["true", "false"]),
});

const policySchema = z.object({
  projectId: z.coerce.number().int().positive(),
  minimumPassRate: z.coerce.number().int().min(0).max(100),
  maximumSafetyFailures: z.coerce.number().int().min(0).max(100),
});

const nonnegativeMetricSchema = z
  .string()
  .trim()
  .min(1)
  .transform(Number)
  .pipe(z.number().finite().nonnegative());
const percentageMetricSchema = z
  .string()
  .trim()
  .min(1)
  .transform(Number)
  .pipe(z.number().finite().min(0).max(100));

const optimizationReleaseSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  candidateLabel: z.string().trim().min(1).max(120),
  candidateReference: z.string().trim().min(1).max(200),
  rollbackReference: z.string().trim().min(1).max(200),
  baselineAverageRequestLatencyMs: nonnegativeMetricSchema,
  baselineAttemptsPerCompletion: nonnegativeMetricSchema,
  baselineModelTurnRate: percentageMetricSchema,
  baselineRetryFallbackRate: percentageMetricSchema,
  baselineTokensPerDirectChat: nonnegativeMetricSchema,
});

export async function recordEvaluationResult(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = resultSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Please check the evaluation result." };
  const context = await resolveStrictUserAndProject(parsed.data.projectId);
  const result = await saveConversationEvaluationResult({
    ...parsed.data,
    passed: parsed.data.passed === "true",
    evaluatedByUserId: context.user.id,
  });
  await writeAuditLog({
    ...context,
    action: "conversation.evaluation_result_recorded",
    targetType: "conversation_evaluation_result",
    targetId: result.id,
    metadata: { passed: result.passed, candidateLabel: result.candidateLabel },
  });
  revalidatePath("/projects/diagnostics/evaluations");
  return { success: "Evaluation result recorded." };
}

export async function updateEvaluationPolicy(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = policySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success)
    return { error: "Please check the promotion thresholds." };
  const context = await resolveStrictUserAndProject(parsed.data.projectId);
  const policy = await saveConversationEvaluationPolicy({
    ...parsed.data,
    updatedByUserId: context.user.id,
  });
  await writeAuditLog({
    ...context,
    action: "conversation.evaluation_policy_updated",
    targetType: "conversation_evaluation_policy",
    targetId: policy.id,
    metadata: {
      minimumPassRate: policy.minimumPassRate,
      maximumSafetyFailures: policy.maximumSafetyFailures,
    },
  });
  revalidatePath("/projects/diagnostics/evaluations");
  return { success: "Evaluation thresholds saved." };
}

export async function recordPhase17aOptimizationRelease(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = optimizationReleaseSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { error: "Please check the baseline and release references." };
  }
  const context = await resolveStrictUserAndProject(parsed.data.projectId);
  const [evaluation, snapshot] = await Promise.all([
    getConversationEvaluationDashboard(
      context.project.id,
      parsed.data.candidateLabel,
    ),
    getPhase17aCandidateSnapshot(context.project.id),
  ]);
  const baseline = {
    averageRequestLatencyMs: parsed.data.baselineAverageRequestLatencyMs,
    attemptsPerCompletion: parsed.data.baselineAttemptsPerCompletion,
    modelTurnRate: parsed.data.baselineModelTurnRate,
    retryFallbackRate: parsed.data.baselineRetryFallbackRate,
    tokensPerDirectChat: parsed.data.baselineTokensPerDirectChat,
  };
  const gate = summarizePhase17aReleaseGate({
    baseline,
    candidate: snapshot.metrics,
    evaluationReady: evaluation.gate.ready,
  });

  await writeAuditLog({
    ...context,
    action: PHASE17A_RELEASE_AUDIT_ACTION,
    targetType: PHASE17A_RELEASE_TARGET_TYPE,
    targetId: context.project.id,
    metadata: {
      schemaVersion: 1,
      candidateLabel: parsed.data.candidateLabel,
      candidateReference: parsed.data.candidateReference,
      rollbackReference: parsed.data.rollbackReference,
      baseline,
      candidate: snapshot.metrics,
      evaluationReady: gate.evaluationReady,
      efficiencyReady: gate.efficiencyReady,
      ready: gate.ready,
      improvedMetricLabels: gate.improvedMetrics.map((metric) => metric.label),
    },
  });
  revalidatePath("/projects/diagnostics/evaluations");
  revalidatePath("/projects/audit");
  return {
    success: gate.ready
      ? "Phase 17A release comparison recorded. The gate is ready."
      : "Phase 17A release comparison recorded. The gate remains blocked.",
  };
}
