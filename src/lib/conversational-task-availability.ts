import type {
  ConversationalTaskSnapshotV1,
  ToolDefinitionV1,
} from "@/lib/conversation-contracts";

export function getBoundAvailabilityDefinition(
  snapshot: ConversationalTaskSnapshotV1,
) {
  for (const binding of snapshot.task.definition.tools) {
    if (
      binding.access !== "read" ||
      !binding.allowedStages.includes("lookup")
    ) {
      continue;
    }
    const definition = snapshot.toolDefinitions.find(
      (candidate) =>
        candidate.id === binding.tool.id &&
        candidate.version === binding.tool.version &&
        candidate.execution.adapter === "built_in" &&
        candidate.execution.handler === "catalog.service_availability" &&
        candidate.execution.mode === "synchronous",
    );
    if (definition) {
      return definition;
    }
  }
  return null;
}

export function readCanonicalAvailability(input: {
  context: Array<{ expiresAt: Date | null; key: string; value: unknown }>;
  definition: ToolDefinitionV1;
  fields: Array<{ canonicalValue: unknown; fieldKey: string }>;
  now?: Date;
}) {
  const mapping = input.definition.resultMappings.find(
    ({ sourcePath }) => sourcePath === "available",
  );
  if (!mapping) return null;

  const now = input.now ?? new Date();
  const value =
    mapping.target === "context"
      ? input.context.find(
          (candidate) =>
            candidate.key === mapping.targetKey &&
            (!candidate.expiresAt || candidate.expiresAt > now),
        )?.value
      : input.fields.find(
          (candidate) => candidate.fieldKey === mapping.targetKey,
        )?.canonicalValue;
  return typeof value === "boolean" ? value : null;
}
