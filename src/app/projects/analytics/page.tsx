import {
  Activity,
  BarChart3,
  BrainCircuit,
  Workflow,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { NoProjectState } from "@/components/no-project-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProjectActionFlowAnalytics } from "@/lib/action-flow-analytics";
import { getProjectChatAnalytics } from "@/lib/chat-analytics";
import { getPhase17ProjectAnalytics } from "@/lib/phase17-analytics";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";

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

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-white p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

type LifecycleRow = {
  key: string;
  label: string;
  starts: number;
  completed: number;
  cancelled: number;
};

function LifecycleTable({
  title,
  rows,
}: {
  title: string;
  rows: LifecycleRow[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border bg-white">
      <p className="border-b px-3 py-2 font-medium">{title}</p>
      {rows.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">
          No recorded activity.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="px-3 py-2">Name</th>
              <th className="py-2 pr-3">Starts</th>
              <th className="py-2 pr-3">Completed</th>
              <th className="py-2 pr-3">Cancelled</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b last:border-b-0">
                <td className="px-3 py-2 font-medium capitalize">
                  {row.label}
                </td>
                <td className="py-2 pr-3">{formatNumber(row.starts)}</td>
                <td className="py-2 pr-3">{formatNumber(row.completed)}</td>
                <td className="py-2 pr-3">{formatNumber(row.cancelled)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
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
  const context = await resolveOptionalPageUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Analytics need a project" />;
  }

  const { project: selectedProject } = context;
  const [analytics, flowAnalytics, phase17Analytics] = await Promise.all([
    getProjectChatAnalytics(selectedProject.id),
    getProjectActionFlowAnalytics(selectedProject.id),
    getPhase17ProjectAnalytics(selectedProject.id),
  ]);
  const directAiRoutes = analytics.routeBreakdown.filter(
    (row) => row.route === "chat" || row.route === "widget",
  );
  const successfulDirectAiChats = directAiRoutes.reduce(
    (total, row) => total + Math.max(0, row.totalRequests - row.errorCount),
    0,
  );
  const directAiTokens = directAiRoutes.reduce(
    (total, row) => total + row.totalTokens,
    0,
  );

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
              Project-scoped lifecycle, conversation, model, tool, and request
              telemetry from recorded runtime activity.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <BrainCircuit className="h-5 w-5" />
              Current AI Usage (30 days)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Rolling project telemetry for the last 30 days. Capture the
              immutable Phase 17A comparison baseline from Automation &gt;
              Conversation Diagnostics &gt; Evaluation gate.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="30-day runtime requests"
                value={formatNumber(analytics.last30Days.totalRequests)}
              />
              <Metric
                label="Successful direct AI chats"
                value={formatNumber(successfulDirectAiChats)}
              />
              <Metric
                label="30-day input tokens"
                value={formatNumber(analytics.last30Days.promptTokens)}
              />
              <Metric
                label="30-day output tokens"
                value={formatNumber(analytics.last30Days.completionTokens)}
              />
              <Metric
                label="30-day total tokens"
                value={formatNumber(analytics.last30Days.totalTokens)}
              />
              <Metric
                label="30-day average request latency"
                value={formatMs(analytics.last30Days.avgLatencyMs)}
              />
              <Metric
                label="Tokens per direct AI chat"
                value={
                  successfulDirectAiChats > 0
                    ? (directAiTokens / successfulDirectAiChats).toFixed(2)
                    : "Unavailable"
                }
              />
              <Metric
                label="Structured decisions"
                value={formatNumber(phase17Analytics.model.structuredTurns)}
              />
              <Metric
                label="Deterministic avoidance"
                value={formatPercent(
                  phase17Analytics.model.deterministicAvoidanceRate,
                )}
              />
              <Metric
                label="Structured model rate"
                value={formatPercent(phase17Analytics.model.modelTurnRate)}
              />
              <Metric
                label="Structured model attempts"
                value={formatNumber(phase17Analytics.model.modelAttempts)}
              />
              <Metric
                label="Retry / fallback rate"
                value={formatPercent(phase17Analytics.model.multiAttemptRate)}
              />
              <Metric
                label="Attempts per model turn"
                value={phase17Analytics.model.attemptsPerModelTurn.toFixed(2)}
              />
              <Metric
                label="Attempts per completion"
                value={phase17Analytics.model.attemptsPerCompletion.toFixed(2)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Request and token totals use the retained 30-day request log.
              Structured decision ratios use retained version-2 turn audits. A
              direct AI chat is one successful Project Chat or Widget request;
              any provider-internal steps within that request are reflected in
              token usage but are not counted as separate requests.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Lifecycle and Conversion
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Metric
                label="Starts"
                value={formatNumber(phase17Analytics.lifecycle.starts)}
              />
              <Metric
                label="Completed"
                value={formatNumber(phase17Analytics.lifecycle.completed)}
              />
              <Metric
                label="Completion"
                value={formatPercent(phase17Analytics.lifecycle.completionRate)}
              />
              <Metric
                label="Cancelled"
                value={formatNumber(phase17Analytics.lifecycle.cancelled)}
              />
              <Metric
                label="Cancellation"
                value={formatPercent(
                  phase17Analytics.lifecycle.cancellationRate,
                )}
              />
              <Metric
                label="Corrections"
                value={formatNumber(phase17Analytics.lifecycle.corrections)}
              />
              <Metric
                label="Retried fields"
                value={formatNumber(phase17Analytics.lifecycle.retriedFields)}
              />
              <Metric
                label="Validation failures"
                value={formatNumber(
                  phase17Analytics.lifecycle.validationFailures,
                )}
              />
              <Metric
                label="Handoffs"
                value={formatNumber(phase17Analytics.lifecycle.handoffs)}
              />
              <Metric
                label="Operations"
                value={`${formatNumber(phase17Analytics.lifecycle.successfulOperations)} passed / ${formatNumber(phase17Analytics.lifecycle.failedOperations)} failed`}
              />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <LifecycleTable
                title="By action or task"
                rows={phase17Analytics.byTask}
              />
              <LifecycleTable
                title="By channel"
                rows={phase17Analytics.byChannel}
              />
              <LifecycleTable
                title="By published version"
                rows={phase17Analytics.byVersion}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <BrainCircuit className="h-5 w-5" />
              Model and Tool Runtime
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Metric
                label="Model turns"
                value={formatNumber(phase17Analytics.model.modelTurns)}
              />
              <Metric
                label="Deterministic turns"
                value={formatNumber(phase17Analytics.model.deterministicTurns)}
              />
              <Metric
                label="Model attempts"
                value={formatNumber(phase17Analytics.model.modelAttempts)}
              />
              <Metric
                label="Multi-attempt turns"
                value={`${formatNumber(phase17Analytics.model.multiAttemptTurns)} (${formatPercent(phase17Analytics.model.multiAttemptRate)})`}
              />
              <Metric
                label="Average model latency"
                value={formatMs(phase17Analytics.model.averageLatencyMs)}
              />
              <Metric
                label="Input tokens"
                value={formatNumber(phase17Analytics.model.inputTokens)}
              />
              <Metric
                label="Output tokens"
                value={formatNumber(phase17Analytics.model.outputTokens)}
              />
              <Metric
                label="Estimated cost units"
                value={formatNumber(phase17Analytics.model.estimatedCostUnits)}
              />
              <Metric
                label="Grounded turns"
                value={formatNumber(phase17Analytics.model.groundedTurns)}
              />
              <Metric
                label="Safety blocks"
                value={formatNumber(phase17Analytics.model.safetyBlocks)}
              />
            </div>

            <div className="overflow-x-auto rounded-md border bg-white">
              <div className="flex items-center gap-2 border-b px-3 py-2 font-medium">
                <BrainCircuit className="h-4 w-4" /> Model escalation reasons
              </div>
              {phase17Analytics.modelEscalations.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No bounded model escalations recorded.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="px-3 py-2">Reason</th>
                      <th className="py-2 pr-3">Turns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phase17Analytics.modelEscalations.map((row) => (
                      <tr key={row.reason} className="border-b last:border-b-0">
                        <td className="px-3 py-2 font-medium capitalize">
                          {row.reason.replaceAll("_", " ")}
                        </td>
                        <td className="py-2 pr-3">{formatNumber(row.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="overflow-x-auto rounded-md border bg-white">
              <div className="flex items-center gap-2 border-b px-3 py-2 font-medium">
                <Wrench className="h-4 w-4" /> Tool activity
              </div>
              {phase17Analytics.tools.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No recorded tool requests.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="px-3 py-2">Tool</th>
                      <th className="py-2 pr-3">Requests</th>
                      <th className="py-2 pr-3">Succeeded</th>
                      <th className="py-2 pr-3">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phase17Analytics.tools.map((tool) => (
                      <tr
                        key={tool.toolId}
                        className="border-b last:border-b-0"
                      >
                        <td className="px-3 py-2 font-medium">{tool.toolId}</td>
                        <td className="py-2 pr-3">
                          {formatNumber(tool.requested)}
                        </td>
                        <td className="py-2 pr-3">
                          {formatNumber(tool.succeeded)}
                        </td>
                        <td className="py-2 pr-3">
                          {formatNumber(tool.failed)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              Field and Route Attribution
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-x-auto rounded-md border bg-white">
              <p className="border-b px-3 py-2 font-medium">Field activity</p>
              {phase17Analytics.fields.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No recorded fields.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="px-3 py-2">Field</th>
                      <th className="py-2 pr-3">Collected</th>
                      <th className="py-2 pr-3">Validation fails</th>
                      <th className="py-2 pr-3">Retried</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phase17Analytics.fields.map((field) => (
                      <tr
                        key={field.fieldKey}
                        className="border-b last:border-b-0"
                      >
                        <td className="px-3 py-2 font-medium">
                          {field.fieldKey}
                        </td>
                        <td className="py-2 pr-3">
                          {formatNumber(field.collected)}
                        </td>
                        <td className="py-2 pr-3">
                          {formatNumber(field.validationFailures)}
                        </td>
                        <td className="py-2 pr-3">
                          {formatNumber(field.retried)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="overflow-x-auto rounded-md border bg-white">
              <p className="border-b px-3 py-2 font-medium">
                Recorded branch routes
              </p>
              {phase17Analytics.routes.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No recorded branch decisions.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="px-3 py-2">Route</th>
                      <th className="py-2 pr-3">Selections</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phase17Analytics.routes.map((route) => (
                      <tr
                        key={route.route}
                        className="border-b last:border-b-0"
                      >
                        <td className="px-3 py-2 font-medium">{route.route}</td>
                        <td className="py-2 pr-3">
                          {formatNumber(route.count)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
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
