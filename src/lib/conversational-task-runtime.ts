import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  conversationalTaskSnapshotV1Schema,
  normalizeConversationProjectPolicy,
} from "@/lib/conversation-contracts";
import {
  applyFieldCandidates,
  clearRuntimeField,
  initializeRuntimeTaskFields,
  type RuntimeTaskField,
  resetRuntimeFields,
} from "@/lib/conversational-task-field-state";
import {
  type InboundEventV1,
  inboundEventV1Schema,
  type StartConversationalTaskRunV1,
  startConversationalTaskRunV1Schema,
  type TaskFieldState,
} from "@/lib/conversational-task-runtime-contracts";
import { db } from "@/lib/db-config";
import {
  channelConversations,
  channelMessages,
  contacts,
  conversationalTaskAuditEvents,
  conversationalTaskContextValues,
  conversationalTaskFieldValues,
  conversationalTaskRuns,
  conversationalTasks,
  conversationalTaskToolRequests,
  conversationalTaskVersions,
  conversationExecutionStates,
  conversationInboundEvents,
  conversationProjectPolicies,
  users,
} from "@/lib/db-schema";

type RuntimeTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ConversationalTaskRuntimeConflictError extends Error {
  constructor() {
    super("The conversation changed while this event was being applied.");
    this.name = "ConversationalTaskRuntimeConflictError";
  }
}

type EventDisposition = "applied" | "conflict" | "ignored" | "quarantined";

export type ConversationalTaskRuntimeResult = {
  disposition: EventDisposition;
  reason: string | null;
  revision: number | null;
  taskRunId: number | null;
};

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

function hashPayload(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(value)))
    .digest("hex");
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function toEventPayload(event: InboundEventV1) {
  const {
    authentication: _authentication,
    channelIdentity: _channelIdentity,
    channelType: _channelType,
    conversationId: _conversationId,
    eventId: _eventId,
    expectedRevision: _expectedRevision,
    occurredAt: _occurredAt,
    projectId: _projectId,
    providerSequence: _providerSequence,
    receivedAt: _receivedAt,
    schemaVersion: _schemaVersion,
    taskRunId: _taskRunId,
    ...payload
  } = event;
  return payload;
}

function safeEventSummary(event: InboundEventV1) {
  switch (event.type) {
    case "field.candidates":
      return {
        candidateCount: event.candidates.length,
        correction: event.correction,
        fieldKeys: [
          ...new Set(event.candidates.map(({ fieldKey }) => fieldKey)),
        ],
      };
    case "field.clear":
      return { fieldKey: event.fieldKey, reason: event.reason };
    case "field.requested":
      return { fieldKey: event.fieldKey };
    case "task.pause":
      return {
        boundary: event.boundary,
        hasReturnTarget: Boolean(event.returnTarget),
        resumeAt: event.resumeAt,
      };
    case "task.resume":
      return { resumed: true };
    case "task.cancel":
    case "task.complete":
      return { outcomeKey: event.outcomeKey };
    case "task.restart":
      return { restarted: true };
    case "task.side_question":
      return { category: event.category };
    case "task.side_question_resolved":
      return { resumedTask: true };
    case "owner.change":
      return {
        activeNodeId: event.activeNodeId,
        executionMode: event.executionMode,
        responseOwner: event.responseOwner,
      };
    case "session.rotate":
      return {
        hasExpiry: Boolean(event.sessionExpiresAt),
        rotated: true,
      };
    case "tool.requested":
      return {
        requestId: event.requestId,
        requestMode: event.requestMode,
        stage: event.stage,
        toolId: event.toolId,
      };
    case "tool.result":
      return {
        requestId: event.requestId,
        status: event.status,
      };
  }
}

function runtimeFieldMap(
  rows: (typeof conversationalTaskFieldValues.$inferSelect)[],
) {
  return new Map<string, RuntimeTaskField>(
    rows.map((row) => [
      row.fieldKey,
      {
        attemptCount: row.attemptCount,
        candidates: row.candidates,
        canonicalValue: row.canonicalValue,
        expiresAt: row.expiresAt,
        fieldId: row.fieldId,
        fieldKey: row.fieldKey,
        fieldType: row.fieldType,
        isRequired: row.isRequired,
        lastRequestedAt: row.lastRequestedAt,
        naturalValue: row.naturalValue,
        provenance: row.provenance,
        revision: row.revision,
        sensitivity: row.sensitivity as RuntimeTaskField["sensitivity"],
        state: row.state as TaskFieldState,
        validatedAt: row.validatedAt,
        validation: row.validation,
      },
    ]),
  );
}

async function recordAudit(
  tx: RuntimeTransaction,
  input: {
    conversationId: number;
    eventType: string;
    inboundEventId?: number | null;
    projectId: number;
    summary?: Record<string, unknown>;
    taskRunId?: number | null;
  },
) {
  await tx.insert(conversationalTaskAuditEvents).values({
    conversationId: input.conversationId,
    eventType: input.eventType,
    inboundEventId: input.inboundEventId ?? null,
    projectId: input.projectId,
    summary: input.summary ?? {},
    taskRunId: input.taskRunId ?? null,
  });
}

