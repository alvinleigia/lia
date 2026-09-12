import { generateKeyPairSync } from "node:crypto";
import { expect, test } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import type { RuntimeActionStep } from "../../src/lib/action-runtime";
import { runBrowserFlowText } from "../../src/lib/browser-flow-runtime";
import { startChannelFlow } from "../../src/lib/channel-flow-runtime";
import type { ChannelType } from "../../src/lib/channels";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import {
  type ConversationalTaskDefinitionV1,
  conversationalTaskSnapshotV1Schema,
} from "../../src/lib/conversation-contracts";
import { StructuredTurnEngine } from "../../src/lib/conversation-turn-engine";
import {
  executeTaskReadOperation,
  getTaskCalendarAvailability,
  readTaskCalendarAvailability,
  refreshExpiredTaskCalendarAvailability,
} from "../../src/lib/conversational-task-calendar-availability";
import {
  executeRequiredTaskFieldLookup,
  readPendingTaskAppointmentChoice,
} from "../../src/lib/conversational-task-field-lookups";
import {
  confirmTaskOperation,
  executeConfirmedTaskOperation,
  getTaskOperationAttempt,
  prepareTaskOperationConfirmation,
  processAndReconcileTaskOperation,
  reconcileUnknownTaskOperation,
} from "../../src/lib/conversational-task-operations";
import {
  applyConversationalTaskEvent,
  deleteConversationRuntimeData,
  exportConversationRuntimeData,
  getConversationalTaskRuntime,
  startConversationalTaskRun,
} from "../../src/lib/conversational-task-runtime";
import { getConversationTaskRuntimeSession } from "../../src/lib/conversational-task-runtime-session";
import { resolveProjectTaskToolDefinition } from "../../src/lib/conversational-task-tools";
import { db } from "../../src/lib/db-config";
import {
  actionFlowVersions,
  actionSubmissionEvents,
  actionSubmissions,
  channelConversations,
  channelMessages,
  companies,
  contactAttributes,
  contacts,
  conversationalTaskAuditEvents,
  conversationalTaskConfirmations,
  conversationalTaskFieldValues,
  conversationalTasks,
  conversationalTaskToolRequests,
  conversationalTaskVersions,
  conversationExecutionStates,
  conversationInboundEvents,
  durableJobs,
  googleCalendarAppointments,
  integrationProviders,
  operationAttempts,
  operations,
  outboxMessages,
  projectActions,
  projects,
  providerSecrets,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import {
  claimNextDurableJob,
  failDurableJob,
} from "../../src/lib/durable-jobs";
import {
  buildHybridChannelResumeReplies,
  runHybridChannelBoundary,
} from "../../src/lib/hybrid-channel-runtime";
import { compileHybridFlowGraph } from "../../src/lib/hybrid-flow-compiler";
import {
  createIntegrationProvider,
  createOperation,
  getOperationAttemptToolResult,
  getProjectOperationAttemptWithDetails,
  processProjectDurableOperationQueue,
  runOperationPreview,
} from "../../src/lib/operations";
import {
  cancelPendingWhatsAppReplies,
  processProjectOutboxQueue,
} from "../../src/lib/outbox";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";
import { getRuntimeProjectAction } from "../../src/lib/runtime-actions";
import { createTextReply } from "../../src/lib/runtime-replies";

test.describe.configure({ mode: "serial" });

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const principal = { kind: "user" as const, principal: `uat-${suffix}` };
const conversationIds: number[] = [];

let fixture:
  | {
      companyId: number;
      manualTaskId: number;
      manualToolId: string;
      otherProjectId: number;
      projectId: number;
      uncertainTaskId: number;
      uncertainToolId: string;
      userId: number;
      workspaceId: number;
    }
  | undefined;

function operationTaskDefinition(
  operationId: number,
): ConversationalTaskDefinitionV1 {
  return {
    ...REFERENCE_BOOKING_TASK_DEFINITION,
    contextVariables: [
      ...REFERENCE_BOOKING_TASK_DEFINITION.contextVariables,
      {
        defaultValue: null,
        expiresAfterMinutes: 30,
        key: "reviewMode",
        modelVisible: true,
        sensitivity: "standard",
        source: "project",
        toolVisible: true,
        type: "text",
      },
    ],
    fieldTransferWhitelist: [],
    fields: REFERENCE_BOOKING_TASK_DEFINITION.fields
      .filter(({ key }) => key === "guestName" || key === "guestEmail")
      .map((field) => ({ ...field, dependsOn: [] })),
    tools: [
      {
        access: "write",
        allowedStages: ["operation"],
        tool: { id: `operation:${operationId}`, version: 1 },
      },
    ],
  };
}

async function createPublishedTask(input: {
  definition?: ConversationalTaskDefinitionV1;
  name: string;
  operationId: number;
  projectId: number;
}) {
  const definition =
    input.definition ?? operationTaskDefinition(input.operationId);
  const [task] = await db
    .insert(conversationalTasks)
    .values({
      definition,
      name: input.name,
      objective: "Collect contact details and submit one confirmed request.",
      projectId: input.projectId,
    })
    .returning();
  const toolDefinitions = await Promise.all(
    definition.tools.map(async (binding) => {
      const tool = await resolveProjectTaskToolDefinition({
        definition,
        projectId: input.projectId,
        toolId: binding.tool.id,
        version: binding.tool.version,
      });
      if (!tool)
        throw new Error("Could not build the operation tool definition.");
      return tool;
    }),
  );
  const snapshot = conversationalTaskSnapshotV1Schema.parse({
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    assistantPolicy: REFERENCE_BOOKING_PROJECT_POLICY.assistant,
    conversationPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
    schemaVersion: 1,
    task: {
      definition,
      description: null,
      id: task.id,
      name: task.name,
      objective: task.objective,
      schemaVersion: 1,
    },
    toolDefinitions,
  });
  const [version] = await db
    .insert(conversationalTaskVersions)
    .values({
      projectId: input.projectId,
      snapshot,
      taskId: task.id,
      versionNumber: 1,
    })
    .returning();
  return { task, version };
}

async function startReadyRun(
  taskId: number,
  channelType: ChannelType = "project_chat",
) {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const [conversation] = await db
    .insert(channelConversations)
    .values({
      channelType,
      externalConversationId: `operation-runtime-${suffix}-${conversationIds.length}`,
      projectId: fixture.projectId,
    })
    .returning();
  conversationIds.push(conversation.id);
  const now = new Date();
  const started = await startConversationalTaskRun({
    anonymousVisitorId: `visitor-${conversation.id}`,
    authenticatedUserId: null,
    channelIdentity: { browserSession: `operation-${conversation.id}` },
    channelType,
    conversationId: conversation.id,
    eventId: `start-${conversation.id}`,
    identityKind: "anonymous",
    initializationContext: {},
    occurredAt: now.toISOString(),
    projectId: fixture.projectId,
    providerSequence: null,
    receivedAt: now.toISOString(),
    sessionExpiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    sessionId: `session-${conversation.id}`,
    taskId,
    verifiedContactId: null,
  });
  if (!started.taskRunId) throw new Error("The task run did not start.");
  const fields = await applyConversationalTaskEvent({
    authentication: null,
    candidates: [
      {
        canonicalValue: "UAT Guest",
        fieldKey: "guestName",
        naturalValue: "UAT Guest",
        provenance: { source: "visitor", sourceReference: null },
        state: "valid",
        validation: { code: null, message: null, valid: true },
      },
      {
        canonicalValue: "uat.guest@example.com",
        fieldKey: "guestEmail",
        naturalValue: "uat.guest@example.com",
        provenance: { source: "visitor", sourceReference: null },
        state: "valid",
        validation: { code: null, message: null, valid: true },
      },
    ],
    channelIdentity: { browserSession: `operation-${conversation.id}` },
    channelType,
    conversationId: conversation.id,
    correction: false,
    eventId: `fields-${conversation.id}`,
    expectedRevision: started.revision,
    occurredAt: now.toISOString(),
    projectId: fixture.projectId,
    providerSequence: null,
    receivedAt: now.toISOString(),
    schemaVersion: 1,
    taskRunId: started.taskRunId,
    type: "field.candidates",
  });
  expect(fields.disposition).toBe("applied");
  return {
    conversationId: conversation.id,
    externalConversationId: conversation.externalConversationId,
    taskRunId: started.taskRunId,
  };
}

test.beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: `task-operation-${suffix}@example.com`,
      name: "Task Operation Test",
      passwordHash: "test-only",
    })
    .returning();
  const [company] = await db
    .insert(companies)
    .values({
      name: `Task Operation ${suffix}`,
      ownerUserId: user.id,
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({
      companyId: company.id,
      name: `Task Operation ${suffix}`,
      ownerUserId: user.id,
    })
    .returning();
  const [project, otherProject] = await db
    .insert(projects)
    .values([
      {
        name: `Task Operation ${suffix}`,
        ownerUserId: user.id,
        workspaceId: workspace.id,
      },
      {
        name: `Other Task Operation ${suffix}`,
        ownerUserId: user.id,
        workspaceId: workspace.id,
      },
    ])
    .returning();

  const manualProvider = await createIntegrationProvider({
    config: {
      autoRetryEnabled: true,
      autoRetryMaxAttempts: 2,
    },
    name: "Manual Review",
    projectId: project.id,
    providerType: "manual_review",
  });
  const manualOperation = await createOperation({
    inputMapping: {
      guestEmail: "fields.guestEmail",
      guestName: "fields.guestName",
    },
    name: "Create Booking Request",
    operationType: "manual_review",
    outputMapping: {
      "contactAttributes.reviewMode": "responsePayload.mode",
      "fields.guestName": "requestPayload.payload.guestName",
    },
    projectId: project.id,
    providerId: manualProvider.id,
  });
  const uncertainProvider = await createIntegrationProvider({
    config: {
      retryCount: 0,
      timeoutMs: 100,
      url: "http://127.0.0.1:1/phase-5-outcome-unknown",
    },
    name: "Uncertain Webhook",
    projectId: project.id,
    providerType: "webhook",
  });
  const uncertainOperation = await createOperation({
    inputMapping: {
      guestEmail: "fields.guestEmail",
      guestName: "fields.guestName",
    },
    name: "Create External Booking",
    operationType: "webhook",
    outputMapping: {
      "contactAttributes.reviewMode": "responsePayload.mode",
    },
    projectId: project.id,
    providerId: uncertainProvider.id,
  });
  const manualTask = await createPublishedTask({
    name: "Confirmed Manual Booking",
    operationId: manualOperation.id,
    projectId: project.id,
  });
  const uncertainTask = await createPublishedTask({
    name: "Confirmed External Booking",
    operationId: uncertainOperation.id,
    projectId: project.id,
  });

  fixture = {
    companyId: company.id,
    manualTaskId: manualTask.task.id,
    manualToolId: `operation:${manualOperation.id}`,
    otherProjectId: otherProject.id,
    projectId: project.id,
    uncertainTaskId: uncertainTask.task.id,
    uncertainToolId: `operation:${uncertainOperation.id}`,
    userId: user.id,
    workspaceId: workspace.id,
  };
});

