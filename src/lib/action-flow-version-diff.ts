import type {
  getProjectAction,
  listActionFlowBranchRules,
  listActionFlowSteps,
} from "@/lib/action-flows";

type ProjectAction = NonNullable<Awaited<ReturnType<typeof getProjectAction>>>;
type ActionFlowSteps = Awaited<ReturnType<typeof listActionFlowSteps>>;
type ActionFlowBranchRules = Awaited<
  ReturnType<typeof listActionFlowBranchRules>
>;

export type ActionFlowVersionDiffSection = {
  key: "action" | "steps" | "branches";
  label: string;
  changed: boolean;
  draft: unknown;
  published: unknown;
};

export function getVersionSnapshotSummary(snapshot: Record<string, unknown>) {
  const steps = Array.isArray(snapshot.steps) ? snapshot.steps.length : 0;
  const branchRules = Array.isArray(snapshot.branchRules)
    ? snapshot.branchRules.length
    : 0;
  const action = isRecord(snapshot.action) ? snapshot.action : null;
  const triggerPhrases = Array.isArray(action?.triggerPhrases)
    ? action.triggerPhrases.length
    : 0;

  return { branchRules, steps, triggerPhrases };
}

export function formatVersionDate(date: Date) {
  return date.toISOString().replace("T", " ").slice(0, 16);
}

export function getDraftRuntimeChangeSummary(input: {
  action: ProjectAction;
  branchRules: ActionFlowBranchRules;
  publishedSnapshot?: Record<string, unknown>;
  steps: ActionFlowSteps;
}) {
  if (!input.publishedSnapshot) {
    return null;
  }

  const sections = getActionFlowVersionDiff({
    action: input.action,
    branchRules: input.branchRules,
    publishedSnapshot: input.publishedSnapshot,
    steps: input.steps,
  });
  const actionChanged = sections.find(
    (section) => section.key === "action",
  )?.changed;
  const stepsChanged = sections.find(
    (section) => section.key === "steps",
  )?.changed;
  const branchesChanged = sections.find(
    (section) => section.key === "branches",
  )?.changed;

  return {
    actionChanged: Boolean(actionChanged),
    branchesChanged: Boolean(branchesChanged),
    hasChanges: sections.some((section) => section.changed),
    stepsChanged: Boolean(stepsChanged),
  };
}

export function getActionFlowVersionDiff(input: {
  action: ProjectAction;
  branchRules: ActionFlowBranchRules;
  publishedSnapshot: Record<string, unknown>;
  steps: ActionFlowSteps;
}): ActionFlowVersionDiffSection[] {
  const draftAction = normalizeActionForCompare(input.action);
  const publishedAction = normalizeSnapshotActionForCompare(
    input.publishedSnapshot,
  );
  const draftSteps = normalizeStepsForCompare(input.steps);
  const publishedSteps = normalizeSnapshotStepsForCompare(
    input.publishedSnapshot,
  );
  const draftBranchRules = normalizeBranchRulesForCompare(input.branchRules);
  const publishedBranchRules = normalizeSnapshotBranchRulesForCompare(
    input.publishedSnapshot,
  );

  return [
    {
      changed: stableJson(draftAction) !== stableJson(publishedAction),
      draft: draftAction,
      key: "action",
      label: "Action Settings",
      published: publishedAction,
    },
    {
      changed: stableJson(draftSteps) !== stableJson(publishedSteps),
      draft: draftSteps,
      key: "steps",
      label: "Flow Steps",
      published: publishedSteps,
    },
    {
      changed:
        stableJson(draftBranchRules) !== stableJson(publishedBranchRules),
      draft: draftBranchRules,
      key: "branches",
      label: "Branch Rules",
      published: publishedBranchRules,
    },
  ];
}

export function formatDiffValue(value: unknown) {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJsonValue(value[key])]),
    );
  }

  return value;
}

function stableJson(value: unknown) {
  return JSON.stringify(sortJsonValue(value));
}

function normalizeActionForCompare(action: ProjectAction) {
  return {
    description: action.description,
    name: action.name,
    settings: action.settings,
    status: action.status,
    triggerPhrases: [...action.triggerPhrases].sort(),
  };
}

