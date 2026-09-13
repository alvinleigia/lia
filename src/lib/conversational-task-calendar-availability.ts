import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  type AppointmentMatch,
  appointmentSlotOptions,
  completeAppointmentSlotOptions,
  isAppointmentLookup,
  upcomingAppointmentMatches,
} from "@/lib/appointment-lookup";
import type {
  ConversationalTaskSnapshotV1,
  ToolDefinitionV1,
} from "@/lib/conversation-contracts";
import {
  applyConversationalTaskEvent,
  getConversationalTaskRuntime,
} from "@/lib/conversational-task-runtime";
import { buildCanonicalToolInput } from "@/lib/conversational-task-tool-runtime";
import { db } from "@/lib/db-config";
import { channelConversations, operationAttempts } from "@/lib/db-schema";
import {
  getOperationAttemptToolResult,
  getProjectOperation,
  getProjectOperationAttemptWithDetails,
  processProjectDurableOperationQueue,
  queueOperationForConversationalTask,
} from "@/lib/operations";
import {
  getTaskOperationOutcome,
  getTaskOperationReason,
} from "@/lib/task-operation-outcome";

export class CalendarSlotValidationError extends Error {}

export type CalendarAvailabilityBinding = {
  definition: ToolDefinitionV1;
  dateFieldKey: string;
  startFieldKey: string;
  timezone?: string;
};

export async function getTaskCalendarAvailability(
  snapshot: ConversationalTaskSnapshotV1,
): Promise<CalendarAvailabilityBinding | null> {
  for (const definition of snapshot.toolDefinitions) {
    const binding = snapshot.task.definition.tools.find(
      ({ tool }) =>
        tool.id === definition.id && tool.version === definition.version,
    );
    if (
      definition.access !== "read" ||
      definition.execution.adapter !== "operation" ||
      !binding?.allowedStages.includes("lookup")
    )
      continue;
    const row = await getProjectOperation(
      definition.projectId,
      Number(definition.execution.handler),
    );
    if (
      !row ||
      !["google_calendar.availability", "appointment.availability"].includes(
        row.operation.operationType,
      )
    )
      continue;
    const date = definition.inputSchema.fields.find(
      ({ key }) => key === "date",
    );
    for (const write of snapshot.toolDefinitions) {
      if (write.access !== "write" || write.execution.adapter !== "operation")
        continue;
      const operation = await getProjectOperation(
        write.projectId,
        Number(write.execution.handler),
      );
      if (
        operation?.provider.id !== row.provider.id ||
        ![
          "google_calendar.book",
          "google_calendar.reschedule",
          "appointment.book",
          "appointment.reschedule",
        ].includes(operation.operation.operationType)
      )
        continue;
      const startKey = [
        "google_calendar.reschedule",
        "appointment.reschedule",
      ].includes(operation.operation.operationType)
        ? "newStart"
        : "start";
      const start = write.inputSchema.fields.find(
        ({ key }) => key === startKey,
      );
      if (date?.source.kind === "field" && start?.source.kind === "field") {
        return {
          definition,
          dateFieldKey: date.source.key,
          startFieldKey: start.source.key,
          timezone:
            typeof row.provider.config.timezone === "string"
              ? row.provider.config.timezone
              : undefined,
        };
      }
    }
  }
  return null;
}

export function verifiedCalendarSlots(input: {
  includeAll?: boolean;
  attempt: {
    status: string;
    responsePayload: Record<string, unknown>;
    requestPayload: Record<string, unknown>;
    finishedAt: Date | null;
  } | null;
  date: unknown;
  now?: Date;
}): Array<{ label: string; value: string }> {
  const attempt = input.attempt;
  const now = input.now ?? new Date();
  const payload = attempt?.requestPayload.payload as
    | Record<string, unknown>
    | undefined;
  if (
    !attempt ||
    getTaskOperationOutcome(attempt, {
      operationType: "google_calendar.availability",
    }) !== "success" ||
    !attempt.finishedAt ||
    now.getTime() - attempt.finishedAt.getTime() > 5 * 60_000 ||
    payload?.date !== input.date
  )
    return [];
  if (attempt.responsePayload.date !== input.date) return [];
  return (
    (input.includeAll
      ? completeAppointmentSlotOptions(attempt.responsePayload)
      : null) ?? appointmentSlotOptions(attempt.responsePayload)
  );
}

