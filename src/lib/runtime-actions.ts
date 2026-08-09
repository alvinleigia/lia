import {
  type ActionFlowVersionSnapshot,
  getActionFlowVersion,
  getProjectAction,
  listActionFlowBranchRules,
  listActionFlowSteps,
  listActiveProjectActions,
} from "@/lib/action-flows";
import {
  compileRuntimeActionGraph,
  type RuntimeAction,
} from "@/lib/action-runtime";
import type {
  SelectActionFlowBranchRule,
  SelectActionFlowStep,
  SelectActionSubmission,
  SelectProjectAction,
} from "@/lib/db-schema";
import { compiledHybridFlowGraphV1Schema } from "@/lib/hybrid-flow-contracts";

export function toRuntimeAction(input: {
  action: SelectProjectAction;
  branchRules: SelectActionFlowBranchRule[];
  steps: SelectActionFlowStep[];
}): RuntimeAction {
  const runtimeAction: RuntimeAction = {
    id: input.action.id,
    versionId: null,
    versionNumber: null,
    name: input.action.name,
    description: input.action.description,
    triggerPhrases: input.action.triggerPhrases,
    settings: input.action.settings,
    branchRules: input.branchRules.map((rule) => ({
      id: rule.id,
      sourceStepId: rule.sourceStepId,
      sourceFieldKey: rule.sourceFieldKey,
      operator: rule.operator,
      comparisonValue: rule.comparisonValue,
      targetStepId: rule.targetStepId,
      sortOrder: rule.sortOrder,
      isEnabled: rule.isEnabled,
      settings: rule.settings,
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

  return {
    ...runtimeAction,
    compiledGraph: compileRuntimeActionGraph(runtimeAction),
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
  version: { id: number; versionNumber: number },
): RuntimeAction {
  const hybridGraph = compiledHybridFlowGraphV1Schema.safeParse(
    snapshot.hybridGraph,
  );
  const runtimeAction: RuntimeAction = {
    id: snapshot.action.id,
    versionId: version.id,
    versionNumber: version.versionNumber,
    name: snapshot.action.name,
    description: snapshot.action.description,
    triggerPhrases: snapshot.action.triggerPhrases,
    settings: snapshot.action.settings,
    branchRules: snapshot.branchRules.map((rule) => ({
      id: rule.id,
      sourceStepId: rule.sourceStepId,
      sourceFieldKey: rule.sourceFieldKey,
      operator: rule.operator,
      comparisonValue: rule.comparisonValue,
      targetStepId: rule.targetStepId,
      sortOrder: rule.sortOrder,
      isEnabled: rule.isEnabled,
      settings: rule.settings,
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
    hybridGraph: hybridGraph.success ? hybridGraph.data : undefined,
  };

  return {
    ...runtimeAction,
    compiledGraph: compileRuntimeActionGraph(runtimeAction),
  };
}

async function getVersionedRuntimeAction(
  projectId: number,
  action: SelectProjectAction,
  versionId: number,
) {
  const version = await getActionFlowVersion(projectId, action.id, versionId);

  if (!version || version.status !== "published") {
    return null;
  }

  return isActionFlowVersionSnapshot(version.snapshot)
    ? toRuntimeActionFromSnapshot(version.snapshot, version)
    : null;
}

async function getPublishedRuntimeAction(
  projectId: number,
  action: SelectProjectAction,
) {
  return action.publishedVersionId
    ? getVersionedRuntimeAction(projectId, action, action.publishedVersionId)
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
  options: { versionId?: number | null } = {},
) {
  const action = await getProjectAction(projectId, actionId);

  if (!action || action.status !== "active") {
    return null;
  }

  if (options.versionId !== undefined && options.versionId !== null) {
    return getVersionedRuntimeAction(projectId, action, options.versionId);
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

export function getRuntimeProjectActionForSubmission(
  projectId: number,
  submission: Pick<SelectActionSubmission, "actionId" | "actionVersionId">,
) {
  return getRuntimeProjectAction(projectId, submission.actionId, {
    versionId: submission.actionVersionId,
  });
}
