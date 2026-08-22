import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { chatRequestLogs } from "@/lib/db-schema";

type WindowSummary = {
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  avgLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type RouteSummary = {
  route: string;
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  avgLatencyMs: number;
  totalTokens: number;
};

export type ChatAnalyticsWindow = {
  since: Date;
  until?: Date;
};

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function getWindowSummary(
  projectId: number,
  since: Date,
  until?: Date,
): Promise<WindowSummary> {
  const [row] = await db
    .select({
      totalRequests: sql<number>`count(*)`,
      errorCount: sql<number>`sum(case when ${chatRequestLogs.statusCode} >= 400 then 1 else 0 end)`,
      avgLatencyMs: sql<number>`coalesce(round(avg(${chatRequestLogs.latencyMs})::numeric, 2), 0)`,
      promptTokens: sql<number>`coalesce(sum(${chatRequestLogs.promptTokens}), 0)`,
      completionTokens: sql<number>`coalesce(sum(${chatRequestLogs.completionTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${chatRequestLogs.totalTokens}), 0)`,
    })
    .from(chatRequestLogs)
    .where(
      and(
        eq(chatRequestLogs.projectId, projectId),
        gte(chatRequestLogs.createdAt, since),
        until ? lte(chatRequestLogs.createdAt, until) : undefined,
      ),
    );

  const totalRequests = Number(row?.totalRequests ?? 0);
  const errorCount = Number(row?.errorCount ?? 0);
  return {
    totalRequests,
    errorCount,
    errorRate:
      totalRequests > 0
        ? Number(((errorCount / totalRequests) * 100).toFixed(2))
        : 0,
    avgLatencyMs: Number(row?.avgLatencyMs ?? 0),
    promptTokens: Number(row?.promptTokens ?? 0),
    completionTokens: Number(row?.completionTokens ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0),
  };
}

async function getRouteBreakdown(
  projectId: number,
  since: Date,
  until?: Date,
): Promise<RouteSummary[]> {
  const rows = await db
    .select({
      route: chatRequestLogs.route,
      totalRequests: sql<number>`count(*)`,
      errorCount: sql<number>`sum(case when ${chatRequestLogs.statusCode} >= 400 then 1 else 0 end)`,
      avgLatencyMs: sql<number>`coalesce(round(avg(${chatRequestLogs.latencyMs})::numeric, 2), 0)`,
      totalTokens: sql<number>`coalesce(sum(${chatRequestLogs.totalTokens}), 0)`,
    })
    .from(chatRequestLogs)
    .where(
      and(
        eq(chatRequestLogs.projectId, projectId),
        gte(chatRequestLogs.createdAt, since),
        until ? lte(chatRequestLogs.createdAt, until) : undefined,
      ),
    )
    .groupBy(chatRequestLogs.route);

  return rows.map((row) => {
    const totalRequests = Number(row.totalRequests ?? 0);
    const errorCount = Number(row.errorCount ?? 0);

    return {
      route: row.route,
      totalRequests,
      errorCount,
      errorRate:
        totalRequests > 0
          ? Number(((errorCount / totalRequests) * 100).toFixed(2))
          : 0,
      avgLatencyMs: Number(row.avgLatencyMs ?? 0),
      totalTokens: Number(row.totalTokens ?? 0),
    };
  });
}

export async function getProjectChatAnalyticsWindow(
  projectId: number,
  window: ChatAnalyticsWindow,
) {
  const [summary, routeBreakdown] = await Promise.all([
    getWindowSummary(projectId, window.since, window.until),
    getRouteBreakdown(projectId, window.since, window.until),
  ]);

  return { summary, routeBreakdown };
}

export async function getProjectChatAnalytics(projectId: number) {
  const last30DaysSince = daysAgo(30);
  const [last24Hours, last7Days, last30Days, routeBreakdown] =
    await Promise.all([
      getWindowSummary(projectId, daysAgo(1)),
      getWindowSummary(projectId, daysAgo(7)),
      getWindowSummary(projectId, last30DaysSince),
      getRouteBreakdown(projectId, last30DaysSince),
    ]);

  return {
    last24Hours,
    last7Days,
    last30Days,
    routeBreakdown,
  };
}
