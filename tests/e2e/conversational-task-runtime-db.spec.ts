import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import { conversationalTaskSnapshotV1Schema } from "../../src/lib/conversation-contracts";
import {
  applyConversationalTaskEvent,
  cleanupExpiredConversationRuntime,
  deleteConversationRuntimeData,
  exportConversationRuntimeData,
  getConversationalTaskRuntime,
  startConversationalTaskRun,
  switchConversationalTaskRun,
} from "../../src/lib/conversational-task-runtime";
import { db } from "../../src/lib/db-config";
import {
  channelConversations,
  channelMessages,
  companies,
  conversationalTaskRuns,
  conversationalTasks,
  conversationalTaskVersions,
  conversationInboundEvents,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

test.describe.configure({ mode: "serial" });

const startedAt = new Date("2026-07-25T10:00:00.000Z");
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const runtimeTaskDefinition = {
  ...REFERENCE_BOOKING_TASK_DEFINITION,
  tools: [
    {
      access: "read" as const,
      allowedStages: ["lookup" as const],
      tool: { id: "availability_lookup", version: 1 },
    },
  ],
};

let fixture:
  | {
      conversationId: number;
      projectId: number;
      otherProjectId: number;
      taskId: number;
      targetTaskId: number;
      unpublishedTaskId: number;
      taskVersionId: number;
      targetVersionId: number;
      userId: number;
      companyId: number;
      workspaceId: number;
    }
  | undefined;
let activeRunId: number;
let activeRevision: number;
let providerSequence = 0;

function timestamp(offsetMinutes: number) {
  return new Date(
    startedAt.getTime() + offsetMinutes * 60 * 1000,
  ).toISOString();
}

function eventEnvelope(type: string, offsetMinutes: number) {
  providerSequence += 1;
  return {
    authentication: null,
    channelIdentity: { browserSession: "runtime-db-test" },
    channelType: "project_chat",
    conversationId: fixture?.conversationId as number,
    eventId: `${type}-${suffix}-${providerSequence}`,
    expectedRevision: activeRevision,
    occurredAt: timestamp(offsetMinutes),
    projectId: fixture?.projectId as number,
    providerSequence,
    receivedAt: timestamp(offsetMinutes),
    schemaVersion: 1 as const,
    taskRunId: activeRunId,
  };
}

test.beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: `task-runtime-${suffix}@example.com`,
      name: "Task Runtime Test",
      passwordHash: "test-only",
    })
    .returning();
  const [company] = await db
    .insert(companies)
    .values({
      name: `Task Runtime ${suffix}`,
      ownerUserId: user.id,
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({
      companyId: company.id,
      name: `Task Runtime ${suffix}`,
      ownerUserId: user.id,
    })
    .returning();
  const [project, otherProject] = await db
    .insert(projects)
    .values([
      {
        name: `Task Runtime ${suffix}`,
        ownerUserId: user.id,
        workspaceId: workspace.id,
      },
      {
        name: `Other Runtime ${suffix}`,
        ownerUserId: user.id,
        workspaceId: workspace.id,
      },
    ])
    .returning();
  const [task, targetTask, unpublishedTask] = await db
    .insert(conversationalTasks)
    .values([
      {
        definition: runtimeTaskDefinition,
        name: "Book a Service",
        objective: "Collect and confirm a service request.",
        projectId: project.id,
      },
      {
        definition: runtimeTaskDefinition,
        name: "Change a Service",
        objective: "Collect a replacement service request.",
        projectId: project.id,
      },
      {
        definition: runtimeTaskDefinition,
        name: "Unpublished Service Task",
        objective: "Remain unavailable until published.",
        projectId: project.id,
      },
    ])
    .returning();

  const taskSnapshot = conversationalTaskSnapshotV1Schema.parse({
    schemaVersion: 1,
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    assistantPolicy: REFERENCE_BOOKING_PROJECT_POLICY.assistant,
    conversationPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
    task: {
      id: task.id,
      schemaVersion: 1,
      name: task.name,
      objective: task.objective,
      description: null,
      definition: runtimeTaskDefinition,
    },
  });
  const targetSnapshot = conversationalTaskSnapshotV1Schema.parse({
    ...taskSnapshot,
    task: {
      ...taskSnapshot.task,
      id: targetTask.id,
      name: targetTask.name,
      objective: targetTask.objective,
    },
  });
  const [taskVersion, targetVersion] = await db
    .insert(conversationalTaskVersions)
    .values([
      {
        projectId: project.id,
        snapshot: taskSnapshot,
        taskId: task.id,
        versionNumber: 1,
      },
      {
        projectId: project.id,
        snapshot: targetSnapshot,
        taskId: targetTask.id,
        versionNumber: 1,
      },
    ])
    .returning();
  const [conversation] = await db
    .insert(channelConversations)
    .values({
      channelType: "project_chat",
      externalConversationId: `runtime-${suffix}`,
      projectId: project.id,
    })
    .returning();

  fixture = {
    companyId: company.id,
    conversationId: conversation.id,
    otherProjectId: otherProject.id,
    projectId: project.id,
    targetTaskId: targetTask.id,
    targetVersionId: targetVersion.id,
    taskId: task.id,
    taskVersionId: taskVersion.id,
    unpublishedTaskId: unpublishedTask.id,
    userId: user.id,
    workspaceId: workspace.id,
  };
});

