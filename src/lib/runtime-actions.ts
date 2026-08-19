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

type RuntimeExperimentSettings = {
  enabled: true;
  key: string;
  variantLabel: string;
  weight: number;
};

function getRuntimeExperimentSettings(
  action: RuntimeAction,
): RuntimeExperimentSettings | null {
  const experiment = action.settings?.experiment;

  if (
    !experiment ||
    typeof experiment !== "object" ||
    Array.isArray(experiment)
  ) {
    return null;
  }

  const record = experiment as Record<string, unknown>;
  const key = typeof record.key === "string" ? record.key.trim() : "";
  const variantLabel =
    typeof record.variantLabel === "string" ? record.variantLabel.trim() : "";
  const weight =
    typeof record.weight === "number" && Number.isFinite(record.weight)
      ? Math.max(0, record.weight)
      : 100;

  return record.enabled === true && key && variantLabel
    ? { enabled: true, key, variantLabel, weight }
    : null;
}

function getStableExperimentBucket(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function selectRuntimeExperimentActions(
  actions: RuntimeAction[],
  allocationKey: string,
) {
  const ordinaryActions: RuntimeAction[] = [];
  const experimentGroups = new Map<string, RuntimeAction[]>();

  for (const action of actions) {
    const experiment = getRuntimeExperimentSettings(action);

    if (!experiment) {
      ordinaryActions.push(action);
      continue;
    }

    const key = experiment.key.toLocaleLowerCase();
    experimentGroups.set(key, [...(experimentGroups.get(key) ?? []), action]);
  }

  const selectedVariants = Array.from(experimentGroups.entries()).map(
    ([experimentKey, variants]) => {
      const orderedVariants = [...variants].sort(
        (left, right) => left.id - right.id,
      );
      const totalWeight = orderedVariants.reduce(
        (total, variant) =>
          total + (getRuntimeExperimentSettings(variant)?.weight ?? 0),
        0,
      );

      if (totalWeight <= 0) {
        return orderedVariants[0];
      }

      const bucket =
        getStableExperimentBucket(`${experimentKey}:${allocationKey}`) %
        totalWeight;
      let cursor = 0;

      for (const variant of orderedVariants) {
        cursor += getRuntimeExperimentSettings(variant)?.weight ?? 0;
        if (bucket < cursor) return variant;
      }

      return orderedVariants.at(-1) as RuntimeAction;
    },
  );

  return [...ordinaryActions, ...selectedVariants].sort(
    (left, right) => left.id - right.id,
  );
}

async function listLoadedRuntimeProjectActions(projectId: number) {
  const actions = await listActiveProjectActions(projectId);

  const runtimeActions = await Promise.all(
    actions.map(async (action) => {
      const publishedAction = await getPublishedRuntimeAction(
        projectId,
        action,
      );

      if (publishedAction) {
        return publishedAction;
      }

      const experiment = action.settings?.experiment;
      if (
        experiment &&
        typeof experiment === "object" &&
        !Array.isArray(experiment) &&
        (experiment as Record<string, unknown>).enabled === true
      ) {
        return null;
      }

      const [steps, branchRules] = await Promise.all([
        listActionFlowSteps(projectId, action.id),
        listActionFlowBranchRules(projectId, action.id),
      ]);

      return toRuntimeAction({ action, branchRules, steps });
    }),
  );

  return runtimeActions.filter(
    (action): action is RuntimeAction => action !== null,
  );
}

export async function listRuntimeProjectActions(
  projectId: number,
  options: { allocationKey?: string } = {},
) {
  const actions = await listLoadedRuntimeProjectActions(projectId);
  return selectRuntimeExperimentActions(
    actions,
    options.allocationKey?.trim() || "default",
  );
}

export async function getRuntimeProjectAction(
  projectId: number,
  actionId: number,
  options: { allocationKey?: string; versionId?: number | null } = {},
) {
  const action = await getProjectAction(projectId, actionId);

  if (!action || action.status !== "active") {
    return null;
  }

  if (options.versionId !== undefined && options.versionId !== null) {
    return getVersionedRuntimeAction(projectId, action, options.versionId);
  }

  if (options.allocationKey) {
    const experiment = action.settings?.experiment;
    if (
      experiment &&
      typeof experiment === "object" &&
      !Array.isArray(experiment) &&
      (experiment as Record<string, unknown>).enabled === true
    ) {
      const allocatedActions = await listRuntimeProjectActions(projectId, {
        allocationKey: options.allocationKey,
      });
      const experimentKey = (experiment as Record<string, unknown>).key;

      return (
        allocatedActions.find((candidate) => {
          const candidateExperiment = getRuntimeExperimentSettings(candidate);
          return (
            candidateExperiment?.key.toLocaleLowerCase() ===
            String(experimentKey ?? "")
              .trim()
              .toLocaleLowerCase()
          );
        }) ?? null
      );
    }
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
