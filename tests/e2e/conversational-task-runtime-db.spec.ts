import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import {
  getNormalizedChannelInboundRuntimeValue,
  normalizeChannelInboundV1,
} from "../../src/lib/channel-inbound-contract";
import {
  CHANNEL_METADATA_LAST_INBOUND_AT,
  type ChannelType,
  getOrCreateChannelConversation,
  recordChannelInboundMessage,
} from "../../src/lib/channels";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import {
  conversationalTaskSnapshotV1Schema,
  type ToolDefinitionV1,
} from "../../src/lib/conversation-contracts";
import {
  listProjectTaskResourceOptions,
  resolveProjectTaskResource,
} from "../../src/lib/conversational-task-project-resources";
import {
  applyConversationalTaskEvent,
  cleanupExpiredConversationRuntime,
  deleteConversationRuntimeData,
  exportConversationRuntimeData,
  getConversationalTaskRuntime,
  startConversationalTaskRun,
  switchConversationalTaskRun,
} from "../../src/lib/conversational-task-runtime";
import { getConversationTaskRuntimeSession } from "../../src/lib/conversational-task-runtime-session";
import { resolveProjectTaskToolDefinition } from "../../src/lib/conversational-task-tools";
import { db } from "../../src/lib/db-config";
import {
  catalogProducts,
  channelConversations,
  channelMessages,
  companies,
  contacts,
  conversationalTaskRuns,
  conversationalTasks,
  conversationalTaskVersions,
  conversationInboundEvents,
  productCatalogs,
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
      tool: { id: "catalog.service_price", version: 1 },
    },
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
      catalogId: number;
      facialCatalogId: number;
      serviceProductId: number;
      otherCatalogId: number;
      otherProductId: number;
    }
  | undefined;
let activeRunId: number;
let activeRevision: number;
let providerSequence = 0;
const certificationConversationIds: number[] = [];
const certificationContactIds: number[] = [];

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

