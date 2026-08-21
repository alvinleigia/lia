import { getProjectChatAnalytics } from "@/lib/chat-analytics";
import { getPhase17ProjectAnalytics } from "@/lib/phase17-analytics";
import { buildPhase17aCandidateMetrics } from "@/lib/phase17a-release-gate";

export async function getPhase17aCandidateSnapshot(projectId: number) {
  const [chatAnalytics, phase17Analytics] = await Promise.all([
    getProjectChatAnalytics(projectId),
    getPhase17ProjectAnalytics(projectId),
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
      averageRequestLatencyMs: chatAnalytics.last30Days.avgLatencyMs,
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