test.afterAll(async () => {
  if (!fixture) return;
  for (const conversationId of conversationIds) {
    await deleteConversationRuntimeData({
      conversationId,
      includeMessages: true,
      projectId: fixture.projectId,
    });
  }
  await db
    .delete(outboxMessages)
    .where(eq(outboxMessages.projectId, fixture.projectId));
  await db
    .delete(durableJobs)
    .where(eq(durableJobs.projectId, fixture.projectId));
  await db
    .delete(operationAttempts)
    .where(eq(operationAttempts.projectId, fixture.projectId));
  await db
    .delete(channelConversations)
    .where(eq(channelConversations.projectId, fixture.projectId));
  await db
    .delete(actionSubmissionEvents)
    .where(eq(actionSubmissionEvents.projectId, fixture.projectId));
  await db
    .delete(actionSubmissions)
    .where(eq(actionSubmissions.projectId, fixture.projectId));
  await db
    .delete(actionFlowVersions)
    .where(eq(actionFlowVersions.projectId, fixture.projectId));
  await db
    .delete(projectActions)
    .where(eq(projectActions.projectId, fixture.projectId));
  await db
    .delete(conversationalTaskVersions)
    .where(eq(conversationalTaskVersions.projectId, fixture.projectId));
  await db
    .delete(conversationalTasks)
    .where(eq(conversationalTasks.projectId, fixture.projectId));
  await db
    .delete(googleCalendarAppointments)
    .where(eq(googleCalendarAppointments.projectId, fixture.projectId));
  await db
    .delete(operations)
    .where(eq(operations.projectId, fixture.projectId));
  await db
    .delete(providerSecrets)
    .where(eq(providerSecrets.projectId, fixture.projectId));
  await db
    .delete(integrationProviders)
    .where(eq(integrationProviders.projectId, fixture.projectId));
  await db
    .delete(contactAttributes)
    .where(eq(contactAttributes.projectId, fixture.projectId));
  await db.delete(contacts).where(eq(contacts.projectId, fixture.projectId));
  await db
    .delete(projects)
    .where(
      and(
        eq(projects.workspaceId, fixture.workspaceId),
        eq(projects.ownerUserId, fixture.userId),
      ),
    );
  await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
  await db.delete(companies).where(eq(companies.id, fixture.companyId));
  await db.delete(users).where(eq(users.id, fixture.userId));
});

test("does not deliver a later WhatsApp reply before an earlier retry", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const destination = `phase13-order-${suffix}`;
  const [earlier, later] = await db
    .insert(outboxMessages)
    .values([
      {
        availableAt: new Date(Date.now() + 60_000),
        dedupeKey: `phase13-order-earlier-${suffix}`,
        destination,
        payload: {},
        projectId: fixture.projectId,
        topic: "whatsapp.runtime_reply",
        traceId: `phase13-order-${suffix}`,
      },
      {
        availableAt: new Date(Date.now() - 1_000),
        dedupeKey: `phase13-order-later-${suffix}`,
        destination,
        payload: {},
        projectId: fixture.projectId,
        topic: "whatsapp.runtime_reply",
        traceId: `phase13-order-${suffix}`,
      },
    ])
    .returning();

  const result = await processProjectOutboxQueue({
    maxMessages: 2,
    projectId: fixture.projectId,
    workerId: `phase13-order-${suffix}`,
  });
  const rows = await db
    .select({ id: outboxMessages.id, status: outboxMessages.status })
    .from(outboxMessages)
    .where(inArray(outboxMessages.id, [earlier.id, later.id]));

  expect(result.processed).toBe(0);
  expect(rows).toEqual(
    expect.arrayContaining([
      { id: earlier.id, status: "queued" },
      { id: later.id, status: "queued" },
    ]),
  );
});

test("scopes immediate WhatsApp outbox draining to one destination", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const destination = `phase13-scope-${suffix}`;
  const [message] = await db
    .insert(outboxMessages)
    .values({
      dedupeKey: `phase13-scope-${suffix}`,
      destination,
      payload: {},
      projectId: fixture.projectId,
      topic: "whatsapp.runtime_reply",
      traceId: `phase13-scope-${suffix}`,
    })
    .returning();

  const result = await processProjectOutboxQueue({
    destination: `${destination}-other`,
    maxMessages: 1,
    projectId: fixture.projectId,
    workerId: `phase13-scope-${suffix}`,
  });
  const [stored] = await db
    .select({ status: outboxMessages.status })
    .from(outboxMessages)
    .where(eq(outboxMessages.id, message.id))
    .limit(1);

  expect(result.processed).toBe(0);
  expect(stored?.status).toBe("queued");
});

test("cancels queued WhatsApp replies superseded by new inbound activity", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const destination = `phase14-cancel-queued-${suffix}`;
  const [target, unrelated] = await db
    .insert(outboxMessages)
    .values([
      {
        dedupeKey: `phase14-cancel-target-${suffix}`,
        destination,
        payload: {},
        projectId: fixture.projectId,
        topic: "whatsapp.runtime_reply",
        traceId: `phase14-cancel-target-${suffix}`,
      },
      {
        availableAt: new Date(Date.now() + 60_000),
        dedupeKey: `phase14-cancel-unrelated-${suffix}`,
        destination: `${destination}-other`,
        payload: {},
        projectId: fixture.projectId,
        topic: "whatsapp.runtime_reply",
        traceId: `phase14-cancel-unrelated-${suffix}`,
      },
    ])
    .returning();

  expect(
    await cancelPendingWhatsAppReplies({
      destination,
      projectId: fixture.projectId,
    }),
  ).toBe(1);
  const rows = await db
    .select({ id: outboxMessages.id, status: outboxMessages.status })
    .from(outboxMessages)
    .where(inArray(outboxMessages.id, [target.id, unrelated.id]));

  expect(rows).toEqual(
    expect.arrayContaining([
      { id: target.id, status: "cancelled" },
      { id: unrelated.id, status: "queued" },
    ]),
  );
});

test("does not deliver a WhatsApp reply owned by an older inbound turn", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const destination = `phase14-stale-reply-${suffix}`;
  const [conversation] = await db
    .insert(channelConversations)
    .values({
      channelType: "whatsapp",
      externalConversationId: destination,
      projectId: fixture.projectId,
    })
    .returning();
  conversationIds.push(conversation.id);
  const [sourceInbound] = await db
    .insert(channelMessages)
    .values({
      conversationId: conversation.id,
      direction: "inbound",
      messageType: "text",
      projectId: fixture.projectId,
      text: "book a spa service",
    })
    .returning();
  const reply = createTextReply("Please provide Service Category.");
  const [outbound] = await db
    .insert(channelMessages)
    .values({
      conversationId: conversation.id,
      direction: "outbound",
      messageType: reply.type,
      payload: { runtimeReply: reply },
      projectId: fixture.projectId,
      text: reply.fallbackText,
    })
    .returning();
  await db.insert(channelMessages).values({
    conversationId: conversation.id,
    direction: "inbound",
    messageType: "text",
    projectId: fixture.projectId,
    text: "cancel",
  });
  const [queued] = await db
    .insert(outboxMessages)
    .values({
      dedupeKey: `phase14-stale-reply-${suffix}`,
      destination,
      payload: {
        channelId: 999_999,
        channelMessageId: outbound.id,
        conversationId: conversation.id,
        runtimeReply: reply,
        sourceInboundMessageId: sourceInbound.id,
        to: destination,
      },
      projectId: fixture.projectId,
      topic: "whatsapp.runtime_reply",
      traceId: `phase14-stale-reply-${suffix}`,
    })
    .returning();

  const result = await processProjectOutboxQueue({
    destination,
    maxMessages: 1,
    projectId: fixture.projectId,
    workerId: `phase14-stale-reply-${suffix}`,
  });
  const [stored] = await db
    .select({ status: outboxMessages.status })
    .from(outboxMessages)
    .where(eq(outboxMessages.id, queued.id))
    .limit(1);

  expect(result).toMatchObject({ cancelled: 1, delivered: 0, failed: 0 });
  expect(stored?.status).toBe("cancelled");
});