async function quarantineEvent(
  tx: RuntimeTransaction,
  input: {
    eventDbId: number;
    eventType: string;
    conversationId: number;
    projectId: number;
    reason: string;
    taskRunId: number | null;
  },
): Promise<ConversationalTaskRuntimeResult> {
  const now = new Date();
  await tx
    .update(conversationInboundEvents)
    .set({
      processedAt: now,
      quarantineReason: input.reason,
      status: "quarantined",
      taskRunId: input.taskRunId,
    })
    .where(
      and(
        eq(conversationInboundEvents.id, input.eventDbId),
        eq(conversationInboundEvents.projectId, input.projectId),
      ),
    );
  await recordAudit(tx, {
    conversationId: input.conversationId,
    eventType: "event.quarantined",
    inboundEventId: input.eventDbId,
    projectId: input.projectId,
    summary: { eventType: input.eventType, reason: input.reason },
    taskRunId: input.taskRunId,
  });
  return {
    disposition: "quarantined",
    reason: input.reason,
    revision: null,
    taskRunId: input.taskRunId,
  };
}

async function resolveDuplicateEvent(
  tx: RuntimeTransaction,
  input: {
    conversationId: number;
    eventId: string;
    payloadHash: string;
    projectId: number;
  },
): Promise<ConversationalTaskRuntimeResult> {
  const [existing] = await tx
    .select()
    .from(conversationInboundEvents)
    .where(
      and(
        eq(conversationInboundEvents.projectId, input.projectId),
        eq(conversationInboundEvents.conversationId, input.conversationId),
        eq(conversationInboundEvents.eventId, input.eventId),
      ),
    )
    .limit(1);

  if (!existing || existing.payloadHash !== input.payloadHash) {
    if (existing) {
      await recordAudit(tx, {
        conversationId: input.conversationId,
        eventType: "event.id_conflict",
        inboundEventId: existing.id,
        projectId: input.projectId,
        summary: { eventId: input.eventId },
        taskRunId: existing.taskRunId,
      });
    }
    return {
      disposition: "conflict",
      reason: "event_id_payload_conflict",
      revision: existing?.appliedRevision ?? null,
      taskRunId: existing?.taskRunId ?? null,
    };
  }

  return {
    disposition: existing.status === "applied" ? "applied" : "ignored",
    reason: "duplicate_event",
    revision: existing.appliedRevision,
    taskRunId: existing.taskRunId,
  };
}

async function verifyIdentityReferences(
  tx: RuntimeTransaction,
  input: StartConversationalTaskRunV1,
) {
  if (input.identityKind === "verified_contact") {
    const [contact] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.projectId, input.projectId),
          eq(contacts.id, input.verifiedContactId as number),
        ),
      )
      .limit(1);
    if (!contact)
      throw new Error("Verified contact does not belong to project.");
  }

  if (input.identityKind === "authenticated_user") {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.authenticatedUserId as number))
      .limit(1);
    if (!user) throw new Error("Authenticated user does not exist.");
  }
}

