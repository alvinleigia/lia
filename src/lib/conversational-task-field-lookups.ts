import type { ConversationalTaskSnapshotV1 } from "@/lib/conversation-contracts";
import { executeTaskReadOperation } from "@/lib/conversational-task-calendar-availability";
import { getConversationalTaskRuntime } from "@/lib/conversational-task-runtime";
import { buildCanonicalToolInput } from "@/lib/conversational-task-tool-runtime";

export async function executeRequiredTaskFieldLookup(input: {
  excludeToolId?: string;
  projectId: number;
  requestId: string;
  snapshot: ConversationalTaskSnapshotV1;
  taskRunId: number;
}): Promise<
  { status: "not_needed" | "success" } | { status: "blocked"; reply: string }
> {
  const runtime = await getConversationalTaskRuntime(input);
  if (!runtime || runtime.run.status !== "active")
    return { status: "not_needed" };
  const fields = new Map(
    runtime.fields.map((field) => [field.fieldKey, field]),
  );
  const next = input.snapshot.task.definition.fields.find((field) => {
    const value = fields.get(field.key);
    return (
      field.required && value?.state !== "valid" && value?.state !== "confirmed"
    );
  });
  if (!next) return { status: "not_needed" };
  const lookups = input.snapshot.toolDefinitions.filter((definition) => {
    const binding = input.snapshot.task.definition.tools.find(
      ({ tool }) =>
        tool.id === definition.id && tool.version === definition.version,
    );
    return (
      definition.id !== input.excludeToolId &&
      definition.projectId === input.projectId &&
      definition.access === "read" &&
      definition.execution.adapter === "operation" &&
      binding?.access === "read" &&
      binding.allowedStages.includes("lookup") &&
      definition.resultMappings.some(
        (mapping) =>
          mapping.target === "field" && mapping.targetKey === next.key,
      )
    );
  });
  if (!lookups.length) return { status: "not_needed" };
  if (lookups.length !== 1 || !next.sourcePriority.includes("tool"))
    return {
      status: "blocked",
      reply:
        "The team needs to review the lookup configuration before I can continue.",
    };
  const definition = lookups[0];
  const canonical = buildCanonicalToolInput({
    context: new Map(runtime.context.map((value) => [value.key, value])),
    definition,
    fields,
    now: new Date(),
    proposedInput: {},
  });
  if (!canonical.ok)
    return {
      status: "blocked",
      reply:
        "I cannot verify the lookup with the current details. Please check your details or ask the team for help.",
    };
  const result = await executeTaskReadOperation({ ...input, definition });
  if (result.taskOutcome !== "success") {
    const message =
      result.taskReason === "multiple_appointments"
        ? "More than one appointment matches your details. The team needs to help select the correct appointment before I can change it."
        : result.taskOutcome === "no_result"
          ? "I could not find a matching appointment. Please check your details or ask the team for help."
          : "I could not verify the lookup. Please try again or ask the team for help.";
    return {
      status: "blocked",
      reply: `${message} Lia attempt #${result.attempt.id}.`,
    };
  }
  const refreshed = await getConversationalTaskRuntime(input);
  const value = refreshed?.fields.find(({ fieldKey }) => fieldKey === next.key);
  if (value?.state !== "valid" && value?.state !== "confirmed")
    return {
      status: "blocked",
      reply: `The lookup did not supply the required verified details. The team needs to review Lia attempt #${result.attempt.id}.`,
    };
  return { status: "success" };
}