test("requires explicit confirmation and invalidates it after correction", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const run = await startReadyRun(fixture.manualTaskId);
  const pending = await prepareTaskOperationConfirmation({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
    toolId: fixture.manualToolId,
  });

  expect(pending.status).toBe("pending");
  expect(pending.summary).toMatchObject({
    operationName: "Create Booking Request",
    toolId: fixture.manualToolId,
  });
  await expect(
    executeConfirmedTaskOperation({
      confirmationId: pending.id,
      principal,
      projectId: fixture.projectId,
      taskRunId: run.taskRunId,
    }),
  ).rejects.toThrow("Confirm the current summary");

  const confirmed = await confirmTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  expect(confirmed.status).toBe("confirmed");

  const corrected = await applyConversationalTaskEvent({
    authentication: null,
    candidates: [
      {
        canonicalValue: "corrected.guest@example.com",
        fieldKey: "guestEmail",
        naturalValue: "corrected.guest@example.com",
        provenance: { source: "visitor", sourceReference: null },
        state: "valid",
        validation: { code: null, message: null, valid: true },
      },
    ],
    channelIdentity: { browserSession: `operation-${run.conversationId}` },
    channelType: "project_chat",
    conversationId: run.conversationId,
    correction: true,
    eventId: `correction-${run.conversationId}`,
    expectedRevision: null,
    occurredAt: new Date().toISOString(),
    projectId: fixture.projectId,
    providerSequence: null,
    receivedAt: new Date().toISOString(),
    schemaVersion: 1,
    taskRunId: run.taskRunId,
    type: "field.candidates",
  });
  expect(corrected.disposition).toBe("applied");

  const runtime = await getConversationalTaskRuntime({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  expect(
    runtime?.confirmations.find(({ id }) => id === confirmed.id)?.status,
  ).toBe("invalidated");
  const refreshed = await prepareTaskOperationConfirmation({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
    toolId: fixture.manualToolId,
  });
  expect(refreshed.canonicalHash).not.toBe(pending.canonicalHash);
  expect(refreshed.status).toBe("pending");
});

test("runs one authorized project operation from Telnyx task state", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const run = await startReadyRun(fixture.manualTaskId, "telnyx_voice");
  const pending = await prepareTaskOperationConfirmation({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
    toolId: fixture.manualToolId,
  });

  await expect(
    executeConfirmedTaskOperation({
      confirmationId: pending.id,
      principal,
      projectId: fixture.projectId,
      taskRunId: run.taskRunId,
    }),
  ).rejects.toThrow("Confirm the current summary");
  await confirmTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  await executeConfirmedTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  const executed = await processAndReconcileTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    workerId: `phase18-telnyx-tool-${suffix}`,
  });
  const [conversation] = await db
    .select({ channelType: channelConversations.channelType })
    .from(channelConversations)
    .where(
      and(
        eq(channelConversations.projectId, fixture.projectId),
        eq(channelConversations.id, run.conversationId),
      ),
    )
    .limit(1);

  expect(conversation?.channelType).toBe("telnyx_voice");
  expect(executed.attempt).toMatchObject({
    projectId: fixture.projectId,
    status: "completed",
    taskConfirmationId: pending.id,
  });
  expect(
    await getTaskOperationAttempt({
      confirmationId: pending.id,
      projectId: fixture.otherProjectId,
    }),
  ).toBeNull();
  const runtime = await getConversationalTaskRuntime({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  expect(runtime?.tools[0]).toMatchObject({
    result: { mode: "manual_review" },
    status: "success",
  });
  const auditEvents = await db
    .select({ eventType: conversationalTaskAuditEvents.eventType })
    .from(conversationalTaskAuditEvents)
    .where(
      and(
        eq(conversationalTaskAuditEvents.projectId, fixture.projectId),
        eq(conversationalTaskAuditEvents.taskRunId, run.taskRunId),
      ),
    );
  expect(auditEvents.map(({ eventType }) => eventType)).toEqual(
    expect.arrayContaining([
      "confirmation.prepared",
      "confirmation.confirmed",
      "operation.queued",
      "operation.completed",
    ]),
  );
});

test("queues one durable attempt and completes from sanitized mapped output", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const run = await startReadyRun(fixture.manualTaskId);
  const pending = await prepareTaskOperationConfirmation({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
    toolId: fixture.manualToolId,
  });
  await confirmTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  const first = await executeConfirmedTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  const replay = await executeConfirmedTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });

  expect(first.created).toBe(true);
  expect(replay.created).toBe(false);
  expect(replay.attempt.id).toBe(first.attempt.id);
  const attempts = await db
    .select()
    .from(operationAttempts)
    .where(
      and(
        eq(operationAttempts.projectId, fixture.projectId),
        eq(operationAttempts.taskConfirmationId, pending.id),
      ),
    );
  expect(attempts).toHaveLength(1);
  expect(
    await getTaskOperationAttempt({
      confirmationId: pending.id,
      projectId: fixture.otherProjectId,
    }),
  ).toBeNull();

  const processed = await processAndReconcileTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    workerId: `phase-5-success-${suffix}`,
  });
  expect(processed.attempt.status).toBe("completed");
  if (!processed.attempt.startedAt || !processed.attempt.finishedAt) {
    throw new Error("The completed attempt timestamps are missing.");
  }
  expect(processed.attempt.finishedAt.getTime()).toBeGreaterThanOrEqual(
    processed.attempt.startedAt.getTime(),
  );
  const runtime = await getConversationalTaskRuntime({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  expect(runtime?.run).toMatchObject({
    outcomeKey: "completed",
    status: "completed",
  });
  expect(runtime?.tools[0]).toMatchObject({
    result: { mode: "manual_review" },
    status: "success",
  });
  expect(runtime?.tools[0]?.result).not.toHaveProperty("message");
  expect(runtime?.context).toContainEqual(
    expect.objectContaining({
      key: "reviewMode",
      value: "manual_review",
    }),
  );
  const exported = await exportConversationRuntimeData({
    conversationId: run.conversationId,
    projectId: fixture.projectId,
  });
  expect(exported.confirmations).toContainEqual(
    expect.objectContaining({ id: pending.id, status: "consumed" }),
  );
});

test("recovers a delivered attempt after legacy completion lost confirmation", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const run = await startReadyRun(fixture.manualTaskId);
  const pending = await prepareTaskOperationConfirmation({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
    toolId: fixture.manualToolId,
  });
  await confirmTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  const queued = await executeConfirmedTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  const delivered = await processProjectDurableOperationQueue({
    maxJobs: 1,
    projectId: fixture.projectId,
    workerId: `legacy-confirmation-${suffix}`,
  });
  expect(delivered.completed).toBe(1);
  const attemptDetails = await getProjectOperationAttemptWithDetails(
    fixture.projectId,
    queued.attempt.id,
  );
  if (!attemptDetails || !queued.attempt.taskToolRequestId) {
    throw new Error("The delivered attempt details are missing.");
  }
  const [request] = await db
    .select()
    .from(conversationalTaskToolRequests)
    .where(
      and(
        eq(conversationalTaskToolRequests.projectId, fixture.projectId),
        eq(conversationalTaskToolRequests.id, queued.attempt.taskToolRequestId),
      ),
    )
    .limit(1);
  if (!request) throw new Error("The operation request is missing.");
  const occurredAt = new Date().toISOString();
  const result = await applyConversationalTaskEvent({
    authentication: {
      keyId: null,
      kind: principal.kind,
      principal: principal.principal,
      verifiedAt: occurredAt,
    },
    channelIdentity: { browserSession: `operation-${run.conversationId}` },
    channelType: "project_chat",
    conversationId: run.conversationId,
    errorCode: null,
    eventId: `operation:${queued.attempt.id}:result:completed`,
    expectedRevision: null,
    occurredAt,
    projectId: fixture.projectId,
    providerSequence: null,
    receivedAt: occurredAt,
    requestId: request.requestId,
    result: getOperationAttemptToolResult(attemptDetails),
    schemaVersion: 1,
    status: "success",
    taskRunId: run.taskRunId,
    type: "tool.result",
  });
  expect(result.disposition).toBe("applied");
  await db
    .update(conversationalTaskFieldValues)
    .set({ state: "valid" })
    .where(
      and(
        eq(conversationalTaskFieldValues.projectId, fixture.projectId),
        eq(conversationalTaskFieldValues.taskRunId, run.taskRunId),
        eq(conversationalTaskFieldValues.fieldKey, "guestName"),
      ),
    );
  const legacyCompletion = await applyConversationalTaskEvent({
    authentication: {
      keyId: null,
      kind: principal.kind,
      principal: principal.principal,
      verifiedAt: occurredAt,
    },
    channelIdentity: { browserSession: `operation-${run.conversationId}` },
    channelType: "project_chat",
    conversationId: run.conversationId,
    eventId: `operation:${queued.attempt.id}:task-complete`,
    expectedRevision: null,
    occurredAt,
    outcomeKey: "completed",
    projectId: fixture.projectId,
    providerSequence: null,
    receivedAt: occurredAt,
    schemaVersion: 1,
    taskRunId: run.taskRunId,
    type: "task.complete",
  });
  expect(legacyCompletion).toMatchObject({
    disposition: "quarantined",
    reason: "confirmation_required",
  });

  const recovered = await processAndReconcileTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    workerId: `legacy-confirmation-retry-${suffix}`,
  });
  expect(recovered.attempt.id).toBe(queued.attempt.id);
  const runtime = await getConversationalTaskRuntime({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  expect(runtime?.run).toMatchObject({
    outcomeKey: "completed",
    status: "completed",
  });
  expect(runtime?.fields).toContainEqual(
    expect.objectContaining({ fieldKey: "guestName", state: "confirmed" }),
  );
});

test("queues a confirmed operation after the runtime timestamp advances", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const run = await startReadyRun(fixture.manualTaskId);
  const pending = await prepareTaskOperationConfirmation({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
    toolId: fixture.manualToolId,
  });
  const confirmed = await confirmTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  if (!confirmed.confirmedAt) throw new Error("Confirmation time is missing.");
  const refreshedAt = new Date(confirmed.confirmedAt.getTime() + 1);
  await db
    .update(conversationExecutionStates)
    .set({ lastEventOccurredAt: refreshedAt })
    .where(
      and(
        eq(conversationExecutionStates.projectId, fixture.projectId),
        eq(conversationExecutionStates.conversationId, run.conversationId),
      ),
    );

  const queued = await executeConfirmedTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });

  expect(queued.created).toBe(true);
  const [requestEvent] = await db
    .select({
      occurredAt: conversationInboundEvents.occurredAt,
      status: conversationInboundEvents.status,
    })
    .from(conversationInboundEvents)
    .where(
      and(
        eq(conversationInboundEvents.projectId, fixture.projectId),
        eq(conversationInboundEvents.taskRunId, run.taskRunId),
        eq(conversationInboundEvents.eventType, "tool.requested"),
      ),
    )
    .limit(1);
  expect(requestEvent).toMatchObject({
    occurredAt: refreshedAt,
    status: "applied",
  });
});

