import {
  getActionStepInputType,
  getActionStepOptions,
  getRunnableActionSteps,
  isActionInputStep,
  normalizeSubmissionFieldKey,
  type RuntimeAction,
  type RuntimeActionStep,
} from "@/lib/action-runtime";
import type { TaskFieldDefinition } from "@/lib/conversational-task-field-validation";

export const FLOW_FIELD_CANDIDATES = "flowFieldCandidates";

// Use the published step definitions. Values for future steps stay provisional
// until that step is reached and its own validator/branch rules run.
export function getFlowCollectionFields(
  action: RuntimeAction,
  currentStep: RuntimeActionStep,
  values: Record<string, unknown>,
  currentOnly = false,
) {
  const steps = getRunnableActionSteps(action);
  const remaining = currentOnly
    ? [currentStep]
    : steps.slice(steps.findIndex(({ id }) => id === currentStep.id));
  const eligible = remaining.filter(
    (step) =>
      isActionInputStep(step) &&
      !["file_upload", "product_selection"].includes(step.stepType),
  );
  const keys = eligible.map((step) =>
    normalizeSubmissionFieldKey(step.fieldKey ?? `step_${step.id}`),
  );
  return eligible.flatMap((step, index) => {
    const key = keys[index];
    if (keys.filter((candidate) => candidate === key).length !== 1) return [];
    const inputType = getActionStepInputType(step);
    const types: Record<string, TaskFieldDefinition["type"]> = {
      date: "date",
      time: "time",
      email: "email",
      phone: "phone",
      int: "integer",
      float: "decimal",
    };
    const options = getActionStepOptions(step, values)
      .filter((option) => option.value !== undefined && option.value !== null)
      .map((option) => ({ label: option.label, value: String(option.value) }));
    const field: TaskFieldDefinition = {
      id: `00000000-0000-4000-8000-${String(step.id).padStart(12, "0")}`,
      key,
      label: step.label ?? key,
      prompt: step.prompt,
      type: options.length ? "enum" : (types[inputType ?? ""] ?? "text"),
      cardinality: "single",
      required: step.isRequired,
      requiredWhen: null,
      optionSource: options.length ? { kind: "static", options } : null,
      validation: null,
      normalization: null,
      sensitivity: "personal",
      confirmation: "never",
      sourcePriority: ["visitor"],
      dependsOn: [],
    };
    return [{ field, step }];
  });
}

export function readFlowFieldCandidates(
  metadata: Record<string, unknown>,
  action: RuntimeAction,
): Record<string, string> {
  const saved = metadata[FLOW_FIELD_CANDIDATES] as
    | { actionId?: unknown; actionVersionId?: unknown; answers?: unknown }
    | undefined;
  if (
    !saved ||
    saved.actionId !== action.id ||
    saved.actionVersionId !== action.versionId ||
    !saved.answers ||
    typeof saved.answers !== "object" ||
    Array.isArray(saved.answers)
  )
    return {};
  const ids = new Set(
    getRunnableActionSteps(action).map(({ id }) => String(id)),
  );
  return Object.fromEntries(
    Object.entries(saved.answers).filter(
      ([id, value]) =>
        ids.has(id) && typeof value === "string" && value.length <= 2000,
    ),
  ) as Record<string, string>;
}
