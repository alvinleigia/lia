import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  createActionFlowStep,
  createPublishedActionFlowVersion,
} from "../../src/lib/action-flows";
import { runBrowserFlowText } from "../../src/lib/browser-flow-runtime";
import { DEFAULT_CONVERSATION_PROJECT_POLICY } from "../../src/lib/conversation-contracts";
import {
  getConversationQualityEvidence,
  getProjectQualityDashboard,
} from "../../src/lib/conversation-quality-store";
import { recordConversationQualityTurn } from "../../src/lib/conversation-quality-telemetry";
import { StructuredTurnEngine } from "../../src/lib/conversation-turn-engine";
import { db } from "../../src/lib/db-config";
import {
  actionFlowSteps,
  actionFlowVersions,
  actionSubmissionEvents,
  actionSubmissions,
  channelConversations,
  companies,
  conversationalTaskAuditEvents,
  durableJobs,
  flowRuntimeCommands,
  integrationProviders,
  operationAttempts,
  operations,
  projectActions,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import {
  claimNextDurableJob,
  enqueueDurableJob,
  failDurableJob,
} from "../../src/lib/durable-jobs";
import {
  processProjectDurableOperationQueue,
  queueOperationForSubmission,
  replayOperationAttempt,
  runOperationPreview,
} from "../../src/lib/operations";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

const suffix = randomUUID();
let fixture: {
  userId: number;
  companyId: number;
  workspaceId: number;
  projectId: number;
  foreignProjectId: number;
  actionId: number;
  conversationId: number;
  submissionId: number;
  dateStepId: number;
};
let server: Server;
let endpoint: string;
let received = 0;
let behavior: "read_retry" | "write_error" | "network" | "permanent" =
  "read_retry";

test.beforeAll(async () => {
  server = createServer((request, response) => {
    received += 1;
    request.resume();
    if (behavior === "network") {
      request.socket.destroy();
      return;
    }
    response.statusCode =
      behavior === "permanent"
        ? 401
        : behavior === "read_retry" && received > 1
          ? 200
          : 503;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: response.statusCode === 200 }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing mock provider address");
  endpoint = `http://127.0.0.1:${address.port}`;
  fixture = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: `recovery-${suffix}@example.test`,
        name: "Recovery Test",
        passwordHash: "test-only",
      })
      .returning();
    const [company] = await tx
      .insert(companies)
      .values({ ownerUserId: user.id, name: `Recovery ${suffix}` })
      .returning();
    const [workspace] = await tx
      .insert(workspaces)
      .values({
        ownerUserId: user.id,
        companyId: company.id,
        name: `Recovery ${suffix}`,
      })
      .returning();
    const [project, foreign] = await tx
      .insert(projects)
      .values(
        ["A", "B"].map((part) => ({
          ownerUserId: user.id,
          workspaceId: workspace.id,
          name: `Recovery ${part} ${suffix}`,
        })),
      )
      .returning();
    const [action] = await tx
      .insert(projectActions)
      .values({
        projectId: project.id,
        name: "Recovery flow",
        status: "active",
      })
      .returning();
    const [conversation] = await tx
      .insert(channelConversations)
      .values({
        projectId: project.id,
        channelType: "project_chat",
        externalConversationId: suffix,
      })
      .returning();
    const [submission] = await tx
      .insert(actionSubmissions)
      .values({
        projectId: project.id,
        actionId: action.id,
        source: "project_chat",
        conversationId: suffix,
        revision: 2,
        fields: { preferredDate: "2027-01-02" },
      })
      .returning();
    return {
      userId: user.id,
      companyId: company.id,
      workspaceId: workspace.id,
      projectId: project.id,
      foreignProjectId: foreign.id,
      actionId: action.id,
      conversationId: conversation.id,
      submissionId: submission.id,
      dateStepId: 0,
    };
  });
  const step = await createActionFlowStep({
    projectId: fixture.projectId,
    actionId: fixture.actionId,
    sortOrder: 1,
    stepType: "date",
    fieldKey: "preferredDate",
    label: "Preferred Date",
    inputType: "date",
    prompt: "What date would you prefer?",
    isRequired: true,
  });
  fixture.dateStepId = step.id;
  await createActionFlowStep({
    projectId: fixture.projectId,
    actionId: fixture.actionId,
    sortOrder: 2,
    stepType: "confirmation",
    label: "Review details",
    isRequired: true,
  });
  const version = await createPublishedActionFlowVersion({
    projectId: fixture.projectId,
    actionId: fixture.actionId,
    publishedByUserId: fixture.userId,
  });
  await db
    .update(actionSubmissions)
    .set({ actionVersionId: version?.id, currentStepId: step.id })
    .where(eq(actionSubmissions.id, fixture.submissionId));
});