test("retries a confirmed operation after queue reservation becomes available", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const run = await startReadyRun(fixture.manualTaskId);
  const pending = await prepareTaskOperationConfirmation({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
    toolId: fixture.manualToolId,
  });
  await confirmTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  const operationId = Number(fixture.manualToolId.split(":").at(-1));
  await db
    .update(operations)
    .set({ status: "disabled" })
    .where(
      and(
        eq(operations.id, operationId),
        eq(operations.projectId, fixture.projectId),
      ),
    );
  try {
    await expect(
      executeConfirmedTaskOperation({
        confirmationId: pending.id,
        principal,
        projectId: fixture.projectId,
        taskRunId: run.taskRunId,
      }),
    ).rejects.toThrow("The operation or provider is unavailable.");
  } finally {
    await db
      .update(operations)
      .set({ status: "active" })
      .where(
        and(
          eq(operations.id, operationId),
          eq(operations.projectId, fixture.projectId),
        ),
      );
  }

  await db
    .update(conversationInboundEvents)
    .set({ payloadHash: `legacy-retry-${suffix}` })
    .where(
      and(
        eq(conversationInboundEvents.projectId, fixture.projectId),
        eq(conversationInboundEvents.taskRunId, run.taskRunId),
        eq(conversationInboundEvents.eventType, "tool.requested"),
      ),
    );

  const retried = await executeConfirmedTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  expect(retried.created).toBe(true);
});

test("reclaims an interrupted operation without allowing a stale worker to overwrite it", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const run = await startReadyRun(fixture.manualTaskId);
  const pending = await prepareTaskOperationConfirmation({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
    toolId: fixture.manualToolId,
  });
  await confirmTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  const queued = await executeConfirmedTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });

  const [job] = await db
    .select()
    .from(durableJobs)
    .where(
      and(
        eq(durableJobs.projectId, fixture.projectId),
        eq(durableJobs.operationAttemptId, queued.attempt.id),
      ),
    )
    .limit(1);
  expect(job).toBeDefined();
  if (!job) throw new Error("The durable operation job was not created.");

  const firstClaimAt = new Date(Date.now() - 60_000);
  await db
    .update(durableJobs)
    .set({ availableAt: firstClaimAt })
    .where(
      and(
        eq(durableJobs.projectId, fixture.projectId),
        eq(durableJobs.id, job.id),
      ),
    );
  const workerA = `phase-8-worker-a-${suffix}`;
  const workerB = `phase-8-worker-b-${suffix}`;
  const claimedByA = await claimNextDurableJob({
    jobTypes: ["operation_delivery"],
    leaseMs: 5_000,
    now: firstClaimAt,
    projectId: fixture.projectId,
    workerId: workerA,
  });
  const claimedByB = await claimNextDurableJob({
    jobTypes: ["operation_delivery"],
    leaseMs: 5_000,
    now: new Date(firstClaimAt.getTime() + 6_000),
    projectId: fixture.projectId,
    workerId: workerB,
  });
  expect(claimedByA?.id).toBe(job.id);
  expect(claimedByB?.id).toBe(job.id);

  const staleFailure = await failDurableJob({
    errorMessage: "Worker A finished after its lease expired.",
    jobId: job.id,
    projectId: fixture.projectId,
    workerId: workerA,
  });
  expect(staleFailure).toBeNull();
  const pendingAttempt = await getTaskOperationAttempt({
    confirmationId: pending.id,
    projectId: fixture.projectId,
  });
  expect(pendingAttempt?.attempt.status).toBe("pending");

  const processed = await processProjectDurableOperationQueue({
    maxJobs: 1,
    projectId: fixture.projectId,
    workerId: `phase-8-worker-c-${suffix}`,
  });
  expect(processed).toMatchObject({
    completed: 1,
    failed: 0,
    processed: 1,
    rescheduled: 0,
  });

  const [completedJob] = await db
    .select()
    .from(durableJobs)
    .where(
      and(
        eq(durableJobs.projectId, fixture.projectId),
        eq(durableJobs.id, job.id),
      ),
    )
    .limit(1);
  expect(completedJob).toMatchObject({
    attempts: 3,
    leaseOwner: null,
    status: "completed",
  });
  const completedAttempt = await getTaskOperationAttempt({
    confirmationId: pending.id,
    projectId: fixture.projectId,
  });
  expect(completedAttempt?.attempt.status).toBe("completed");
  expect(
    await db
      .select()
      .from(operationAttempts)
      .where(
        and(
          eq(operationAttempts.projectId, fixture.projectId),
          eq(operationAttempts.taskConfirmationId, pending.id),
        ),
      ),
  ).toHaveLength(1);
});

test("keeps an uncertain provider outcome open until manual reconciliation", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const run = await startReadyRun(fixture.uncertainTaskId);
  const pending = await prepareTaskOperationConfirmation({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
    toolId: fixture.uncertainToolId,
  });
  await confirmTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  await executeConfirmedTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  const uncertain = await processAndReconcileTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    workerId: `phase-5-unknown-${suffix}`,
  });
  expect(uncertain.attempt.status).toBe("outcome_unknown");

  const waiting = await getConversationalTaskRuntime({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  expect(waiting?.run.status).toBe("active");
  expect(waiting?.run.outcomeKey).toBeNull();
  expect(waiting?.confirmations[0]?.status).toBe("outcome_unknown");

  const correction = await applyConversationalTaskEvent({
    authentication: null,
    candidates: [
      {
        canonicalValue: "blocked@example.com",
        fieldKey: "guestEmail",
        naturalValue: "blocked@example.com",
        provenance: { source: "visitor", sourceReference: null },
        state: "valid",
        validation: { code: null, message: null, valid: true },
      },
    ],
    channelIdentity: { browserSession: `operation-${run.conversationId}` },
    channelType: "project_chat",
    conversationId: run.conversationId,
    correction: true,
    eventId: `blocked-correction-${run.conversationId}`,
    expectedRevision: null,
    occurredAt: new Date().toISOString(),
    projectId: fixture.projectId,
    providerSequence: null,
    receivedAt: new Date().toISOString(),
    schemaVersion: 1,
    taskRunId: run.taskRunId,
    type: "field.candidates",
  });
  expect(correction).toMatchObject({
    disposition: "quarantined",
    reason: "operation_reconciliation_required",
  });

  const reconciled = await reconcileUnknownTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    responsePayload: { mode: "manual_reconciliation" },
    status: "completed",
  });
  expect(reconciled.attempt.status).toBe("completed");
  const completed = await getConversationalTaskRuntime({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  expect(completed?.run).toMatchObject({
    outcomeKey: "completed",
    status: "completed",
  });
  expect(completed?.context).toContainEqual(
    expect.objectContaining({
      key: "reviewMode",
      value: "manual_reconciliation",
    }),
  );
});

test("routes a reconciled operation failure through the published handoff policy", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const run = await startReadyRun(fixture.uncertainTaskId);
  const pending = await prepareTaskOperationConfirmation({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
    toolId: fixture.uncertainToolId,
  });
  await confirmTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  await executeConfirmedTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  const uncertain = await processAndReconcileTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    workerId: `phase-5-failure-${suffix}`,
  });
  expect(uncertain.attempt.status).toBe("outcome_unknown");

  const reconciled = await reconcileUnknownTaskOperation({
    confirmationId: pending.id,
    errorMessage: "The provider confirmed the request was not created.",
    principal,
    projectId: fixture.projectId,
    status: "failed",
  });
  expect(reconciled.attempt.status).toBe("failed");

  const failed = await getConversationalTaskRuntime({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  expect(failed?.run).toMatchObject({
    outcomeKey: "failed",
    status: "handoff",
  });
  expect(failed?.execution?.responseOwner).toBe("human");
  expect(failed?.confirmations[0]?.status).toBe("failed");
  expect(failed?.tools[0]).toMatchObject({
    result: null,
    status: "provider_failure",
  });
});

test("completed delivery with rejected business result cannot complete a task", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const run = await startReadyRun(fixture.manualTaskId);
  const pending = await prepareTaskOperationConfirmation({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
    toolId: fixture.manualToolId,
  });
  await confirmTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  const queued = await executeConfirmedTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  await processProjectDurableOperationQueue({
    maxJobs: 25,
    projectId: fixture.projectId,
    workerId: `business-rejection-${suffix}`,
  });
  await db
    .update(operationAttempts)
    .set({
      status: "completed",
      responsePayload: { status: "rejected", reason: "slot_taken" },
    })
    .where(
      and(
        eq(operationAttempts.id, queued.attempt.id),
        eq(operationAttempts.projectId, fixture.projectId),
      ),
    );
  await processAndReconcileTaskOperation({
    confirmationId: pending.id,
    principal,
    projectId: fixture.projectId,
    workerId: `reconcile-rejection-${suffix}`,
  });
  const runtime = await getConversationalTaskRuntime({
    projectId: fixture.projectId,
    taskRunId: run.taskRunId,
  });
  expect(runtime?.run.status).not.toBe("completed");
  expect(runtime?.tools[0]).toMatchObject({
    status: "rejected",
    errorCode: "slot_taken",
  });
  const exported = await exportConversationRuntimeData({
    conversationId: run.conversationId,
    projectId: fixture.projectId,
  });
  expect(exported.confirmations).toContainEqual(
    expect.objectContaining({ id: pending.id, status: "failed" }),
  );
  const audit = await db
    .select()
    .from(conversationalTaskAuditEvents)
    .where(
      and(
        eq(conversationalTaskAuditEvents.projectId, fixture.projectId),
        eq(conversationalTaskAuditEvents.taskRunId, run.taskRunId),
      ),
    );
  expect(audit).toContainEqual(
    expect.objectContaining({
      eventType: "operation.failed",
      summary: expect.objectContaining({
        attemptId: queued.attempt.id,
        businessOutcome: "rejected",
        reason: "slot_taken",
      }),
    }),
  );
});

test("operation sandbox resolves prefixed and bare field mappings without losing values", async () => {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const projectId = fixture.projectId;
  const provider = await createIntegrationProvider({
    name: "Preview mapping fixture",
    projectId,
    providerType: "manual_review",
    config: {},
  });
  const operation = await createOperation({
    name: "Preview identity mapping",
    projectId,
    providerId: provider.id,
    operationType: "manual_review",
    inputMapping: {
      patientName: "fields.patientName",
      contactNumber: "fields.contactNumber",
      legacyName: "patientName",
      city: "fields.address.city",
      missing: "fields.absent",
      literal: 2,
    },
    outputMapping: {},
  });
  const result = await runOperationPreview({
    fields: {
      patientName: "Alex Test",
      contactNumber: "+61491570006",
      address: { city: "Test City" },
    },
    operationId: operation.id,
    projectId,
  });
  expect(result?.attempt.requestPayload).toMatchObject({
    preview: true,
    payload: {
      patientName: "Alex Test",
      contactNumber: "+61491570006",
      legacyName: "Alex Test",
      city: "Test City",
      missing: null,
      literal: 2,
    },
  });
});

