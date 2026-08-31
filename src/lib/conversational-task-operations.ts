import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type ConversationalTaskSnapshotV1,
  conversationalTaskSnapshotV1Schema,
  type ToolDefinitionV1,
} from "@/lib/conversation-contracts";
import {
  getBoundAvailabilityDefinition,
  readCanonicalAvailability,
} from "@/lib/conversational-task-availability";
import {
  applyConversationalTaskEvent,
  getConversationalTaskRuntime,
} from "@/lib/conversational-task-runtime";
import { buildCanonicalToolInput } from "@/lib/conversational-task-tool-runtime";
import { db } from "@/lib/db-config";
import {
  channelConversations,
  conversationalTaskAuditEvents,
  conversationalTaskConfirmations,
  conversationalTaskFieldValues,
  conversationalTaskRuns,
  conversationalTaskToolRequests,
  conversationalTaskVersions,
  operationAttempts,
  type SelectConversationalTaskConfirmation,
} from "@/lib/db-schema";
import {
  getOperationAttemptToolResult,
  getProjectOperationAttemptWithDetails,
  processProjectDurableOperationQueue,
  queueOperationForConversationalTask,
  reconcileOperationAttemptOutcome,
} from "@/lib/operations";

const CONFIRMATION_TTL_MINUTES = 15;
const ACTIVE_CONFIRMATION_STATUSES = [
  "pending",
  "confirmed",
  "executing",
  "outcome_unknown",
] as const;

export type TaskOperationPrincipal = {
  kind: "api_key" | "hmac" | "session" | "user";
  principal: string;
};

type ConfirmationSummaryItem = {
  key: string;
  label: string;
  source: "field" | "tool";
  value: unknown;
};

