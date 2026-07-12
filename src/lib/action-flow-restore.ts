import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db-config";
import {
  actionFlowBranchRules,
  actionFlowSteps,
  projectActions,
} from "@/lib/db-schema";

const recordSchema = z.record(z.string(), z.unknown());
const nullableStringSchema = z.string().nullable();
const nullableNumberSchema = z.number().int().positive().nullable();

const actionFlowSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  action: z.object({
    name: z.string().trim().min(1).max(120),
    description: nullableStringSchema,
    status: z.string().trim().min(1).max(80),
    triggerPhrases: z.array(z.string()),
    settings: recordSchema,
  }),
  steps: z.array(
    z.object({
      id: z.number().int().positive(),
      sortOrder: z.number().int().positive(),
      stepType: z.string().trim().min(1).max(80),
      fieldKey: nullableStringSchema,
      label: nullableStringSchema,
      prompt: nullableStringSchema,
      inputType: nullableStringSchema,
      isRequired: z.boolean(),
      isEnabled: z.boolean(),
      options: z.array(z.unknown()),
      settings: recordSchema,
      nextStepId: nullableNumberSchema,
      operationId: nullableNumberSchema,
    }),
  ),
  branchRules: z.array(
    z.object({
      id: z.number().int().positive(),
      sourceStepId: z.number().int().positive(),
      sourceFieldKey: z.string().trim().min(1).max(80),
      operator: z.string().trim().min(1).max(80),
      comparisonValue: nullableStringSchema,
      targetStepId: z.number().int().positive(),
      sortOrder: z.number().int().positive(),
      isEnabled: z.boolean(),
      settings: recordSchema,
    }),
  ),
});

export type RestoreActionFlowDraftResult = {
  branchRuleCount: number;
  skippedBranchRuleCount: number;
  stepCount: number;
};

export async function restoreActionFlowDraftFromSnapshot(input: {
  actionId: number;
  projectId: number;
  snapshot: Record<string, unknown>;
}): Promise<RestoreActionFlowDraftResult> {
  const snapshot = actionFlowSnapshotSchema.parse(input.snapshot);
  const orderedSteps = [...snapshot.steps].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.id - right.id,
  );

  return db.transaction(async (tx) => {
    await tx
      .delete(actionFlowBranchRules)
      .where(
        and(
          eq(actionFlowBranchRules.projectId, input.projectId),
          eq(actionFlowBranchRules.actionId, input.actionId),
        ),
      );

    await tx
      .delete(actionFlowSteps)
      .where(
        and(
          eq(actionFlowSteps.projectId, input.projectId),
          eq(actionFlowSteps.actionId, input.actionId),
        ),
      );

    await tx
      .update(projectActions)
      .set({
        description: snapshot.action.description,
        name: snapshot.action.name,
        settings: snapshot.action.settings,
        status: snapshot.action.status,
        triggerPhrases: snapshot.action.triggerPhrases,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectActions.projectId, input.projectId),
          eq(projectActions.id, input.actionId),
        ),
      );

    const stepIdMap = new Map<number, number>();
    for (const step of orderedSteps) {
      const [restoredStep] = await tx
        .insert(actionFlowSteps)
        .values({
          actionId: input.actionId,
          fieldKey: step.fieldKey,
          inputType: step.inputType,
          isEnabled: step.isEnabled,
          isRequired: step.isRequired,
          label: step.label,
          nextStepId: null,
          operationId: step.operationId,
          options: step.options,
          projectId: input.projectId,
          prompt: step.prompt,
          settings: step.settings,
          sortOrder: step.sortOrder,
          stepType: step.stepType,
          updatedAt: new Date(),
        })
        .returning();

      stepIdMap.set(step.id, restoredStep.id);
    }

    for (const step of orderedSteps) {
      const restoredStepId = stepIdMap.get(step.id);
      if (!restoredStepId) {
        continue;
      }

      const nextStepId =
        step.nextStepId === null
          ? null
          : (stepIdMap.get(step.nextStepId) ?? null);

      await tx
        .update(actionFlowSteps)
        .set({
          nextStepId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(actionFlowSteps.projectId, input.projectId),
            eq(actionFlowSteps.actionId, input.actionId),
            eq(actionFlowSteps.id, restoredStepId),
          ),
        );
    }

    let branchRuleCount = 0;
    let skippedBranchRuleCount = 0;
    for (const rule of snapshot.branchRules) {
      const sourceStepId = stepIdMap.get(rule.sourceStepId);
      const targetStepId = stepIdMap.get(rule.targetStepId);

      if (!sourceStepId || !targetStepId) {
        skippedBranchRuleCount += 1;
        continue;
      }

      await tx.insert(actionFlowBranchRules).values({
        actionId: input.actionId,
        comparisonValue: rule.comparisonValue,
        isEnabled: rule.isEnabled,
        operator: rule.operator,
        projectId: input.projectId,
        settings: rule.settings,
        sortOrder: rule.sortOrder,
        sourceFieldKey: rule.sourceFieldKey,
        sourceStepId,
        targetStepId,
        updatedAt: new Date(),
      });
      branchRuleCount += 1;
    }

    return {
      branchRuleCount,
      skippedBranchRuleCount,
      stepCount: orderedSteps.length,
    };
  });
}
