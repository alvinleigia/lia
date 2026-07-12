import { getActionFlowStep, listActionFlowSteps } from "@/lib/action-flows";
import {
  buildInvalidStepAnswerMessage,
  getActionStepOptions,
  isActionInputStep,
  normalizeActionText,
  normalizeSubmissionFieldKey,
  type RuntimeActionStep,
  validateStepAnswer,
} from "@/lib/action-runtime";
import type { SelectActionFlowStep } from "@/lib/db-schema";
import { isFlowMediaUploadValue } from "@/lib/flow-media-values";
import {
  normalizeFlowAddressValue,
  normalizeFlowLocationValue,
} from "@/lib/flow-structured-values";

export type ActionFlowValidationIssue = {
  stepId: number;
  fieldKey: string;
  message: string;
};

type ActionFlowValidationResult = {
  isValid: boolean;
  issues: ActionFlowValidationIssue[];
};

function toRuntimeStep(step: SelectActionFlowStep): RuntimeActionStep {
  return {
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
  };
}

function getStepFieldKey(step: SelectActionFlowStep) {
  return normalizeSubmissionFieldKey(step.fieldKey ?? `step_${step.id}`);
}

function isBlankValue(value: unknown) {
  return value === undefined || value === null || String(value).trim() === "";
}

function getRequiredMessage(step: SelectActionFlowStep, fieldKey: string) {
  const requiredMessage = step.settings.requiredMessage;

  if (typeof requiredMessage === "string" && requiredMessage.trim()) {
    return requiredMessage.trim();
  }

  return `${step.label || step.prompt || fieldKey} is required.`;
}

function validateStoredStepValue(
  step: RuntimeActionStep,
  value: unknown,
  fields: Record<string, unknown>,
) {
  if (step.stepType === "file_upload") {
    return isFlowMediaUploadValue(value);
  }

  if (step.stepType === "address") {
    return Boolean(normalizeFlowAddressValue(value));
  }

  if (step.stepType === "location") {
    return Boolean(normalizeFlowLocationValue(value));
  }

  const options = getActionStepOptions(step, fields);

  if (options.length === 0) {
    return validateStepAnswer(step, String(value), fields).isValid;
  }

  const valueText = String(value);
  const normalizedValue = normalizeActionText(valueText);

  return options.some(
    (option) =>
      String(option.value) === valueText ||
      normalizeActionText(option.label) === normalizedValue,
  );
}

export async function validateActionFlowProgress(input: {
  projectId: number;
  actionId: number;
  stepId?: number;
  value?: unknown;
  fields: Record<string, unknown>;
}): Promise<ActionFlowValidationResult> {
  if (!input.stepId) {
    return {
      isValid: false,
      issues: [
        {
          stepId: 0,
          fieldKey: "stepId",
          message: "Flow step is required.",
        },
      ],
    };
  }

  const step = await getActionFlowStep(
    input.projectId,
    input.actionId,
    input.stepId,
  );

  if (!step || !step.isEnabled || step.stepType === "operation") {
    return {
      isValid: false,
      issues: [
        {
          stepId: input.stepId,
          fieldKey: "stepId",
          message: "Flow step is unavailable.",
        },
      ],
    };
  }

  const runtimeStep = toRuntimeStep(step);
  if (!isActionInputStep(runtimeStep)) {
    return { isValid: true, issues: [] };
  }

  const fieldKey = getStepFieldKey(step);
  const value =
    input.value === undefined ? input.fields[fieldKey] : input.value;

  if (isBlankValue(value)) {
    return step.isRequired
      ? {
          isValid: false,
          issues: [
            {
              stepId: step.id,
              fieldKey,
              message: getRequiredMessage(step, fieldKey),
            },
          ],
        }
      : { isValid: true, issues: [] };
  }

  if (!validateStoredStepValue(runtimeStep, value, input.fields)) {
    return {
      isValid: false,
      issues: [
        {
          stepId: step.id,
          fieldKey,
          message: buildInvalidStepAnswerMessage(runtimeStep, input.fields),
        },
      ],
    };
  }

  return { isValid: true, issues: [] };
}

export async function validateActionSubmissionFields(input: {
  projectId: number;
  actionId: number;
  fields: Record<string, unknown>;
}): Promise<ActionFlowValidationResult> {
  const steps = await listActionFlowSteps(input.projectId, input.actionId);
  const issues: ActionFlowValidationIssue[] = [];

  for (const step of steps) {
    const runtimeStep = toRuntimeStep(step);

    if (!runtimeStep.isEnabled || !isActionInputStep(runtimeStep)) {
      continue;
    }

    const fieldKey = getStepFieldKey(step);
    const value = input.fields[fieldKey];

    if (isBlankValue(value)) {
      if (step.isRequired) {
        issues.push({
          stepId: step.id,
          fieldKey,
          message: getRequiredMessage(step, fieldKey),
        });
      }

      continue;
    }

    if (!validateStoredStepValue(runtimeStep, value, input.fields)) {
      issues.push({
        stepId: step.id,
        fieldKey,
        message: buildInvalidStepAnswerMessage(runtimeStep, input.fields),
      });
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}