export async function startConversationalTaskRun(
  input: StartConversationalTaskRunV1,
): Promise<ConversationalTaskRuntimeResult> {
  const parsed = startConversationalTaskRunV1Schema.parse(input);
  const eventHash = hashPayload(parsed);
  const occurredAt = new Date(parsed.occurredAt);
  const receivedAt = new Date(parsed.receivedAt);

  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(channelConversations)
      .where(
        and(
          eq(channelConversations.projectId, parsed.projectId),
          eq(channelConversations.id, parsed.conversationId),
          eq(channelConversations.channelType, parsed.channelType),
        ),
      )
      .limit(1);
    if (!conversation) {
      throw new Error(
        "Conversation does not belong to the project and channel.",
      );
    }

    const [eventRow] = await tx
      .insert(conversationInboundEvents)
      .values({
        channelIdentity: parsed.channelIdentity,
        channelType: parsed.channelType,
        conversationId: parsed.conversationId,
        eventId: parsed.eventId,
        eventType: "task.started",
        occurredAt,
        payload: { taskId: parsed.taskId },
        payloadHash: eventHash,
        projectId: parsed.projectId,
        providerSequence: parsed.providerSequence,
        receivedAt,
      })
      .onConflictDoNothing()
      .returning();
    if (!eventRow) {
      return resolveDuplicateEvent(tx, {
        conversationId: parsed.conversationId,
        eventId: parsed.eventId,
        payloadHash: eventHash,
        projectId: parsed.projectId,
      });
    }

    await verifyIdentityReferences(tx, parsed);

    const [task] = await tx
      .select({ id: conversationalTasks.id })
      .from(conversationalTasks)
      .where(
        and(
          eq(conversationalTasks.id, parsed.taskId),
          eq(conversationalTasks.projectId, parsed.projectId),
          eq(conversationalTasks.isArchived, false),
        ),
      )
      .limit(1);
    const [version] = task
      ? await tx
          .select()
          .from(conversationalTaskVersions)
          .where(
            and(
              eq(conversationalTaskVersions.projectId, parsed.projectId),
              eq(conversationalTaskVersions.taskId, parsed.taskId),
            ),
          )
          .orderBy(desc(conversationalTaskVersions.versionNumber))
          .limit(1)
      : [];
    if (!task || !version) {
      return quarantineEvent(tx, {
        conversationId: parsed.conversationId,
        eventDbId: eventRow.id,
        eventType: "task.started",
        projectId: parsed.projectId,
        reason: "published_task_not_found",
        taskRunId: null,
      });
    }
    const snapshot = conversationalTaskSnapshotV1Schema.parse(version.snapshot);

    await tx
      .insert(conversationExecutionStates)
      .values({
        anonymousVisitorId: parsed.anonymousVisitorId,
        authenticatedUserId:
          parsed.identityKind === "authenticated_user"
            ? parsed.authenticatedUserId
            : null,
        channelIdentity: parsed.channelIdentity,
        conversationId: parsed.conversationId,
        identityKind: parsed.identityKind,
        projectId: parsed.projectId,
        sessionExpiresAt: parsed.sessionExpiresAt
          ? new Date(parsed.sessionExpiresAt)
          : null,
        sessionId: parsed.sessionId,
        verifiedContactId:
          parsed.identityKind === "verified_contact"
            ? parsed.verifiedContactId
            : null,
      })
      .onConflictDoNothing();
    const [execution] = await tx
      .select()
      .from(conversationExecutionStates)
      .where(
        and(
          eq(conversationExecutionStates.projectId, parsed.projectId),
          eq(conversationExecutionStates.conversationId, parsed.conversationId),
        ),
      )
      .limit(1);
    if (!execution) throw new ConversationalTaskRuntimeConflictError();
    if (execution.activeTaskRunId) {
      await tx
        .update(conversationInboundEvents)
        .set({
          processedAt: receivedAt,
          quarantineReason: "active_task_exists",
          status: "ignored",
        })
        .where(eq(conversationInboundEvents.id, eventRow.id));
      await recordAudit(tx, {
        conversationId: parsed.conversationId,
        eventType: "task.start_ignored",
        inboundEventId: eventRow.id,
        projectId: parsed.projectId,
        summary: { reason: "active_task_exists" },
        taskRunId: execution.activeTaskRunId,
      });
      return {
        disposition: "ignored",
        reason: "active_task_exists",
        revision: execution.revision,
        taskRunId: execution.activeTaskRunId,
      };
    }

    const expiresAt = addDays(
      receivedAt,
      snapshot.conversationPolicy.dataHandling.fieldRetentionDays,
    );
    const [run] = await tx
      .insert(conversationalTaskRuns)
      .values({
        conversationId: parsed.conversationId,
        expiresAt,
        projectId: parsed.projectId,
        taskId: parsed.taskId,
        taskVersionId: version.id,
      })
      .returning();
    if (!run) throw new ConversationalTaskRuntimeConflictError();

    const runtimeFields = initializeRuntimeTaskFields({ expiresAt, snapshot });
    if (runtimeFields.size > 0) {
      await tx.insert(conversationalTaskFieldValues).values(
        [...runtimeFields.values()].map((field) => ({
          attemptCount: field.attemptCount,
          candidates: field.candidates,
          canonicalValue: field.canonicalValue,
          expiresAt: field.expiresAt,
          fieldId: field.fieldId,
          fieldKey: field.fieldKey,
          fieldType: field.fieldType,
          isRequired: field.isRequired,
          naturalValue: field.naturalValue,
          projectId: parsed.projectId,
          provenance: field.provenance,
          revision: field.revision,
          sensitivity: field.sensitivity,
          state: field.state,
          taskRunId: run.id,
          validation: field.validation,
        })),
      );
    }

    const contextRows = snapshot.task.definition.contextVariables.flatMap(
      (variable) => {
        const supplied = Object.hasOwn(
          parsed.initializationContext,
          variable.key,
        );
        const value = supplied
          ? parsed.initializationContext[variable.key]
          : variable.defaultValue;
        if (value === undefined || value === null) return [];
        return [
          {
            expiresAt: variable.expiresAfterMinutes
              ? addMinutes(receivedAt, variable.expiresAfterMinutes)
              : expiresAt,
            key: variable.key,
            modelVisible: variable.modelVisible,
            projectId: parsed.projectId,
            sensitivity: variable.sensitivity,
            source: variable.source,
            taskRunId: run.id,
            toolVisible: variable.toolVisible,
            type: variable.type,
            value,
          },
        ];
      },
    );
    if (contextRows.length > 0) {
      await tx.insert(conversationalTaskContextValues).values(contextRows);
    }

    const [updatedExecution] = await tx
      .update(conversationExecutionStates)
      .set({
        activeNodeId: null,
        activeTaskRunId: run.id,
        activeTaskVersionId: version.id,
        anonymousVisitorId: parsed.anonymousVisitorId,
        authenticatedUserId:
          parsed.identityKind === "authenticated_user"
            ? parsed.authenticatedUserId
            : null,
        channelIdentity: parsed.channelIdentity,
        executionMode: "task",
        identityKind: parsed.identityKind,
        lastEventOccurredAt: occurredAt,
        lastProviderSequence: parsed.providerSequence,
        responseOwner: "task",
        revision: sql`${conversationExecutionStates.revision} + 1`,
        sessionExpiresAt: parsed.sessionExpiresAt
          ? new Date(parsed.sessionExpiresAt)
          : null,
        sessionId: parsed.sessionId,
        status: "active",
        suspendedReturnTarget: null,
        updatedAt: receivedAt,
        verifiedContactId:
          parsed.identityKind === "verified_contact"
            ? parsed.verifiedContactId
            : null,
      })
      .where(
        and(
          eq(conversationExecutionStates.id, execution.id),
          eq(conversationExecutionStates.projectId, parsed.projectId),
          eq(conversationExecutionStates.revision, execution.revision),
        ),
      )
      .returning();
    if (!updatedExecution) throw new ConversationalTaskRuntimeConflictError();

    await tx
      .update(conversationInboundEvents)
      .set({
        appliedRevision: updatedExecution.revision,
        processedAt: receivedAt,
        status: "applied",
        taskRunId: run.id,
      })
      .where(eq(conversationInboundEvents.id, eventRow.id));
    await recordAudit(tx, {
      conversationId: parsed.conversationId,
      eventType: "task.started",
      inboundEventId: eventRow.id,
      projectId: parsed.projectId,
      summary: {
        identityKind: parsed.identityKind,
        taskId: parsed.taskId,
        taskVersionId: version.id,
        versionNumber: version.versionNumber,
      },
      taskRunId: run.id,
    });

    return {
      disposition: "applied",
      reason: null,
      revision: updatedExecution.revision,
      taskRunId: run.id,
    };
  });
}