export async function readTaskCalendarAvailability(input: {
  binding: CalendarAvailabilityBinding;
  projectId: number;
  taskRunId: number;
}) {
  const runtime = await getConversationalTaskRuntime(input);
  const date = runtime?.fields.find(
    ({ fieldKey, state }) =>
      fieldKey === input.binding.dateFieldKey &&
      (state === "valid" || state === "confirmed"),
  )?.canonicalValue;
  const [attempt] = await db
    .select()
    .from(operationAttempts)
    .where(
      and(
        eq(operationAttempts.projectId, input.projectId),
        eq(operationAttempts.taskRunId, input.taskRunId),
        eq(
          operationAttempts.operationId,
          Number(input.binding.definition.execution.handler),
        ),
      ),
    )
    .orderBy(desc(operationAttempts.id))
    .limit(1);
  return {
    attempt: attempt ?? null,
    date,
    options: verifiedCalendarSlots({ attempt: attempt ?? null, date }),
    allOptions: verifiedCalendarSlots({
      attempt: attempt ?? null,
      date,
      includeAll: true,
    }),
    complete: completeAppointmentSlotOptions(attempt?.responsePayload) !== null,
  };
}

// Refresh an expired successful lookup without clearing the caller's collected fields.
export async function refreshExpiredTaskCalendarAvailability(input: {
  binding: CalendarAvailabilityBinding;
  projectId: number;
  snapshot: ConversationalTaskSnapshotV1;
  taskRunId: number;
}) {
  const availability = await readTaskCalendarAvailability(input);
  const attempt = availability.attempt;
  if (
    !attempt?.finishedAt ||
    Date.now() - attempt.finishedAt.getTime() <= 5 * 60_000 ||
    !verifiedCalendarSlots({
      attempt,
      date: availability.date,
      now: attempt.finishedAt,
    }).length
  )
    return availability;
  await executeTaskReadOperation({
    ...input,
    definition: input.binding.definition,
  });
  return readTaskCalendarAvailability(input);
}