test("Calendar slots use the task ledger and block arbitrary, empty, failed and stale selections", async () => {
  test.setTimeout(360_000);
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const projectId = fixture.projectId;
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString();
  const provider = await createIntegrationProvider({
    name: "Fixture Calendar",
    projectId,
    providerType: "google_calendar",
    config: {
      calendarId: "fixture@example.test",
      clientEmail: "lia@example.test",
      privateKey,
      timezone: "UTC",
      identityFactors: ["patientName"],
      workingDays: [1, 2, 3, 4, 5, 6, 7],
      schedulingHorizonDays: 60,
    },
  });
  const availabilityOperation = await createOperation({
    name: "Fixture availability",
    projectId,
    providerId: provider.id,
    operationType: "google_calendar.availability",
    inputMapping: { date: "fields.preferredDate" },
    outputMapping: {},
  });
  const booking = await createOperation({
    name: "Fixture booking",
    projectId,
    providerId: provider.id,
    operationType: "google_calendar.book",
    inputMapping: {
      patientName: "fields.guestName",
      start: "fields.appointmentStart",
    },
    outputMapping: {},
  });
  const base = operationTaskDefinition(booking.id);
  const dateField = REFERENCE_BOOKING_TASK_DEFINITION.fields.find(
    ({ key }) => key === "preferredDate",
  );
  if (!dateField) throw new Error("Date fixture missing.");
  const definition: ConversationalTaskDefinitionV1 = {
    ...base,
    fields: [
      ...base.fields,
      { ...dateField, dependsOn: [] },
      {
        ...base.fields[0],
        id: "10000000-0000-4000-8000-000000000099",
        key: "appointmentStart",
        label: "Appointment time",
        type: "time",
        dependsOn: ["preferredDate"],
      },
    ],
    tools: [
      {
        access: "read",
        allowedStages: ["lookup"],
        tool: { id: `operation:${availabilityOperation.id}`, version: 1 },
      },
      ...base.tools,
    ],
  };
  const published = await createPublishedTask({
    definition,
    name: "Calendar ledger UAT",
    operationId: booking.id,
    projectId,
  });
  const snapshot = conversationalTaskSnapshotV1Schema.parse(
    published.version.snapshot,
  );
  const binding = await getTaskCalendarAvailability(snapshot);
  if (!binding) throw new Error("Calendar availability binding missing.");
  const run = await startReadyRun(published.task.id);
  const scope = { binding, projectId, taskRunId: run.taskRunId };
  const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const setField = async (fieldKey: string, value: string) => {
    const now = new Date().toISOString();
    const result = await applyConversationalTaskEvent({
      authentication: null,
      candidates: [
        {
          fieldKey,
          naturalValue: value,
          provenance: { source: "visitor", sourceReference: null },
          state: "candidate",
          validation: { code: null, message: null, valid: false },
        },
      ],
      channelIdentity: {},
      channelType: "project_chat",
      conversationId: run.conversationId,
      correction: true,
      eventId: `calendar-field-${Date.now()}-${fieldKey}`,
      expectedRevision: null,
      occurredAt: now,
      receivedAt: now,
      projectId,
      providerSequence: null,
      schemaVersion: 1,
      taskRunId: run.taskRunId,
      type: "field.candidates",
    });
    expect(result.disposition).toBe("applied");
  };
  const lookup = () =>
    executeTaskReadOperation({
      definition: binding.definition,
      projectId,
      snapshot,
      taskRunId: run.taskRunId,
    });
  const prepare = () =>
    prepareTaskOperationConfirmation({
      projectId,
      taskRunId: run.taskRunId,
      toolId: `operation:${booking.id}`,
    });
  let mode: "available" | "busy" | "failed" = "available";
  let freeBusyCalls = 0;
  const originalFetch = globalThis.fetch;
  let insertedEvent: Record<string, unknown> | null = null;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://oauth2.googleapis.com/token")
      return Response.json({ access_token: "fixture-token", expires_in: 3600 });
    if (String(url).endsWith("/freeBusy")) {
      freeBusyCalls += 1;
      if (mode === "failed")
        return new Response("unavailable", { status: 503 });
      return Response.json({
        calendars: {
          "fixture@example.test": {
            busy:
              mode === "busy"
                ? [{ start: `${date}T00:00:00Z`, end: `${date}T23:59:59Z` }]
                : [],
          },
        },
      });
    }
    if (String(url).includes("/events") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      insertedEvent = {
        id: body.id,
        etag: "fixture-etag",
        status: "confirmed",
        start: body.start,
        end: body.end,
      };
      return Response.json(insertedEvent);
    }
    if (
      String(url).includes("/events/") &&
      init?.method === "GET" &&
      insertedEvent
    )
      return Response.json(insertedEvent);
    throw new Error("Unexpected fixture network request.");
  };
  try {
    await expect(lookup()).rejects.toThrow("not ready");
    expect(freeBusyCalls).toBe(0);
    await setField("preferredDate", date);
    const first = await lookup();
    expect(first.attempt).toMatchObject({
      status: "completed",
      taskRunId: run.taskRunId,
      taskVersionId: published.version.id,
    });
    expect(first.attempt.taskToolRequestId).toBeTruthy();
    expect(first.attempt.traceId).toBeTruthy();
    const available = await readTaskCalendarAvailability(scope);
    expect(available.options.length).toBeGreaterThan(0);
    // A router with no field-transfer whitelist must let the selected task
    // extract the opening message, then bind only a provider-verified time.
    const entryDefinition: ConversationalTaskDefinitionV1 = {
      ...definition,
      fields: [
        ...definition.fields,
        {
          ...base.fields[0],
          id: "10000000-0000-4000-8000-000000000098",
          key: "reason",
          label: "Reason",
          type: "text",
          dependsOn: [],
        },
        {
          ...base.fields[0],
          id: "10000000-0000-4000-8000-000000000097",
          key: "contactNumber",
          label: "Contact Number",
          type: "phone",
          dependsOn: [],
        },
      ],
    };
    const entryTask = await createPublishedTask({
      definition: entryDefinition,
      name: "Opening booking",
      operationId: booking.id,
      projectId,
    });
    const [entryAction] = await db
      .insert(projectActions)
      .values({
        name: "Opening appointment",
        projectId,
        status: "active",
        triggerPhrases: ["appointment"],
      })
      .returning();
    const stepBase = {
      fieldKey: null,
      inputType: null,
      isEnabled: true,
      isRequired: true,
      nextStepId: null,
      operationId: null,
      options: [],
      prompt: null,
    };
    const steps: RuntimeActionStep[] = [
      {
        ...stepBase,
        id: 1,
        sortOrder: 1,
        label: "Router",
        stepType: "knowledge_conversation",
        settings: {
          knowledgeConversation: {
            answeredRoute: "end",
            handoffRoute: "end",
            noAnswerRoute: "end",
            recommendationTargetStepIds: [2],
            remainActiveAfterAnswer: true,
            schemaVersion: 1,
            stageMode: "goal_driven",
          },
        },
      },
      {
        ...stepBase,
        id: 2,
        sortOrder: 2,
        label: "Booking",
        stepType: "conversational_task",
        settings: {
          conversationalTask: {
            schemaVersion: 1,
            outcomeRoutes: { cancelled: "end", completed: "end" },
            task: {
              name: entryTask.task.name,
              outcomes: entryDefinition.outcomes,
              schemaVersion: 1,
              taskId: entryTask.task.id,
              taskVersionId: entryTask.version.id,
              versionNumber: 1,
            },
            transferContextKeys: [],
            transferFieldKeys: [],
          },
        },
      },
    ];
    const [entryVersion] = await db
      .insert(actionFlowVersions)
      .values({
        actionId: entryAction.id,
        projectId,
        status: "published",
        versionNumber: 1,
        snapshot: {
          schemaVersion: 1,
          action: entryAction,
          branchRules: [],
          steps,
          hybridGraph: compileHybridFlowGraph({ branchRules: [], steps }).graph,
        },
      })
      .returning();
    await db
      .update(projectActions)
      .set({ publishedVersionId: entryVersion.id })
      .where(eq(projectActions.id, entryAction.id));
    const action = await getRuntimeProjectAction(projectId, entryAction.id);
    if (!action) throw new Error("Opening action missing");
    const originalExecute = StructuredTurnEngine.prototype.execute;
    try {
      for (const [channelType, clock, fromPrompt, pastedSummary] of [
        ["project_chat", "10:00 am", false],
        ["telnyx_voice", "10:00 am", false],
        ["project_chat", "8:00 pm", false],
        ["project_chat", "10:00 am", true],
        ["project_chat", "10:00 am", true, true],
      ] as const) {
        const text = pastedSummary
          ? `I have noted your preferred appointment on ${date} at ${clock} UTC, patient name Alex Test, email alex@example.com, contact +61491570006, and reason persistent knee pain. How would you like to proceed with confirmation?`
          : `Book on ${date} at ${clock} UTC. My name is Alex Test, email alex@example.com, phone +61491570006, reason persistent knee pain.`;
        const stages: string[] = [];
        StructuredTurnEngine.prototype.execute = async (input) => {
          const starting =
            fromPrompt && input.visitorMessage === "Book an appointment";
          if (!starting) expect(input.visitorMessage).toBe(text);
          stages.push(input.stage);
          const routing = input.stage === "knowledge";
          if (!routing)
            expect(input.activeTask?.task.id).toBe(entryTask.task.id);
          return {
            attempts: 1,
            modelEscalationReason: null,
            source: "model",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            proposal: {
              schemaVersion: 1,
              turnKind: routing
                ? "task_recommendation"
                : fromPrompt && !starting
                  ? "ordinary_question"
                  : "field_answer",
              reply:
                "I have noted your details. How would you like to proceed with confirmation?",
              grounding: { status: "not_needed", excerptIds: [] },
              fieldCandidates:
                routing || starting
                  ? []
                  : Object.entries({
                      guestName: "Alex Test",
                      guestEmail: "alex@example.com",
                      contactNumber: "+61491570006",
                      reason: "persistent knee pain",
                      preferredDate: date,
                      appointmentStart: clock,
                    }).map(([fieldKey, naturalValue]) => ({
                      fieldKey,
                      naturalValue,
                      confidence: 1,
                      source: "visitor" as const,
                    })),
              taskRecommendation: routing
                ? {
                    taskId: entryTask.task.id,
                    confidence: 1,
                    reason: "Visitor requests booking",
                  }
                : null,
              toolRequest: null,
              routeRecommendation: null,
              outcomeRecommendation: null,
              nextAction: "ask",
              ambiguity: { requiresClarification: false, question: null },
              safety: { decision: "allow", reasonCode: null },
              decisionSummary: "Visitor supplied booking details",
              validation: {
                accepted: true,
                modelAttemptCount: 1,
                providerModelId: "fixture",
              },
            },
          };
        };
        const externalConversationId = `opening-${channelType}-${clock}-${fromPrompt}-${Boolean(pastedSummary)}-${suffix}`;
        const [conversation] = await db
          .insert(channelConversations)
          .values({ channelType, externalConversationId, projectId })
          .returning();
        conversationIds.push(conversation.id);
        const browserInput = {
          actionId: entryAction.id,
          channelType,
          conversationId: externalConversationId,
          projectId,
          source: channelType,
        };
        let result: Awaited<ReturnType<typeof runHybridChannelBoundary>>;
        if (fromPrompt) {
          const started = await runBrowserFlowText({
            ...browserInput,
            text: "Book an appointment",
          });
          expect(started.replies.at(-1)?.payload).toMatchObject({
            inputRequest: { fieldKey: "guestName" },
          });
          result = await runBrowserFlowText({ ...browserInput, text });
        } else {
          const [message] = await db
            .insert(channelMessages)
            .values({
              conversationId: conversation.id,
              direction: "inbound",
              messageType: "text",
              projectId,
              text,
            })
            .returning();
          const started = await startChannelFlow({
            action,
            conversationId: externalConversationId,
            projectId,
            source: channelType,
          });
          const [submission] = await db
            .select()
            .from(actionSubmissions)
            .where(
              and(
                eq(actionSubmissions.projectId, projectId),
                eq(actionSubmissions.conversationId, externalConversationId),
              ),
            );
          result = await runHybridChannelBoundary({
            action,
            boundaryNodeId: started.boundaryNodeId ?? "missing",
            channelConversationId: conversation.id,
            channelType,
            externalConversationId,
            inboundMessageId: message.id,
            projectId,
            submission,
            text,
          });
        }
        expect(stages).toEqual(
          fromPrompt
            ? ["knowledge", "extraction", "extraction"]
            : ["knowledge", "extraction"],
        );
        const session = await getConversationTaskRuntimeSession({
          channelType,
          externalConversationId,
          projectId,
        });
        const fields = Object.fromEntries(
          (session.runtime?.fields ?? []).map((field) => [
            field.fieldKey,
            field,
          ]),
        );
        for (const [key, canonicalValue] of Object.entries({
          guestName: "Alex Test",
          guestEmail: "alex@example.com",
          contactNumber: "+61491570006",
          reason: "persistent knee pain",
          preferredDate: date,
        })) {
          expect(fields[key]).toMatchObject({ canonicalValue, state: "valid" });
        }
        if (clock === "10:00 am") {
          expect(fields.appointmentStart).toMatchObject({
            canonicalValue: `${date}T10:00:00.000Z`,
            state: "valid",
          });
          expect(result.replies.map((reply) => reply.text).join(" ")).toContain(
            "Confirm",
          );
        } else {
          expect(fields.appointmentStart.state).not.toBe("valid");
          expect(result.replies[0].payload).toMatchObject({
            inputRequest: { fieldKey: "appointmentStart", inputKind: "choice" },
          });
        }
        expect(insertedEvent).toBeNull();
        if (fromPrompt) {
          expect(result.replies.at(-1)?.payload).toMatchObject({
            inputRequest: { fieldKey: "lia_confirmation" },
          });
          if (!session.runtime) throw new Error("Missing task runtime");
          // Simulate a previous conversational confirmation that had no saved review.
          await db
            .delete(conversationalTaskConfirmations)
            .where(
              and(
                eq(conversationalTaskConfirmations.projectId, projectId),
                eq(
                  conversationalTaskConfirmations.taskRunId,
                  session.runtime.run.id,
                ),
              ),
            );
          StructuredTurnEngine.prototype.execute = async () => {
            throw new Error("Confirmation must not require the model");
          };
          const recovered = await runBrowserFlowText({
            ...browserInput,
            text: "yes",
          });
          expect(recovered.replies.at(-1)?.payload).toMatchObject({
            inputRequest: { fieldKey: "lia_confirmation" },
          });
          expect(insertedEvent).toBeNull();
          const confirmed = await runBrowserFlowText({
            ...browserInput,
            text: "yes",
          });
          expect(
            confirmed.replies.map((reply) => reply.text).join(" "),
          ).toContain("submitted successfully");
          expect(insertedEvent).not.toBeNull();
          expect(confirmed.activeFlow).toBeNull();
          const writes = await db
            .select()
            .from(operationAttempts)
            .where(
              and(
                eq(operationAttempts.projectId, projectId),
                eq(operationAttempts.taskRunId, session.runtime.run.id),
                eq(operationAttempts.operationId, booking.id),
              ),
            );
          expect(writes).toHaveLength(1);
          insertedEvent = null;
        }
      }
    } finally {
      StructuredTurnEngine.prototype.execute = originalExecute;
    }
    const resumeInput = {
      channelType: "project_chat" as const,
      externalConversationId: run.externalConversationId,
      projectId,
    };
    const resumed = await buildHybridChannelResumeReplies(resumeInput);
    expect(resumed[0].payload).toMatchObject({
      inputRequest: { inputKind: "choice", options: available.options },
    });
    await setField("appointmentStart", "10:00 AM");
    await expect(prepare()).rejects.toThrow("provider-verified");
    await setField("appointmentStart", available.options[0].value);
    // A pause while collecting identity must not discard a previously offered slot.
    await db
      .update(operationAttempts)
      .set({ finishedAt: new Date(Date.now() - 301_000) })
      .where(eq(operationAttempts.id, first.attempt.id));
    expect((await readTaskCalendarAvailability(scope)).options).toEqual([]);
    const fieldsBeforeRefresh = (await getConversationalTaskRuntime(scope))
      ?.fields;
    const beforeExpiredRefresh = freeBusyCalls;
    const refreshed = await refreshExpiredTaskCalendarAvailability({
      ...scope,
      snapshot,
    });
    expect(freeBusyCalls).toBe(beforeExpiredRefresh + 1);
    expect(refreshed.options).toEqual(available.options);
    expect((await getConversationalTaskRuntime(scope))?.fields).toEqual(
      fieldsBeforeRefresh,
    );
    await refreshExpiredTaskCalendarAvailability({ ...scope, snapshot });
    expect(freeBusyCalls).toBe(beforeExpiredRefresh + 1);
    if (!refreshed.attempt) throw new Error("Refreshed lookup missing.");
    await db
      .update(operationAttempts)
      .set({ finishedAt: new Date(Date.now() - 301_000) })
      .where(eq(operationAttempts.id, refreshed.attempt.id));
    const beforeRefresh = freeBusyCalls;
    const confirmation = await prepare();
    expect(freeBusyCalls).toBe(beforeRefresh + 1);
    expect(confirmation.canonicalInput.start).toBe(available.options[0].value);
    await confirmTaskOperation({
      confirmationId: confirmation.id,
      principal,
      projectId,
      taskRunId: run.taskRunId,
    });
    mode = "busy";
    await expect(
      executeConfirmedTaskOperation({
        confirmationId: confirmation.id,
        principal,
        projectId,
        taskRunId: run.taskRunId,
      }),
    ).rejects.toThrow("no longer available");
    expect((await readTaskCalendarAvailability(scope)).options).toEqual([]);
    const writes = await db
      .select()
      .from(operationAttempts)
      .where(
        and(
          eq(operationAttempts.projectId, projectId),
          eq(operationAttempts.taskRunId, run.taskRunId),
          eq(operationAttempts.operationId, booking.id),
        ),
      );
    expect(writes).toEqual([]);
    mode = "failed";
    const failure = await lookup();
    expect(failure.attempt.status).toBe("failed");
    expect((await readTaskCalendarAvailability(scope)).options).toEqual([]);
    const runtime = await getConversationalTaskRuntime(scope);
    expect(runtime?.tools).toContainEqual(
      expect.objectContaining({
        id: failure.attempt.taskToolRequestId,
        status: "provider_failure",
      }),
    );
    await expect(prepare()).rejects.toThrow("provider-verified");
    const recovered = await buildHybridChannelResumeReplies(resumeInput);
    expect(recovered[0].payload).toMatchObject({
      inputRequest: {
        fieldKey: "preferredDate",
        inputKind: "date",
        options: [],
      },
    });
    mode = "available";
    await lookup();
    const fresh = await readTaskCalendarAvailability(scope);
    await setField("appointmentStart", fresh.options[0].value);
    const ready = await prepare();
    await confirmTaskOperation({
      confirmationId: ready.id,
      principal,
      projectId,
      taskRunId: run.taskRunId,
    });
    await executeConfirmedTaskOperation({
      confirmationId: ready.id,
      principal,
      projectId,
      taskRunId: run.taskRunId,
    });
    const completed = await processAndReconcileTaskOperation({
      confirmationId: ready.id,
      principal,
      projectId,
      workerId: `calendar-success-${suffix}`,
    });
    expect(completed.businessOutcome).toBe("success");
    expect(completed.attempt.responsePayload.status).toBe("success");
    expect((await getConversationalTaskRuntime(scope))?.run.status).toBe(
      "completed",
    );
    expect(insertedEvent).not.toBeNull();

    const find = await createOperation({
      name: "Find fixture appointment",
      projectId,
      providerId: provider.id,
      operationType: "google_calendar.lookup",
      inputMapping: {
        patientName: "fields.guestName",
        patientEmail: "fields.guestEmail",
      },
      outputMapping: {
        "fields.appointmentRef":
          "responsePayload.appointments.0.appointmentRef",
      },
    });
    const reschedule = await createOperation({
      name: "Reschedule fixture appointment",
      projectId,
      providerId: provider.id,
      operationType: "google_calendar.reschedule",
      inputMapping: {
        patientName: "fields.guestName",
        appointmentRef: "fields.appointmentRef",
        newStart: "fields.appointmentStart",
      },
      outputMapping: {},
    });
    const rescheduleTask = await createPublishedTask({
      name: "Identity first fixture",
      projectId,
      operationId: reschedule.id,
      definition: {
        ...definition,
        fields: [
          ...base.fields,
          {
            ...base.fields[0],
            id: "10000000-0000-4000-8000-000000000098",
            key: "appointmentRef",
            label: "Appointment reference",
            dependsOn: [],
          },
          ...definition.fields.slice(base.fields.length),
        ],
        tools: [
          {
            access: "read",
            allowedStages: ["lookup"],
            tool: { id: `operation:${find.id}`, version: 1 },
          },
          {
            access: "write",
            allowedStages: ["operation"],
            tool: { id: `operation:${reschedule.id}`, version: 1 },
          },
        ],
      },
    });
    const lookupSnapshot = conversationalTaskSnapshotV1Schema.parse(
      rescheduleTask.version.snapshot,
    );
    const findForRun = (taskRunId: number) =>
      executeRequiredTaskFieldLookup({
        projectId,
        taskRunId,
        requestId: `automatic-lookup-${taskRunId}`,
        snapshot: lookupSnapshot,
      });
    for (const channel of ["project_chat", "telnyx_voice"] as const) {
      const identityRun = await startReadyRun(rescheduleTask.task.id, channel);
      await db
        .update(conversationalTaskFieldValues)
        .set({ state: "cleared" })
        .where(
          and(
            eq(conversationalTaskFieldValues.taskRunId, identityRun.taskRunId),
            eq(conversationalTaskFieldValues.fieldKey, "guestEmail"),
          ),
        );
      expect(await findForRun(identityRun.taskRunId)).toEqual({
        status: "not_needed",
      });
      expect(
        (
          await getConversationalTaskRuntime({
            projectId,
            taskRunId: identityRun.taskRunId,
          })
        )?.tools,
      ).toHaveLength(0);
      await db
        .update(conversationalTaskFieldValues)
        .set({ state: "valid" })
        .where(
          and(
            eq(conversationalTaskFieldValues.taskRunId, identityRun.taskRunId),
            eq(conversationalTaskFieldValues.fieldKey, "guestEmail"),
          ),
        );
      expect(await findForRun(identityRun.taskRunId)).toEqual({
        status: "success",
      });
      const found = await getConversationalTaskRuntime({
        projectId,
        taskRunId: identityRun.taskRunId,
      });
      expect(found?.fields).toContainEqual(
        expect.objectContaining({
          fieldKey: "appointmentRef",
          state: "valid",
          canonicalValue: completed.attempt.responsePayload.appointmentRef,
        }),
      );
      const next = await buildHybridChannelResumeReplies({
        projectId,
        channelType: channel,
        externalConversationId: identityRun.externalConversationId,
      });
      expect(next[0].payload).toMatchObject({
        inputRequest: { fieldKey: "preferredDate" },
      });
      expect(await findForRun(identityRun.taskRunId)).toEqual({
        status: "not_needed",
      });
      expect(
        (
          await getConversationalTaskRuntime({
            projectId,
            taskRunId: identityRun.taskRunId,
          })
        )?.tools,
      ).toHaveLength(1);
    }
    const missingRun = await startReadyRun(rescheduleTask.task.id);
    await db
      .update(conversationalTaskFieldValues)
      .set({ canonicalValue: "No Matching Patient" })
      .where(
        and(
          eq(conversationalTaskFieldValues.taskRunId, missingRun.taskRunId),
          eq(conversationalTaskFieldValues.fieldKey, "guestName"),
        ),
      );
    expect(await findForRun(missingRun.taskRunId)).toMatchObject({
      status: "blocked",
      reply: expect.stringContaining("could not find a matching appointment"),
    });
    const [stored] = await db
      .select()
      .from(googleCalendarAppointments)
      .where(
        and(
          eq(googleCalendarAppointments.projectId, projectId),
          eq(googleCalendarAppointments.providerId, provider.id),
          eq(
            googleCalendarAppointments.reference,
            String(completed.attempt.responsePayload.appointmentRef),
          ),
        ),
      );
    await db.insert(googleCalendarAppointments).values({
      ...stored,
      id: undefined,
      reference: "apt_fixture_multiple",
      remoteEventId: "fixture-multiple",
      operationKeyHash: "fixture-multiple",
    });
    const multipleRun = await startReadyRun(rescheduleTask.task.id);
    expect(await findForRun(multipleRun.taskRunId)).toMatchObject({
      status: "choice",
      inputRequest: {
        fieldKey: "appointmentRef",
        inputKind: "choice",
        options: expect.any(Array),
      },
    });
    for (const blockedRun of [missingRun, multipleRun]) {
      const blocked = await getConversationalTaskRuntime({
        projectId,
        taskRunId: blockedRun.taskRunId,
      });
      expect(
        blocked?.fields.find(({ fieldKey }) => fieldKey === "appointmentRef")
          ?.state,
      ).toBe("missing");
      const attempts = await db
        .select()
        .from(operationAttempts)
        .where(eq(operationAttempts.taskRunId, blockedRun.taskRunId));
      expect(attempts.map(({ operationId }) => operationId)).toEqual([find.id]);
    }
    const pendingChoice = await readPendingTaskAppointmentChoice({
      projectId,
      taskRunId: multipleRun.taskRunId,
      snapshot: lookupSnapshot,
    });
    expect(pendingChoice?.appointments).toHaveLength(2);
    const resumedChoices = await buildHybridChannelResumeReplies({
      projectId,
      channelType: "project_chat",
      externalConversationId: multipleRun.externalConversationId,
    });
    expect(resumedChoices[0].payload).toMatchObject({
      inputRequest: {
        inputKind: "choice",
        options: pendingChoice?.inputRequest.options,
      },
    });
    const choose = (answer: string, requestId: string) =>
      executeRequiredTaskFieldLookup({
        projectId,
        taskRunId: multipleRun.taskRunId,
        snapshot: lookupSnapshot,
        requestId,
        selection: { fieldKey: "appointmentRef", answer },
      });
    expect(
      await choose("apt_another_patient", "invalid-appointment-choice"),
    ).toMatchObject({ status: "choice" });
    // Even an expired offer must be rechecked, then the exact selected appointment maps.
    await db
      .update(operationAttempts)
      .set({ finishedAt: new Date(Date.now() - 301_000) })
      .where(eq(operationAttempts.taskRunId, multipleRun.taskRunId));
    expect(
      await choose("the second one", "verified-appointment-choice"),
    ).toEqual({ status: "success" });
    const selectedRuntime = await getConversationalTaskRuntime({
      projectId,
      taskRunId: multipleRun.taskRunId,
    });
    expect(selectedRuntime?.fields).toContainEqual(
      expect.objectContaining({
        fieldKey: "appointmentRef",
        state: "valid",
        canonicalValue: pendingChoice?.appointments[1].appointmentRef,
      }),
    );
    expect(selectedRuntime?.tools).toHaveLength(2);
    expect(selectedRuntime?.confirmations).toHaveLength(0);
    expect(
      (
        await buildHybridChannelResumeReplies({
          projectId,
          channelType: "project_chat",
          externalConversationId: multipleRun.externalConversationId,
        })
      )[0].payload,
    ).toMatchObject({ inputRequest: { fieldKey: "preferredDate" } });

    // A changed identity invalidates the resolved reference; arbitrary caller refs are ignored.
    const changedAt = new Date().toISOString();
    await applyConversationalTaskEvent({
      authentication: null,
      channelIdentity: {},
      channelType: "project_chat",
      conversationId: multipleRun.conversationId,
      correction: true,
      eventId: "change-appointment-identity",
      expectedRevision: selectedRuntime?.execution?.revision ?? null,
      occurredAt: changedAt,
      receivedAt: changedAt,
      projectId,
      providerSequence: null,
      schemaVersion: 1,
      taskRunId: multipleRun.taskRunId,
      type: "field.candidates",
      candidates: [
        {
          canonicalValue: "Another Patient",
          naturalValue: "Another Patient",
          fieldKey: "guestName",
          provenance: { source: "visitor", sourceReference: null },
          state: "valid",
          validation: { code: null, message: null, valid: true },
        },
        {
          canonicalValue: "forged-reference",
          naturalValue: "forged-reference",
          fieldKey: "appointmentRef",
          provenance: { source: "visitor", sourceReference: null },
          state: "valid",
          validation: { code: null, message: null, valid: true },
        },
      ],
    });
    const changedRuntime = await getConversationalTaskRuntime({
      projectId,
      taskRunId: multipleRun.taskRunId,
    });
    expect(
      changedRuntime?.fields.find(
        (field) => field.fieldKey === "appointmentRef",
      )?.state,
    ).not.toBe("valid");
    expect(
      await readPendingTaskAppointmentChoice({
        projectId,
        taskRunId: multipleRun.taskRunId,
        snapshot: lookupSnapshot,
      }),
    ).toBeNull();
    expect(
      await readPendingTaskAppointmentChoice({
        projectId: projectId + 999_999,
        taskRunId: multipleRun.taskRunId,
        snapshot: lookupSnapshot,
      }),
    ).toBeNull();

    // The same contract works through a non-Google adapter and a voice session.
    const genericProvider = await createIntegrationProvider({
      config: { url: "https://appointments.example.test/lookup" },
      name: "Appointment adapter fixture",
      projectId,
      providerType: "webhook",
      status: "active",
    });
    const genericLookup = await createOperation({
      projectId,
      providerId: genericProvider.id,
      name: "Universal appointment lookup",
      operationType: "appointment.lookup",
      inputMapping: {
        patientName: "fields.guestName",
        patientEmail: "fields.guestEmail",
      },
      outputMapping: {
        "fields.appointmentRef":
          "responsePayload.appointments.0.appointmentRef",
      },
      status: "active",
    });
    const genericAvailability = await createOperation({
      projectId,
      providerId: genericProvider.id,
      name: "Universal availability",
      operationType: "appointment.availability",
      inputMapping: { date: "fields.preferredDate" },
      outputMapping: {},
      status: "active",
    });
    const genericReschedule = await createOperation({
      projectId,
      providerId: genericProvider.id,
      name: "Universal reschedule",
      operationType: "appointment.reschedule",
      inputMapping: {
        patientName: "fields.guestName",
        patientEmail: "fields.guestEmail",
        appointmentRef: "fields.appointmentRef",
        newStart: "fields.appointmentStart",
      },
      outputMapping: {},
      status: "active",
    });
    const genericTask = await createPublishedTask({
      name: "Universal appointment selection",
      projectId,
      operationId: genericLookup.id,
      definition: {
        ...lookupSnapshot.task.definition,
        tools: [
          {
            access: "read",
            allowedStages: ["lookup"],
            tool: { id: `operation:${genericAvailability.id}`, version: 1 },
          },
          {
            access: "write",
            allowedStages: ["operation"],
            tool: { id: `operation:${genericReschedule.id}`, version: 1 },
          },
          {
            access: "read",
            allowedStages: ["lookup"],
            tool: { id: `operation:${genericLookup.id}`, version: 1 },
          },
        ],
      },
    });
    const genericSnapshot = conversationalTaskSnapshotV1Schema.parse(
      genericTask.version.snapshot,
    );
    const genericRun = await startReadyRun(genericTask.task.id, "telnyx_voice");
    const calendarFetch = globalThis.fetch;
    let adapterAppointments = pendingChoice?.appointments ?? [];
    const genericWrites: Record<string, unknown>[] = [];
    const newSlot = {
      start: new Date(Date.now() + 8 * 86_400_000).toISOString(),
      end: new Date(Date.now() + 8 * 86_400_000 + 30 * 60_000).toISOString(),
      spoken: "Fixture available appointment time",
    };
    globalThis.fetch = async (resource, init) => {
      if (!String(resource).startsWith("https://appointments.example.test/"))
        return calendarFetch(resource, init);
      const request = JSON.parse(String(init?.body));
      let response: Record<string, unknown> = {
        status: "success",
        appointments: adapterAppointments,
      };
      if (request.operationType === "appointment.availability")
        response = {
          status: "success",
          date: request.payload.date,
          slots: [newSlot],
        };
      if (request.operationType === "appointment.reschedule") {
        genericWrites.push(request.payload);
        response = {
          status: "success",
          appointmentRef: request.payload.appointmentRef,
          ...newSlot,
        };
      }
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const genericFind = (requestId: string, answer?: string) =>
      executeRequiredTaskFieldLookup({
        projectId,
        taskRunId: genericRun.taskRunId,
        snapshot: genericSnapshot,
        requestId,
        ...(answer
          ? { selection: { fieldKey: "appointmentRef", answer } }
          : {}),
      });
    expect(await genericFind("generic-offer")).toMatchObject({
      status: "choice",
    });
    expect(
      (
        await buildHybridChannelResumeReplies({
          projectId,
          channelType: "telnyx_voice",
          externalConversationId: genericRun.externalConversationId,
        })
      )[0].payload,
    ).toMatchObject({ inputRequest: { inputKind: "choice" } });
    // Simulate the first displayed appointment starting while the caller decides.
    // Its position must not disappear from the cached numbered offer.
    await db
      .update(operationAttempts)
      .set({
        finishedAt: new Date(Date.now() - 120_000),
        responsePayload: {
          status: "success",
          appointments: [
            {
              ...adapterAppointments[0],
              start: new Date(Date.now() - 60_000).toISOString(),
              end: new Date(Date.now() + 29 * 60_000).toISOString(),
            },
            adapterAppointments[1],
          ],
        },
      })
      .where(eq(operationAttempts.taskRunId, genericRun.taskRunId));
    // The offered appointment disappeared: do not silently choose the remaining one.
    adapterAppointments = adapterAppointments.slice(1);
    expect(await genericFind("generic-changed", "first")).toMatchObject({
      status: "choice",
      reply: expect.stringContaining("appointments have changed"),
    });
    expect(await genericFind("generic-selected", "first")).toEqual({
      status: "success",
    });
    expect(
      (
        await getConversationalTaskRuntime({
          projectId,
          taskRunId: genericRun.taskRunId,
        })
      )?.fields,
    ).toContainEqual(
      expect.objectContaining({
        fieldKey: "appointmentRef",
        state: "valid",
        canonicalValue: adapterAppointments[0].appointmentRef,
      }),
    );
    for (const [fieldKey, canonicalValue] of [
      ["preferredDate", newSlot.start.slice(0, 10)],
      ["appointmentStart", newSlot.start],
    ]) {
      await db
        .update(conversationalTaskFieldValues)
        .set({ canonicalValue, naturalValue: canonicalValue, state: "valid" })
        .where(
          and(
            eq(conversationalTaskFieldValues.taskRunId, genericRun.taskRunId),
            eq(conversationalTaskFieldValues.fieldKey, fieldKey),
          ),
        );
    }
    const genericBinding = await getTaskCalendarAvailability(genericSnapshot);
    expect(genericBinding?.definition.id).toBe(
      `operation:${genericAvailability.id}`,
    );
    if (!genericBinding)
      throw new Error("Generic availability binding missing");
    await executeTaskReadOperation({
      projectId,
      taskRunId: genericRun.taskRunId,
      snapshot: genericSnapshot,
      definition: genericBinding.definition,
      requestId: "generic-availability",
    });
    const genericConfirmation = await prepareTaskOperationConfirmation({
      projectId,
      taskRunId: genericRun.taskRunId,
      toolId: `operation:${genericReschedule.id}`,
    });
    expect(genericWrites).toHaveLength(0);
    await expect(
      executeConfirmedTaskOperation({
        confirmationId: genericConfirmation.id,
        principal,
        projectId,
        taskRunId: genericRun.taskRunId,
      }),
    ).rejects.toThrow();
    expect(genericWrites).toHaveLength(0);
    await confirmTaskOperation({
      confirmationId: genericConfirmation.id,
      principal,
      projectId,
      taskRunId: genericRun.taskRunId,
    });
    await executeConfirmedTaskOperation({
      confirmationId: genericConfirmation.id,
      principal,
      projectId,
      taskRunId: genericRun.taskRunId,
    });
    await processAndReconcileTaskOperation({
      confirmationId: genericConfirmation.id,
      principal,
      projectId,
      workerId: "generic-reschedule-fixture",
    });
    expect(genericWrites).toEqual([
      {
        patientName: "UAT Guest",
        patientEmail: "uat.guest@example.com",
        appointmentRef: adapterAppointments[0].appointmentRef,
        newStart: newSlot.start,
      },
    ]);
    const cancelOperation = await createOperation({
      projectId,
      providerId: genericProvider.id,
      name: "Cancel Calendar Appointment",
      operationType: "appointment.cancel",
      inputMapping: {
        appointmentRef: "fields.appointmentRef",
        patientName: "fields.guestName",
        patientEmail: "fields.guestEmail",
      },
      outputMapping: {},
      status: "active",
    });
    const cancelTask = await createPublishedTask({
      name: "Cancel appointment review",
      projectId,
      operationId: cancelOperation.id,
      definition: {
        ...lookupSnapshot.task.definition,
        fields: lookupSnapshot.task.definition.fields.slice(0, 3),
        tools: [
          {
            access: "read",
            allowedStages: ["lookup"],
            tool: { id: `operation:${genericLookup.id}`, version: 1 },
          },
          {
            access: "write",
            allowedStages: ["operation"],
            tool: { id: `operation:${cancelOperation.id}`, version: 1 },
          },
        ],
      },
    });
    const cancelSnapshot = conversationalTaskSnapshotV1Schema.parse(
      cancelTask.version.snapshot,
    );
    const cancelRun = await startReadyRun(cancelTask.task.id);
    adapterAppointments = adapterAppointments.map((item) => ({
      ...item,
      appointmentReason: "Persistent knee pain",
      timezone: "Australia/Sydney",
    }));
    await executeRequiredTaskFieldLookup({
      projectId,
      taskRunId: cancelRun.taskRunId,
      snapshot: cancelSnapshot,
      requestId: "cancel-review-lookup",
    });
    const cancelReplies = await buildHybridChannelResumeReplies({
      projectId,
      channelType: "project_chat",
      externalConversationId: cancelRun.externalConversationId,
    });
    expect(cancelReplies[0].text).toContain("Appointment Start:");
    expect(cancelReplies[0].text).toContain("Appointment End:");
    expect(cancelReplies[0].text).toContain("(Australia/Sydney)");
    expect(cancelReplies[0].text).toContain(
      "Appointment Reason: Persistent knee pain",
    );
    expect(cancelReplies[0].text).toContain(
      adapterAppointments[0].appointmentRef,
    );
    const cancellation = (
      await getConversationalTaskRuntime({
        projectId,
        taskRunId: cancelRun.taskRunId,
      })
    )?.confirmations[0];
    if (!cancellation) throw new Error("Cancellation confirmation missing");
    expect(cancellation.summary).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          key: "appointment.reason",
          value: "Persistent knee pain",
        }),
      ]),
    });
    await confirmTaskOperation({
      projectId,
      taskRunId: cancelRun.taskRunId,
      confirmationId: cancellation.id,
      principal,
    });
    adapterAppointments = adapterAppointments.map((item) => ({
      ...item,
      appointmentReason: "Changed reason",
    }));
    await expect(
      executeConfirmedTaskOperation({
        projectId,
        taskRunId: cancelRun.taskRunId,
        confirmationId: cancellation.id,
        principal,
      }),
    ).rejects.toThrow("Review and confirm again");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