test.afterAll(async () => {
  server?.closeAllConnections();
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!fixture) return;
  await db.transaction(async (tx) => {
    for (const projectId of [fixture.projectId, fixture.foreignProjectId]) {
      for (const table of [
        durableJobs,
        operationAttempts,
        operations,
        integrationProviders,
        conversationalTaskAuditEvents,
        flowRuntimeCommands,
        channelConversations,
        actionSubmissionEvents,
        actionSubmissions,
        actionFlowSteps,
      ])
        await tx.delete(table).where(eq(table.projectId, projectId));
      await tx
        .update(projectActions)
        .set({ publishedVersionId: null })
        .where(eq(projectActions.projectId, projectId));
      await tx
        .delete(actionFlowVersions)
        .where(eq(actionFlowVersions.projectId, projectId));
      await tx
        .delete(projectActions)
        .where(eq(projectActions.projectId, projectId));
      await tx.delete(projects).where(eq(projects.id, projectId));
    }
    await tx.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
    await tx.delete(companies).where(eq(companies.id, fixture.companyId));
    await tx.delete(users).where(eq(users.id, fixture.userId));
  });
});

async function createProvider(method: "GET" | "POST") {
  received = 0;
  const [provider] = await db
    .insert(integrationProviders)
    .values({
      projectId: fixture.projectId,
      providerType: "webhook",
      name: `Recovery ${method}`,
      config: { method, url: endpoint, retryCount: 2, retryDelayMs: 0 },
    })
    .returning();
  const [operation] = await db
    .insert(operations)
    .values({
      projectId: fixture.projectId,
      providerId: provider.id,
      name: `Recovery ${method}`,
      operationType: "api_request",
    })
    .returning();
  return operation;
}

test("a transient GET is retried and accepted only after a successful provider response", async () => {
  behavior = "read_retry";
  const operation = await createProvider("GET");
  const result = await runOperationPreview({
    projectId: fixture.projectId,
    operationId: operation.id,
    fields: {},
  });
  expect(received).toBe(2);
  expect(result?.attempt.status).toBe("completed");
  expect(result?.attempt.responsePayload.recovery).toMatchObject({
    outcome: "recovered",
    validated: true,
    automaticSteps: 1,
  });
});

for (const failure of ["write_error", "network"] as const)
  test(`${failure}: an uncertain POST is sent once and cannot be replayed`, async () => {
    behavior = failure;
    const operation = await createProvider("POST");
    const result = await runOperationPreview({
      projectId: fixture.projectId,
      operationId: operation.id,
      fields: {},
    });
    expect(received).toBe(1);
    expect(result?.attempt.status).toBe("outcome_unknown");
    expect(result?.attempt.responsePayload.recovery).toMatchObject({
      outcome: "review_required",
      validated: false,
    });
    if (!result) throw new Error("Missing operation result");
    expect(
      await replayOperationAttempt({
        projectId: fixture.projectId,
        attemptId: result.attempt.id,
        mode: "auto_retry",
      }),
    ).toBeNull();
    expect(received).toBe(1);
  });

test("credential rejection is not retried even when provider retries are configured", async () => {
  behavior = "permanent";
  const operation = await createProvider("GET");
  const result = await runOperationPreview({
    projectId: fixture.projectId,
    operationId: operation.id,
    fields: {},
  });
  expect(received).toBe(1);
  expect(result?.attempt.status).toBe("failed");
});