function eventCanMutate(event: InboundEventV1, responseOwner: string) {
  if (event.type === "session.rotate") return true;
  if (event.type === "owner.change") return Boolean(event.authentication);
  if (event.type === "task.side_question_resolved") {
    return responseOwner === "knowledge";
  }
  if (event.type === "tool.result") {
    return responseOwner === "task" || responseOwner === "deterministic";
  }
  return (
    responseOwner === "task" ||
    (responseOwner === "human" && Boolean(event.authentication))
  );
}

export async function applyConversationalTaskEvent(
  input: InboundEventV1,
): Promise<ConversationalTaskRuntimeResult> {
  const event = inboundEventV1Schema.parse(input);
  const eventHash = hashPayload(event);
  const occurredAt = new Date(event.occurredAt);
  const receivedAt = new Date(event.receivedAt);

  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({ id: channelConversations.id })
      .from(channelConversations)
      .where(
        and(
          eq(channelConversations.projectId, event.projectId),
          eq(channelConversations.id, event.conversationId),
          eq(channelConversations.channelType, event.channelType),
        ),
      )
      .limit(1);
    if (!conversation) {
      throw new Error(
        "Conversation does not belong to the project and channel.",
      );
    }

    const [eventRow] = await tx
      .insert(conversationInboundEvents)
      .values({
        authentication: event.authentication,
        channelIdentity: event.channelIdentity,
        channelType: event.channelType,
        conversationId: event.conversationId,
        eventId: event.eventId,
        eventType: event.type,
        expectedRevision: event.expectedRevision,
        occurredAt,
        payload: toEventPayload(event),
        payloadHash: eventHash,
        projectId: event.projectId,
        providerSequence: event.providerSequence,
        receivedAt,
        taskRunId: event.taskRunId,
      })
      .onConflictDoNothing()
      .returning();
    if (!eventRow) {
      return resolveDuplicateEvent(tx, {
        conversationId: event.conversationId,
        eventId: event.eventId,
        payloadHash: eventHash,
        projectId: event.projectId,
      });
    }

    const [execution] = await tx
      .select()
      .from(conversationExecutionStates)
      .where(
        and(
          eq(conversationExecutionStates.projectId, event.projectId),
          eq(conversationExecutionStates.conversationId, event.conversationId),
        ),
      )
      .limit(1);
    if (!execution || !event.taskRunId) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "execution_position_not_found",
        taskRunId: event.taskRunId,
      });
    }
    if (
      execution.activeTaskRunId !== event.taskRunId ||
      !execution.activeTaskVersionId
    ) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "stale_task_run",
        taskRunId: event.taskRunId,
      });
    }
    if (
      event.expectedRevision !== null &&
      event.expectedRevision !== execution.revision
    ) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "stale_revision",
        taskRunId: event.taskRunId,
      });
    }
    if (
      event.providerSequence !== null &&
      execution.lastProviderSequence !== null &&
      event.providerSequence <= execution.lastProviderSequence
    ) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "out_of_order_provider_sequence",
        taskRunId: event.taskRunId,
      });
    }
    if (
      event.providerSequence === null &&
      execution.lastEventOccurredAt &&
      occurredAt < execution.lastEventOccurredAt
    ) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "out_of_order_occurred_at",
        taskRunId: event.taskRunId,
      });
    }
    if (
      event.type !== "session.rotate" &&
      execution.sessionExpiresAt &&
      receivedAt >= execution.sessionExpiresAt
    ) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "session_expired",
        taskRunId: event.taskRunId,
      });
    }
    if (!eventCanMutate(event, execution.responseOwner)) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "inactive_response_owner",
        taskRunId: event.taskRunId,
      });
    }

    const [run] = await tx
      .select()
      .from(conversationalTaskRuns)
      .where(
        and(
          eq(conversationalTaskRuns.projectId, event.projectId),
          eq(conversationalTaskRuns.id, event.taskRunId),
          eq(
            conversationalTaskRuns.taskVersionId,
            execution.activeTaskVersionId,
          ),
        ),
      )
      .limit(1);
    const [version] = run
      ? await tx
          .select()
          .from(conversationalTaskVersions)
          .where(
            and(
              eq(conversationalTaskVersions.id, execution.activeTaskVersionId),
              eq(conversationalTaskVersions.projectId, event.projectId),
            ),
          )
          .limit(1)
      : [];
    if (!run || !version) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "pinned_task_version_not_found",
        taskRunId: event.taskRunId,
      });
    }
    if (run.expiresAt && receivedAt >= run.expiresAt) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "task_run_expired",
        taskRunId: run.id,
      });
    }
    const snapshot = conversationalTaskSnapshotV1Schema.parse(version.snapshot);
    const fieldRows = await tx
      .select()
      .from(conversationalTaskFieldValues)
      .where(
        and(
          eq(conversationalTaskFieldValues.projectId, event.projectId),
          eq(conversationalTaskFieldValues.taskRunId, run.id),
        ),
      );
    const fields = runtimeFieldMap(fieldRows);

    const referencedFieldKeys =
      event.type === "field.candidates"
        ? event.candidates.map(({ fieldKey }) => fieldKey)
        : event.type === "field.clear" || event.type === "field.requested"
          ? [event.fieldKey]
          : [];
    if (referencedFieldKeys.some((key) => !fields.has(key))) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "field_not_found",
        taskRunId: run.id,
      });
    }
    if (
      event.type === "task.complete" &&
      !snapshot.task.definition.outcomes.some(
        (outcome) =>
          outcome.key === event.outcomeKey && outcome.type === "completed",
      )
    ) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "completed_outcome_not_found",
        taskRunId: run.id,
      });
    }
    if (
      event.type === "task.cancel" &&
      event.outcomeKey &&
      !snapshot.task.definition.outcomes.some(
        (outcome) =>
          outcome.key === event.outcomeKey && outcome.type === "cancelled",
      )
    ) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "cancelled_outcome_not_found",
        taskRunId: run.id,
      });
    }
    if (
      event.type === "tool.requested" &&
      !snapshot.task.definition.tools.some(
        (binding) =>
          binding.tool.id === event.toolId &&
          binding.allowedStages.includes(event.stage),
      )
    ) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "tool_not_allowed_for_stage",
        taskRunId: run.id,
      });
    }

    const executionChanges: Partial<
      typeof conversationExecutionStates.$inferInsert
    > = {
      lastEventOccurredAt: occurredAt,
      lastProviderSequence:
        event.providerSequence ?? execution.lastProviderSequence,
      status: "active",
      updatedAt: receivedAt,
    };
    const runChanges: Partial<typeof conversationalTaskRuns.$inferInsert> = {
      updatedAt: receivedAt,
    };
    let fieldUpdates = new Map<
      string,
      RuntimeTaskField & {
        changed?: boolean;
        dependencyInvalidated?: boolean;
      }
    >();

    switch (event.type) {
      case "field.candidates": {
        const result = applyFieldCandidates({
          candidates: event.candidates,
          definition: snapshot.task.definition,
          eventId: event.eventId,
          fields,
          now: receivedAt,
        });
        fieldUpdates = result.updates;
        break;
      }
      case "field.clear": {
        const result = clearRuntimeField({
          definition: snapshot.task.definition,
          eventId: event.eventId,
          fieldKey: event.fieldKey,
          fields,
          now: receivedAt,
          reason: event.reason,
        });
        fieldUpdates = result.updates;
        break;
      }
      case "field.requested": {
        runChanges.lastRequestedFieldKey = event.fieldKey;
        const current = fields.get(event.fieldKey);
        if (current) {
          fieldUpdates.set(event.fieldKey, {
            ...current,
            lastRequestedAt: receivedAt,
          });
        }
        break;
      }
      case "task.pause":
        runChanges.pausedAt = receivedAt;
        runChanges.resumeAt = event.resumeAt ? new Date(event.resumeAt) : null;
        runChanges.status = event.boundary === "manual" ? "paused" : "waiting";
        runChanges.suspendedReturnTarget = event.returnTarget;
        executionChanges.suspendedReturnTarget = event.returnTarget;
        break;
      case "task.resume":
        runChanges.pausedAt = null;
        runChanges.resumeAt = null;
        runChanges.status = "active";
        executionChanges.executionMode = "task";
        executionChanges.responseOwner = "task";
        executionChanges.suspendedReturnTarget = null;
        break;
      case "task.cancel": {
        const returnMode = snapshot.task.definition.returnPolicy.cancelled;
        runChanges.cancelledAt = receivedAt;
        runChanges.outcomeKey = event.outcomeKey ?? "cancelled";
        runChanges.status = "cancelled";
        executionChanges.activeNodeId = null;
        executionChanges.activeTaskRunId = null;
        executionChanges.activeTaskVersionId = null;
        executionChanges.executionMode = "knowledge";
        executionChanges.responseOwner = "knowledge";
        executionChanges.status = returnMode === "end" ? "closed" : "active";
        executionChanges.suspendedReturnTarget = null;
        break;
      }
      case "task.restart":
        fieldUpdates = resetRuntimeFields(fields, receivedAt);
        runChanges.currentStage = "extraction";
        runChanges.lastRequestedFieldKey = null;
        runChanges.outcomeKey = null;
        runChanges.pausedAt = null;
        runChanges.resumeAt = null;
        runChanges.status = "active";
        executionChanges.executionMode = "task";
        executionChanges.responseOwner = "task";
        executionChanges.suspendedReturnTarget = null;
        break;
      case "task.complete": {
        const returnMode = snapshot.task.definition.returnPolicy.completed;
        runChanges.completedAt = receivedAt;
        runChanges.outcomeKey = event.outcomeKey;
        runChanges.status = "completed";
        executionChanges.activeNodeId = null;
        executionChanges.activeTaskRunId = null;
        executionChanges.activeTaskVersionId = null;
        executionChanges.executionMode = "knowledge";
        executionChanges.responseOwner = "knowledge";
        executionChanges.status = returnMode === "end" ? "closed" : "active";
        executionChanges.suspendedReturnTarget = null;
        break;
      }
      case "task.side_question": {
        const returnTarget = {
          lastRequestedFieldKey: run.lastRequestedFieldKey,
          responseOwner: "task",
          taskRunId: run.id,
        };
        runChanges.suspendedReturnTarget = returnTarget;
        executionChanges.executionMode = "knowledge";
        executionChanges.responseOwner = "knowledge";
        executionChanges.suspendedReturnTarget = returnTarget;
        break;
      }
      case "task.side_question_resolved":
        if (!execution.suspendedReturnTarget) {
          return quarantineEvent(tx, {
            conversationId: event.conversationId,
            eventDbId: eventRow.id,
            eventType: event.type,
            projectId: event.projectId,
            reason: "return_target_not_found",
            taskRunId: run.id,
          });
        }
        runChanges.suspendedReturnTarget = null;
        executionChanges.executionMode = "task";
        executionChanges.responseOwner = "task";
        executionChanges.suspendedReturnTarget = null;
        break;
      case "owner.change":
        executionChanges.activeNodeId = event.activeNodeId;
        executionChanges.executionMode = event.executionMode;
        executionChanges.responseOwner = event.responseOwner;
        runChanges.status =
          event.responseOwner === "human" ? "handoff" : "active";
        break;
      case "session.rotate":
        executionChanges.sessionExpiresAt = event.sessionExpiresAt
          ? new Date(event.sessionExpiresAt)
          : null;
        executionChanges.sessionId = event.sessionId;
        executionChanges.sessionRotatedAt = receivedAt;
        break;
      case "tool.requested":
        {
          const [createdRequest] = await tx
            .insert(conversationalTaskToolRequests)
            .values({
              idempotencyKey: event.idempotencyKey,
              input: event.input,
              projectId: event.projectId,
              requestId: event.requestId,
              requestMode: event.requestMode,
              stage: event.stage,
              taskRunId: run.id,
              taskVersionId: version.id,
              timeoutAt: event.timeoutAt ? new Date(event.timeoutAt) : null,
              toolId: event.toolId,
            })
            .onConflictDoNothing()
            .returning();
          if (!createdRequest) {
            const [existingRequest] = await tx
              .select()
              .from(conversationalTaskToolRequests)
              .where(
                and(
                  eq(conversationalTaskToolRequests.projectId, event.projectId),
                  or(
                    eq(
                      conversationalTaskToolRequests.requestId,
                      event.requestId,
                    ),
                    eq(
                      conversationalTaskToolRequests.idempotencyKey,
                      event.idempotencyKey,
                    ),
                  ),
                ),
              )
              .limit(1);
            if (
              !existingRequest ||
              existingRequest.taskRunId !== run.id ||
              existingRequest.taskVersionId !== version.id ||
              existingRequest.toolId !== event.toolId ||
              existingRequest.stage !== event.stage
            ) {
              return quarantineEvent(tx, {
                conversationId: event.conversationId,
                eventDbId: eventRow.id,
                eventType: event.type,
                projectId: event.projectId,
                reason: "tool_request_idempotency_conflict",
                taskRunId: run.id,
              });
            }
          }
        }
        break;
      case "tool.result": {
        const [request] = await tx
          .update(conversationalTaskToolRequests)
          .set({
            completedAt: receivedAt,
            errorCode: event.errorCode,
            result: event.result,
            status: event.status,
            updatedAt: receivedAt,
          })
          .where(
            and(
              eq(conversationalTaskToolRequests.projectId, event.projectId),
              eq(conversationalTaskToolRequests.taskRunId, run.id),
              eq(conversationalTaskToolRequests.requestId, event.requestId),
              eq(conversationalTaskToolRequests.status, "pending"),
            ),
          )
          .returning();
        if (!request) {
          return quarantineEvent(tx, {
            conversationId: event.conversationId,
            eventDbId: eventRow.id,
            eventType: event.type,
            projectId: event.projectId,
            reason: "pending_tool_request_not_found",
            taskRunId: run.id,
          });
        }
        break;
      }
    }

    const [updatedExecution] = await tx
      .update(conversationExecutionStates)
      .set({
        ...executionChanges,
        revision: sql`${conversationExecutionStates.revision} + 1`,
      })
      .where(
        and(
          eq(conversationExecutionStates.id, execution.id),
          eq(conversationExecutionStates.projectId, event.projectId),
          eq(conversationExecutionStates.revision, execution.revision),
        ),
      )
      .returning();
    if (!updatedExecution) throw new ConversationalTaskRuntimeConflictError();

    const [updatedRun] = await tx
      .update(conversationalTaskRuns)
      .set({
        ...runChanges,
        revision: sql`${conversationalTaskRuns.revision} + 1`,
      })
      .where(
        and(
          eq(conversationalTaskRuns.id, run.id),
          eq(conversationalTaskRuns.projectId, event.projectId),
          eq(conversationalTaskRuns.revision, run.revision),
        ),
      )
      .returning();
    if (!updatedRun) throw new ConversationalTaskRuntimeConflictError();

    for (const [key, update] of fieldUpdates) {
      await tx
        .update(conversationalTaskFieldValues)
        .set({
          attemptCount: update.attemptCount,
          candidates: update.candidates,
          canonicalValue: update.canonicalValue,
          isRequired: update.isRequired,
          lastRequestedAt: update.lastRequestedAt,
          naturalValue: update.naturalValue,
          provenance: update.provenance,
          revision: update.revision,
          state: update.state,
          updatedAt: receivedAt,
          validatedAt: update.validatedAt,
          validation: update.validation,
        })
        .where(
          and(
            eq(conversationalTaskFieldValues.projectId, event.projectId),
            eq(conversationalTaskFieldValues.taskRunId, run.id),
            eq(conversationalTaskFieldValues.fieldKey, key),
          ),
        );
    }

    await tx
      .update(conversationInboundEvents)
      .set({
        appliedRevision: updatedExecution.revision,
        processedAt: receivedAt,
        status: "applied",
      })
      .where(eq(conversationInboundEvents.id, eventRow.id));
    await recordAudit(tx, {
      conversationId: event.conversationId,
      eventType: event.type,
      inboundEventId: eventRow.id,
      projectId: event.projectId,
      summary: safeEventSummary(event),
      taskRunId: run.id,
    });

    return {
      disposition: "applied",
      reason: null,
      revision: updatedExecution.revision,
      taskRunId: run.id,
    };
  });
}

