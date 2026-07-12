import {
  type ActionFlowVersionSnapshot,
  getActionFlowVersion,
  getProjectAction,
  listActionFlowBranchRules,
  listActionFlowSteps,
  listActiveProjectActions,
} from "@/lib/action-flows";
import type { RuntimeAction } from "@/lib/action-runtime";
import type {
  SelectActionFlowBranchRule,
  SelectActionFlowStep,
  SelectProjectAction,
} from "@/lib/db-schema";

export function toRuntimeAction(input: {
  action: SelectProjectAction;
  branchRules: SelectActionFlowBranchRule[];
  steps: SelectActionFlowStep[];
}): RuntimeAction {
  return {
    id: input.action.id,
    name: input.action.name,
    description: input.action.description,
    triggerPhrases: input.action.triggerPhrases,
    branchRules: input.branchRules.map((rule) => ({
      id: rule.id,
      sourceStepId: rule.sourceStepId,
      sourceFieldKey: rule.sourceFieldKey,
      operator: rule.operator,
      comparisonValue: rule.comparisonValue,
      targetStepId: rule.targetStepId,
      sortOrder: rule.sortOrder,
      isEnabled: rule.isEnabled,
    })),
    steps: input.steps.map((step) => ({
      id: step.id,
      sortOrder: step.sortOrder,
      stepType: step.stepType,
      fieldKey: step.fieldKey,
      label: step.label,
      prompt: step.prompt,
      inputType: step.inputType,
      isRequired: step.isRequired,
      isEnabled: step.isEnabled,
      operationId: step.operationId,
      nextStepId: step.nextStepId,
      options: step.options,
      settings: step.settings,
    })),
  };
}

function isActionFlowVersionSnapshot(
  value: unknown,
): value is ActionFlowVersionSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ActionFlowVersionSnapshot>;
  return (
    candidate.schemaVersion === 1 &&
    Boolean(candidate.action) &&
    Array.isArray(candidate.steps) &&
    Array.isArray(candidate.branchRules)
  );
}

function toRuntimeActionFromSnapshot(
  snapshot: ActionFlowVersionSnapshot,
): RuntimeAction {
  return {
    id: snapshot.action.id,
    name: snapshot.action.name,
    description: snapshot.action.description,
    triggerPhrases: snapshot.action.triggerPhrases,
    branchRules: snapshot.branchRules.map((rule) => ({
      id: rule.id,
      sourceStepId: rule.sourceStepId,
      sourceFieldKey: rule.sourceFieldKey,
      operator: rule.operator,
      comparisonValue: rule.comparisonValue,
      targetStepId: rule.targetStepId,
      sortOrder: rule.sortOrder,
      isEnabled: rule.isEnabled,
    })),
    steps: snapshot.steps.map((step) => ({
      id: step.id,
      sortOrder: step.sortOrder,
      stepType: step.stepType,
      fieldKey: step.fieldKey,
      label: step.label,
      prompt: step.prompt,
      inputType: step.inputType,
      isRequired: step.isRequired,
      isEnabled: step.isEnabled,
      operationId: step.operationId,
      nextStepId: step.nextStepId,
      options: step.options,
      settings: step.settings,
    })),
  };
}

async function getPublishedRuntimeAction(
  projectId: number,
  action: SelectProjectAction,
) {
  if (!action.publishedVersionId) {
    return null;
  }

  const version = await getActionFlowVersion(
    projectId,
    action.id,
    action.publishedVersionId,
  );

  if (!version || version.status !== "published") {
    return null;
  }

  return isActionFlowVersionSnapshot(version.snapshot)
    ? toRuntimeActionFromSnapshot(version.snapshot)
    : null;
}

export async function listRuntimeProjectActions(projectId: number) {
  const actions = await listActiveProjectActions(projectId);

  return Promise.all(
    actions.map(async (action) => {
      const publishedAction = await getPublishedRuntimeAction(
        projectId,
        action,
      );

      if (publishedAction) {
        return publishedAction;
      }

      const [steps, branchRules] = await Promise.all([
        listActionFlowSteps(projectId, action.id),
        listActionFlowBranchRules(projectId, action.id),
      ]);

      return toRuntimeAction({ action, branchRules, steps });
    }),
  );
}

export async function getRuntimeProjectAction(
  projectId: number,
  actionId: number,
) {
  const action = await getProjectAction(projectId, actionId);

  if (!action || action.status !== "active") {
    return null;
  }

  const publishedAction = await getPublishedRuntimeAction(projectId, action);

  if (publishedAction) {
    return publishedAction;
  }

  const [steps, branchRules] = await Promise.all([
    listActionFlowSteps(projectId, action.id),
    listActionFlowBranchRules(projectId, action.id),
  ]);

  return toRuntimeAction({ action, branchRules, steps });
}
