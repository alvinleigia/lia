"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionFormState } from "@/lib/action-form-state";
import { listAuditLogsForTarget, writeAuditLog } from "@/lib/audit";
import { resolveStrictUserAndProject } from "@/lib/auth-project";
import {
  getConversationEvaluationDashboard,
  saveConversationEvaluationPolicy,
  saveConversationEvaluationResult,
} from "@/lib/conversation-evaluations";
import { getPhase17aCandidateSnapshot } from "@/lib/phase17a-release-data";
import {
  PHASE17A_BASELINE_AUDIT_ACTION,
  PHASE17A_BASELINE_TARGET_TYPE,
  PHASE17A_RELEASE_AUDIT_ACTION,
  PHASE17A_RELEASE_TARGET_TYPE,
  parsePhase17aBaselineAuditRecord,
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

const optimizationBaselineSchema = z.object({
  projectId: z.coerce.number().int().positive(),
});

const optimizationReleaseSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  candidateLabel: z.string().trim().min(1).max(120),
  candidateReference: z.string().trim().min(1).max(200),
  rollbackReference: z.string().trim().min(1).max(200),
});

export async function recordPhase17aOptimizationBaseline(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = optimizationBaselineSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) return { error: "Please check the selected project." };

  const context = await resolveStrictUserAndProject(parsed.data.projectId);
  const existingAudits = await listAuditLogsForTarget({
    action: PHASE17A_BASELINE_AUDIT_ACTION,
    limit: 1,
    projectId: context.project.id,
    targetId: context.project.id,
    targetType: PHASE17A_BASELINE_TARGET_TYPE,
  });
  if (existingAudits.length > 0) {
    const existing = parsePhase17aBaselineAuditRecord(
      existingAudits[0].auditLog.metadata,
    );
    return existing
      ? { error: "The immutable Phase 17A baseline has already been recorded." }
      : {
          error:
            "The existing Phase 17A baseline record is invalid. Review the audit log before continuing.",
        };
  }

  const windowEndedAt = new Date();
  const windowStartedAt = new Date(
    windowEndedAt.getTime() - 30 * 24 * 60 * 60 * 1000,
  );
  const snapshot = await getPhase17aCandidateSnapshot(context.project.id, {
    since: windowStartedAt,
    until: windowEndedAt,
  });
  await writeAuditLog({
    ...context,
    action: PHASE17A_BASELINE_AUDIT_ACTION,
    targetType: PHASE17A_BASELINE_TARGET_TYPE,
    targetId: context.project.id,
    metadata: {
      schemaVersion: 1,
      capturedAt: windowEndedAt.toISOString(),
      windowStartedAt: windowStartedAt.toISOString(),
      windowEndedAt: windowEndedAt.toISOString(),
      metrics: snapshot.metrics,
    },
  });
  revalidatePath("/projects/diagnostics/evaluations");
  revalidatePath("/projects/analytics");
  revalidatePath("/projects/audit");
  return { success: "Immutable Phase 17A baseline recorded." };
}

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
    return { error: "Please check the candidate and rollback references." };
  }
  const context = await resolveStrictUserAndProject(parsed.data.projectId);
  const baselineAudits = await listAuditLogsForTarget({
    action: PHASE17A_BASELINE_AUDIT_ACTION,
    limit: 1,
    projectId: context.project.id,
    targetId: context.project.id,
    targetType: PHASE17A_BASELINE_TARGET_TYPE,
  });
  const baseline = baselineAudits[0]
    ? parsePhase17aBaselineAuditRecord(baselineAudits[0].auditLog.metadata)
    : null;
  if (!baseline) {
    return {
      error:
        "Record the immutable Phase 17A baseline before evaluating a release.",
    };
  }

  const candidateWindowStartedAt = new Date(baseline.capturedAt);
  const candidateWindowEndedAt = new Date();
  const [evaluation, snapshot] = await Promise.all([
    getConversationEvaluationDashboard(
      context.project.id,
      parsed.data.candidateLabel,
    ),
    getPhase17aCandidateSnapshot(context.project.id, {
      since: candidateWindowStartedAt,
      until: candidateWindowEndedAt,
    }),
  ]);
  const gate = summarizePhase17aReleaseGate({
    baseline: baseline.metrics,
    candidate: snapshot.metrics,
    evaluationReady: evaluation.gate.ready,
  });

  await writeAuditLog({
    ...context,
    action: PHASE17A_RELEASE_AUDIT_ACTION,
    targetType: PHASE17A_RELEASE_TARGET_TYPE,
    targetId: context.project.id,
    metadata: {
      schemaVersion: 2,
      candidateLabel: parsed.data.candidateLabel,
      candidateReference: parsed.data.candidateReference,
      rollbackReference: parsed.data.rollbackReference,
      baseline: baseline.metrics,
      baselineCapturedAt: baseline.capturedAt,
      candidate: snapshot.metrics,
      candidateWindowStartedAt: candidateWindowStartedAt.toISOString(),
      candidateWindowEndedAt: candidateWindowEndedAt.toISOString(),
      evaluationReady: gate.evaluationReady,
      efficiencyReady: gate.efficiencyReady,
      ready: gate.ready,
      improvedMetricLabels: gate.improvedMetrics.map((metric) => metric.label),
    },
  });
  revalidatePath("/projects/diagnostics/evaluations");
  revalidatePath("/projects/analytics");
  revalidatePath("/projects/audit");
  return {
    success: gate.ready
      ? "Phase 17A release comparison recorded. The gate is ready."
      : "Phase 17A release comparison recorded. The gate remains blocked.",
  };
}