type ConfirmationSummary = {
  items: ConfirmationSummaryItem[];
  operationName: string;
  toolId: string;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function humanizeKey(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function authentication(principal: TaskOperationPrincipal, now: Date) {
  return {
    keyId: null,
    kind: principal.kind,
    principal: principal.principal,
    verifiedAt: now.toISOString(),
  } as const;
}

function operationIdFromDefinition(definition: ToolDefinitionV1) {
  const operationId = Number(definition.execution.handler);
  if (!Number.isInteger(operationId) || operationId <= 0) {
    throw new Error("The published operation definition is invalid.");
  }
  return operationId;
}

async function loadTaskOperationContext(input: {
  projectId: number;
  taskRunId: number;
  toolId?: string;
}) {
  const runtime = await getConversationalTaskRuntime({
    projectId: input.projectId,
    taskRunId: input.taskRunId,
  });
  if (!runtime || !runtime.execution) {
    throw new Error("The active task runtime was not found.");
  }
  if (
    runtime.run.status !== "active" ||
    runtime.execution.activeTaskRunId !== runtime.run.id ||
    runtime.execution.activeTaskVersionId !== runtime.run.taskVersionId
  ) {
    throw new Error("The task must be active before taking an action.");
  }

  const [[version], [conversation]] = await Promise.all([
    db
      .select()
      .from(conversationalTaskVersions)
      .where(
        and(
          eq(conversationalTaskVersions.projectId, input.projectId),
          eq(conversationalTaskVersions.id, runtime.run.taskVersionId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(channelConversations)
      .where(
        and(
          eq(channelConversations.projectId, input.projectId),
          eq(channelConversations.id, runtime.run.conversationId),
        ),
      )
      .limit(1),
  ]);
  if (!version || !conversation) {
    throw new Error("The pinned task version or conversation was not found.");
  }

  const snapshot = conversationalTaskSnapshotV1Schema.parse(version.snapshot);
  const operationDefinitions = snapshot.toolDefinitions.filter(
    (definition) =>
      definition.projectId === input.projectId &&
      definition.access === "write" &&
      definition.execution.adapter === "operation",
  );
  const definition = input.toolId
    ? operationDefinitions.find(({ id }) => id === input.toolId)
    : operationDefinitions.length === 1
      ? operationDefinitions[0]
      : null;
  const binding = definition
    ? snapshot.task.definition.tools.find(
        ({ tool }) =>
          tool.id === definition.id && tool.version === definition.version,
      )
    : null;
  if (
    !definition ||
    !binding ||
    binding.access !== "write" ||
    !binding.allowedStages.includes("operation")
  ) {
    throw new Error(
      "Choose a published operation allowed at the action stage.",
    );
  }

  return {
    binding,
    conversation,
    definition,
    runtime,
    snapshot,
    version,
  };
}

async function refreshVolatileFacts(
  context: Awaited<ReturnType<typeof loadTaskOperationContext>>,
) {
  for (const binding of context.snapshot.task.definition.tools) {
    if (
      binding.access !== "read" ||
      !binding.allowedStages.includes("lookup")
    ) {
      continue;
    }
    const definition = context.snapshot.toolDefinitions.find(
      (candidate) =>
        candidate.id === binding.tool.id &&
        candidate.version === binding.tool.version &&
        candidate.execution.adapter === "built_in" &&
        candidate.execution.mode === "synchronous" &&
        candidate.resultMappings.some(
          ({ freshnessMinutes }) => freshnessMinutes !== null,
        ),
    );
    if (!definition) continue;

    const now = new Date();
    const requestId = randomUUID();
    const result = await applyConversationalTaskEvent({
      authentication: null,
      channelIdentity: context.conversation.metadata,
      channelType: context.conversation.channelType,
      conversationId: context.runtime.run.conversationId,
      eventId: `operation-refresh:${requestId}`,
      expectedRevision: null,
      idempotencyKey: requestId,
      input: {},
      occurredAt: now.toISOString(),
      projectId: context.runtime.run.projectId,
      providerSequence: null,
      receivedAt: now.toISOString(),
      requestId,
      requestMode: "synchronous",
      schemaVersion: 1,
      stage: "lookup",
      taskRunId: context.runtime.run.id,
      timeoutAt: null,
      toolId: definition.id,
      type: "tool.requested",
    });
    if (
      result.disposition !== "applied" &&
      result.reason !== "duplicate_event"
    ) {
      throw new Error(
        result.reason === "tool_input_missing"
          ? "Complete the required details before preparing confirmation."
          : "Current business facts could not be refreshed.",
      );
    }
  }
}

function buildConfirmationState(input: {
  definition: ToolDefinitionV1;
  runtime: NonNullable<
    Awaited<ReturnType<typeof getConversationalTaskRuntime>>
  >;
  snapshot: ConversationalTaskSnapshotV1;
}) {
  const now = new Date();
  const fields = new Map(
    input.runtime.fields.map((field) => [
      field.fieldKey,
      {
        canonicalValue: field.canonicalValue,
        state: field.state,
      },
    ]),
  );
  const context = new Map(
    input.runtime.context.map((item) => [
      item.key,
      { expiresAt: item.expiresAt, value: item.value },
    ]),
  );
  const canonicalInput = buildCanonicalToolInput({
    context,
    definition: input.definition,
    fields,
    now,
    proposedInput: {},
  });
  if (!canonicalInput.ok) {
    throw new Error(canonicalInput.error.message);
  }

  const availabilityDefinition = getBoundAvailabilityDefinition(input.snapshot);
  if (availabilityDefinition) {
    const availability = readCanonicalAvailability({
      context: input.runtime.context,
      definition: availabilityDefinition,
      fields: input.runtime.fields,
      now,
    });
    if (availability !== true) {
      throw new Error(
        availability === false
          ? "The selected service is unavailable for that date and time."
          : "Current availability could not be verified. Do not place the appointment.",
      );
    }
  }

  const missingRequiredField = input.runtime.fields.find(
    ({ isRequired, state }) =>
      isRequired && state !== "valid" && state !== "confirmed",
  );
  if (missingRequiredField) {
    throw new Error(
      `Complete "${humanizeKey(missingRequiredField.fieldKey)}" before confirmation.`,
    );
  }

  const items: ConfirmationSummaryItem[] = [];
  for (const definition of input.snapshot.task.definition.fields) {
    const field = input.runtime.fields.find(
      ({ fieldKey }) => fieldKey === definition.key,
    );
    if (
      field &&
      (field.state === "valid" || field.state === "confirmed") &&
      field.canonicalValue !== null &&
      field.canonicalValue !== undefined
    ) {
      items.push({
        key: field.fieldKey,
        label: definition.label,
        source: "field",
        value: field.canonicalValue,
      });
    }
  }
  for (const item of input.runtime.context
    .filter(
      ({ expiresAt, source, toolVisible, value }) =>
        source === "tool" &&
        toolVisible &&
        value !== null &&
        value !== undefined &&
        (!expiresAt || expiresAt > now),
    )
    .sort((left, right) => left.key.localeCompare(right.key))) {
    items.push({
      key: item.key,
      label: humanizeKey(item.key),
      source: "tool",
      value: item.value,
    });
  }

  const summary: ConfirmationSummary = {
    items,
    operationName: input.definition.name,
    toolId: input.definition.id,
  };
  const canonicalHash = hashValue({
    canonicalInput: canonicalInput.input,
    facts: items.map(({ key, source, value }) => ({ key, source, value })),
    taskVersionId: input.runtime.run.taskVersionId,
    toolId: input.definition.id,
    toolVersion: input.definition.version,
  });

  return { canonicalHash, canonicalInput: canonicalInput.input, summary };
}

async function audit(input: {
  confirmationId?: number;
  eventType: string;
  projectId: number;
  run: { conversationId: number; id: number };
  summary?: Record<string, unknown>;
}) {
  await db.insert(conversationalTaskAuditEvents).values({
    conversationId: input.run.conversationId,
    eventType: input.eventType,
    projectId: input.projectId,
    summary: {
      confirmationId: input.confirmationId ?? null,
      ...(input.summary ?? {}),
    },
    taskRunId: input.run.id,
  });
}

export async function listTaskOperationConfirmations(input: {
  projectId: number;
  taskRunId: number;
}) {
  return db
    .select()
    .from(conversationalTaskConfirmations)
    .where(
      and(
        eq(conversationalTaskConfirmations.projectId, input.projectId),
        eq(conversationalTaskConfirmations.taskRunId, input.taskRunId),
      ),
    )
    .orderBy(desc(conversationalTaskConfirmations.createdAt));
}

export async function prepareTaskOperationConfirmation(input: {
  projectId: number;
  taskRunId: number;
  toolId: string;
}) {
  let context = await loadTaskOperationContext(input);
  await refreshVolatileFacts(context);
  context = await loadTaskOperationContext(input);
  const state = buildConfirmationState(context);
  const now = new Date();
  const active = await db
    .select()
    .from(conversationalTaskConfirmations)
    .where(
      and(
        eq(conversationalTaskConfirmations.projectId, input.projectId),
        eq(conversationalTaskConfirmations.taskRunId, input.taskRunId),
        eq(conversationalTaskConfirmations.toolId, input.toolId),
        inArray(
          conversationalTaskConfirmations.status,
          ACTIVE_CONFIRMATION_STATUSES,
        ),
      ),
    )
    .orderBy(desc(conversationalTaskConfirmations.id))
    .limit(1)
    .then(([row]) => row ?? null);
  if (
    active &&
    (active.status === "executing" || active.status === "outcome_unknown")
  ) {
    throw new Error(
      active.status === "outcome_unknown"
        ? "Reconcile the uncertain operation before preparing it again."
        : "This operation is already being processed.",
    );
  }
  if (
    active &&
    active.canonicalHash === state.canonicalHash &&
    active.expiresAt > now
  ) {
    return active;
  }

  const confirmation = await db.transaction(async (tx) => {
    await tx
      .update(conversationalTaskConfirmations)
      .set({
        invalidatedAt: now,
        status: "invalidated",
        updatedAt: now,
      })
      .where(
        and(
          eq(conversationalTaskConfirmations.projectId, input.projectId),
          eq(conversationalTaskConfirmations.taskRunId, input.taskRunId),
          eq(conversationalTaskConfirmations.toolId, input.toolId),
          inArray(conversationalTaskConfirmations.status, [
            "pending",
            "confirmed",
          ]),
        ),
      );
    const [created] = await tx
      .insert(conversationalTaskConfirmations)
      .values({
        canonicalHash: state.canonicalHash,
        canonicalInput: state.canonicalInput,
        confirmationToken: randomUUID(),
        expiresAt: addMinutes(now, CONFIRMATION_TTL_MINUTES),
        projectId: input.projectId,
        status: "pending",
        summary: state.summary,
        taskRunId: input.taskRunId,
        taskVersionId: context.runtime.run.taskVersionId,
        toolId: input.toolId,
      })
      .returning();
    await tx
      .update(conversationalTaskRuns)
      .set({ currentStage: "confirmation", updatedAt: now })
      .where(
        and(
          eq(conversationalTaskRuns.projectId, input.projectId),
          eq(conversationalTaskRuns.id, input.taskRunId),
        ),
      );
    return created;
  });
  if (!confirmation) {
    throw new Error("The confirmation summary could not be prepared.");
  }
  await audit({
    confirmationId: confirmation.id,
    eventType: "confirmation.prepared",
    projectId: input.projectId,
    run: context.runtime.run,
    summary: {
      factKeys: state.summary.items.map(({ key }) => key),
      toolId: input.toolId,
    },
  });
  return confirmation;
}

export async function confirmTaskOperation(input: {
  confirmationId: number;
  principal: TaskOperationPrincipal;
  projectId: number;
  taskRunId: number;
}) {
  const [confirmation] = await db
    .select()
    .from(conversationalTaskConfirmations)
    .where(
      and(
        eq(conversationalTaskConfirmations.id, input.confirmationId),
        eq(conversationalTaskConfirmations.projectId, input.projectId),
        eq(conversationalTaskConfirmations.taskRunId, input.taskRunId),
      ),
    )
    .limit(1);
  if (!confirmation) throw new Error("The confirmation was not found.");
  if (confirmation.status === "confirmed") return confirmation;
  if (confirmation.status !== "pending") {
    throw new Error("Prepare a fresh confirmation before continuing.");
  }

  const now = new Date();
  if (confirmation.expiresAt <= now) {
    await db
      .update(conversationalTaskConfirmations)
      .set({ invalidatedAt: now, status: "expired", updatedAt: now })
      .where(eq(conversationalTaskConfirmations.id, confirmation.id));
    throw new Error("The confirmation expired. Prepare it again.");
  }
  const context = await loadTaskOperationContext({
    projectId: input.projectId,
    taskRunId: input.taskRunId,
    toolId: confirmation.toolId,
  });
  const state = buildConfirmationState(context);
  if (state.canonicalHash !== confirmation.canonicalHash) {
    await db
      .update(conversationalTaskConfirmations)
      .set({ invalidatedAt: now, status: "invalidated", updatedAt: now })
      .where(eq(conversationalTaskConfirmations.id, confirmation.id));
    throw new Error("Task details changed. Review a fresh confirmation.");
  }

  const confirmationFieldKeys = context.snapshot.task.definition.fields
    .filter(({ confirmation: policy }) => policy !== "never")
    .map(({ key }) => key);
  const [updated] = await db.transaction(async (tx) => {
    if (confirmationFieldKeys.length > 0) {
      await tx
        .update(conversationalTaskFieldValues)
        .set({
          revision: sql`${conversationalTaskFieldValues.revision} + 1`,
          state: "confirmed",
          updatedAt: now,
        })
        .where(
          and(
            eq(conversationalTaskFieldValues.projectId, input.projectId),
            eq(conversationalTaskFieldValues.taskRunId, input.taskRunId),
            inArray(
              conversationalTaskFieldValues.fieldKey,
              confirmationFieldKeys,
            ),
            inArray(conversationalTaskFieldValues.state, [
              "valid",
              "confirmed",
            ]),
          ),
        );
    }
    const rows = await tx
      .update(conversationalTaskConfirmations)
      .set({
        confirmedAt: now,
        confirmedBy: {
          kind: input.principal.kind,
          principal: input.principal.principal,
        },
        status: "confirmed",
        updatedAt: now,
      })
      .where(
        and(
          eq(conversationalTaskConfirmations.id, confirmation.id),
          eq(conversationalTaskConfirmations.status, "pending"),
        ),
      )
      .returning();
    await tx
      .update(conversationalTaskRuns)
      .set({ currentStage: "operation", updatedAt: now })
      .where(
        and(
          eq(conversationalTaskRuns.projectId, input.projectId),
          eq(conversationalTaskRuns.id, input.taskRunId),
        ),
      );
    return rows;
  });
  if (!updated) throw new Error("The confirmation changed. Try again.");
  await audit({
    confirmationId: updated.id,
    eventType: "confirmation.confirmed",
    projectId: input.projectId,
    run: context.runtime.run,
    summary: { toolId: confirmation.toolId },
  });
  return updated;
}

function stableOperationKey(input: {
  canonicalHash: string;
  runId: number;
  toolId: string;
  versionId: number;
}) {
  return `task:${input.runId}:version:${input.versionId}:tool:${input.toolId}:input:${input.canonicalHash}`;
}

export async function executeConfirmedTaskOperation(input: {
  confirmationId: number;
  principal: TaskOperationPrincipal;
  projectId: number;
  taskRunId: number;
}) {
  const [confirmation] = await db
    .select()
    .from(conversationalTaskConfirmations)
    .where(
      and(
        eq(conversationalTaskConfirmations.id, input.confirmationId),
        eq(conversationalTaskConfirmations.projectId, input.projectId),
        eq(conversationalTaskConfirmations.taskRunId, input.taskRunId),
      ),
    )
    .limit(1);
  if (!confirmation) throw new Error("The confirmation was not found.");
  if (
    !["confirmed", "executing", "outcome_unknown", "consumed"].includes(
      confirmation.status,
    )
  ) {
    throw new Error("Confirm the current summary before executing.");
  }
  const existingAttempt = await db
    .select()
    .from(operationAttempts)
    .where(
      and(
        eq(operationAttempts.projectId, input.projectId),
        eq(operationAttempts.taskConfirmationId, confirmation.id),
      ),
    )
    .limit(1)
    .then(([row]) => row ?? null);
  if (existingAttempt) {
    return { attempt: existingAttempt, created: false, job: null };
  }
  if (confirmation.status !== "confirmed") {
    throw new Error("This operation is already being reconciled.");
  }

  let context = await loadTaskOperationContext({
    projectId: input.projectId,
    taskRunId: input.taskRunId,
    toolId: confirmation.toolId,
  });
  await refreshVolatileFacts(context);
  context = await loadTaskOperationContext({
    projectId: input.projectId,
    taskRunId: input.taskRunId,
    toolId: confirmation.toolId,
  });
  const state = buildConfirmationState(context);
  const now = new Date();
  if (
    confirmation.expiresAt <= now ||
    state.canonicalHash !== confirmation.canonicalHash
  ) {
    await db
      .update(conversationalTaskConfirmations)
      .set({ invalidatedAt: now, status: "invalidated", updatedAt: now })
      .where(eq(conversationalTaskConfirmations.id, confirmation.id));
    throw new Error(
      "A current fact or task value changed. Review and confirm again.",
    );
  }

  const idempotencyKey = stableOperationKey({
    canonicalHash: confirmation.canonicalHash,
    runId: input.taskRunId,
    toolId: confirmation.toolId,
    versionId: confirmation.taskVersionId,
  });
  const requestId = `operation:${hashValue(idempotencyKey).slice(0, 40)}`;
  const confirmedAt = confirmation.confirmedAt ?? now;
  const lastEventOccurredAt = context.runtime.execution?.lastEventOccurredAt;
  const requestedAt =
    lastEventOccurredAt && lastEventOccurredAt > confirmedAt
      ? lastEventOccurredAt
      : confirmedAt;
  const [existingRequest] = await db
    .select()
    .from(conversationalTaskToolRequests)
    .where(
      and(
        eq(conversationalTaskToolRequests.projectId, input.projectId),
        eq(conversationalTaskToolRequests.taskRunId, input.taskRunId),
        eq(conversationalTaskToolRequests.requestId, requestId),
      ),
    )
    .limit(1);
  if (
    existingRequest &&
    (existingRequest.taskVersionId !== confirmation.taskVersionId ||
      existingRequest.toolId !== confirmation.toolId ||
      existingRequest.idempotencyKey !== idempotencyKey ||
      existingRequest.stage !== "operation" ||
      existingRequest.status !== "pending" ||
      (existingRequest.confirmationId !== null &&
        existingRequest.confirmationId !== confirmation.id))
  ) {
    throw new Error(
      "The existing operation request does not match this confirmation.",
    );
  }
  if (!existingRequest) {
    const eventResult = await applyConversationalTaskEvent({
      authentication: authentication(input.principal, requestedAt),
      channelIdentity: context.conversation.metadata,
      channelType: context.conversation.channelType,
      conversationId: context.runtime.run.conversationId,
      eventId: `${requestId}:requested`,
      expectedRevision: null,
      idempotencyKey,
      input: confirmation.canonicalInput,
      occurredAt: requestedAt.toISOString(),
      projectId: input.projectId,
      providerSequence: null,
      receivedAt: requestedAt.toISOString(),
      requestId,
      requestMode: "asynchronous",
      schemaVersion: 1,
      stage: "operation",
      taskRunId: input.taskRunId,
      timeoutAt: null,
      toolId: confirmation.toolId,
      type: "tool.requested",
    });
    if (
      eventResult.disposition !== "applied" &&
      eventResult.reason !== "duplicate_event"
    ) {
      throw new Error(
        eventResult.reason ?? "The operation request could not be reserved.",
      );
    }
  }
  const [toolRequest] = await db
    .update(conversationalTaskToolRequests)
    .set({ confirmationId: confirmation.id, updatedAt: now })
    .where(
      and(
        eq(conversationalTaskToolRequests.projectId, input.projectId),
        eq(conversationalTaskToolRequests.taskRunId, input.taskRunId),
        eq(conversationalTaskToolRequests.requestId, requestId),
      ),
    )
    .returning();
  if (!toolRequest) {
    throw new Error("The operation request could not be found.");
  }

  const queued = await queueOperationForConversationalTask({
    confirmationId: confirmation.id,
    idempotencyKey,
    operationId: operationIdFromDefinition(context.definition),
    payload: confirmation.canonicalInput,
    projectId: input.projectId,
    taskRunId: input.taskRunId,
    taskToolRequestId: toolRequest.id,
    taskVersionId: confirmation.taskVersionId,
  });
  if (!queued) throw new Error("The operation or provider is unavailable.");

  await db
    .update(conversationalTaskConfirmations)
    .set({ status: "executing", updatedAt: now })
    .where(
      and(
        eq(conversationalTaskConfirmations.id, confirmation.id),
        eq(conversationalTaskConfirmations.status, "confirmed"),
      ),
    );
  await audit({
    confirmationId: confirmation.id,
    eventType: "operation.queued",
    projectId: input.projectId,
    run: context.runtime.run,
    summary: {
      attemptId: queued.attempt.id,
      toolId: confirmation.toolId,
    },
  });
  return queued;
}

function matchingOutcome(
  snapshot: ConversationalTaskSnapshotV1,
  type: "completed" | "failed" | "handoff",
) {
  return snapshot.task.definition.outcomes.find(
    (outcome) => outcome.type === type,
  );
}

function confirmedFieldValues(summary: Record<string, unknown>) {
  const values = new Map<string, unknown>();
  if (!Array.isArray(summary.items)) return values;
  for (const item of summary.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    if (
      entry.source === "field" &&
      typeof entry.key === "string" &&
      "value" in entry
    ) {
      values.set(entry.key, entry.value);
    }
  }
  return values;
}

async function restoreConfirmedOperationFields(input: {
  confirmation: SelectConversationalTaskConfirmation;
  now: Date;
  projectId: number;
}) {
  const confirmedValues = confirmedFieldValues(input.confirmation.summary);
  if (confirmedValues.size === 0) return;
  const fields = await db
    .select({
      canonicalValue: conversationalTaskFieldValues.canonicalValue,
      fieldKey: conversationalTaskFieldValues.fieldKey,
      id: conversationalTaskFieldValues.id,
      state: conversationalTaskFieldValues.state,
    })
    .from(conversationalTaskFieldValues)
    .where(
      and(
        eq(conversationalTaskFieldValues.projectId, input.projectId),
        eq(
          conversationalTaskFieldValues.taskRunId,
          input.confirmation.taskRunId,
        ),
        inArray(conversationalTaskFieldValues.fieldKey, [
          ...confirmedValues.keys(),
        ]),
      ),
    );
  const fieldIds = fields
    .filter(
      (field) =>
        field.state === "valid" &&
        confirmedValues.has(field.fieldKey) &&
        stableJson(field.canonicalValue) ===
          stableJson(confirmedValues.get(field.fieldKey)),
    )
    .map(({ id }) => id);
  if (fieldIds.length === 0) return;
  await db
    .update(conversationalTaskFieldValues)
    .set({
      revision: sql`${conversationalTaskFieldValues.revision} + 1`,
      state: "confirmed",
      updatedAt: input.now,
    })
    .where(
      and(
        eq(conversationalTaskFieldValues.projectId, input.projectId),
        eq(
          conversationalTaskFieldValues.taskRunId,
          input.confirmation.taskRunId,
        ),
        eq(conversationalTaskFieldValues.state, "valid"),
        inArray(conversationalTaskFieldValues.id, fieldIds),
      ),
    );
}

async function applyOperationResult(input: {
  confirmation: SelectConversationalTaskConfirmation;
  principal: TaskOperationPrincipal;
  projectId: number;
}) {
  const context = await loadTaskOperationContext({
    projectId: input.projectId,
    taskRunId: input.confirmation.taskRunId,
    toolId: input.confirmation.toolId,
  });
  const [attemptRow] = await db
    .select({ id: operationAttempts.id })
    .from(operationAttempts)
    .where(
      and(
        eq(operationAttempts.projectId, input.projectId),
        eq(operationAttempts.taskConfirmationId, input.confirmation.id),
      ),
    )
    .limit(1);
  const attemptDetails = attemptRow
    ? await getProjectOperationAttemptWithDetails(
        input.projectId,
        attemptRow.id,
      )
    : null;
  if (!attemptDetails) throw new Error("The operation attempt was not found.");
  const { attempt: attemptContext, operation } = attemptDetails;
  if (attemptContext.status === "pending") {
    return { attempt: attemptContext, reconciled: false };
  }
  if (!attemptContext.taskToolRequestId) {
    throw new Error("The operation attempt is not linked to its task request.");
  }

  const [request] = await db
    .select()
    .from(conversationalTaskToolRequests)
    .where(
      and(
        eq(conversationalTaskToolRequests.projectId, input.projectId),
        eq(conversationalTaskToolRequests.id, attemptContext.taskToolRequestId),
        eq(
          conversationalTaskToolRequests.taskRunId,
          input.confirmation.taskRunId,
        ),
      ),
    )
    .limit(1);
  if (!request) throw new Error("The operation tool request was not found.");

  const now = new Date();
  const eventStatus =
    attemptContext.status === "completed"
      ? "success"
      : attemptContext.status === "outcome_unknown"
        ? "outcome_unknown"
        : "provider_failure";
  if (
    !(attemptContext.status === "completed" && request.status === "success")
  ) {
    const result = await applyConversationalTaskEvent({
      authentication: authentication(input.principal, now),
      channelIdentity: context.conversation.metadata,
      channelType: context.conversation.channelType,
      conversationId: context.runtime.run.conversationId,
      errorCode:
        attemptContext.status === "completed" ? null : attemptContext.status,
      eventId: `operation:${attemptContext.id}:result:${attemptContext.status}`,
      expectedRevision: null,
      occurredAt: now.toISOString(),
      projectId: input.projectId,
      providerSequence: null,
      receivedAt: now.toISOString(),
      requestId: request.requestId,
      result:
        attemptContext.status === "completed"
          ? getOperationAttemptToolResult({
              attempt: attemptContext,
              operation,
            })
          : null,
      schemaVersion: 1,
      status: eventStatus,
      taskRunId: input.confirmation.taskRunId,
      type: "tool.result",
    });
    if (result.disposition !== "applied") {
      throw new Error(result.reason ?? "The operation result was rejected.");
    }
  }

  if (attemptContext.status === "outcome_unknown") {
    await db
      .update(conversationalTaskConfirmations)
      .set({ status: "outcome_unknown", updatedAt: now })
      .where(eq(conversationalTaskConfirmations.id, input.confirmation.id));
    await audit({
      confirmationId: input.confirmation.id,
      eventType: "operation.outcome_unknown",
      projectId: input.projectId,
      run: context.runtime.run,
      summary: { attemptId: attemptContext.id },
    });
    return { attempt: attemptContext, reconciled: true };
  }

  const terminalOutcome =
    attemptContext.status === "completed"
      ? matchingOutcome(context.snapshot, "completed")
      : matchingOutcome(context.snapshot, "failed");
  const handoffOutcome =
    attemptContext.status === "failed"
      ? matchingOutcome(context.snapshot, "handoff")
      : null;
  let outcomeKey: string | null = terminalOutcome?.key ?? null;
  if (attemptContext.status === "completed" && !terminalOutcome) {
    throw new Error("The published task has no completed outcome.");
  }
  if (attemptContext.status === "completed" && terminalOutcome) {
    await restoreConfirmedOperationFields({
      confirmation: input.confirmation,
      now,
      projectId: input.projectId,
    });
    const completion = await applyConversationalTaskEvent({
      authentication: authentication(input.principal, now),
      channelIdentity: context.conversation.metadata,
      channelType: context.conversation.channelType,
      conversationId: context.runtime.run.conversationId,
      eventId: `operation:${attemptContext.id}:confirmation:${input.confirmation.id}:task-complete`,
      expectedRevision: null,
      occurredAt: now.toISOString(),
      outcomeKey: terminalOutcome.key,
      projectId: input.projectId,
      providerSequence: null,
      receivedAt: now.toISOString(),
      schemaVersion: 1,
      taskRunId: input.confirmation.taskRunId,
      type: "task.complete",
    });
    if (completion.disposition !== "applied") {
      throw new Error(completion.reason ?? "The task could not be completed.");
    }
  } else if (terminalOutcome) {
    const failure = await applyConversationalTaskEvent({
      authentication: authentication(input.principal, now),
      channelIdentity: context.conversation.metadata,
      channelType: context.conversation.channelType,
      conversationId: context.runtime.run.conversationId,
      eventId: `operation:${attemptContext.id}:task-failed`,
      expectedRevision: null,
      occurredAt: now.toISOString(),
      outcomeKey: terminalOutcome.key,
      projectId: input.projectId,
      providerSequence: null,
      reason: "provider_failure",
      receivedAt: now.toISOString(),
      schemaVersion: 1,
      taskRunId: input.confirmation.taskRunId,
      type: "task.fail",
    });
    if (
      failure.disposition !== "applied" &&
      failure.reason !== "duplicate_event"
    ) {
      throw new Error(failure.reason ?? "The failure route was rejected.");
    }
  } else if (handoffOutcome) {
    outcomeKey = handoffOutcome.key;
    const handoff = await applyConversationalTaskEvent({
      authentication: authentication(input.principal, now),
      channelIdentity: context.conversation.metadata,
      channelType: context.conversation.channelType,
      conversationId: context.runtime.run.conversationId,
      eventId: `operation:${attemptContext.id}:task-handoff`,
      expectedRevision: null,
      occurredAt: now.toISOString(),
      outcomeKey: handoffOutcome.key,
      projectId: input.projectId,
      providerSequence: null,
      reason: "The configured operation could not be completed.",
      receivedAt: now.toISOString(),
      schemaVersion: 1,
      taskRunId: input.confirmation.taskRunId,
      type: "task.handoff",
    });
    if (
      handoff.disposition !== "applied" &&
      handoff.reason !== "duplicate_event"
    ) {
      throw new Error(handoff.reason ?? "The handoff route was rejected.");
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(conversationalTaskToolRequests)
      .set({ outcomeKey, updatedAt: now })
      .where(eq(conversationalTaskToolRequests.id, request.id));
    await tx
      .update(conversationalTaskConfirmations)
      .set({
        consumedAt: now,
        status: attemptContext.status === "completed" ? "consumed" : "failed",
        updatedAt: now,
      })
      .where(eq(conversationalTaskConfirmations.id, input.confirmation.id));
  });
  await audit({
    confirmationId: input.confirmation.id,
    eventType:
      attemptContext.status === "completed"
        ? "operation.completed"
        : "operation.failed",
    projectId: input.projectId,
    run: context.runtime.run,
    summary: { attemptId: attemptContext.id, outcomeKey },
  });
  return { attempt: attemptContext, reconciled: true };
}

export async function processAndReconcileTaskOperation(input: {
  confirmationId: number;
  principal: TaskOperationPrincipal;
  projectId: number;
  workerId: string;
}) {
  const [confirmation] = await db
    .select()
    .from(conversationalTaskConfirmations)
    .where(
      and(
        eq(conversationalTaskConfirmations.id, input.confirmationId),
        eq(conversationalTaskConfirmations.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!confirmation) throw new Error("The confirmation was not found.");

  await processProjectDurableOperationQueue({
    maxJobs: 25,
    projectId: input.projectId,
    workerId: input.workerId,
  });
  return applyOperationResult({
    confirmation,
    principal: input.principal,
    projectId: input.projectId,
  });
}

export async function reconcileUnknownTaskOperation(input: {
  confirmationId: number;
  errorMessage?: string | null;
  principal: TaskOperationPrincipal;
  projectId: number;
  responsePayload?: Record<string, unknown>;
  status: "completed" | "failed";
}) {
  const [confirmation] = await db
    .select()
    .from(conversationalTaskConfirmations)
    .where(
      and(
        eq(conversationalTaskConfirmations.id, input.confirmationId),
        eq(conversationalTaskConfirmations.projectId, input.projectId),
        eq(conversationalTaskConfirmations.status, "outcome_unknown"),
      ),
    )
    .limit(1);
  if (!confirmation) {
    throw new Error("No uncertain operation is waiting for reconciliation.");
  }
  const [attempt] = await db
    .select()
    .from(operationAttempts)
    .where(
      and(
        eq(operationAttempts.projectId, input.projectId),
        eq(operationAttempts.taskConfirmationId, confirmation.id),
        eq(operationAttempts.status, "outcome_unknown"),
      ),
    )
    .limit(1);
  if (!attempt) throw new Error("The uncertain attempt was not found.");

  const reconciled = await reconcileOperationAttemptOutcome({
    attemptId: attempt.id,
    errorMessage: input.errorMessage,
    projectId: input.projectId,
    responsePayload: input.responsePayload,
    status: input.status,
  });
  if (!reconciled) throw new Error("The operation was already reconciled.");
  return applyOperationResult({
    confirmation,
    principal: input.principal,
    projectId: input.projectId,
  });
}

export async function getTaskOperationAttempt(input: {
  confirmationId: number;
  projectId: number;
}) {
  const [attempt] = await db
    .select()
    .from(operationAttempts)
    .where(
      and(
        eq(operationAttempts.projectId, input.projectId),
        eq(operationAttempts.taskConfirmationId, input.confirmationId),
      ),
    )
    .limit(1);
  return attempt
    ? getProjectOperationAttemptWithDetails(input.projectId, attempt.id)
    : null;
}