function normalizeSnapshotActionForCompare(snapshot: Record<string, unknown>) {
  const action = isRecord(snapshot.action) ? snapshot.action : {};
  const triggerPhrases = Array.isArray(action.triggerPhrases)
    ? action.triggerPhrases.filter(
        (phrase): phrase is string => typeof phrase === "string",
      )
    : [];

  return {
    description:
      typeof action.description === "string" || action.description === null
        ? action.description
        : null,
    name: typeof action.name === "string" ? action.name : "",
    settings: isRecord(action.settings) ? action.settings : {},
    status: typeof action.status === "string" ? action.status : "",
    triggerPhrases: [...triggerPhrases].sort(),
  };
}

function normalizeStepsForCompare(steps: ActionFlowSteps) {
  return steps
    .map((step) => ({
      fieldKey: step.fieldKey,
      id: step.id,
      inputType: step.inputType,
      isEnabled: step.isEnabled,
      isRequired: step.isRequired,
      label: step.label,
      nextStepId: step.nextStepId,
      operationId: step.operationId,
      options: step.options,
      prompt: step.prompt,
      settings: step.settings,
      sortOrder: step.sortOrder,
      stepType: step.stepType,
    }))
    .sort(
      (left, right) => left.sortOrder - right.sortOrder || left.id - right.id,
    );
}

function normalizeSnapshotStepsForCompare(snapshot: Record<string, unknown>) {
  const steps = Array.isArray(snapshot.steps) ? snapshot.steps : [];

  return steps
    .filter(isRecord)
    .map((step) => ({
      fieldKey: typeof step.fieldKey === "string" ? step.fieldKey : null,
      id: typeof step.id === "number" ? step.id : 0,
      inputType: typeof step.inputType === "string" ? step.inputType : null,
      isEnabled: Boolean(step.isEnabled),
      isRequired: Boolean(step.isRequired),
      label: typeof step.label === "string" ? step.label : null,
      nextStepId: typeof step.nextStepId === "number" ? step.nextStepId : null,
      operationId:
        typeof step.operationId === "number" ? step.operationId : null,
      options: Array.isArray(step.options) ? step.options : [],
      prompt: typeof step.prompt === "string" ? step.prompt : null,
      settings: isRecord(step.settings) ? step.settings : {},
      sortOrder: typeof step.sortOrder === "number" ? step.sortOrder : 0,
      stepType: typeof step.stepType === "string" ? step.stepType : "",
    }))
    .sort(
      (left, right) => left.sortOrder - right.sortOrder || left.id - right.id,
    );
}

function normalizeBranchRulesForCompare(branchRules: ActionFlowBranchRules) {
  return branchRules
    .map((rule) => ({
      comparisonValue: rule.comparisonValue,
      id: rule.id,
      isEnabled: rule.isEnabled,
      operator: rule.operator,
      settings: rule.settings,
      sortOrder: rule.sortOrder,
      sourceFieldKey: rule.sourceFieldKey,
      sourceStepId: rule.sourceStepId,
      targetStepId: rule.targetStepId,
    }))
    .sort(
      (left, right) =>
        left.sourceStepId - right.sourceStepId ||
        left.sortOrder - right.sortOrder ||
        left.id - right.id,
    );
}

function normalizeSnapshotBranchRulesForCompare(
  snapshot: Record<string, unknown>,
) {
  const branchRules = Array.isArray(snapshot.branchRules)
    ? snapshot.branchRules
    : [];

  return branchRules
    .filter(isRecord)
    .map((rule) => ({
      comparisonValue:
        typeof rule.comparisonValue === "string" ? rule.comparisonValue : null,
      id: typeof rule.id === "number" ? rule.id : 0,
      isEnabled: Boolean(rule.isEnabled),
      operator: typeof rule.operator === "string" ? rule.operator : "",
      settings: isRecord(rule.settings) ? rule.settings : {},
      sortOrder: typeof rule.sortOrder === "number" ? rule.sortOrder : 0,
      sourceFieldKey:
        typeof rule.sourceFieldKey === "string" ? rule.sourceFieldKey : "",
      sourceStepId:
        typeof rule.sourceStepId === "number" ? rule.sourceStepId : 0,
      targetStepId:
        typeof rule.targetStepId === "number" ? rule.targetStepId : 0,
    }))
    .sort(
      (left, right) =>
        left.sourceStepId - right.sourceStepId ||
        left.sortOrder - right.sortOrder ||
        left.id - right.id,
    );
}