export async function getConversationalTaskRuntime(input: {
  projectId: number;
  taskRunId: number;
}) {
  const [run] = await db
    .select()
    .from(conversationalTaskRuns)
    .where(
      and(
        eq(conversationalTaskRuns.projectId, input.projectId),
        eq(conversationalTaskRuns.id, input.taskRunId),
      ),
    )
    .limit(1);
  if (!run) return null;

  const [execution, fields, context, tools, audit] = await Promise.all([
    db
      .select()
      .from(conversationExecutionStates)
      .where(
        and(
          eq(conversationExecutionStates.projectId, input.projectId),
          eq(conversationExecutionStates.conversationId, run.conversationId),
        ),
      )
      .limit(1)
      .then(([row]) => row ?? null),
    db
      .select()
      .from(conversationalTaskFieldValues)
      .where(
        and(
          eq(conversationalTaskFieldValues.projectId, input.projectId),
          eq(conversationalTaskFieldValues.taskRunId, run.id),
        ),
      )
      .orderBy(asc(conversationalTaskFieldValues.id)),
    db
      .select()
      .from(conversationalTaskContextValues)
      .where(
        and(
          eq(conversationalTaskContextValues.projectId, input.projectId),
          eq(conversationalTaskContextValues.taskRunId, run.id),
        ),
      )
      .orderBy(asc(conversationalTaskContextValues.id)),
    db
      .select()
      .from(conversationalTaskToolRequests)
      .where(
        and(
          eq(conversationalTaskToolRequests.projectId, input.projectId),
          eq(conversationalTaskToolRequests.taskRunId, run.id),
        ),
      )
      .orderBy(desc(conversationalTaskToolRequests.requestedAt)),
    db
      .select()
      .from(conversationalTaskAuditEvents)
      .where(
        and(
          eq(conversationalTaskAuditEvents.projectId, input.projectId),
          eq(conversationalTaskAuditEvents.taskRunId, run.id),
        ),
      )
      .orderBy(asc(conversationalTaskAuditEvents.createdAt)),
  ]);

  return { audit, context, execution, fields, run, tools };
}