// Both availability and identity lookups use the same durable operation ledger as writes.
export async function executeTaskReadOperation(input: {
  definition: ToolDefinitionV1;
  projectId: number;
  requestId?: string;
  selectedAppointment?: AppointmentMatch;
  snapshot: ConversationalTaskSnapshotV1;
  taskRunId: number;
}) {
  const definition = input.snapshot.toolDefinitions.find(
    (candidate) =>
      candidate.id === input.definition.id &&
      candidate.version === input.definition.version,
  );
  const binding = input.snapshot.task.definition.tools.find(
    ({ tool }) =>
      tool.id === definition?.id && tool.version === definition.version,
  );
  if (
    !definition ||
    definition.projectId !== input.projectId ||
    definition.access !== "read" ||
    definition.execution.adapter !== "operation" ||
    binding?.access !== "read" ||
    !binding.allowedStages.includes("lookup")
  )
    throw new Error("The published lookup is not allowed.");
  const runtime = await getConversationalTaskRuntime(input);
  if (!runtime || runtime.run.status !== "active")
    throw new Error("The lookup task is not active.");
  const canonical = buildCanonicalToolInput({
    context: new Map(
      runtime.context.map((item) => [
        item.key,
        { expiresAt: item.expiresAt, value: item.value },
      ]),
    ),
    definition,
    fields: new Map(
      runtime.fields.map((field) => [
        field.fieldKey,
        { canonicalValue: field.canonicalValue, state: field.state },
      ]),
    ),
    now: new Date(),
    proposedInput: {},
  });
  if (!canonical.ok) throw new Error(canonical.error.message);
  const [conversation] = await db
    .select()
    .from(channelConversations)
    .where(
      and(
        eq(channelConversations.projectId, input.projectId),
        eq(channelConversations.id, runtime.run.conversationId),
      ),
    )
    .limit(1);
  if (!conversation) throw new Error("The lookup conversation was not found.");
  const requestId = input.requestId ?? `calendar-refresh:${randomUUID()}`;
  const now = new Date().toISOString();
  const envelope = {
    authentication: {
      kind: "session" as const,
      principal: "lia-operation-runtime",
      keyId: null,
      verifiedAt: now,
    },
    channelIdentity: conversation.metadata,
    channelType: conversation.channelType,
    conversationId: conversation.id,
    expectedRevision: null,
    occurredAt: now,
    receivedAt: now,
    projectId: input.projectId,
    providerSequence: null,
    schemaVersion: 1 as const,
    taskRunId: input.taskRunId,
  };
  const requested = await applyConversationalTaskEvent({
    ...envelope,
    eventId: `${requestId}:requested`,
    idempotencyKey: requestId,
    input: canonical.input,
    requestId,
    requestMode: "asynchronous",
    stage: "lookup",
    timeoutAt: null,
    toolId: definition.id,
    type: "tool.requested",
  });
  if (
    requested.disposition !== "applied" &&
    requested.reason !== "duplicate_event"
  )
    throw new Error(requested.reason ?? "The lookup could not be reserved.");
  const refreshed = await getConversationalTaskRuntime(input);
  const request = refreshed?.tools.find((tool) => tool.requestId === requestId);
  if (!request) throw new Error("The lookup request was not found.");
  const queued = await queueOperationForConversationalTask({
    confirmationId: null,
    idempotencyKey: requestId,
    operationId: Number(definition.execution.handler),
    payload: canonical.input,
    projectId: input.projectId,
    taskRunId: input.taskRunId,
    taskToolRequestId: request.id,
    taskVersionId: runtime.run.taskVersionId,
  });
  if (!queued) throw new Error("The lookup provider is unavailable.");
  await processProjectDurableOperationQueue({
    maxJobs: 25,
    projectId: input.projectId,
    workerId: `task-lookup-${request.id}`,
  });
  const details = await getProjectOperationAttemptWithDetails(
    input.projectId,
    queued.attempt.id,
  );
  if (!details) throw new Error("The lookup attempt was not found.");
  let status = getTaskOperationOutcome(details.attempt, details.operation);
  let reason = getTaskOperationReason(details.attempt);
  let mappedDetails = details;
  if (
    status === "success" &&
    isAppointmentLookup(details.operation.operationType)
  ) {
    const appointments = upcomingAppointmentMatches(
      details.attempt.responsePayload,
    );
    const selected = input.selectedAppointment
      ? appointments?.find(
          (item) =>
            item.appointmentRef === input.selectedAppointment?.appointmentRef &&
            item.start === input.selectedAppointment.start &&
            item.end === input.selectedAppointment.end,
        )
      : appointments?.length === 1
        ? appointments[0]
        : null;
    if (!appointments) {
      status = "provider_failure";
      reason = "invalid_appointment_result";
    } else if (!selected) {
      status = appointments.length ? "rejected" : "no_result";
      reason = input.selectedAppointment
        ? "appointment_selection_changed"
        : appointments.length
          ? "multiple_appointments"
          : "appointment_not_found";
    } else {
      // Keep the complete provider response in the ledger. Only the verified choice
      // is passed to scalar mappings (including existing published index-zero mappings).
      mappedDetails = {
        ...details,
        attempt: {
          ...details.attempt,
          responsePayload: {
            ...details.attempt.responsePayload,
            appointments: [selected],
          },
        },
      };
    }
  }
  if (
    status !== "pending" &&
    ["pending", "outcome_unknown"].includes(request.status)
  ) {
    const completedAt = new Date().toISOString();
    const applied = await applyConversationalTaskEvent({
      ...envelope,
      occurredAt: completedAt,
      receivedAt: completedAt,
      eventId: `${requestId}:result:${status}`,
      requestId,
      status,
      errorCode: status === "success" ? null : (reason ?? status),
      result:
        status === "success"
          ? getOperationAttemptToolResult(mappedDetails)
          : null,
      type: "tool.result",
    });
    if (
      applied.disposition !== "applied" &&
      applied.reason !== "duplicate_event"
    )
      throw new Error(
        applied.reason ?? "The lookup result could not be applied.",
      );
  }
  return { ...details, taskOutcome: status, taskReason: reason };
}

