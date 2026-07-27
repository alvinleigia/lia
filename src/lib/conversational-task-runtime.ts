import { createHash } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  type ConversationalTaskDefinitionV1,
  conversationalTaskSnapshotV1Schema,
  type ToolDefinitionV1,
  type ToolResultMappingV1,
} from "@/lib/conversation-contracts";
import {
  applyFieldCandidates,
  clearRuntimeField,
  initializeRuntimeTaskFields,
  type RuntimeTaskField,
  resetRuntimeFields,
} from "@/lib/conversational-task-field-state";
import { canonicalizeFieldCandidates } from "@/lib/conversational-task-field-validation";
import { resolveProjectTaskResource } from "@/lib/conversational-task-project-resources";
import {
  type FieldCandidateV1,
  type InboundEventInputV1,
  type InboundEventV1,
  inboundEventV1Schema,
  type StartConversationalTaskRunInputV1,
  type StartConversationalTaskRunV1,
  type SwitchConversationalTaskRunV1,
  startConversationalTaskRunV1Schema,
  switchConversationalTaskRunV1Schema,
  type TaskFieldState,
} from "@/lib/conversational-task-runtime-contracts";
import {
  buildCanonicalToolInput,
  validateToolResultPayload,
} from "@/lib/conversational-task-tool-runtime";
import { executeBuiltInTaskTool } from "@/lib/conversational-task-tools";
import { db } from "@/lib/db-config";
import {
  actionFlowVersions,
  channelConversations,
  contacts,
  conversationalTaskAuditEvents,
  conversationalTaskConfirmations,
  conversationalTaskContextValues,
  conversationalTaskFieldValues,
  conversationalTaskRuns,
  conversationalTasks,
  conversationalTaskToolRequests,
  conversationalTaskVersions,
  conversationExecutionStates,
  conversationInboundEvents,
  users,
} from "@/lib/db-schema";
import {
  compiledHybridFlowGraphV1Schema,
  parseHybridGraphTaskReturnTarget,
  sideQuestionReturnTargetV1Schema,
  taskSuspensionReturnTargetV1Schema,
} from "@/lib/hybrid-flow-contracts";
import {
  buildHybridGraphTaskReturnTarget,
  resolveHybridTaskOutcomeResume,
} from "@/lib/hybrid-flow-runtime";

export {
  cleanupExpiredConversationRuntime,
  deleteConversationRuntimeData,
  exportConversationRuntimeData,
  getConversationalTaskRuntime,
} from "@/lib/conversational-task-runtime-data";

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

async function runRuntimeTransaction(
  taskRunId: number | null,
  operation: (
    transaction: RuntimeTransaction,
  ) => Promise<ConversationalTaskRuntimeResult>,
) {
  try {
    return await db.transaction(operation);
  } catch (error) {
    if (error instanceof ConversationalTaskRuntimeConflictError) {
      return {
        disposition: "conflict" as const,
        reason: "revision_conflict",
        revision: null,
        taskRunId,
      };
    }
    throw error;
  }
}

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