export async function exportConversationRuntimeData(input: {
  conversationId: number;
  projectId: number;
}) {
  const runs = await db
    .select()
    .from(conversationalTaskRuns)
    .where(
      and(
        eq(conversationalTaskRuns.projectId, input.projectId),
        eq(conversationalTaskRuns.conversationId, input.conversationId),
      ),
    )
    .orderBy(asc(conversationalTaskRuns.createdAt));
  const runIds = runs.map(({ id }) => id);
  const [execution, fields, context, tools, audit, messages] =
    await Promise.all([
      db
        .select()
        .from(conversationExecutionStates)
        .where(
          and(
            eq(conversationExecutionStates.projectId, input.projectId),
            eq(
              conversationExecutionStates.conversationId,
              input.conversationId,
            ),
          ),
        )
        .limit(1)
        .then(([row]) => row ?? null),
      runIds.length
        ? db
            .select()
            .from(conversationalTaskFieldValues)
            .where(
              and(
                eq(conversationalTaskFieldValues.projectId, input.projectId),
                inArray(conversationalTaskFieldValues.taskRunId, runIds),
              ),
            )
        : [],
      runIds.length
        ? db
            .select()
            .from(conversationalTaskContextValues)
            .where(
              and(
                eq(conversationalTaskContextValues.projectId, input.projectId),
                inArray(conversationalTaskContextValues.taskRunId, runIds),
              ),
            )
        : [],
      runIds.length
        ? db
            .select()
            .from(conversationalTaskToolRequests)
            .where(
              and(
                eq(conversationalTaskToolRequests.projectId, input.projectId),
                inArray(conversationalTaskToolRequests.taskRunId, runIds),
              ),
            )
        : [],
      db
        .select()
        .from(conversationalTaskAuditEvents)
        .where(
          and(
            eq(conversationalTaskAuditEvents.projectId, input.projectId),
            eq(
              conversationalTaskAuditEvents.conversationId,
              input.conversationId,
            ),
          ),
        ),
      db
        .select()
        .from(channelMessages)
        .where(
          and(
            eq(channelMessages.projectId, input.projectId),
            eq(channelMessages.conversationId, input.conversationId),
          ),
        ),
    ]);

  return { audit, context, execution, fields, messages, runs, tools };
}