export async function assertTaskCalendarSlot(input: {
  definition: ToolDefinitionV1;
  projectId: number;
  snapshot: ConversationalTaskSnapshotV1;
  taskRunId: number;
  refresh: boolean;
}) {
  const operation = await getProjectOperation(
    input.projectId,
    Number(input.definition.execution.handler),
  );
  if (
    !operation ||
    ![
      "google_calendar.book",
      "google_calendar.reschedule",
      "appointment.book",
      "appointment.reschedule",
    ].includes(operation.operation.operationType)
  )
    return;
  const binding = await getTaskCalendarAvailability(input.snapshot);
  if (!binding)
    throw new Error(
      "Bind a Calendar availability lookup before placing appointments.",
    );
  const runtime = await getConversationalTaskRuntime(input);
  const selected = runtime?.fields.find(
    ({ fieldKey }) => fieldKey === binding.startFieldKey,
  )?.canonicalValue;
  let availability = input.refresh
    ? await readTaskCalendarAvailability({ ...input, binding })
    : await refreshExpiredTaskCalendarAvailability({ ...input, binding });
  // An expired offer can only proceed when a fresh lookup below verifies it again.
  const offeredOptions = input.refresh
    ? verifiedCalendarSlots({
        includeAll: true,
        attempt: availability.attempt,
        date: availability.date,
        now: availability.attempt?.finishedAt ?? undefined,
      })
    : availability.allOptions;
  if (!offeredOptions.some(({ value }) => value === selected))
    throw new CalendarSlotValidationError(
      "Choose a provider-verified available appointment time before confirmation.",
    );
  if (input.refresh) {
    await executeTaskReadOperation({
      ...input,
      definition: binding.definition,
    });
    availability = await readTaskCalendarAvailability({ ...input, binding });
    if (!availability.allOptions.some(({ value }) => value === selected))
      throw new CalendarSlotValidationError(
        `The selected time is no longer available or could not be verified. Choose another time. Lia attempt #${availability.attempt?.id}.`,
      );
  }
}

export const CALENDAR_TIME_CHOICE_HINT =
  'Choose a time above, or tell me another preferred time, such as "3:30 pm" or "after 2 pm".';

type SlotOption = { label: string; value: string };
type TimePreference = {
  kind: "exact" | "window";
  minute: number;
  endMinute: number;
  timezone: string;
};