function availabilityToolDefinition(projectId: number): ToolDefinitionV1 {
  return {
    access: "read",
    description: "Read a provider-confirmed availability result.",
    execution: {
      adapter: "operation",
      cancellation: "best_effort",
      handler: "availability_lookup",
      mode: "synchronous",
      retryAttempts: 0,
      retryDelayMs: 0,
      timeoutMs: 5_000,
    },
    id: "availability_lookup",
    inputSchema: { fields: [] },
    name: "Availability Lookup",
    outputSchema: {
      fields: [{ path: "available", required: true, type: "boolean" }],
    },
    projectId,
    requiredForCompletion: false,
    resultMappings: [
      {
        freshnessMinutes: 5,
        modelVisible: true,
        sourcePath: "available",
        target: "context",
        targetKey: "serviceAvailable",
        toolVisible: true,
        type: "boolean",
      },
    ],
    schemaVersion: 1,
    version: 1,
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
  const [catalog, facialCatalog, otherCatalog] = await db
    .insert(productCatalogs)
    .values([
      {
        name: "Massage",
        projectId: project.id,
      },
      {
        name: "Facial",
        projectId: project.id,
      },
      {
        name: `Other Catalog ${suffix}`,
        projectId: otherProject.id,
      },
    ])
    .returning();
  const [serviceProduct, otherProduct] = await db
    .insert(catalogProducts)
    .values([
      {
        catalogId: catalog.id,
        currency: "INR",
        description: "A focused massage service.",
        metadata: {
          available: true,
          availabilityStatus: "available",
          durationMinutes: 75,
        },
        name: "Deep Tissue",
        priceAmount: 15_000,
        projectId: project.id,
      },
      {
        catalogId: otherCatalog.id,
        currency: "INR",
        name: `Foreign Service ${suffix}`,
        priceAmount: 999,
        projectId: otherProject.id,
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

  const servicePriceTool = await resolveProjectTaskToolDefinition({
    definition: runtimeTaskDefinition,
    projectId: project.id,
    toolId: "catalog.service_price",
    version: 1,
  });
  if (!servicePriceTool) {
    throw new Error("Could not build the reference service-price tool.");
  }
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
    toolDefinitions: [servicePriceTool, availabilityToolDefinition(project.id)],
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
    catalogId: catalog.id,
    conversationId: conversation.id,
    facialCatalogId: facialCatalog.id,
    otherCatalogId: otherCatalog.id,
    otherProjectId: otherProject.id,
    otherProductId: otherProduct.id,
    projectId: project.id,
    serviceProductId: serviceProduct.id,
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
  for (const conversationId of certificationConversationIds) {
    await deleteConversationRuntimeData({
      conversationId,
      includeMessages: true,
      projectId: fixture.projectId,
    });
    await db
      .delete(channelConversations)
      .where(
        and(
          eq(channelConversations.id, conversationId),
          eq(channelConversations.projectId, fixture.projectId),
        ),
      );
  }
  for (const contactId of certificationContactIds) {
    await db
      .delete(contacts)
      .where(
        and(
          eq(contacts.id, contactId),
          eq(contacts.projectId, fixture.projectId),
        ),
      );
  }
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
    .delete(catalogProducts)
    .where(eq(catalogProducts.projectId, fixture.projectId));
  await db
    .delete(catalogProducts)
    .where(eq(catalogProducts.projectId, fixture.otherProjectId));
  await db
    .delete(productCatalogs)
    .where(eq(productCatalogs.projectId, fixture.projectId));
  await db
    .delete(productCatalogs)
    .where(eq(productCatalogs.projectId, fixture.otherProjectId));
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

test("resolves legacy generic resource fields inside the selected project", async () => {
  const categoryField = {
    ...REFERENCE_BOOKING_TASK_DEFINITION.fields[0],
    optionSource: null,
  };
  const serviceField = {
    ...REFERENCE_BOOKING_TASK_DEFINITION.fields[1],
    optionSource: null,
  };
  const category = await resolveProjectTaskResource({
    field: categoryField,
    fieldValues: new Map(),
    projectId: fixture?.projectId as number,
    value: "Massage",
  });
  const service = await resolveProjectTaskResource({
    field: serviceField,
    fieldValues: new Map([
      ["serviceCategoryId", `catalog:${fixture?.catalogId}`],
    ]),
    projectId: fixture?.projectId as number,
    value: "Deep Tissue",
  });

  expect(category).toEqual({
    id: `catalog:${fixture?.catalogId}`,
    label: "Massage",
    status: "resolved",
  });
  expect(service).toEqual({
    id: `product:${fixture?.serviceProductId}`,
    label: "Deep Tissue",
    status: "resolved",
  });
});

test("lists scoped catalog choices for channel input controls", async () => {
  const [categoryField, serviceField] =
    REFERENCE_BOOKING_TASK_DEFINITION.fields;
  const legacyCategoryField = { ...categoryField, optionSource: null };
  const legacyServiceField = { ...serviceField, optionSource: null };
  const categories = await listProjectTaskResourceOptions({
    field: categoryField,
    fieldValues: new Map(),
    projectId: fixture?.projectId as number,
  });
  const services = await listProjectTaskResourceOptions({
    field: serviceField,
    fieldValues: new Map([
      ["serviceCategoryId", `catalog:${fixture?.catalogId}`],
    ]),
    projectId: fixture?.projectId as number,
  });
  const legacyCategories = await listProjectTaskResourceOptions({
    field: legacyCategoryField,
    fieldValues: new Map(),
    projectId: fixture?.projectId as number,
  });
  const legacyServices = await listProjectTaskResourceOptions({
    field: legacyServiceField,
    fieldValues: new Map([
      ["serviceCategoryId", `catalog:${fixture?.catalogId}`],
    ]),
    projectId: fixture?.projectId as number,
  });

  expect(categories).toEqual([
    { id: `catalog:${fixture?.facialCatalogId}`, label: "Facial" },
    { id: `catalog:${fixture?.catalogId}`, label: "Massage" },
  ]);
  expect(services).toEqual([
    { id: `product:${fixture?.serviceProductId}`, label: "Deep Tissue" },
  ]);
  expect(legacyCategories).toEqual(categories);
  expect(legacyServices).toEqual(services);
  expect([...categories, ...services].map((option) => option.id)).not.toContain(
    `product:${fixture?.otherProductId}`,
  );
});

test("certifies identical booking fields and outcomes across live channel types", async () => {
  const channels: ChannelType[] = ["project_chat", "widget", "whatsapp"];

  const results = await Promise.all(
    channels.map(async (channelType, channelIndex) => {
      const externalConversationId = `phase13-${channelType}-${suffix}`;
      const [conversation] = await db
        .insert(channelConversations)
        .values({
          channelType,
          externalConversationId,
          projectId: fixture?.projectId as number,
        })
        .returning();
      certificationConversationIds.push(conversation.id);

      const channelIdentity = {
        externalConversationId,
        externalUserId: `phase13-visitor-${channelType}-${suffix}`,
      };
      const occurredAt = timestamp(30 + channelIndex);
      const started = await startConversationalTaskRun({
        anonymousVisitorId: channelIdentity.externalUserId,
        authenticatedUserId: null,
        channelIdentity,
        channelType,
        conversationId: conversation.id,
        eventId: `phase13-start-${channelType}-${suffix}`,
        identityKind: "anonymous",
        initializationContext: { lia_timezone: "Asia/Kolkata" },
        occurredAt,
        projectId: fixture?.projectId as number,
        providerSequence: null,
        receivedAt: occurredAt,
        sessionExpiresAt: timestamp(120),
        sessionId: externalConversationId,
        taskId: fixture?.taskId as number,
        verifiedContactId: null,
      });
      expect(started.disposition).toBe("applied");

      const categoryValue = getNormalizedChannelInboundRuntimeValue(
        normalizeChannelInboundV1({
          channelType,
          selection: {
            id: `task-field:serviceCategoryId:catalog:${fixture?.catalogId}`,
            label: "Massage",
            value: `catalog:${fixture?.catalogId}`,
          },
          text: "Massage",
        }),
      );
      const serviceValue = getNormalizedChannelInboundRuntimeValue(
        normalizeChannelInboundV1({
          channelType,
          selection: {
            id: `task-field:serviceId:product:${fixture?.serviceProductId}`,
            label: "Deep Tissue",
            value: `product:${fixture?.serviceProductId}`,
          },
          text: "Deep Tissue",
        }),
      );
      const textValue = (text: string) =>
        getNormalizedChannelInboundRuntimeValue(
          normalizeChannelInboundV1({ channelType, text }),
        );
      expect(categoryValue).toBe(`catalog:${fixture?.catalogId}`);
      expect(serviceValue).toBe(`product:${fixture?.serviceProductId}`);

      const fieldsApplied = await applyConversationalTaskEvent({
        authentication: null,
        candidates: [
          {
            canonicalValue: categoryValue,
            fieldKey: "serviceCategoryId",
            naturalValue: categoryValue,
            provenance: { source: "visitor", sourceReference: null },
            state: "valid",
            validation: { code: null, message: null, valid: true },
          },
          {
            canonicalValue: serviceValue,
            fieldKey: "serviceId",
            naturalValue: serviceValue,
            provenance: { source: "visitor", sourceReference: null },
            state: "valid",
            validation: { code: null, message: null, valid: true },
          },
          ...[
            ["preferredDate", "2026-08-10"],
            ["preferredTime", "14:00"],
            ["guestName", "Priya Sharma"],
            ["guestEmail", "phase13@example.com"],
            ["guestPhone", "+919988776655"],
          ].map(([fieldKey, text]) => ({
            canonicalValue: textValue(text),
            fieldKey,
            naturalValue: textValue(text),
            provenance: { source: "visitor" as const, sourceReference: null },
            state: "valid" as const,
            validation: { code: null, message: null, valid: true },
          })),
        ],
        channelIdentity,
        channelType,
        conversationId: conversation.id,
        correction: false,
        eventId: `phase13-fields-${channelType}-${suffix}`,
        expectedRevision: started.revision as number,
        occurredAt,
        projectId: fixture?.projectId as number,
        providerSequence: 1,
        receivedAt: occurredAt,
        schemaVersion: 1,
        taskRunId: started.taskRunId as number,
        type: "field.candidates",
      });
      expect(fieldsApplied.disposition).toBe("applied");

      const completed = await applyConversationalTaskEvent({
        authentication: null,
        channelIdentity,
        channelType,
        conversationId: conversation.id,
        eventId: `phase13-complete-${channelType}-${suffix}`,
        expectedRevision: fieldsApplied.revision as number,
        occurredAt,
        outcomeKey: "completed",
        projectId: fixture?.projectId as number,
        providerSequence: 2,
        receivedAt: occurredAt,
        schemaVersion: 1,
        taskRunId: started.taskRunId as number,
        type: "task.complete",
      });
      expect(completed.disposition).toBe("applied");

      const runtime = await getConversationalTaskRuntime({
        projectId: fixture?.projectId as number,
        taskRunId: started.taskRunId as number,
      });
      return {
        fields: Object.fromEntries(
          runtime?.fields.map((field) => [
            field.fieldKey,
            field.canonicalValue,
          ]) ?? [],
        ),
        outcomeKey: runtime?.run.outcomeKey,
        status: runtime?.run.status,
        taskVersionId: runtime?.run.taskVersionId,
      };
    }),
  );

  expect(results).toHaveLength(3);
  expect(results[0]).toMatchObject({
    outcomeKey: "completed",
    status: "completed",
    taskVersionId: fixture?.taskVersionId,
  });
  expect(results[1]).toEqual(results[0]);
  expect(results[2]).toEqual(results[0]);
});

test("deduplicates replayed WhatsApp provider messages before runtime effects", async () => {
  const externalConversationId = `phase13-whatsapp-replay-${suffix}`;
  const externalMessageId = `wamid.phase13.${suffix}`;
  const input = {
    channelType: "whatsapp" as const,
    externalConversationId,
    externalMessageId,
    externalUserId: externalConversationId,
    messageType: "text",
    payload: { whatsappMessageId: externalMessageId },
    projectId: fixture?.projectId as number,
    text: "Book a massage",
  };

  const first = await recordChannelInboundMessage(input);
  certificationConversationIds.push(first.conversation.id);
  if (first.conversation.contactId) {
    certificationContactIds.push(first.conversation.contactId);
  }
  const replay = await recordChannelInboundMessage(input);

  expect(first.duplicate).toBe(false);
  expect(replay).toMatchObject({
    duplicate: true,
    message: { id: first.message.id },
  });
  await expect(
    db
      .select({ id: channelMessages.id })
      .from(channelMessages)
      .where(
        and(
          eq(channelMessages.projectId, fixture?.projectId as number),
          eq(channelMessages.conversationId, first.conversation.id),
          eq(channelMessages.externalMessageId, externalMessageId),
        ),
      ),
  ).resolves.toHaveLength(1);
});

test("preserves the inbound timestamp when conversation metadata is extended", async () => {
  const externalConversationId = `phase13-whatsapp-metadata-${suffix}`;
  const inbound = await recordChannelInboundMessage({
    channelType: "whatsapp",
    externalConversationId,
    externalUserId: externalConversationId,
    metadata: { channelId: 1 },
    projectId: fixture?.projectId as number,
    text: "Book a facial",
  });
  certificationConversationIds.push(inbound.conversation.id);
  if (inbound.conversation.contactId) {
    certificationContactIds.push(inbound.conversation.contactId);
  }
  const lastInboundMessageAt =
    inbound.conversation.metadata[CHANNEL_METADATA_LAST_INBOUND_AT];

  const updated = await getOrCreateChannelConversation({
    channelType: "whatsapp",
    externalConversationId,
    externalUserId: externalConversationId,
    metadata: { channelId: 2 },
    projectId: fixture?.projectId as number,
  });

  expect(updated.metadata).toMatchObject({
    channelId: 2,
    [CHANNEL_METADATA_LAST_INBOUND_AT]: lastInboundMessageAt,
  });
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
        canonicalValue: "client-supplied-category",
        state: "valid" as const,
        provenance: { source: "visitor" as const, sourceReference: null },
        validation: { code: null, message: null, valid: true },
      },
      {
        fieldKey: "serviceId",
        naturalValue: "Deep Tissue",
        canonicalValue: "client-supplied-service",
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
      canonicalValue: `product:${fixture?.serviceProductId}`,
      fieldKey: "serviceId",
      naturalValue: "Deep Tissue",
      state: "valid",
    }),
  );
  expect(runtime?.fields).toContainEqual(
    expect.objectContaining({
      canonicalValue: `catalog:${fixture?.catalogId}`,
      fieldKey: "serviceCategoryId",
      state: "valid",
    }),
  );
});

test("executes a pinned built-in lookup and stores only approved facts", async () => {
  const completed = await applyConversationalTaskEvent({
    ...eventEnvelope("service-price", 3),
    idempotencyKey: `service-price-${suffix}`,
    input: {
      serviceId: `product:${fixture?.serviceProductId}`,
    },
    requestId: `service-price-${suffix}`,
    requestMode: "synchronous",
    stage: "lookup",
    timeoutAt: timestamp(30),
    toolId: "catalog.service_price",
    type: "tool.requested",
  });
  activeRevision = completed.revision as number;

  expect(completed.disposition).toBe("applied");
  const runtime = await getConversationalTaskRuntime({
    projectId: fixture?.projectId as number,
    taskRunId: activeRunId,
  });
  expect(runtime?.tools).toContainEqual(
    expect.objectContaining({
      input: { serviceId: `product:${fixture?.serviceProductId}` },
      requestId: `service-price-${suffix}`,
      result: { amount: 150, currency: "INR" },
      status: "success",
      toolId: "catalog.service_price",
    }),
  );
  expect(runtime?.context).toContainEqual(
    expect.objectContaining({
      key: "servicePriceAmount",
      source: "tool",
      value: 150,
    }),
  );
  expect(runtime?.context).toContainEqual(
    expect.objectContaining({
      key: "servicePriceCurrency",
      source: "tool",
      value: "INR",
    }),
  );
});

test("rejects a resource owned by another project", async () => {
  const rejected = await applyConversationalTaskEvent({
    ...eventEnvelope("foreign-service", 4),
    candidates: [
      {
        canonicalValue: `product:${fixture?.serviceProductId}`,
        fieldKey: "serviceId",
        naturalValue: `product:${fixture?.otherProductId}`,
        provenance: { source: "visitor", sourceReference: null },
        state: "valid",
        validation: { code: null, message: null, valid: true },
      },
    ],
    correction: true,
    type: "field.candidates",
  });
  activeRevision = rejected.revision as number;
  let runtime = await getConversationalTaskRuntime({
    projectId: fixture?.projectId as number,
    taskRunId: activeRunId,
  });
  expect(runtime?.fields).toContainEqual(
    expect.objectContaining({
      canonicalValue: null,
      fieldKey: "serviceId",
      state: "invalid",
      validation: expect.objectContaining({
        code: "project_resource_not_found",
      }),
    }),
  );

  const restored = await applyConversationalTaskEvent({
    ...eventEnvelope("restore-service", 5),
    candidates: [
      {
        canonicalValue: "ignored",
        fieldKey: "serviceId",
        naturalValue: "Deep Tissue",
        provenance: { source: "visitor", sourceReference: null },
        state: "valid",
        validation: { code: null, message: null, valid: true },
      },
    ],
    correction: true,
    type: "field.candidates",
  });
  activeRevision = restored.revision as number;
  runtime = await getConversationalTaskRuntime({
    projectId: fixture?.projectId as number,
    taskRunId: activeRunId,
  });
  expect(runtime?.fields).toContainEqual(
    expect.objectContaining({
      canonicalValue: `product:${fixture?.serviceProductId}`,
      fieldKey: "serviceId",
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

  const delayedWithoutSequence = await applyConversationalTaskEvent({
    ...eventEnvelope("delayed-without-sequence", 7),
    providerSequence: null,
    type: "field.requested",
    fieldKey: "guestName",
  });
  expect(delayedWithoutSequence).toMatchObject({
    disposition: "quarantined",
    reason: "out_of_order_occurred_at",
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
    input: {},
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
    result: { available: true, providerSecret: "must-not-persist" },
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
      result: { available: true },
      status: "success",
      taskVersionId: fixture?.taskVersionId,
      toolId: "availability_lookup",
    }),
  );
  expect(runtime?.context).toContainEqual(
    expect.objectContaining({
      key: "serviceAvailable",
      source: "tool",
      value: true,
    }),
  );
});

test("records every tool outcome and invalidates an older business fact", async () => {
  const outcomes = [
    {
      errorCode: "no_available_slots",
      status: "no_result" as const,
    },
    {
      errorCode: "ambiguous_result",
      status: "rejected" as const,
    },
    {
      errorCode: "tool_timeout",
      status: "timeout" as const,
    },
    {
      errorCode: "provider_down",
      status: "provider_failure" as const,
    },
    {
      errorCode: "cancelled_by_user",
      status: "cancelled" as const,
    },
  ];

  for (const [index, outcome] of outcomes.entries()) {
    const requestId = `availability-${outcome.status}-${suffix}`;
    const requested = await applyConversationalTaskEvent({
      ...eventEnvelope(`tool-requested-${outcome.status}`, 13.1 + index / 10),
      idempotencyKey: requestId,
      input: {},
      requestId,
      requestMode: "synchronous",
      stage: "lookup",
      timeoutAt: timestamp(30),
      toolId: "availability_lookup",
      type: "tool.requested",
    });
    activeRevision = requested.revision as number;
    const completed = await applyConversationalTaskEvent({
      ...eventEnvelope(`tool-result-${outcome.status}`, 13.15 + index / 10),
      authentication: {
        keyId: "runtime-db-test",
        kind: "hmac",
        principal: "test-provider",
        verifiedAt: timestamp(13.15 + index / 10),
      },
      errorCode: outcome.errorCode,
      requestId,
      result: { available: true, providerSecret: "must-not-persist" },
      status: outcome.status,
      type: "tool.result",
    });
    activeRevision = completed.revision as number;
  }

  const runtime = await getConversationalTaskRuntime({
    projectId: fixture?.projectId as number,
    taskRunId: activeRunId,
  });
  for (const outcome of outcomes) {
    expect(runtime?.tools).toContainEqual(
      expect.objectContaining({
        errorCode: outcome.errorCode,
        result: null,
        status: outcome.status,
      }),
    );
  }
  expect(runtime?.context.some(({ key }) => key === "serviceAvailable")).toBe(
    false,
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
  const session = await getConversationTaskRuntimeSession({
    channelType: "project_chat",
    externalConversationId: `runtime-${suffix}`,
    projectId: fixture?.projectId as number,
  });
  expect(session.safeAudit.map((event) => event.eventType)).toEqual(
    expect.arrayContaining(["task.cancel", "task.started"]),
  );
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
