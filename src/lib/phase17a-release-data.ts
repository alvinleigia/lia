import {
  getProjectChatAnalytics,
  getProjectChatAnalyticsWindow,
} from "@/lib/chat-analytics";
import {
  getPhase17ProjectAnalytics,
  type Phase17AnalyticsWindow,
} from "@/lib/phase17-analytics";
import { buildPhase17aCandidateMetrics } from "@/lib/phase17a-release-gate";

export async function getPhase17aCandidateSnapshot(
  projectId: number,
  window?: Phase17AnalyticsWindow,
) {
  const [chatAnalytics, phase17Analytics] = await Promise.all([
    window
      ? getProjectChatAnalyticsWindow(projectId, window)
      : getProjectChatAnalytics(projectId).then((analytics) => ({
          routeBreakdown: analytics.routeBreakdown,
          summary: analytics.last30Days,
        })),
    getPhase17ProjectAnalytics(projectId, window),
  ]);
  const directAiRoutes = chatAnalytics.routeBreakdown.filter(
    (row) => row.route === "chat" || row.route === "widget",
  );
  const directAiChats = directAiRoutes.reduce(
    (total, row) => total + Math.max(0, row.totalRequests - row.errorCount),
    0,
  );
  const directAiTokens = directAiRoutes.reduce(
    (total, row) => total + row.totalTokens,
    0,
  );

  return {
    metrics: buildPhase17aCandidateMetrics({
      averageRequestLatencyMs: chatAnalytics.summary.avgLatencyMs,
      attemptsPerCompletion: phase17Analytics.model.attemptsPerCompletion,
      completionCount: phase17Analytics.lifecycle.completed,
      directAiChats,
      modelTurnRate: phase17Analytics.model.modelTurnRate,
      retryFallbackRate: phase17Analytics.model.multiAttemptRate,
      structuredTurns: phase17Analytics.model.structuredTurns,
      totalTokens: directAiTokens,
    }),
  };
}
