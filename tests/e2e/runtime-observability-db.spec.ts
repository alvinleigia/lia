import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { getProjectChatAnalytics } from "../../src/lib/chat-analytics";
import { logChatRequest } from "../../src/lib/chat-logs";
import { db } from "../../src/lib/db-config";
import {
  chatRequestLogs,
  companies,
  durableJobs,
  outboxMessages,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import { getProjectExecutionDiagnostics } from "../../src/lib/execution-diagnostics";

let fixture: {
  userId: number;
  companyId: number;
  workspaceId: number;
  projectIds: number[];
};

test.beforeAll(async () => {
  fixture = await db.transaction(async (tx) => {
    const suffix = crypto.randomUUID();
    const [user] = await tx
      .insert(users)
      .values({
        email: `metrics-${suffix}@example.test`,
        passwordHash: "test-only",
      })
      .returning();
    const [company] = await tx
      .insert(companies)
      .values({ name: "Metrics test", ownerUserId: user.id })
      .returning();
    const [workspace] = await tx
      .insert(workspaces)
      .values({
        name: "Metrics test",
        ownerUserId: user.id,
        companyId: company.id,
      })
      .returning();
    const rows = await tx
      .insert(projects)
      .values(
        ["Metrics A", "Metrics B"].map((name) => ({
          name,
          ownerUserId: user.id,
          workspaceId: workspace.id,
        })),
      )
      .returning();
    return {
      userId: user.id,
      companyId: company.id,
      workspaceId: workspace.id,
      projectIds: rows.map((row) => row.id),
    };
  });
});

test.afterAll(async () => {
  if (!fixture) return;
  await db
    .delete(chatRequestLogs)
    .where(inArray(chatRequestLogs.projectId, fixture.projectIds));
  await db
    .delete(outboxMessages)
    .where(inArray(outboxMessages.projectId, fixture.projectIds));
  await db
    .delete(durableJobs)
    .where(inArray(durableJobs.projectId, fixture.projectIds));
  await db.delete(projects).where(inArray(projects.id, fixture.projectIds));
  await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
  await db.delete(companies).where(eq(companies.id, fixture.companyId));
  await db.delete(users).where(eq(users.id, fixture.userId));
});

test("old failed jobs and outbox entries remain visible ahead of recent completions within their project", async () => {
  const [projectId, otherProjectId] = fixture.projectIds;
  const common = {
    projectId,
    jobType: "post_conversation",
    traceId: "metrics-test-trace",
  };
  await db.insert(durableJobs).values([
    ...Array.from({ length: 14 }, (_, i) => ({
      ...common,
      dedupeKey: `recent-${i}`,
      status: "completed",
    })),
    {
      ...common,
      dedupeKey: "old-failure",
      status: "failed",
      createdAt: new Date("2020-01-01"),
      lastError: "Synthetic failure",
    },
    {
      ...common,
      projectId: otherProjectId,
      dedupeKey: "foreign-failure",
      status: "failed",
    },
  ]);
  await db.insert(outboxMessages).values({
    projectId,
    topic: "synthetic",
    dedupeKey: "old-outbox",
    traceId: "metrics-outbox-trace",
    status: "failed",
    createdAt: new Date("2020-01-02"),
  });
  const result = await getProjectExecutionDiagnostics(projectId, 3);
  expect(result.counts).toEqual({
    completed: 14,
    failed: 2,
    queued: 0,
    processing: 0,
  });
  expect(result.items.map((item) => item.status)).toEqual([
    "failed",
    "failed",
    "completed",
  ]);
  expect(result.items.map((item) => item.kind)).toEqual([
    "outbox",
    "job",
    "job",
  ]);
  expect(
    result.items.some((item) => item.traceId === "metrics-outbox-trace"),
  ).toBe(true);
});

test("runtime request metrics feed scoped analytics and distinguish unreported usage", async () => {
  const [projectId, otherProjectId] = fixture.projectIds;
  await logChatRequest({
    route: "project_runtime",
    projectId,
    statusCode: 200,
    latencyMs: 100,
    promptTokens: 10,
    completionTokens: 4,
    totalTokens: 14,
  });
  await logChatRequest({
    route: "widget_runtime",
    projectId,
    statusCode: 500,
    latencyMs: 200,
  });
  await logChatRequest({
    route: "project_runtime",
    projectId: otherProjectId,
    statusCode: 200,
    latencyMs: 999,
    totalTokens: 1000,
  });
  const analytics = await getProjectChatAnalytics(projectId);
  expect(analytics.last24Hours).toMatchObject({
    totalRequests: 2,
    errorCount: 1,
    errorRate: 50,
    avgLatencyMs: 150,
    totalTokens: 14,
    unmeteredRequests: 1,
  });
  expect(analytics.routeBreakdown.map((row) => row.route).sort()).toEqual([
    "project_runtime",
    "widget_runtime",
  ]);
});