export function parseCalendarTimePreference(
  text: string,
  timezone: string,
): TimePreference | null {
  // Do not interpret a negated time, competing times, or an unclear timezone as a selection.
  if (/\b(?:not|instead of|except|between)\b/i.test(text)) return null;
  const clocks = [
    ...text.matchAll(
      /\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b|\b([01]\d|2[0-3]):([0-5]\d)\b/gi,
    ),
  ];
  const minutes = new Set<number>();
  for (const match of clocks) {
    if (match[3]) {
      const hour = Number(match[1]);
      if (hour < 1 || hour > 12) return null;
      minutes.add(
        ((hour % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0)) * 60 +
          Number(match[2] ?? 0),
      );
    } else minutes.add(Number(match[4]) * 60 + Number(match[5]));
  }
  if (minutes.size > 1) return null;
  const zones = [
    ...new Set(
      text.match(/\b[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/g) ?? [],
    ),
  ];
  if (
    /\b(?:UTC|GMT)\s*[+-]|\b(?:IST|EST|EDT|CST|CDT|MST|MDT|PST|PDT|AEST|AEDT|BST|CET|CEST)\b/i.test(
      text,
    )
  )
    return null;
  if (/\b(?:UTC|GMT)\b/i.test(text)) zones.push("UTC");
  if (new Set(zones).size > 1) return null;
  timezone = zones[0] ?? timezone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    return null;
  }
  const minute = [...minutes][0];
  if (minute !== undefined) {
    const clock = clocks[0];
    const beforeClock = text.slice(0, clock.index).trim();
    const afterClock = text.slice((clock.index ?? 0) + clock[0].length).trim();
    if (
      /\b(?:after|from|later than)$/i.test(beforeClock) ||
      /^(?:onwards|or later)\b/i.test(afterClock)
    )
      return { kind: "window", minute, endMinute: 1440, timezone };
    if (/\b(?:before|earlier than)$/i.test(beforeClock))
      return { kind: "window", minute: 0, endMinute: minute, timezone };
    return { kind: "exact", minute, endMinute: minute, timezone };
  }
  const periods = [...text.matchAll(/\b(morning|afternoon|evening)\b/gi)];
  if (periods.length !== 1) return null;
  const period = periods[0][1].toLowerCase();
  const [from, to] =
    period === "morning"
      ? [0, 720]
      : period === "afternoon"
        ? [720, 1020]
        : [1020, 1440];
  return { kind: "window", minute: from, endMinute: to, timezone };
}

// Match and rank only provider-returned slots. This helper never fabricates an
// instant from a requested clock time; date and timezone remain explicit.
export function suggestCalendarSlots(input: {
  text: string;
  date: string;
  timezone: string;
  options: SlotOption[];
}) {
  const preference = parseCalendarTimePreference(input.text, input.timezone);
  if (!preference) return null;
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: preference.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const candidates = input.options.flatMap((option) => {
    if (!Number.isFinite(Date.parse(option.value))) return [];
    const parts = Object.fromEntries(
      format
        .formatToParts(new Date(option.value))
        .map((part) => [part.type, part.value]),
    );
    if (`${parts.year}-${parts.month}-${parts.day}` !== input.date) return [];
    return [{ option, minute: Number(parts.hour) * 60 + Number(parts.minute) }];
  });
  const matches = candidates.filter(({ minute }) =>
    preference.kind === "exact"
      ? minute === preference.minute
      : minute >= preference.minute && minute < preference.endMinute,
  );
  const distance = (minute: number) =>
    preference.kind === "exact"
      ? Math.abs(minute - preference.minute)
      : Math.max(preference.minute - minute, minute - preference.endMinute, 0);
  const nearest = [...candidates].sort(
    (a, b) => distance(a.minute) - distance(b.minute) || a.minute - b.minute,
  );
  return {
    kind: preference.kind,
    matches: matches.map(({ option }) => option),
    options: (matches.length && preference.kind === "window"
      ? matches
      : nearest
    )
      .slice(0, 6)
      .map(({ option }) => option),
  };
}

// A time stated in a multi-field message is a preference until the provider
// verifies that exact local date/time. A broad window always asks for a choice.
export function findRequestedCalendarSlots(
  input: Parameters<typeof suggestCalendarSlots>[0],
) {
  const suggestions = suggestCalendarSlots(input);
  return suggestions?.kind === "exact" ? suggestions.matches : null;
}

// Preserve the single-slot selection contract; zero matches means not offered,
// while null or multiple matches need clarification rather than an availability claim.
export function matchRequestedCalendarSlot(
  input: Parameters<typeof findRequestedCalendarSlots>[0],
) {
  const options = findRequestedCalendarSlots(input);
  return options?.length === 1 ? options[0] : null;
}