export async function deleteConversationRuntimeData(input: {
  conversationId: number;
  includeMessages?: boolean;
  projectId: number;
}) {
  return db.transaction(async (tx) => {
    const runs = await tx
      .select({ id: conversationalTaskRuns.id })
      .from(conversationalTaskRuns)
      .where(
        and(
          eq(conversationalTaskRuns.projectId, input.projectId),
          eq(conversationalTaskRuns.conversationId, input.conversationId),
        ),
      );
    const runIds = runs.map(({ id }) => id);

    await tx
      .delete(conversationalTaskAuditEvents)
      .where(
        and(
          eq(conversationalTaskAuditEvents.projectId, input.projectId),
          eq(
            conversationalTaskAuditEvents.conversationId,
            input.conversationId,
          ),
        ),
      );
    await tx
      .delete(conversationInboundEvents)
      .where(
        and(
          eq(conversationInboundEvents.projectId, input.projectId),
          eq(conversationInboundEvents.conversationId, input.conversationId),
        ),
      );
    if (runIds.length > 0) {
      await tx
        .delete(conversationalTaskToolRequests)
        .where(
          and(
            eq(conversationalTaskToolRequests.projectId, input.projectId),
            inArray(conversationalTaskToolRequests.taskRunId, runIds),
          ),
        );
      await tx
        .delete(conversationalTaskContextValues)
        .where(
          and(
            eq(conversationalTaskContextValues.projectId, input.projectId),
            inArray(conversationalTaskContextValues.taskRunId, runIds),
          ),
        );
      await tx
        .delete(conversationalTaskFieldValues)
        .where(
          and(
            eq(conversationalTaskFieldValues.projectId, input.projectId),
            inArray(conversationalTaskFieldValues.taskRunId, runIds),
          ),
        );
    }
    await tx
      .delete(conversationExecutionStates)
      .where(
        and(
          eq(conversationExecutionStates.projectId, input.projectId),
          eq(conversationExecutionStates.conversationId, input.conversationId),
        ),
      );
    await tx
      .delete(conversationalTaskRuns)
      .where(
        and(
          eq(conversationalTaskRuns.projectId, input.projectId),
          eq(conversationalTaskRuns.conversationId, input.conversationId),
        ),
      );
    if (input.includeMessages) {
      await tx
        .delete(channelMessages)
        .where(
          and(
            eq(channelMessages.projectId, input.projectId),
            eq(channelMessages.conversationId, input.conversationId),
          ),
        );
    }
    return { deletedRuns: runIds.length };
  });
}

