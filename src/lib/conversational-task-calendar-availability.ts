import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
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
import { getGoogleCalendarHostedVoiceResult } from "@/lib/google-calendar";
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
      row?.provider.providerType !== "google_calendar" ||
      row.operation.operationType !== "google_calendar.availability"
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
        !["google_calendar.book", "google_calendar.reschedule"].includes(
          operation.operation.operationType,
        )
      )
        continue;
      const startKey =
        operation.operation.operationType === "google_calendar.reschedule"
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
        };
      }
    }
  }
  return null;
}

export function verifiedCalendarSlots(input: {
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
  const result = getGoogleCalendarHostedVoiceResult(attempt.responsePayload);
  if (result.date !== input.date || !Array.isArray(result.slots)) return [];
  return result.slots.map((slot: { spoken: string; start: string }) => ({
    label: slot.spoken,
    value: slot.start,
  }));
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
  const status = getTaskOperationOutcome(details.attempt, details.operation);
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
      errorCode:
        status === "success"
          ? null
          : (getTaskOperationReason(details.attempt) ?? status),
      result:
        status === "success" ? getOperationAttemptToolResult(details) : null,
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
  return details;
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
    !["google_calendar.book", "google_calendar.reschedule"].includes(
      operation.operation.operationType,
    )
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
  let availability = await readTaskCalendarAvailability({ ...input, binding });
  // An expired offer can only proceed when a fresh lookup below verifies it again.
  const offeredOptions = input.refresh
    ? verifiedCalendarSlots({
        attempt: availability.attempt,
        date: availability.date,
        now: availability.attempt?.finishedAt ?? undefined,
      })
    : availability.options;
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
    if (!availability.options.some(({ value }) => value === selected))
      throw new CalendarSlotValidationError(
        `The selected time is no longer available or could not be verified. Choose another time. Lia attempt #${availability.attempt?.id}.`,
      );
  }
}
