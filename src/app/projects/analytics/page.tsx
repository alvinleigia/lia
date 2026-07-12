import { BarChart3, Workflow } from "lucide-react";
import Link from "next/link";
import { NoProjectState } from "@/components/no-project-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProjectActionFlowAnalytics } from "@/lib/action-flow-analytics";
import {
  getActiveProjectIdCookie,
  resolveOptionalUserAndProject,
} from "@/lib/auth-project";
import { getProjectChatAnalytics } from "@/lib/chat-analytics";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMs(value: number) {
  return `${value.toFixed(0)} ms`;
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatWholePercent(value: number) {
  return `${value}%`;
}

type SummaryCardProps = {
  title: string;
  totalRequests: number;
  avgLatencyMs: number;
  errorRate: number;
  totalTokens: number;
};

function SummaryCard({
  title,
  totalRequests,
  avgLatencyMs,
  errorRate,
  totalTokens,
}: SummaryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>Total requests: {formatNumber(totalRequests)}</p>
        <p>Avg latency: {formatMs(avgLatencyMs)}</p>
        <p>Error rate: {formatPercent(errorRate)}</p>
        <p>Total tokens: {formatNumber(totalTokens)}</p>
      </CardContent>
    </Card>
  );
}

export default async function ProjectAnalyticsPage() {
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Analytics need a project" />;
  }

  const { project: selectedProject } = context;
  const [analytics, flowAnalytics] = await Promise.all([
    getProjectChatAnalytics(selectedProject.id),
    getProjectActionFlowAnalytics(selectedProject.id),
  ]);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <BarChart3 className="h-6 w-6" />
              Analytics: {selectedProject.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Metrics are project-scoped and based on chat request logs.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <Workflow className="h-5 w-5" />
              Flow Analytics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-5">
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Actions
                </p>
                <p className="text-xl font-semibold">
                  {formatNumber(flowAnalytics.actionCount)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatNumber(flowAnalytics.activeActionCount)} active
                </p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Starts
                </p>
                <p className="text-xl font-semibold">
                  {formatNumber(flowAnalytics.totalSubmissions)}
                </p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Submitted
                </p>
                <p className="text-xl font-semibold">
                  {formatNumber(flowAnalytics.submittedCount)}
                </p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Completion
                </p>
                <p className="text-xl font-semibold">
                  {formatWholePercent(flowAnalytics.averageCompletionRate)}
                </p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Drop-Offs
                </p>
                <p className="text-xl font-semibold">
                  {formatNumber(flowAnalytics.dropOffCount)}
                </p>
              </div>
            </div>

            {flowAnalytics.flows.length === 0 ? (
              <div className="rounded-md border bg-white p-4">
                <p className="text-sm text-muted-foreground">
                  No action flows yet for this project.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-4 pl-3">Flow</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Starts</th>
                      <th className="py-2 pr-4">Submitted</th>
                      <th className="py-2 pr-4">Completion</th>
                      <th className="py-2 pr-4">Drop-Offs</th>
                      <th className="py-2 pr-4">Validation Fails</th>
                      <th className="py-2 pr-4">Branches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flowAnalytics.flows.map((flow) => (
                      <tr
                        key={flow.actionId}
                        className="border-b last:border-b-0"
                      >
                        <td className="py-2 pr-4 pl-3 font-medium">
                          <Link
                            href={`/projects/actions/${flow.actionId}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {flow.actionName}
                          </Link>
                        </td>
                        <td className="py-2 pr-4 capitalize">
                          {flow.actionStatus}
                        </td>
                        <td className="py-2 pr-4">
                          {formatNumber(flow.totalSubmissions)}
                        </td>
                        <td className="py-2 pr-4">
                          {formatNumber(flow.submittedCount)}
                        </td>
                        <td className="py-2 pr-4">
                          {formatWholePercent(flow.completionRate)}
                        </td>
                        <td className="py-2 pr-4">
                          {formatNumber(flow.dropOffCount)}
                        </td>
                        <td className="py-2 pr-4">
                          {formatNumber(flow.validationFailureCount)}
                        </td>
                        <td className="py-2 pr-4">
                          {formatNumber(flow.branchDecisionCount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {flowAnalytics.topDropOffSteps.length > 0 && (
              <div className="rounded-md border bg-white p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">Top Drop-Off Nodes</p>
                    <p className="text-sm text-muted-foreground">
                      In-progress submissions grouped by their current step.
                    </p>
                  </div>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2 pr-4">Step</th>
                        <th className="py-2 pr-4">Flow</th>
                        <th className="py-2 pr-4">Type</th>
                        <th className="py-2 pr-4">Field</th>
                        <th className="py-2 pr-4">Drop-Offs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flowAnalytics.topDropOffSteps.map((step) => (
                        <tr
                          key={`${step.actionId}-${step.stepId}`}
                          className="border-b last:border-b-0"
                        >
                          <td className="py-2 pr-4 font-medium">
                            {step.sortOrder}. {step.label}
                          </td>
                          <td className="py-2 pr-4">
                            <Link
                              href={`/projects/actions/${step.actionId}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {step.actionName}
                            </Link>
                          </td>
                          <td className="py-2 pr-4 capitalize">
                            {step.stepType.replaceAll("_", " ")}
                          </td>
                          <td className="py-2 pr-4">{step.fieldKey || "-"}</td>
                          <td className="py-2 pr-4">
                            {formatNumber(step.dropOffCount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            title="Last 24 Hours"
            totalRequests={analytics.last24Hours.totalRequests}
            avgLatencyMs={analytics.last24Hours.avgLatencyMs}
            errorRate={analytics.last24Hours.errorRate}
            totalTokens={analytics.last24Hours.totalTokens}
          />
          <SummaryCard
            title="Last 7 Days"
            totalRequests={analytics.last7Days.totalRequests}
            avgLatencyMs={analytics.last7Days.avgLatencyMs}
            errorRate={analytics.last7Days.errorRate}
            totalTokens={analytics.last7Days.totalTokens}
          />
          <SummaryCard
            title="Last 30 Days"
            totalRequests={analytics.last30Days.totalRequests}
            avgLatencyMs={analytics.last30Days.avgLatencyMs}
            errorRate={analytics.last30Days.errorRate}
            totalTokens={analytics.last30Days.totalTokens}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Route Breakdown (30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.routeBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No chat logs yet for this project.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-4">Route</th>
                      <th className="py-2 pr-4">Requests</th>
                      <th className="py-2 pr-4">Avg Latency</th>
                      <th className="py-2 pr-4">Error Rate</th>
                      <th className="py-2 pr-4">Total Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.routeBreakdown.map((row) => (
                      <tr key={row.route} className="border-b last:border-b-0">
                        <td className="py-2 pr-4 font-medium">{row.route}</td>
                        <td className="py-2 pr-4">
                          {formatNumber(row.totalRequests)}
                        </td>
                        <td className="py-2 pr-4">
                          {formatMs(row.avgLatencyMs)}
                        </td>
                        <td className="py-2 pr-4">
                          {formatPercent(row.errorRate)}
                        </td>
                        <td className="py-2 pr-4">
                          {formatNumber(row.totalTokens)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