export async function cleanupExpiredConversationRuntime(input: {
  now?: Date;
  projectId: number;
}) {
  const now = input.now ?? new Date();
  const [policyRow] = await db
    .select({ definition: conversationProjectPolicies.definition })
    .from(conversationProjectPolicies)
    .where(eq(conversationProjectPolicies.projectId, input.projectId))
    .limit(1);
  const policy = normalizeConversationProjectPolicy(policyRow?.definition);
  const messageCutoff = addDays(now, -policy.dataHandling.messageRetentionDays);

  return db.transaction(async (tx) => {
    const expiredRuns = await tx
      .select({
        conversationId: conversationalTaskRuns.conversationId,
        id: conversationalTaskRuns.id,
      })
      .from(conversationalTaskRuns)
      .where(
        and(
          eq(conversationalTaskRuns.projectId, input.projectId),
          inArray(conversationalTaskRuns.status, [
            "active",
            "paused",
            "waiting",
            "handoff",
          ]),
          lte(conversationalTaskRuns.expiresAt, now),
        ),
      );
    const expiredRunIds = expiredRuns.map(({ id }) => id);
    if (expiredRunIds.length > 0) {
      await tx
        .update(conversationExecutionStates)
        .set({
          activeNodeId: null,
          activeTaskRunId: null,
          activeTaskVersionId: null,
          executionMode: "knowledge",
          responseOwner: "knowledge",
          revision: sql`${conversationExecutionStates.revision} + 1`,
          suspendedReturnTarget: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(conversationExecutionStates.projectId, input.projectId),
            inArray(conversationExecutionStates.activeTaskRunId, expiredRunIds),
          ),
        );
      await tx
        .update(conversationalTaskRuns)
        .set({
          abandonedAt: now,
          revision: sql`${conversationalTaskRuns.revision} + 1`,
          status: "abandoned",
          updatedAt: now,
        })
        .where(
          and(
            eq(conversationalTaskRuns.projectId, input.projectId),
            inArray(conversationalTaskRuns.id, expiredRunIds),
          ),
        );
      await tx.insert(conversationalTaskAuditEvents).values(
        expiredRuns.map((run) => ({
          conversationId: run.conversationId,
          eventType: "task.abandoned",
          projectId: input.projectId,
          summary: { reason: "retention_expired" },
          taskRunId: run.id,
        })),
      );
    }

    const expiredFields = await tx
      .delete(conversationalTaskFieldValues)
      .where(
        and(
          eq(conversationalTaskFieldValues.projectId, input.projectId),
          lte(conversationalTaskFieldValues.expiresAt, now),
        ),
      )
      .returning({ id: conversationalTaskFieldValues.id });
    const expiredContext = await tx
      .delete(conversationalTaskContextValues)
      .where(
        and(
          eq(conversationalTaskContextValues.projectId, input.projectId),
          lte(conversationalTaskContextValues.expiresAt, now),
        ),
      )
      .returning({ id: conversationalTaskContextValues.id });
    const expiredMessages = await tx
      .delete(channelMessages)
      .where(
        and(
          eq(channelMessages.projectId, input.projectId),
          lte(channelMessages.createdAt, messageCutoff),
        ),
      )
      .returning({ id: channelMessages.id });
    const timedOutTools = await tx
      .update(conversationalTaskToolRequests)
      .set({
        completedAt: now,
        errorCode: "timeout",
        status: "timed_out",
        updatedAt: now,
      })
      .where(
        and(
          eq(conversationalTaskToolRequests.projectId, input.projectId),
          eq(conversationalTaskToolRequests.status, "pending"),
          lte(conversationalTaskToolRequests.timeoutAt, now),
        ),
      )
      .returning({ id: conversationalTaskToolRequests.id });
    const expiredSessions = await tx
      .update(conversationExecutionStates)
      .set({
        status: "session_expired",
        updatedAt: now,
      })
      .where(
        and(
          eq(conversationExecutionStates.projectId, input.projectId),
          lte(conversationExecutionStates.sessionExpiresAt, now),
          or(
            isNull(conversationExecutionStates.status),
            eq(conversationExecutionStates.status, "active"),
          ),
        ),
      )
      .returning({ id: conversationExecutionStates.id });

    return {
      abandonedRuns: expiredRunIds.length,
      expiredContext: expiredContext.length,
      expiredFields: expiredFields.length,
      expiredMessages: expiredMessages.length,
      expiredSessions: expiredSessions.length,
      timedOutTools: timedOutTools.length,
    };
  });
}
