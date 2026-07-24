import { listContextVariableDependencies } from "@/lib/context-variable-dependencies";
import {
  type ConversationalTaskDefinitionV1,
  type ConversationProjectPolicyV1,
  conversationalTaskDefinitionV1Schema,
  conversationProjectPolicyV1Schema,
} from "@/lib/conversation-contracts";

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

  const fieldKeys = new Set(input.definition.fields.map((field) => field.key));
  for (const field of input.definition.fields) {
    for (const dependency of field.dependsOn) {
      if (!fieldKeys.has(dependency)) {
        issues.push(`${field.label} depends on missing field ${dependency}.`);
      }
    }
  }
  for (const rule of input.definition.fieldTransferWhitelist) {
    if (!fieldKeys.has(rule.fieldKey)) {
      issues.push(`Transfer field ${rule.fieldKey} is not defined.`);
    }
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

  return { issues, ready: issues.length === 0 };
}
