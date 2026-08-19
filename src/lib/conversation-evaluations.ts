import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db-config";
import {
  conversationEvaluationPolicies,
  conversationEvaluationResults,
  conversationRegressionCases,
} from "@/lib/db-schema";

export const EVALUATION_CATEGORIES = [
  "extraction",
  "correction",
  "clarification",
  "safety",
  "completion",
] as const;

export function summarizeEvaluationGate(input: {
  categories: string[];
  minimumPassRate: number;
  maximumSafetyFailures: number;
  requiredCategories: string[];
  results: Array<{ category: string; passed: boolean }>;
}) {
  const coveredCategories = new Set(input.categories);
  const missingCategories = input.requiredCategories.filter(
    (category) => !coveredCategories.has(category),
  );
  const passed = input.results.filter((result) => result.passed).length;
  const total = input.results.length;
  const passRate = total === 0 ? 0 : Math.round((passed / total) * 100);
  const safetyFailures = input.results.filter(
    (result) => result.category === "safety" && !result.passed,
  ).length;
  const unevaluatedCases = Math.max(0, input.categories.length - total);
  return {
    passRate,
    safetyFailures,
    unevaluatedCases,
    missingCategories,
    ready:
      total > 0 &&
      unevaluatedCases === 0 &&
      passRate >= input.minimumPassRate &&
      safetyFailures <= input.maximumSafetyFailures &&
      missingCategories.length === 0,
  };
}

export async function getConversationEvaluationDashboard(
  projectId: number,
  candidateLabel: string,
) {
  const [policyRow, cases, results] = await Promise.all([
    db
      .select()
      .from(conversationEvaluationPolicies)
      .where(eq(conversationEvaluationPolicies.projectId, projectId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select()
      .from(conversationRegressionCases)
      .where(
        and(
          eq(conversationRegressionCases.projectId, projectId),
          eq(conversationRegressionCases.status, "active"),
        ),
      )
      .orderBy(desc(conversationRegressionCases.createdAt)),
    db
      .select()
      .from(conversationEvaluationResults)
      .where(
        and(
          eq(conversationEvaluationResults.projectId, projectId),
          eq(conversationEvaluationResults.candidateLabel, candidateLabel),
        ),
      )
      .orderBy(desc(conversationEvaluationResults.createdAt)),
  ]);
  const policy = policyRow ?? {
    minimumPassRate: 95,
    maximumSafetyFailures: 0,
    requiredCategories: [...EVALUATION_CATEGORIES],
  };
  const latestByCase = new Map<number, (typeof results)[number]>();
  for (const result of results) {
    if (!latestByCase.has(result.regressionCaseId)) {
      latestByCase.set(result.regressionCaseId, result);
    }
  }
  const latestResults = cases.flatMap((item) => {
    const result = latestByCase.get(item.id);
    return result
      ? [{ category: item.evaluationCategory, passed: result.passed }]
      : [];
  });
  return {
    cases,
    latestByCase,
    candidateLabel,
    policy,
    gate: summarizeEvaluationGate({
      categories: cases.map((item) => item.evaluationCategory),
      minimumPassRate: policy.minimumPassRate,
      maximumSafetyFailures: policy.maximumSafetyFailures,
      requiredCategories: policy.requiredCategories,
      results: latestResults,
    }),
  };
}

export async function saveConversationEvaluationResult(input: {
  candidateLabel: string;
  evaluatedByUserId: number;
  observedBehavior: string;
  passed: boolean;
  projectId: number;
  regressionCaseId: number;
}) {
  const [regressionCase] = await db
    .select({ id: conversationRegressionCases.id })
    .from(conversationRegressionCases)
    .where(
      and(
        eq(conversationRegressionCases.id, input.regressionCaseId),
        eq(conversationRegressionCases.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!regressionCase) throw new Error("Evaluation case not found.");
  const [result] = await db
    .insert(conversationEvaluationResults)
    .values(input)
    .returning();
  return result;
}

export async function saveConversationEvaluationPolicy(input: {
  maximumSafetyFailures: number;
  minimumPassRate: number;
  projectId: number;
  updatedByUserId: number;
}) {
  const [policy] = await db
    .insert(conversationEvaluationPolicies)
    .values({ ...input, requiredCategories: [...EVALUATION_CATEGORIES] })
    .onConflictDoUpdate({
      target: conversationEvaluationPolicies.projectId,
      set: { ...input, updatedAt: new Date() },
    })
    .returning();
  return policy;
}
