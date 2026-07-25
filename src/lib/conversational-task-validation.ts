import { listContextVariableDependencies } from "@/lib/context-variable-dependencies";
import {
  type ConversationalTaskDefinitionV1,
  type ConversationProjectPolicyV1,
  conversationalTaskDefinitionV1Schema,
  conversationProjectPolicyV1Schema,
  TASK_EXECUTION_STAGES,
} from "@/lib/conversation-contracts";

function duplicateValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }
  return [...duplicates];
}

function hasFieldDependencyCycle(definition: ConversationalTaskDefinitionV1) {
  const dependencies = new Map(
    definition.fields.map((field) => [field.key, field.dependsOn]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(key: string): boolean {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;

    visiting.add(key);
    for (const dependency of dependencies.get(key) ?? []) {
      if (dependencies.has(dependency) && visit(dependency)) return true;
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  }

  return definition.fields.some((field) => visit(field.key));
}

export function validateConversationalTaskForPublish(input: {
  definition: ConversationalTaskDefinitionV1;
  projectPolicy: ConversationProjectPolicyV1;
}) {
  const issues: string[] = [];
  if (
    !conversationProjectPolicyV1Schema.safeParse(input.projectPolicy).success
  ) {
    issues.push("Project conversation policy is invalid.");
  }
  if (
    !conversationalTaskDefinitionV1Schema.safeParse(input.definition).success
  ) {
    issues.push("Task definition is invalid.");
  }
  if (input.definition.fields.length === 0) {
    issues.push("Add at least one task field.");
  }
  if (
    !input.definition.outcomes.some((outcome) => outcome.type === "completed")
  ) {
    issues.push("Add a completed outcome.");
  }
  if (
    !input.definition.outcomes.some((outcome) => outcome.type === "cancelled")
  ) {
    issues.push("Add a cancelled outcome.");
  }

  for (const id of duplicateValues(
    input.definition.fields.map(({ id }) => id),
  )) {
    issues.push(`Field ID ${id} is duplicated.`);
  }
  for (const key of duplicateValues(
    input.definition.fields.map(({ key }) => key),
  )) {
    issues.push(`Field key ${key} is duplicated.`);
  }

  const fieldKeys = new Set(input.definition.fields.map((field) => field.key));
  for (const field of input.definition.fields) {
    if (new Set(field.sourcePriority).size !== field.sourcePriority.length) {
      issues.push(`${field.label} contains duplicate source priorities.`);
    }
    if (new Set(field.dependsOn).size !== field.dependsOn.length) {
      issues.push(`${field.label} contains duplicate dependencies.`);
    }
    for (const dependency of field.dependsOn) {
      if (!fieldKeys.has(dependency)) {
        issues.push(`${field.label} depends on missing field ${dependency}.`);
      }
      if (dependency === field.key) {
        issues.push(`${field.label} cannot depend on itself.`);
      }
    }

    if (
      field.optionSource &&
      field.type !== "enum" &&
      field.type !== "project_resource"
    ) {
      issues.push(
        `${field.label} has choices but is not an enum or project resource field.`,
      );
    }
    if (field.optionSource?.kind === "static") {
      for (const value of duplicateValues(
        field.optionSource.options.map((option) => option.value),
      )) {
        issues.push(`${field.label} contains duplicate option ${value}.`);
      }
    }
    if (field.optionSource?.kind === "project_resource") {
      const filterKey = field.optionSource.filterByField;
      if (filterKey && !fieldKeys.has(filterKey)) {
        issues.push(`${field.label} filters by missing field ${filterKey}.`);
      }
      if (filterKey === field.key) {
        issues.push(`${field.label} cannot filter itself.`);
      }
    }
  }
  if (hasFieldDependencyCycle(input.definition)) {
    issues.push("Field dependencies contain a cycle.");
  }

  const transferFieldKeys = input.definition.fieldTransferWhitelist.map(
    ({ fieldKey }) => fieldKey,
  );
  for (const fieldKey of duplicateValues(transferFieldKeys)) {
    issues.push(`Transfer field ${fieldKey} has duplicate rules.`);
  }
  for (const rule of input.definition.fieldTransferWhitelist) {
    if (!fieldKeys.has(rule.fieldKey)) {
      issues.push(`Transfer field ${rule.fieldKey} is not defined.`);
    }
    if (rule.allowedSources.length === 0) {
      issues.push(`Transfer field ${rule.fieldKey} needs an allowed source.`);
    }
    if (new Set(rule.allowedSources).size !== rule.allowedSources.length) {
      issues.push(`Transfer field ${rule.fieldKey} has duplicate sources.`);
    }
  }

  for (const key of duplicateValues(
    input.definition.contextVariables.map(({ key }) => key),
  )) {
    issues.push(`Context key ${key} is duplicated.`);
  }
  const contextKeys = new Set(
    input.definition.contextVariables.map((variable) => variable.key),
  );
  for (const dependency of listContextVariableDependencies(input.definition)) {
    if (!contextKeys.has(dependency.key)) {
      issues.push(
        `${dependency.location} references missing context ${dependency.key}.`,
      );
    }
  }

  for (const id of duplicateValues(
    input.definition.outcomes.map(({ id }) => id),
  )) {
    issues.push(`Outcome ID ${id} is duplicated.`);
  }
  for (const key of duplicateValues(
    input.definition.outcomes.map(({ key }) => key),
  )) {
    issues.push(`Outcome key ${key} is duplicated.`);
  }
  for (const port of duplicateValues(
    input.definition.outcomes.map(({ outputPort }) => outputPort),
  )) {
    issues.push(`Outcome port ${port} is duplicated.`);
  }

  for (const toolId of duplicateValues(
    input.definition.tools.map(({ tool }) => tool.id),
  )) {
    issues.push(`Tool ${toolId} is bound more than once.`);
  }
  for (const binding of input.definition.tools) {
    if (binding.allowedStages.length === 0) {
      issues.push(`Tool ${binding.tool.id} has no allowed stage.`);
    }
    if (new Set(binding.allowedStages).size !== binding.allowedStages.length) {
      issues.push(`Tool ${binding.tool.id} has duplicate allowed stages.`);
    }
  }

  if (
    input.definition.executionOrder.length !== TASK_EXECUTION_STAGES.length ||
    input.definition.executionOrder.some(
      (stage, index) => stage !== TASK_EXECUTION_STAGES[index],
    )
  ) {
    issues.push(
      "Execution order must contain each lifecycle stage once in the required order.",
    );
  }

  return { issues, ready: issues.length === 0 };
}
