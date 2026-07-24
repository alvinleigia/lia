import type { ConversationalTaskDefinitionV1 } from "@/lib/conversation-contracts";

export type ContextVariableDependency = {
  key: string;
  location: string;
  path: string;
};

export type ContextVariableRemovalEvaluation =
  | {
      allowed: false;
      dependencies: ContextVariableDependency[];
      protected: boolean;
      reason: string;
    }
  | {
      allowed: true;
      dependencies: [];
      protected: false;
      reason: null;
    };

const contextReferencePattern = /{{\s*context\.([a-z][a-zA-Z0-9_]*)\s*}}/g;

function collectDependencies(
  dependencies: ContextVariableDependency[],
  text: string | null,
  location: string,
  path: string,
) {
  if (!text) {
    return;
  }

  for (const match of text.matchAll(contextReferencePattern)) {
    const key = match[1];
    if (
      key &&
      !dependencies.some(
        (dependency) => dependency.key === key && dependency.path === path,
      )
    ) {
      dependencies.push({ key, location, path });
    }
  }
}

export function listContextVariableDependencies(
  definition: ConversationalTaskDefinitionV1,
) {
  const dependencies: ContextVariableDependency[] = [];

  collectDependencies(
    dependencies,
    definition.taskPolicy.fallbackMessage,
    "Fallback message",
    "taskPolicy.fallbackMessage",
  );
  collectDependencies(
    dependencies,
    definition.taskPolicy.handoffMessage,
    "Handoff message",
    "taskPolicy.handoffMessage",
  );

  for (const field of definition.fields) {
    collectDependencies(
      dependencies,
      field.requiredWhen,
      `${field.label} required rule`,
      `fields.${field.id}.requiredWhen`,
    );
    collectDependencies(
      dependencies,
      field.validation,
      `${field.label} validation rule`,
      `fields.${field.id}.validation`,
    );
    collectDependencies(
      dependencies,
      field.normalization,
      `${field.label} normalization rule`,
      `fields.${field.id}.normalization`,
    );
  }

  for (const outcome of definition.outcomes) {
    collectDependencies(
      dependencies,
      outcome.condition,
      `${outcome.label} outcome condition`,
      `outcomes.${outcome.id}.condition`,
    );
  }

  return dependencies;
}

export function findContextVariableDependencies(
  definition: ConversationalTaskDefinitionV1,
  key: string,
) {
  return listContextVariableDependencies(definition).filter(
    (dependency) => dependency.key === key,
  );
}

export function isProtectedContextVariable(variable: {
  key: string;
  source: string;
}) {
  return variable.source === "system" || variable.key.startsWith("lia_");
}

export function evaluateContextVariableRemoval(
  definition: ConversationalTaskDefinitionV1,
  key: string,
): ContextVariableRemovalEvaluation {
  const variable = definition.contextVariables.find(
    (candidate) => candidate.key === key,
  );
  if (!variable) {
    return {
      allowed: false,
      dependencies: [] as ContextVariableDependency[],
      protected: false,
      reason: "Context variable not found.",
    };
  }

  const protectedVariable = isProtectedContextVariable(variable);
  if (protectedVariable) {
    return {
      allowed: false,
      dependencies: [] as ContextVariableDependency[],
      protected: true,
      reason: "System context is managed by Lia and cannot be removed.",
    };
  }

  const dependencies = findContextVariableDependencies(definition, key);
  if (dependencies.length > 0) {
    return {
      allowed: false,
      dependencies,
      protected: false,
      reason: `Remove references to ${key} before deleting it.`,
    };
  }

  return {
    allowed: true,
    dependencies: [],
    protected: false,
    reason: null,
  };
}
