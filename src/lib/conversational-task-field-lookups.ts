import { isDeepStrictEqual } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import {
  appointmentChoiceOptions,
  isAppointmentLookup,
  resolveAppointmentChoice,
  upcomingAppointmentMatches,
} from "@/lib/appointment-lookup";
import type { ConversationalTaskSnapshotV1 } from "@/lib/conversation-contracts";
import { executeTaskReadOperation } from "@/lib/conversational-task-calendar-availability";
import { getConversationalTaskRuntime } from "@/lib/conversational-task-runtime";
import { buildCanonicalToolInput } from "@/lib/conversational-task-tool-runtime";
import { db } from "@/lib/db-config";
import { operationAttempts } from "@/lib/db-schema";
import { getProjectOperation } from "@/lib/operations";
import type { RuntimeInputRequest } from "@/lib/runtime-input-request";
import { getTaskOperationOutcome } from "@/lib/task-operation-outcome";

type LookupInput = {
  excludeToolId?: string;
  projectId: number;
  snapshot: ConversationalTaskSnapshotV1;
  taskRunId: number;
  runtime?: Awaited<ReturnType<typeof getConversationalTaskRuntime>>;
};
type LookupResult =
  | { status: "not_needed" | "success" }
  | { status: "blocked"; reply: string }
  | { status: "choice"; reply: string; inputRequest: RuntimeInputRequest };

async function lookupContext(input: LookupInput) {
  const runtime = input.runtime ?? (await getConversationalTaskRuntime(input));
  if (!runtime || runtime.run.status !== "active") return null;
  const fields = new Map(
    runtime.fields.map((field) => [field.fieldKey, field]),
  );
  const next = input.snapshot.task.definition.fields.find((field) => {
    const value = fields.get(field.key);
    return (
      field.required && value?.state !== "valid" && value?.state !== "confirmed"
    );
  });
  if (!next) return null;
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
  if (!lookups.length) return null;
  const definition = lookups[0];
  const canonical = buildCanonicalToolInput({
    context: new Map(runtime.context.map((value) => [value.key, value])),
    definition,
    fields,
    now: new Date(),
    proposedInput: {},
  });
  return {
    canonical,
    definition,
    next,
    valid: lookups.length === 1 && next.sourcePriority.includes("tool"),
  };
}

// The durable offer is scoped to this run, provider operation, and current identity.
// A browser/voice answer is never used as an unchecked provider reference.
export async function readPendingTaskAppointmentChoice(
  input: LookupInput,
  existingContext?: Awaited<ReturnType<typeof lookupContext>>,
) {
  const context = existingContext ?? (await lookupContext(input));
  if (
    !context?.valid ||
    !context.canonical.ok ||
    !context.definition.resultMappings.some(
      (mapping) =>
        mapping.target === "field" &&
        mapping.targetKey === context.next.key &&
        mapping.sourcePath === "appointments.0.appointmentRef",
    )
  )
    return null;
  const row = await getProjectOperation(
    input.projectId,
    Number(context.definition.execution.handler),
  );
  if (!row || !isAppointmentLookup(row.operation.operationType)) return null;
  const [attempt] = await db
    .select()
    .from(operationAttempts)
    .where(
      and(
        eq(operationAttempts.projectId, input.projectId),
        eq(operationAttempts.taskRunId, input.taskRunId),
        eq(operationAttempts.operationId, row.operation.id),
      ),
    )
    .orderBy(desc(operationAttempts.id))
    .limit(1);
  if (
    !attempt ||
    !attempt.finishedAt ||
    getTaskOperationOutcome(attempt, row.operation) !== "success" ||
    !isDeepStrictEqual(attempt.requestPayload.payload, context.canonical.input)
  )
    return null;
  // Preserve the originally offered order even if a booking has since started.
  // Selection is checked against a fresh provider result before it can be mapped.
  const appointments = upcomingAppointmentMatches(
    attempt.responsePayload,
    attempt.finishedAt,
  );
  if (!appointments?.length) return null;
  const options = appointmentChoiceOptions(appointments);
  const inputRequest: RuntimeInputRequest = {
    fieldKey: context.next.key,
    label: "Appointment to change",
    required: true,
    inputKind: "choice",
    options,
  };
  const ambiguous =
    new Set(appointments.map((item) => item.spoken)).size !==
    appointments.length;
  const reply = `Which upcoming appointment would you like to change?\n${options.map((option) => option.label).join("\n")}\nChoose a number or appointment.${ambiguous ? " If these are hard to distinguish, you can provide the booking reference or ask the team for help." : ""}`;
  return {
    appointments,
    fresh: Date.now() - attempt.finishedAt.getTime() <= 5 * 60_000,
    inputRequest,
    reply,
    status: "choice" as const,
  };
}

export async function executeRequiredTaskFieldLookup(
  input: LookupInput & {
    requestId: string;
    selection?: { fieldKey: string; answer: string };
  },
): Promise<LookupResult> {
  const context = await lookupContext(input);
  if (!context) return { status: "not_needed" };
  if (!context.valid)
    return {
      status: "blocked",
      reply:
        "The team needs to review the lookup configuration before I can continue.",
    };
  if (!context.canonical.ok)
    return {
      status: "blocked",
      reply:
        "I cannot verify the lookup with the current details. Please check your details or ask the team for help.",
    };
  const pending = await readPendingTaskAppointmentChoice(input, context);
  const selectedAppointment =
    input.selection &&
    pending &&
    input.selection.fieldKey === pending.inputRequest.fieldKey
      ? resolveAppointmentChoice(pending.appointments, input.selection.answer)
      : null;
  if (pending && !selectedAppointment && (pending.fresh || input.selection))
    return {
      status: "choice",
      inputRequest: pending.inputRequest,
      reply: input.selection
        ? `I could not match that to one appointment. ${pending.reply}`
        : pending.reply,
    };
  const result = await executeTaskReadOperation({
    ...input,
    definition: context.definition,
    selectedAppointment: selectedAppointment ?? undefined,
  });
  if (result.taskOutcome !== "success") {
    if (
      ["multiple_appointments", "appointment_selection_changed"].includes(
        result.taskReason ?? "",
      )
    ) {
      const choice = await readPendingTaskAppointmentChoice(input);
      if (choice)
        return {
          status: "choice",
          inputRequest: choice.inputRequest,
          reply:
            result.taskReason === "appointment_selection_changed"
              ? `The appointments have changed. ${choice.reply}`
              : choice.reply,
        };
    }
    const message =
      result.taskOutcome === "no_result"
        ? "I could not find a matching appointment. Please check your details or ask the team for help."
        : "I could not verify the lookup. Please try again or ask the team for help.";
    return {
      status: "blocked",
      reply: `${message} Lia attempt #${result.attempt.id}.`,
    };
  }
  const refreshed = await getConversationalTaskRuntime(input);
  const value = refreshed?.fields.find(
    ({ fieldKey }) => fieldKey === context.next.key,
  );
  if (value?.state !== "valid" && value?.state !== "confirmed")
    return {
      status: "blocked",
      reply: `The lookup did not supply the required verified details. The team needs to review Lia attempt #${result.attempt.id}.`,
    };
  return { status: "success" };
}
