import { needsExplicitPublishTerminalStep } from "@/lib/action-flow-compiler";
import { isFlowInputStepType } from "@/lib/flow-input-editor";

export type ActionPublishReadinessStep = {
  fieldKey: string | null;
  isEnabled: boolean;
  label: string | null;
  operationId: number | null;
  options: unknown;
  prompt: string | null;
  settings: Record<string, unknown>;
  sortOrder: number;
  stepType: string;
};

function hasDynamicOptions(settings: Record<string, unknown>) {
  return typeof settings.sourceType === "string" && settings.sourceType.trim();
}

function getSettingText(settings: Record<string, unknown>, key: string) {
  const value = settings[key];
  return typeof value === "string" ? value.trim() : "";
}

function isSilentActionStep(stepType: string) {
  return [
    "operation",
    "set_attribute",
    "add_tag",
    "remove_tag",
    "subscribe",
    "unsubscribe",
    "assign_agent",
    "assign_team",
  ].includes(stepType);
}

function isProductMessageStep(stepType: string) {
  return [
    "catalog_message",
    "single_product",
    "multiple_products",
    "product_selection",
  ].includes(stepType);
}

function hasProductSnapshot(settings: Record<string, unknown>) {
  return Array.isArray(settings.products) && settings.products.length > 0;
}

export function getActionPublishReadinessIssues(input: {
  routeIssueCount: number;
  steps: readonly ActionPublishReadinessStep[];
}) {
  const issues: string[] = [];
  const enabledSteps = input.steps.filter((step) => step.isEnabled);
  const runnableSteps = enabledSteps.filter(
    (step) => step.stepType !== "operation",
  );
  const enabledFieldKeys = enabledSteps
    .filter((step) => isFlowInputStepType(step.stepType))
    .map((step) => step.fieldKey?.trim())
    .filter((fieldKey): fieldKey is string => Boolean(fieldKey));
  const fieldKeyCounts = enabledFieldKeys.reduce<Map<string, number>>(
    (counts, fieldKey) => counts.set(fieldKey, (counts.get(fieldKey) ?? 0) + 1),
    new Map(),
  );

  if (input.steps.length === 0) {
    issues.push("Add at least one flow step.");
  }

  if (enabledSteps.length === 0) {
    issues.push("Enable at least one flow step.");
  }

  if (runnableSteps.length === 0) {
    issues.push("Add at least one enabled customer-facing step.");
  }

  for (const [fieldKey, count] of fieldKeyCounts) {
    if (count > 1) {
      issues.push(`Field key "${fieldKey}" is used by multiple enabled steps.`);
    }
  }

  for (const step of enabledSteps) {
    if (!isSilentActionStep(step.stepType) && !step.prompt?.trim()) {
      issues.push(`Step ${step.sortOrder} is missing a prompt.`);
    }

    if (isFlowInputStepType(step.stepType)) {
      if (!step.fieldKey?.trim()) {
        issues.push(`Step ${step.sortOrder} is missing a field key.`);
      }

      if (!step.label?.trim()) {
        issues.push(`Step ${step.sortOrder} is missing a label.`);
      }
    }

    if (
      step.stepType === "choice" &&
      (!Array.isArray(step.options) || step.options.length === 0) &&
      !hasDynamicOptions(step.settings)
    ) {
      issues.push(`Step ${step.sortOrder} needs options or an option source.`);
    }

    if (step.stepType === "operation" && !step.operationId) {
      issues.push(`Step ${step.sortOrder} is missing an operation.`);
    }

    if (
      isProductMessageStep(step.stepType) &&
      !hasProductSnapshot(step.settings)
    ) {
      issues.push(`Step ${step.sortOrder} needs a product selection.`);
    }

    if (step.stepType === "set_attribute") {
      const valueSource =
        getSettingText(step.settings, "contactAttributeValueSource") || "field";
      const hasValue =
        valueSource === "static"
          ? Boolean(getSettingText(step.settings, "contactAttributeValue"))
          : Boolean(getSettingText(step.settings, "contactAttributeFieldKey"));

      if (!getSettingText(step.settings, "contactAttributeKey") || !hasValue) {
        issues.push(
          `Step ${step.sortOrder} needs a contact attribute key and value source.`,
        );
      }
    }

    if (
      (step.stepType === "add_tag" || step.stepType === "remove_tag") &&
      !getSettingText(step.settings, "contactTagNames")
    ) {
      issues.push(`Step ${step.sortOrder} needs at least one contact tag.`);
    }

    if (
      step.stepType === "assign_agent" &&
      !getSettingText(step.settings, "contactAgentEmail")
    ) {
      issues.push(
        `Step ${step.sortOrder} needs an active company member email.`,
      );
    }

    if (
      step.stepType === "assign_team" &&
      !getSettingText(step.settings, "contactTeamName")
    ) {
      issues.push(`Step ${step.sortOrder} needs a team or queue name.`);
    }
  }

  if (
    needsExplicitPublishTerminalStep(enabledSteps.map((step) => step.stepType))
  ) {
    issues.push("Add an enabled confirmation or submit step.");
  }

  if (input.routeIssueCount > 0) {
    issues.push(`${input.routeIssueCount} route issue(s) need attention.`);
  }

  return issues;
}