test.afterAll(async () => {
  if (!fixture) return;
  await deleteConversationRuntimeData({
    conversationId: fixture.conversationId,
    includeMessages: true,
    projectId: fixture.projectId,
  });
  await db
    .delete(channelConversations)
    .where(
      and(
        eq(channelConversations.id, fixture.conversationId),
        eq(channelConversations.projectId, fixture.projectId),
      ),
    );
  await db
    .delete(conversationalTaskVersions)
    .where(eq(conversationalTaskVersions.projectId, fixture.projectId));
  await db
    .delete(conversationalTasks)
    .where(eq(conversationalTasks.projectId, fixture.projectId));
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

test("starts a version-pinned run and replays the same event once", async () => {
  const input = {
    anonymousVisitorId: `visitor-${suffix}`,
    authenticatedUserId: null,
    channelIdentity: { browserSession: "runtime-db-test" },
    channelType: "project_chat",
    conversationId: fixture?.conversationId as number,
    eventId: `start-${suffix}`,
    identityKind: "anonymous" as const,
    initializationContext: { lia_timezone: "Asia/Kolkata" },
    occurredAt: timestamp(0),
    projectId: fixture?.projectId as number,
    providerSequence: null,
    receivedAt: timestamp(0),
    sessionExpiresAt: timestamp(60),
    sessionId: `session-${suffix}`,
    taskId: fixture?.taskId as number,
    verifiedContactId: null,
  };

  const started = await startConversationalTaskRun(input);
  const replayed = await startConversationalTaskRun(input);

  expect(started).toMatchObject({
    disposition: "applied",
    reason: null,
    revision: 1,
  });
  expect(replayed).toMatchObject({
    disposition: "applied",
    reason: "duplicate_event",
    taskRunId: started.taskRunId,
  });
  activeRunId = started.taskRunId as number;
  activeRevision = started.revision as number;

  const runtime = await getConversationalTaskRuntime({
    projectId: fixture?.projectId as number,
    taskRunId: activeRunId,
  });
  expect(runtime?.run.taskVersionId).toBe(fixture?.taskVersionId);
  expect(runtime?.fields).toHaveLength(
    REFERENCE_BOOKING_TASK_DEFINITION.fields.length,
  );
  expect(runtime?.context).toContainEqual(
    expect.objectContaining({
      key: "lia_timezone",
      value: "Asia/Kolkata",
    }),
  );
});

test("rejects completion while required fields remain incomplete", async () => {
  const result = await applyConversationalTaskEvent({
    ...eventEnvelope("premature-completion", 1),
    type: "task.complete",
    outcomeKey: "completed",
  });

  expect(result).toMatchObject({
    disposition: "quarantined",
    reason: "required_fields_incomplete",
  });
  const runtime = await getConversationalTaskRuntime({
    projectId: fixture?.projectId as number,
    taskRunId: activeRunId,
  });
  expect(runtime?.run.status).toBe("active");
});

test("applies multiple values once and preserves canonical field state", async () => {
  const event = {
    ...eventEnvelope("field-candidates", 2),
    type: "field.candidates" as const,
    correction: false,
    candidates: [
      {
        fieldKey: "serviceCategoryId",
        naturalValue: "Massage",
        canonicalValue: "massage",
        state: "valid" as const,
        provenance: { source: "visitor" as const, sourceReference: null },
        validation: { code: null, message: null, valid: true },
      },
      {
        fieldKey: "serviceId",
        naturalValue: "Deep Tissue",
        canonicalValue: "deep_tissue",
        state: "valid" as const,
        provenance: { source: "visitor" as const, sourceReference: null },
        validation: { code: null, message: null, valid: true },
      },
    ],
  };
  const applied = await applyConversationalTaskEvent(event);
  const replayed = await applyConversationalTaskEvent(event);
  activeRevision = applied.revision as number;

  expect(applied.disposition).toBe("applied");
  expect(replayed).toMatchObject({
    disposition: "applied",
    reason: "duplicate_event",
    revision: activeRevision,
  });
  const runtime = await getConversationalTaskRuntime({
    projectId: fixture?.projectId as number,
    taskRunId: activeRunId,
  });
  expect(runtime?.fields).toContainEqual(
    expect.objectContaining({
      canonicalValue: "deep_tissue",
      fieldKey: "serviceId",
      naturalValue: "Deep Tissue",
      state: "valid",
    }),
  );
});

test("suspends for a side question and resumes the requested field", async () => {
  const requested = await applyConversationalTaskEvent({
    ...eventEnvelope("field-requested", 3),
    type: "field.requested",
    fieldKey: "preferredDate",
  });
  activeRevision = requested.revision as number;
  const suspended = await applyConversationalTaskEvent({
    ...eventEnvelope("side-question", 4),
    type: "task.side_question",
    category: "business_hours",
  });
  activeRevision = suspended.revision as number;

  let runtime = await getConversationalTaskRuntime({
    projectId: fixture?.projectId as number,
    taskRunId: activeRunId,
  });
  expect(runtime?.execution).toMatchObject({
    responseOwner: "knowledge",
    suspendedReturnTarget: {
      lastRequestedFieldKey: "preferredDate",
      taskRunId: activeRunId,
    },
  });

  const blockedMutation = await applyConversationalTaskEvent({
    ...eventEnvelope("side-question-field-mutation", 5),
    type: "field.candidates",
    correction: false,
    candidates: [
      {
        fieldKey: "guestName",
        naturalValue: "Blocked during Q&A",
        canonicalValue: "Blocked during Q&A",
        state: "valid",
        provenance: { source: "visitor", sourceReference: null },
        validation: { code: null, message: null, valid: true },
      },
    ],
  });
  expect(blockedMutation).toMatchObject({
    disposition: "quarantined",
    reason: "inactive_response_owner",
  });

  const resumed = await applyConversationalTaskEvent({
    ...eventEnvelope("side-question-resolved", 6),
    type: "task.side_question_resolved",
  });
  activeRevision = resumed.revision as number;
  runtime = await getConversationalTaskRuntime({
    projectId: fixture?.projectId as number,
    taskRunId: activeRunId,
  });
  expect(runtime?.execution).toMatchObject({
    responseOwner: "task",
    suspendedReturnTarget: null,
  });
  expect(runtime?.run.lastRequestedFieldKey).toBe("preferredDate");
});

test("corrects dependencies, clears fields, and quarantines stale turns", async () => {
  const corrected = await applyConversationalTaskEvent({
    ...eventEnvelope("correction", 7),
    type: "field.candidates",
    correction: true,
    candidates: [
      {
        fieldKey: "serviceCategoryId",
        naturalValue: "Facial",
        canonicalValue: "facial",
        state: "valid",
        provenance: { source: "visitor", sourceReference: null },
        validation: { code: null, message: null, valid: true },
      },
    ],
  });
  activeRevision = corrected.revision as number;
  let runtime = await getConversationalTaskRuntime({
    projectId: fixture?.projectId as number,
    taskRunId: activeRunId,
  });
  expect(runtime?.fields).toContainEqual(
    expect.objectContaining({
      fieldKey: "serviceId",
      state: "candidate",
      validation: expect.objectContaining({ code: "dependency_changed" }),
    }),
  );

  const cleared = await applyConversationalTaskEvent({
    ...eventEnvelope("clear", 8),
    type: "field.clear",
    fieldKey: "serviceId",
    reason: "visitor_correction",
  });
  activeRevision = cleared.revision as number;
  runtime = await getConversationalTaskRuntime({
    projectId: fixture?.projectId as number,
    taskRunId: activeRunId,
  });
  expect(runtime?.fields).toContainEqual(
    expect.objectContaining({
      canonicalValue: null,
      fieldKey: "serviceId",
      state: "cleared",
    }),
  );

  const stale = await applyConversationalTaskEvent({
    ...eventEnvelope("stale", 9),
    expectedRevision: activeRevision - 1,
    type: "field.requested",
    fieldKey: "guestName",
  });
  expect(stale).toMatchObject({
    disposition: "quarantined",
    reason: "stale_revision",
  });

  const outOfOrder = await applyConversationalTaskEvent({
    ...eventEnvelope("out-of-order", 10),
    providerSequence: providerSequence - 2,
    type: "field.requested",
    fieldKey: "guestName",
  });
  expect(outOfOrder).toMatchObject({
    disposition: "quarantined",
    reason: "out_of_order_provider_sequence",
  });
});

test("serializes concurrent turns and records authenticated tool results", async () => {
  const first = {
    ...eventEnvelope("concurrent-guest-email", 11),
    type: "field.candidates" as const,
    correction: false,
    candidates: [
      {
        fieldKey: "guestEmail",
        naturalValue: "first@example.com",
        canonicalValue: "first@example.com",
        state: "valid" as const,
        provenance: { source: "visitor" as const, sourceReference: null },
        validation: { code: null, message: null, valid: true },
      },
    ],
  };
  const second = {
    ...eventEnvelope("concurrent-guest-phone", 11),
    expectedRevision: first.expectedRevision,
    type: "field.candidates" as const,
    correction: false,
    candidates: [
      {
        fieldKey: "guestPhone",
        naturalValue: "+919988776655",
        canonicalValue: "+919988776655",
        state: "valid" as const,
        provenance: { source: "visitor" as const, sourceReference: null },
        validation: { code: null, message: null, valid: true },
      },
    ],
  };
  const concurrentResults = await Promise.all([
    applyConversationalTaskEvent(first),
    applyConversationalTaskEvent(second),
  ]);
  expect(
    concurrentResults.filter((result) => result.disposition === "applied"),
  ).toHaveLength(1);
  expect(
    concurrentResults.filter(
      (result) =>
        result.disposition === "conflict" ||
        (result.disposition === "quarantined" &&
          result.reason === "stale_revision"),
    ),
  ).toHaveLength(1);
  const applied = concurrentResults.find(
    (result) => result.disposition === "applied",
  );
  activeRevision = applied?.revision as number;

  const requested = await applyConversationalTaskEvent({
    ...eventEnvelope("tool-requested", 12),
    type: "tool.requested",
    idempotencyKey: `availability-${suffix}`,
    input: { preferredDate: "2026-08-15" },
    requestId: `availability-${suffix}`,
    requestMode: "synchronous",
    stage: "lookup",
    timeoutAt: timestamp(20),
    toolId: "availability_lookup",
  });
  activeRevision = requested.revision as number;
  const completed = await applyConversationalTaskEvent({
    ...eventEnvelope("tool-result", 13),
    type: "tool.result",
    authentication: {
      keyId: "runtime-db-test",
      kind: "hmac",
      principal: "test-provider",
      verifiedAt: timestamp(13),
    },
    errorCode: null,
    requestId: `availability-${suffix}`,
    result: { available: true },
    status: "completed",
  });
  activeRevision = completed.revision as number;

  const runtime = await getConversationalTaskRuntime({
    projectId: fixture?.projectId as number,
    taskRunId: activeRunId,
  });
  expect(runtime?.tools).toContainEqual(
    expect.objectContaining({
      requestId: `availability-${suffix}`,
      status: "completed",
      taskVersionId: fixture?.taskVersionId,
      toolId: "availability_lookup",
    }),
  );
});

test("pauses, rotates the session, resumes, and switches tasks", async () => {
  const paused = await applyConversationalTaskEvent({
    ...eventEnvelope("pause", 14),
    type: "task.pause",
    boundary: "no_reply",
    reason: "visitor_inactive",
    resumeAt: null,
    returnTarget: { fieldKey: "guestName" },
  });
  activeRevision = paused.revision as number;
  const blockedMutation = await applyConversationalTaskEvent({
    ...eventEnvelope("paused-field-mutation", 15),
    type: "field.candidates",
    correction: false,
    candidates: [
      {
        fieldKey: "guestName",
        naturalValue: "Blocked while paused",
        canonicalValue: "Blocked while paused",
        state: "valid",
        provenance: { source: "visitor", sourceReference: null },
        validation: { code: null, message: null, valid: true },
      },
    ],
  });
  expect(blockedMutation).toMatchObject({
    disposition: "quarantined",
    reason: "task_not_active",
  });
  expect(
    (
      await getConversationalTaskRuntime({
        projectId: fixture?.projectId as number,
        taskRunId: activeRunId,
      })
    )?.fields.find((field) => field.fieldKey === "guestName")?.state,
  ).toBe("missing");

  const rotated = await applyConversationalTaskEvent({
    ...eventEnvelope("rotate", 16),
    type: "session.rotate",
    sessionId: `rotated-${suffix}`,
    sessionExpiresAt: timestamp(120),
  });
  activeRevision = rotated.revision as number;
  const resumed = await applyConversationalTaskEvent({
    ...eventEnvelope("resume", 17),
    type: "task.resume",
    reason: "visitor_returned",
  });
  activeRevision = resumed.revision as number;

  await expect(
    switchConversationalTaskRun({
      channelIdentity: { browserSession: "runtime-db-test" },
      channelType: "project_chat",
      conversationId: fixture?.conversationId as number,
      currentTaskRunId: activeRunId,
      eventId: `unpublished-switch-${suffix}`,
      initializationContext: { lia_timezone: "Asia/Kolkata" },
      occurredAt: timestamp(18),
      projectId: fixture?.projectId as number,
      receivedAt: timestamp(18),
      targetTaskId: fixture?.unpublishedTaskId as number,
    }),
  ).rejects.toThrow("The target task has no published version.");
  expect(
    (
      await getConversationalTaskRuntime({
        projectId: fixture?.projectId as number,
        taskRunId: activeRunId,
      })
    )?.run.status,
  ).toBe("active");

  const switched = await switchConversationalTaskRun({
    channelIdentity: { browserSession: "runtime-db-test" },
    channelType: "project_chat",
    conversationId: fixture?.conversationId as number,
    currentTaskRunId: activeRunId,
    eventId: `switch-${suffix}`,
    initializationContext: { lia_timezone: "Asia/Kolkata" },
    occurredAt: timestamp(19),
    projectId: fixture?.projectId as number,
    receivedAt: timestamp(19),
    targetTaskId: fixture?.targetTaskId as number,
  });
  expect(switched.cancel.disposition).toBe("applied");
  expect(switched.start).toMatchObject({
    disposition: "applied",
    reason: null,
  });

  const previousRun = await getConversationalTaskRuntime({
    projectId: fixture?.projectId as number,
    taskRunId: activeRunId,
  });
  expect(previousRun?.run.status).toBe("cancelled");
  activeRunId = switched.start?.taskRunId as number;
  activeRevision = switched.start?.revision as number;
  const currentRun = await getConversationalTaskRuntime({
    projectId: fixture?.projectId as number,
    taskRunId: activeRunId,
  });
  expect(currentRun?.run.taskVersionId).toBe(fixture?.targetVersionId);
  expect(currentRun?.execution).toMatchObject({
    activeTaskRunId: activeRunId,
    responseOwner: "task",
    sessionId: `rotated-${suffix}`,
  });
});

test("keeps runtime reads and writes inside the project boundary", async () => {
  expect(
    await getConversationalTaskRuntime({
      projectId: fixture?.otherProjectId as number,
      taskRunId: activeRunId,
    }),
  ).toBeNull();

  await expect(
    applyConversationalTaskEvent({
      ...eventEnvelope("wrong-project", 20),
      projectId: fixture?.otherProjectId as number,
      type: "field.requested",
      fieldKey: "guestEmail",
    }),
  ).rejects.toThrow("Conversation does not belong to the project and channel.");
});

test("exports, expires, and deletes conversation data without cross-project effects", async () => {
  await db.insert(channelMessages).values([
    {
      conversationId: fixture?.conversationId as number,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      direction: "inbound",
      projectId: fixture?.projectId as number,
      text: "Expired test message",
    },
    {
      conversationId: fixture?.conversationId as number,
      createdAt: new Date(),
      direction: "inbound",
      projectId: fixture?.projectId as number,
      text: "Current test message",
    },
  ]);
  const exported = await exportConversationRuntimeData({
    conversationId: fixture?.conversationId as number,
    projectId: fixture?.projectId as number,
  });
  expect(exported.runs.length).toBeGreaterThanOrEqual(2);
  expect(exported.audit.length).toBeGreaterThan(0);

  await db
    .update(conversationalTaskRuns)
    .set({ expiresAt: new Date("2025-01-01T00:00:00.000Z") })
    .where(
      and(
        eq(conversationalTaskRuns.id, activeRunId),
        eq(conversationalTaskRuns.projectId, fixture?.projectId as number),
      ),
    );
  const cleaned = await cleanupExpiredConversationRuntime({
    now: new Date(),
    projectId: fixture?.projectId as number,
  });
  expect(cleaned).toMatchObject({
    abandonedRuns: 1,
    expiredMessages: 1,
  });

  const deleted = await deleteConversationRuntimeData({
    conversationId: fixture?.conversationId as number,
    projectId: fixture?.projectId as number,
  });
  expect(deleted.deletedRuns).toBeGreaterThanOrEqual(2);
  expect(
    await db
      .select()
      .from(conversationInboundEvents)
      .where(
        and(
          eq(conversationInboundEvents.projectId, fixture?.projectId as number),
          eq(
            conversationInboundEvents.conversationId,
            fixture?.conversationId as number,
          ),
        ),
      ),
  ).toHaveLength(0);
});