test("reclaimed delivery holds an interrupted write instead of repeating it", async () => {
  behavior = "write_error";
  const operation = await createProvider("POST");
  const queued = await queueOperationForSubmission({
    projectId: fixture.projectId,
    actionId: fixture.actionId,
    submissionId: fixture.submissionId,
    operationId: operation.id,
    fields: {},
    idempotencyKey: `recovery:${suffix}`,
  });
  if (!queued) throw new Error("Missing queued operation");
  await db
    .update(operationAttempts)
    .set({ startedAt: new Date(Date.now() - 60000) })
    .where(eq(operationAttempts.id, queued.attempt.id));
  await db
    .update(durableJobs)
    .set({ attempts: 1, maxAttempts: 2 })
    .where(eq(durableJobs.id, queued.job.id));
  await processProjectDurableOperationQueue({
    projectId: fixture.projectId,
    workerId: "recovery-test-worker",
    maxJobs: 1,
  });
  expect(received).toBe(0);
  const [attempt] = await db
    .select()
    .from(operationAttempts)
    .where(eq(operationAttempts.id, queued.attempt.id));
  expect(attempt.status).toBe("outcome_unknown");
});

test("job exhaustion is persisted without exceeding its configured attempt limit", async () => {
  const queued = await enqueueDurableJob({
    projectId: fixture.projectId,
    jobType: "post_conversation",
    dedupeKey: suffix,
    payload: {},
    maxAttempts: 1,
  });
  const job = await claimNextDurableJob({
    projectId: fixture.projectId,
    jobTypes: ["post_conversation"],
    workerId: "recovery-test-worker",
  });
  expect(job?.id).toBe(queued.job.id);
  const result = await failDurableJob({
    projectId: fixture.projectId,
    workerId: "recovery-test-worker",
    jobId: queued.job.id,
    errorMessage: "Synthetic failure",
  });
  expect(result?.status).toBe("failed");
  expect(result?.attempts).toBe(1);
  expect(result?.result.recovery).toMatchObject({
    outcome: "review_required",
    automaticSteps: 0,
  });
});

test("stale visitor updates reload saved state without applying their old value", async () => {
  await expect(
    runBrowserFlowText({
      projectId: fixture.projectId,
      channelType: "project_chat",
      conversationId: suffix,
      source: "project_chat",
      commandId: `recovery-command-${suffix}`,
      text: "2027-02-01",
      expectedRevision: 1,
    }),
  ).rejects.toMatchObject({ code: "stale" });
  const [submission] = await db
    .select()
    .from(actionSubmissions)
    .where(eq(actionSubmissions.id, fixture.submissionId));
  expect(submission.fields.preferredDate).toBe("2027-01-02");
  expect(submission.revision).toBe(2);
  const events = await getConversationQualityEvidence(
    fixture.projectId,
    fixture.conversationId,
  );
  expect(
    events.events.some((event) =>
      event.recovery?.decisions.some(
        (decision) => decision.action === "reload_state",
      ),
    ),
  ).toBe(true);
});

test("recovery review is scoped, persisted and redacted in quality evidence", async () => {
  const execution = await new StructuredTurnEngine({
    provider: {
      async generateTurn() {
        throw Object.assign(new Error("private error detail"), {
          statusCode: 401,
        });
      },
    },
  }).execute({
    activeTask: null,
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    assistantIntroduced: true,
    channel: "project_chat",
    companyName: "Recovery",
    context: [],
    fieldState: [],
    history: [],
    projectId: fixture.projectId,
    projectPolicy: DEFAULT_CONVERSATION_PROJECT_POLICY,
    projectName: "Recovery",
    publishedTasks: [],
    stage: "knowledge",
    visitorMessage: "What services do you offer?",
  });
  await recordConversationQualityTurn({
    projectId: fixture.foreignProjectId,
    conversationId: fixture.conversationId,
    stage: "knowledge",
    latencyMs: 1,
    execution,
  });
  expect(
    (
      await getConversationQualityEvidence(
        fixture.foreignProjectId,
        fixture.conversationId,
      )
    ).events,
  ).toEqual([]);
  await recordConversationQualityTurn({
    projectId: fixture.projectId,
    conversationId: fixture.conversationId,
    stage: "knowledge",
    latencyMs: 1,
    execution,
  });
  const evidence = await getConversationQualityEvidence(
    fixture.projectId,
    fixture.conversationId,
  );
  expect(evidence.events[0].recovery?.outcome).toBe("review_required");
  expect(JSON.stringify(evidence)).not.toContain("private error");
  const dashboard = await getProjectQualityDashboard(fixture.projectId);
  expect(
    dashboard[0].flags.some((flag) => flag.code === "recovery_review"),
  ).toBe(true);
});
