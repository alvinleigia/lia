import { expect, test } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import {
  type ConversationalTaskDefinitionV1,
  conversationalTaskSnapshotV1Schema,
} from "../../src/lib/conversation-contracts";
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
import { resolveProjectTaskToolDefinition } from "../../src/lib/conversational-task-tools";
import { db } from "../../src/lib/db-config";
import {
  channelConversations,
  companies,
  conversationalTasks,
  conversationalTaskVersions,
  conversationExecutionStates,
  conversationInboundEvents,
  durableJobs,
  integrationProviders,
  operationAttempts,
  operations,
  outboxMessages,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import {
  claimNextDurableJob,
  failDurableJob,
} from "../../src/lib/durable-jobs";
import {
  createIntegrationProvider,
  createOperation,
  processProjectDurableOperationQueue,
} from "../../src/lib/operations";
import { processProjectOutboxQueue } from "../../src/lib/outbox";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

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
  name: string;
  operationId: number;
  projectId: number;
}) {
  const definition = operationTaskDefinition(input.operationId);
  const [task] = await db
    .insert(conversationalTasks)
    .values({
      definition,
      name: input.name,
      objective: "Collect contact details and submit one confirmed request.",
      projectId: input.projectId,
    })
    .returning();
  const toolDefinition = await resolveProjectTaskToolDefinition({
    definition,
    projectId: input.projectId,
    toolId: `operation:${input.operationId}`,
    version: 1,
  });
  if (!toolDefinition) {
    throw new Error("Could not build the operation tool definition.");
  }
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
    toolDefinitions: [toolDefinition],
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

async function startReadyRun(taskId: number) {
  if (!fixture) throw new Error("The operation fixture is not ready.");
  const [conversation] = await db
    .insert(channelConversations)
    .values({
      channelType: "project_chat",
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
    channelType: "project_chat",
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
    channelType: "project_chat",
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
    .delete(conversationalTaskVersions)
    .where(eq(conversationalTaskVersions.projectId, fixture.projectId));
  await db
    .delete(conversationalTasks)
    .where(eq(conversationalTasks.projectId, fixture.projectId));
  await db
    .delete(operations)
    .where(eq(operations.projectId, fixture.projectId));
  await db
    .delete(integrationProviders)
    .where(eq(integrationProviders.projectId, fixture.projectId));
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