function childEventId(eventId: string, suffix: string) {
  const value = `${eventId}:${suffix}`;
  return value.length <= 160
    ? value
    : `${eventId.slice(0, 80)}:${hashPayload(value)}`;
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
    case "task.fail":
      return { outcomeKey: event.outcomeKey, reason: event.reason };
    case "task.handoff":
      return { outcomeKey: event.outcomeKey, reason: event.reason };
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

type RuntimeContextValue = {
  expiresAt: Date | null;
  value: unknown;
};

function mappingExpiry(
  now: Date,
  freshnessMinutes: number | null,
  runExpiresAt: Date | null,
) {
  if (!freshnessMinutes) return runExpiresAt;
  const freshnessExpiry = addMinutes(now, freshnessMinutes);
  return runExpiresAt && runExpiresAt < freshnessExpiry
    ? runExpiresAt
    : freshnessExpiry;
}

async function applyToolResultMappings(
  tx: RuntimeTransaction,
  input: {
    contextValues: Map<string, unknown>;
    definition: ConversationalTaskDefinitionV1;
    eventId: string;
    fields: Map<string, RuntimeTaskField>;
    mappings: Array<{ mapping: ToolResultMappingV1; value: unknown }>;
    now: Date;
    projectId: number;
    runExpiresAt: Date | null;
    taskRunId: number;
    toolRequestId: string;
  },
) {
  const definitionFields = new Map(
    input.definition.fields.map((field) => [field.key, field]),
  );
  const definitionContext = new Map(
    input.definition.contextVariables.map((variable) => [
      variable.key,
      variable,
    ]),
  );
  const fieldCandidates: FieldCandidateV1[] = [];

  for (const { mapping, value } of input.mappings) {
    if (mapping.target === "field") {
      const field = definitionFields.get(mapping.targetKey);
      if (
        !field ||
        field.type !== mapping.type ||
        !field.sourcePriority.includes("tool")
      ) {
        return {
          error: "tool_result_mapping_not_allowed",
          updates: new Map<string, RuntimeTaskField>(),
        };
      }
      fieldCandidates.push({
        fieldKey: mapping.targetKey,
        naturalValue: value,
        provenance: {
          source: "tool" as const,
          sourceReference: input.toolRequestId,
        },
        state: "candidate" as const,
        validation: { code: null, message: null, valid: false },
      });
      continue;
    }

    const context = definitionContext.get(mapping.targetKey);
    if (context && context.type !== mapping.type) {
      return {
        error: "tool_result_mapping_not_allowed",
        updates: new Map<string, RuntimeTaskField>(),
      };
    }
  }

  const canonicalCandidates =
    fieldCandidates.length > 0
      ? await canonicalizeFieldCandidates({
          candidates: fieldCandidates,
          contextValues: input.contextValues,
          definition: input.definition,
          fieldValues: new Map(
            [...input.fields].map(([key, field]) => [
              key,
              field.canonicalValue,
            ]),
          ),
          projectId: input.projectId,
          resolveProjectResource: resolveProjectTaskResource,
        })
      : [];
  if (canonicalCandidates.some(({ state }) => state === "invalid")) {
    return {
      error: "tool_result_mapping_invalid",
      updates: new Map<string, RuntimeTaskField>(),
    };
  }

  for (const { mapping, value } of input.mappings) {
    if (mapping.target !== "context") continue;
    const context = definitionContext.get(mapping.targetKey);
    const expiresAt = mappingExpiry(
      input.now,
      mapping.freshnessMinutes,
      input.runExpiresAt,
    );
    await tx
      .insert(conversationalTaskContextValues)
      .values({
        expiresAt,
        key: mapping.targetKey,
        modelVisible: mapping.modelVisible,
        projectId: input.projectId,
        sensitivity: context?.sensitivity ?? "standard",
        source: "tool",
        taskRunId: input.taskRunId,
        toolVisible: mapping.toolVisible,
        type: mapping.type,
        value,
      })
      .onConflictDoUpdate({
        target: [
          conversationalTaskContextValues.taskRunId,
          conversationalTaskContextValues.key,
        ],
        set: {
          expiresAt,
          modelVisible: mapping.modelVisible,
          sensitivity: context?.sensitivity ?? "standard",
          source: "tool",
          toolVisible: mapping.toolVisible,
          type: mapping.type,
          updatedAt: input.now,
          value,
        },
      });
    input.contextValues.set(mapping.targetKey, value);
  }

  const updates =
    canonicalCandidates.length > 0
      ? applyFieldCandidates({
          candidates: canonicalCandidates,
          definition: input.definition,
          eventId: input.eventId,
          fields: input.fields,
          now: input.now,
        }).updates
      : new Map<string, RuntimeTaskField>();

  return { error: null, updates };
}

async function invalidateToolResultMappings(
  tx: RuntimeTransaction,
  input: {
    definition: ConversationalTaskDefinitionV1;
    eventId: string;
    fields: Map<string, RuntimeTaskField>;
    mappings: ToolResultMappingV1[];
    now: Date;
    projectId: number;
    taskRunId: number;
  },
) {
  const contextKeys = [
    ...new Set(
      input.mappings
        .filter((mapping) => mapping.target === "context")
        .map((mapping) => mapping.targetKey),
    ),
  ];
  if (contextKeys.length > 0) {
    await tx
      .delete(conversationalTaskContextValues)
      .where(
        and(
          eq(conversationalTaskContextValues.projectId, input.projectId),
          eq(conversationalTaskContextValues.taskRunId, input.taskRunId),
          inArray(conversationalTaskContextValues.key, contextKeys),
          eq(conversationalTaskContextValues.source, "tool"),
        ),
      );
  }

  let fields = input.fields;
  const updates = new Map<string, RuntimeTaskField>();
  for (const mapping of input.mappings) {
    if (mapping.target !== "field") continue;
    const current = fields.get(mapping.targetKey);
    if (current?.provenance.source !== "tool") continue;
    const cleared = clearRuntimeField({
      definition: input.definition,
      eventId: input.eventId,
      fieldKey: mapping.targetKey,
      fields,
      now: input.now,
      reason: "tool_result_stale",
    });
    fields = cleared.fields;
    for (const [key, value] of cleared.updates) updates.set(key, value);
  }
  return updates;
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
  input: StartConversationalTaskRunInputV1,
): Promise<ConversationalTaskRuntimeResult> {
  const parsed = startConversationalTaskRunV1Schema.parse(input);
  const eventHash = hashPayload(parsed);
  const occurredAt = new Date(parsed.occurredAt);
  const receivedAt = new Date(parsed.receivedAt);

  return runRuntimeTransaction(null, async (tx) => {
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
      .select({
        id: conversationalTasks.id,
        isArchived: conversationalTasks.isArchived,
      })
      .from(conversationalTasks)
      .where(
        and(
          eq(conversationalTasks.id, parsed.taskId),
          eq(conversationalTasks.projectId, parsed.projectId),
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
              ...(parsed.taskVersionId
                ? [eq(conversationalTaskVersions.id, parsed.taskVersionId)]
                : []),
            ),
          )
          .orderBy(desc(conversationalTaskVersions.versionNumber))
          .limit(1)
      : [];
    if (!task || (!parsed.taskVersionId && task.isArchived) || !version) {
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
    if (parsed.returnTarget) {
      const [actionVersion] = await tx
        .select({ snapshot: actionFlowVersions.snapshot })
        .from(actionFlowVersions)
        .where(
          and(
            eq(actionFlowVersions.projectId, parsed.projectId),
            eq(actionFlowVersions.id, parsed.returnTarget.actionVersionId),
            eq(actionFlowVersions.status, "published"),
          ),
        )
        .limit(1);
      const actionSnapshot =
        actionVersion?.snapshot &&
        typeof actionVersion.snapshot === "object" &&
        !Array.isArray(actionVersion.snapshot)
          ? (actionVersion.snapshot as Record<string, unknown>)
          : null;
      const graph = compiledHybridFlowGraphV1Schema.safeParse(
        actionSnapshot?.hybridGraph,
      );
      const expectedTarget = graph.success
        ? buildHybridGraphTaskReturnTarget({
            actionVersionId: parsed.returnTarget.actionVersionId,
            graph: graph.data,
            taskNodeId: parsed.returnTarget.taskNodeId,
          })
        : null;
      const taskNodeCandidate = graph.success
        ? graph.data.nodes.find(
            (node) => node.id === parsed.returnTarget?.taskNodeId,
          )
        : null;
      const taskNode =
        taskNodeCandidate?.kind === "conversational_task"
          ? taskNodeCandidate
          : null;
      if (
        !expectedTarget ||
        !taskNode ||
        taskNode.settings.task.taskId !== parsed.taskId ||
        taskNode.settings.task.taskVersionId !== version.id ||
        JSON.stringify(expectedTarget) !== JSON.stringify(parsed.returnTarget)
      ) {
        return quarantineEvent(tx, {
          conversationId: parsed.conversationId,
          eventDbId: eventRow.id,
          eventType: "task.started",
          projectId: parsed.projectId,
          reason: "hybrid_task_return_target_invalid",
          taskRunId: null,
        });
      }
    }

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
    if (
      parsed.providerSequence !== null &&
      execution.lastProviderSequence !== null &&
      parsed.providerSequence <= execution.lastProviderSequence
    ) {
      return quarantineEvent(tx, {
        conversationId: parsed.conversationId,
        eventDbId: eventRow.id,
        eventType: "task.started",
        projectId: parsed.projectId,
        reason: "out_of_order_provider_sequence",
        taskRunId: execution.activeTaskRunId,
      });
    }
    if (
      parsed.providerSequence === null &&
      execution.lastEventOccurredAt &&
      occurredAt < execution.lastEventOccurredAt
    ) {
      return quarantineEvent(tx, {
        conversationId: parsed.conversationId,
        eventDbId: eventRow.id,
        eventType: "task.started",
        projectId: parsed.projectId,
        reason: "out_of_order_occurred_at",
        taskRunId: execution.activeTaskRunId,
      });
    }
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
        suspendedReturnTarget: parsed.returnTarget,
      })
      .returning();
    if (!run) throw new ConversationalTaskRuntimeConflictError();

    const runtimeFields = initializeRuntimeTaskFields({
      expiresAt,
      snapshot,
    });
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
        activeActionVersionId:
          parsed.returnTarget?.actionVersionId ??
          execution.activeActionVersionId,
        activeNodeId: parsed.activeNodeId,
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
        lastProviderSequence:
          parsed.providerSequence ?? execution.lastProviderSequence,
        responseOwner: "task",
        revision: sql`${conversationExecutionStates.revision} + 1`,
        sessionExpiresAt: parsed.sessionExpiresAt
          ? new Date(parsed.sessionExpiresAt)
          : null,
        sessionId: parsed.sessionId,
        status: "active",
        suspendedReturnTarget: parsed.returnTarget,
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
        actionVersionId: parsed.returnTarget?.actionVersionId ?? null,
        activeNodeId: parsed.activeNodeId,
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

export async function switchConversationalTaskRun(
  input: SwitchConversationalTaskRunV1,
) {
  const parsed = switchConversationalTaskRunV1Schema.parse(input);
  const [targetVersion] = await db
    .select({ id: conversationalTaskVersions.id })
    .from(conversationalTaskVersions)
    .innerJoin(
      conversationalTasks,
      and(
        eq(conversationalTasks.id, conversationalTaskVersions.taskId),
        eq(conversationalTasks.projectId, conversationalTaskVersions.projectId),
      ),
    )
    .where(
      and(
        eq(conversationalTaskVersions.projectId, parsed.projectId),
        eq(conversationalTaskVersions.taskId, parsed.targetTaskId),
        eq(conversationalTasks.isArchived, false),
      ),
    )
    .orderBy(desc(conversationalTaskVersions.versionNumber))
    .limit(1);
  if (!targetVersion) {
    throw new Error("The target task has no published version.");
  }

  const [execution] = await db
    .select()
    .from(conversationExecutionStates)
    .where(
      and(
        eq(conversationExecutionStates.projectId, parsed.projectId),
        eq(conversationExecutionStates.conversationId, parsed.conversationId),
        eq(
          conversationExecutionStates.activeTaskRunId,
          parsed.currentTaskRunId,
        ),
      ),
    )
    .limit(1);
  if (!execution) {
    throw new Error("The current task is not active for this conversation.");
  }

  const cancel = await applyConversationalTaskEvent({
    authentication: null,
    channelIdentity: parsed.channelIdentity,
    channelType: parsed.channelType,
    conversationId: parsed.conversationId,
    eventId: childEventId(parsed.eventId, "cancel"),
    expectedRevision: execution.revision,
    occurredAt: parsed.occurredAt,
    projectId: parsed.projectId,
    providerSequence: null,
    receivedAt: parsed.receivedAt,
    schemaVersion: 1,
    taskRunId: parsed.currentTaskRunId,
    type: "task.cancel",
    outcomeKey: null,
  });
  if (
    cancel.disposition === "conflict" ||
    cancel.disposition === "quarantined"
  ) {
    return { cancel, start: null };
  }

  const [identity] = await db
    .select()
    .from(conversationExecutionStates)
    .where(
      and(
        eq(conversationExecutionStates.projectId, parsed.projectId),
        eq(conversationExecutionStates.conversationId, parsed.conversationId),
      ),
    )
    .limit(1);
  if (!identity) {
    throw new ConversationalTaskRuntimeConflictError();
  }
  const start = await startConversationalTaskRun({
    anonymousVisitorId: identity.anonymousVisitorId,
    authenticatedUserId: identity.authenticatedUserId,
    channelIdentity: parsed.channelIdentity,
    channelType: parsed.channelType,
    conversationId: parsed.conversationId,
    eventId: childEventId(parsed.eventId, "start"),
    identityKind: identity.identityKind as
      | "anonymous"
      | "authenticated_user"
      | "verified_contact",
    initializationContext: parsed.initializationContext,
    occurredAt: parsed.occurredAt,
    projectId: parsed.projectId,
    providerSequence: null,
    receivedAt: parsed.receivedAt,
    sessionExpiresAt: identity.sessionExpiresAt?.toISOString() ?? null,
    sessionId: identity.sessionId,
    taskId: parsed.targetTaskId,
    verifiedContactId: identity.verifiedContactId,
  });

  return { cancel, start };
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

function eventAllowedForRunStatus(event: InboundEventV1, runStatus: string) {
  if (runStatus !== "paused" && runStatus !== "waiting") {
    return true;
  }

  return [
    "session.rotate",
    "task.cancel",
    "task.fail",
    "task.handoff",
    "task.restart",
    "task.resume",
    "tool.result",
  ].includes(event.type);
}

async function completeSynchronousBuiltInToolRequest(input: {
  event: Extract<InboundEventV1, { type: "tool.requested" }>;
  expectedRevision: number;
}) {
  if (!input.event.taskRunId) return null;
  const [request] = await db
    .select()
    .from(conversationalTaskToolRequests)
    .where(
      and(
        eq(conversationalTaskToolRequests.projectId, input.event.projectId),
        eq(conversationalTaskToolRequests.taskRunId, input.event.taskRunId),
        eq(conversationalTaskToolRequests.requestId, input.event.requestId),
        eq(conversationalTaskToolRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (!request) return null;

  const [version] = await db
    .select()
    .from(conversationalTaskVersions)
    .where(
      and(
        eq(conversationalTaskVersions.projectId, input.event.projectId),
        eq(conversationalTaskVersions.id, request.taskVersionId),
      ),
    )
    .limit(1);
  if (!version) return null;

  const snapshot = conversationalTaskSnapshotV1Schema.parse(version.snapshot);
  const binding = snapshot.task.definition.tools.find(
    (candidate) => candidate.tool.id === request.toolId,
  );
  const definition =
    snapshot.toolDefinitions.find(
      (candidate) =>
        candidate.id === request.toolId &&
        candidate.version === binding?.tool.version &&
        candidate.projectId === input.event.projectId,
    ) ?? null;
  if (
    !definition ||
    definition.execution.adapter !== "built_in" ||
    definition.execution.mode !== "synchronous"
  ) {
    return null;
  }

  let result: Awaited<ReturnType<typeof executeBuiltInTaskTool>>;
  try {
    result = await executeBuiltInTaskTool({
      definition,
      projectId: input.event.projectId,
      toolInput: request.input,
    });
  } catch {
    result = {
      errorCode: "built_in_tool_failed",
      result: null,
      status: "provider_failure",
    };
  }

  const now = new Date(input.event.receivedAt);
  return applyConversationalTaskEvent({
    authentication: {
      keyId: null,
      kind: "api_key",
      principal: "lia-built-in-tool",
      verifiedAt: now.toISOString(),
    },
    channelIdentity: input.event.channelIdentity,
    channelType: input.event.channelType,
    conversationId: input.event.conversationId,
    errorCode: result.errorCode,
    eventId: childEventId(input.event.eventId, "result"),
    expectedRevision: input.expectedRevision,
    occurredAt: now.toISOString(),
    projectId: input.event.projectId,
    providerSequence: null,
    receivedAt: now.toISOString(),
    requestId: input.event.requestId,
    result: result.result,
    schemaVersion: 1,
    status: result.status,
    taskRunId: input.event.taskRunId,
    type: "tool.result",
  });
}

export async function applyConversationalTaskEvent(
  input: InboundEventInputV1,
): Promise<ConversationalTaskRuntimeResult> {
  const event = inboundEventV1Schema.parse(input);
  const eventHash = hashPayload(event);
  const occurredAt = new Date(event.occurredAt);
  const receivedAt = new Date(event.receivedAt);

  const applied = await runRuntimeTransaction(event.taskRunId, async (tx) => {
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
    if (!eventAllowedForRunStatus(event, run.status)) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "task_not_active",
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
    const contextRows = await tx
      .select()
      .from(conversationalTaskContextValues)
      .where(
        and(
          eq(conversationalTaskContextValues.projectId, event.projectId),
          eq(conversationalTaskContextValues.taskRunId, run.id),
        ),
      );
    const contextValues = new Map(
      contextRows.map((row) => [row.key, row.value]),
    );
    const toolContext = new Map<string, RuntimeContextValue>(
      contextRows.map((row) => [
        row.key,
        { expiresAt: row.expiresAt, value: row.value },
      ]),
    );
    const fieldValues = new Map(
      [...fields].map(([key, field]) => [key, field.canonicalValue]),
    );

    if (
      event.type === "field.candidates" ||
      event.type === "field.clear" ||
      event.type === "task.restart"
    ) {
      const [inFlightConfirmation] = await tx
        .select({ id: conversationalTaskConfirmations.id })
        .from(conversationalTaskConfirmations)
        .where(
          and(
            eq(conversationalTaskConfirmations.projectId, event.projectId),
            eq(conversationalTaskConfirmations.taskRunId, run.id),
            inArray(conversationalTaskConfirmations.status, [
              "executing",
              "outcome_unknown",
            ]),
          ),
        )
        .limit(1);
      if (inFlightConfirmation) {
        return quarantineEvent(tx, {
          conversationId: event.conversationId,
          eventDbId: eventRow.id,
          eventType: event.type,
          projectId: event.projectId,
          reason: "operation_reconciliation_required",
          taskRunId: run.id,
        });
      }
    }

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
      event.type === "task.complete" &&
      snapshot.toolDefinitions.some(
        ({ access, requiredForCompletion }) =>
          access === "write" && requiredForCompletion,
      ) &&
      snapshot.task.definition.fields.some((definition) => {
        const field = fields.get(definition.key);
        return (
          definition.confirmation !== "never" &&
          field?.canonicalValue !== null &&
          field?.canonicalValue !== undefined &&
          field.state !== "confirmed"
        );
      })
    ) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "confirmation_required",
        taskRunId: run.id,
      });
    }
    if (
      event.type === "task.complete" &&
      [...fields.values()].some(
        (field) =>
          field.isRequired &&
          field.state !== "valid" &&
          field.state !== "confirmed",
      )
    ) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "required_fields_incomplete",
        taskRunId: run.id,
      });
    }
    if (event.type === "task.complete") {
      const requiredToolIds = snapshot.toolDefinitions
        .filter(({ requiredForCompletion }) => requiredForCompletion)
        .map(({ id }) => id);
      if (requiredToolIds.length > 0) {
        const completedToolRequests = await tx
          .select({
            status: conversationalTaskToolRequests.status,
            toolId: conversationalTaskToolRequests.toolId,
          })
          .from(conversationalTaskToolRequests)
          .where(
            and(
              eq(conversationalTaskToolRequests.projectId, event.projectId),
              eq(conversationalTaskToolRequests.taskRunId, run.id),
            ),
          );
        const successfulToolIds = new Set(
          completedToolRequests
            .filter(({ status }) => status === "success")
            .map(({ toolId }) => toolId),
        );
        if (requiredToolIds.some((toolId) => !successfulToolIds.has(toolId))) {
          return quarantineEvent(tx, {
            conversationId: event.conversationId,
            eventDbId: eventRow.id,
            eventType: event.type,
            projectId: event.projectId,
            reason: "required_tools_incomplete",
            taskRunId: run.id,
          });
        }
      }
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
      event.type === "task.fail" &&
      !snapshot.task.definition.outcomes.some(
        (outcome) =>
          outcome.key === event.outcomeKey && outcome.type === "failed",
      )
    ) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "failed_outcome_not_found",
        taskRunId: run.id,
      });
    }
    if (
      event.type === "task.handoff" &&
      event.outcomeKey &&
      !snapshot.task.definition.outcomes.some(
        (outcome) =>
          outcome.key === event.outcomeKey && outcome.type === "handoff",
      )
    ) {
      return quarantineEvent(tx, {
        conversationId: event.conversationId,
        eventDbId: eventRow.id,
        eventType: event.type,
        projectId: event.projectId,
        reason: "handoff_outcome_not_found",
        taskRunId: run.id,
      });
    }
    let requestedToolDefinition: ToolDefinitionV1 | null = null;
    let requestedToolInput: Record<string, unknown> | null = null;
    if (event.type === "tool.requested") {
      const binding = snapshot.task.definition.tools.find(
        (candidate) => candidate.tool.id === event.toolId,
      );
      requestedToolDefinition =
        snapshot.toolDefinitions.find(
          (definition) =>
            definition.id === event.toolId &&
            definition.version === binding?.tool.version,
        ) ?? null;
      if (
        !binding ||
        !requestedToolDefinition ||
        requestedToolDefinition.projectId !== event.projectId ||
        requestedToolDefinition.access !== binding.access ||
        !binding.allowedStages.includes(event.stage) ||
        requestedToolDefinition.execution.mode !== event.requestMode
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
      const canonicalInput = buildCanonicalToolInput({
        context: toolContext,
        definition: requestedToolDefinition,
        fields,
        now: receivedAt,
        proposedInput: event.input,
      });
      if (!canonicalInput.ok) {
        return quarantineEvent(tx, {
          conversationId: event.conversationId,
          eventDbId: eventRow.id,
          eventType: event.type,
          projectId: event.projectId,
          reason: canonicalInput.error.code,
          taskRunId: run.id,
        });
      }
      requestedToolInput = canonicalInput.input;
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
    let auditSummary: Record<string, unknown> = safeEventSummary(event);
    const graphReturnTarget =
      parseHybridGraphTaskReturnTarget(execution.suspendedReturnTarget) ??
      parseHybridGraphTaskReturnTarget(run.suspendedReturnTarget);

    function applyGraphOutcomeRoute(input: {
      eventType: "cancelled" | "completed" | "failed" | "handoff";
      outcomeKey: string | null;
    }) {
      const resume = resolveHybridTaskOutcomeResume({
        ...input,
        outcomes: snapshot.task.definition.outcomes,
        returnTarget: graphReturnTarget,
      });
      if (!resume) {
        return false;
      }

      runChanges.suspendedReturnTarget = null;
      executionChanges.activeActionVersionId = resume.actionVersionId;
      executionChanges.activeNodeId = resume.nodeId;
      executionChanges.activeTaskRunId = null;
      executionChanges.activeTaskVersionId = null;
      executionChanges.executionMode = resume.responseOwner;
      executionChanges.responseOwner = resume.responseOwner;
      executionChanges.status = resume.status;
      executionChanges.suspendedReturnTarget = null;
      return true;
    }

    switch (event.type) {
      case "field.candidates": {
        const canonicalCandidates = await canonicalizeFieldCandidates({
          candidates: event.candidates,
          contextValues,
          definition: snapshot.task.definition,
          fieldValues,
          projectId: event.projectId,
          resolveProjectResource: resolveProjectTaskResource,
        });
        const result = applyFieldCandidates({
          candidates: canonicalCandidates,
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
        runChanges.suspendedReturnTarget = graphReturnTarget
          ? taskSuspensionReturnTargetV1Schema.parse({
              boundaryReturnTarget: event.returnTarget,
              graphReturnTarget,
              kind: "task_suspension",
              schemaVersion: 1,
            })
          : event.returnTarget;
        executionChanges.suspendedReturnTarget =
          runChanges.suspendedReturnTarget;
        break;
      case "task.resume":
        runChanges.pausedAt = null;
        runChanges.resumeAt = null;
        runChanges.status = "active";
        runChanges.suspendedReturnTarget = graphReturnTarget;
        executionChanges.executionMode = "task";
        executionChanges.responseOwner = "task";
        executionChanges.suspendedReturnTarget = graphReturnTarget;
        break;
      case "task.cancel": {
        const returnMode = snapshot.task.definition.returnPolicy.cancelled;
        runChanges.cancelledAt = receivedAt;
        runChanges.outcomeKey = event.outcomeKey ?? "cancelled";
        runChanges.status = "cancelled";
        if (
          applyGraphOutcomeRoute({
            eventType: "cancelled",
            outcomeKey: event.outcomeKey,
          })
        ) {
          break;
        }
        executionChanges.activeNodeId = null;
        executionChanges.activeActionVersionId = null;
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
        executionChanges.suspendedReturnTarget = graphReturnTarget;
        break;
      case "task.complete": {
        const returnMode = snapshot.task.definition.returnPolicy.completed;
        runChanges.completedAt = receivedAt;
        runChanges.outcomeKey = event.outcomeKey;
        runChanges.status = "completed";
        if (
          applyGraphOutcomeRoute({
            eventType: "completed",
            outcomeKey: event.outcomeKey,
          })
        ) {
          break;
        }
        executionChanges.activeNodeId = null;
        executionChanges.activeActionVersionId = null;
        executionChanges.activeTaskRunId = null;
        executionChanges.activeTaskVersionId = null;
        executionChanges.executionMode = "knowledge";
        executionChanges.responseOwner = "knowledge";
        executionChanges.status = returnMode === "end" ? "closed" : "active";
        executionChanges.suspendedReturnTarget = null;
        break;
      }
      case "task.fail": {
        const returnMode = snapshot.task.definition.returnPolicy.failed;
        runChanges.completedAt = receivedAt;
        runChanges.outcomeKey = event.outcomeKey;
        runChanges.status = returnMode === "handoff" ? "handoff" : "completed";
        if (
          applyGraphOutcomeRoute({
            eventType: "failed",
            outcomeKey: event.outcomeKey,
          })
        ) {
          runChanges.status = "completed";
          break;
        }
        executionChanges.activeNodeId = null;
        executionChanges.activeActionVersionId = null;
        executionChanges.executionMode =
          returnMode === "handoff" ? "human" : "knowledge";
        executionChanges.responseOwner =
          returnMode === "handoff" ? "human" : "knowledge";
        executionChanges.status = returnMode === "end" ? "closed" : "active";
        executionChanges.suspendedReturnTarget =
          returnMode === "handoff"
            ? { outcomeKey: event.outcomeKey, reason: event.reason }
            : null;
        if (returnMode !== "handoff") {
          executionChanges.activeTaskRunId = null;
          executionChanges.activeTaskVersionId = null;
        }
        break;
      }
      case "task.handoff":
        runChanges.outcomeKey = event.outcomeKey;
        runChanges.status = "handoff";
        if (
          applyGraphOutcomeRoute({
            eventType: "handoff",
            outcomeKey: event.outcomeKey,
          })
        ) {
          runChanges.completedAt = receivedAt;
          runChanges.status = "completed";
          break;
        }
        runChanges.suspendedReturnTarget = {
          outcomeKey: event.outcomeKey,
          reason: event.reason,
        };
        executionChanges.executionMode = "human";
        executionChanges.responseOwner = "human";
        executionChanges.activeActionVersionId = null;
        executionChanges.suspendedReturnTarget = {
          outcomeKey: event.outcomeKey,
          reason: event.reason,
        };
        break;
      case "task.side_question": {
        const returnTarget = sideQuestionReturnTargetV1Schema.parse({
          graphReturnTarget,
          lastRequestedFieldKey: run.lastRequestedFieldKey,
          kind: "task_side_question",
          schemaVersion: 1,
          taskRunId: run.id,
        });
        runChanges.suspendedReturnTarget = returnTarget;
        executionChanges.executionMode = "knowledge";
        executionChanges.responseOwner = "knowledge";
        executionChanges.suspendedReturnTarget = returnTarget;
        break;
      }
      case "task.side_question_resolved": {
        const returnTarget = sideQuestionReturnTargetV1Schema.safeParse(
          execution.suspendedReturnTarget,
        );
        if (!returnTarget.success) {
          return quarantineEvent(tx, {
            conversationId: event.conversationId,
            eventDbId: eventRow.id,
            eventType: event.type,
            projectId: event.projectId,
            reason: "return_target_not_found",
            taskRunId: run.id,
          });
        }
        runChanges.suspendedReturnTarget = returnTarget.data.graphReturnTarget;
        executionChanges.executionMode = "task";
        executionChanges.responseOwner = "task";
        executionChanges.suspendedReturnTarget =
          returnTarget.data.graphReturnTarget;
        break;
      }
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
          if (!requestedToolDefinition || !requestedToolInput) {
            return quarantineEvent(tx, {
              conversationId: event.conversationId,
              eventDbId: eventRow.id,
              eventType: event.type,
              projectId: event.projectId,
              reason: "pinned_tool_definition_not_found",
              taskRunId: run.id,
            });
          }
          const timeoutAt = new Date(
            receivedAt.getTime() + requestedToolDefinition.execution.timeoutMs,
          );
          const [createdRequest] = await tx
            .insert(conversationalTaskToolRequests)
            .values({
              idempotencyKey: event.idempotencyKey,
              input: requestedToolInput,
              projectId: event.projectId,
              requestId: event.requestId,
              requestMode: requestedToolDefinition.execution.mode,
              stage: event.stage,
              taskRunId: run.id,
              taskVersionId: version.id,
              timeoutAt,
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
            status: "processing",
            updatedAt: receivedAt,
          })
          .where(
            and(
              eq(conversationalTaskToolRequests.projectId, event.projectId),
              eq(conversationalTaskToolRequests.taskRunId, run.id),
              eq(conversationalTaskToolRequests.requestId, event.requestId),
              inArray(conversationalTaskToolRequests.status, [
                "pending",
                "outcome_unknown",
              ]),
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
        const binding = snapshot.task.definition.tools.find(
          (candidate) => candidate.tool.id === request.toolId,
        );
        const definition =
          snapshot.toolDefinitions.find(
            (candidate) =>
              candidate.id === request.toolId &&
              candidate.version === binding?.tool.version &&
              candidate.projectId === event.projectId,
          ) ?? null;
        let finalStatus = event.status;
        let finalResult: Record<string, unknown> | null = null;
        let finalErrorCode = event.errorCode;

        if (!definition) {
          finalStatus = "rejected";
          finalErrorCode = "pinned_tool_definition_not_found";
        } else if (event.status === "success") {
          if (!event.result) {
            finalStatus = "rejected";
            finalErrorCode = "tool_output_missing";
          } else {
            const validatedResult = await validateToolResultPayload({
              contextValues,
              definition,
              fieldValues,
              projectId: event.projectId,
              result: event.result,
            });
            if (!validatedResult.ok) {
              finalStatus = "rejected";
              finalErrorCode = validatedResult.error.code;
            } else {
              const mapped = await applyToolResultMappings(tx, {
                contextValues,
                definition: snapshot.task.definition,
                eventId: event.eventId,
                fields,
                mappings: validatedResult.mappings,
                now: receivedAt,
                projectId: event.projectId,
                runExpiresAt: run.expiresAt,
                taskRunId: run.id,
                toolRequestId: request.requestId,
              });
              if (mapped.error) {
                finalStatus = "rejected";
                finalErrorCode = mapped.error;
              } else {
                fieldUpdates = mapped.updates;
                finalResult = validatedResult.result;
                finalErrorCode = null;
              }
            }
          }
        } else {
          finalErrorCode ??= event.status;
        }

        if (definition && finalStatus !== "success") {
          fieldUpdates = await invalidateToolResultMappings(tx, {
            definition: snapshot.task.definition,
            eventId: event.eventId,
            fields,
            mappings: definition.resultMappings,
            now: receivedAt,
            projectId: event.projectId,
            taskRunId: run.id,
          });
        }

        await tx
          .update(conversationalTaskToolRequests)
          .set({
            completedAt: receivedAt,
            errorCode: finalErrorCode,
            result: finalResult,
            status: finalStatus,
            updatedAt: receivedAt,
          })
          .where(
            and(
              eq(conversationalTaskToolRequests.id, request.id),
              eq(conversationalTaskToolRequests.projectId, event.projectId),
              eq(conversationalTaskToolRequests.taskRunId, run.id),
            ),
          );
        auditSummary = {
          errorCode: finalErrorCode,
          requestId: event.requestId,
          status: finalStatus,
        };
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

    const shouldInvalidateConfirmation =
      event.type === "field.clear" ||
      event.type === "task.restart" ||
      (event.type === "field.candidates" &&
        [...fieldUpdates.values()].some(
          ({ changed, dependencyInvalidated }) =>
            changed || dependencyInvalidated,
        ));
    if (shouldInvalidateConfirmation) {
      const invalidated = await tx
        .update(conversationalTaskConfirmations)
        .set({
          invalidatedAt: receivedAt,
          status: "invalidated",
          updatedAt: receivedAt,
        })
        .where(
          and(
            eq(conversationalTaskConfirmations.projectId, event.projectId),
            eq(conversationalTaskConfirmations.taskRunId, run.id),
            inArray(conversationalTaskConfirmations.status, [
              "pending",
              "confirmed",
            ]),
          ),
        )
        .returning({ id: conversationalTaskConfirmations.id });
      if (invalidated.length > 0) {
        await recordAudit(tx, {
          conversationId: event.conversationId,
          eventType: "confirmation.invalidated",
          inboundEventId: eventRow.id,
          projectId: event.projectId,
          summary: {
            confirmationIds: invalidated.map(({ id }) => id),
            reason: event.type,
          },
          taskRunId: run.id,
        });
      }
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
      summary: auditSummary,
      taskRunId: run.id,
    });

    return {
      disposition: "applied",
      reason: null,
      revision: updatedExecution.revision,
      taskRunId: run.id,
    };
  });

  if (
    event.type === "tool.requested" &&
    applied.disposition === "applied" &&
    applied.revision !== null
  ) {
    return (
      (await completeSynchronousBuiltInToolRequest({
        event,
        expectedRevision: applied.revision,
      })) ?? applied
    );
  }
  return applied;
}
