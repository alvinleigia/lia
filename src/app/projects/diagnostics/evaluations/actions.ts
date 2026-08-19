"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionFormState } from "@/lib/action-form-state";
import { writeAuditLog } from "@/lib/audit";
import { resolveStrictUserAndProject } from "@/lib/auth-project";
import {
  saveConversationEvaluationPolicy,
  saveConversationEvaluationResult,
} from "@/lib/conversation-evaluations";

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
  return {};
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
  return {};
}
