import {
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  Gauge,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import {
  recordEvaluationResult,
  recordPhase17aOptimizationBaseline,
  recordPhase17aOptimizationRelease,
  updateEvaluationPolicy,
} from "@/app/projects/diagnostics/evaluations/actions";
import { NoProjectState } from "@/components/no-project-state";
import {
  ActionFormError,
  ActionFormSuccessToast,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listAuditLogsForTarget } from "@/lib/audit";
import {
  EVALUATION_CATEGORIES,
  getConversationEvaluationDashboard,
} from "@/lib/conversation-evaluations";
import { getPhase17aCandidateSnapshot } from "@/lib/phase17a-release-data";
import {
  PHASE17A_BASELINE_AUDIT_ACTION,
  PHASE17A_BASELINE_TARGET_TYPE,
  PHASE17A_RELEASE_AUDIT_ACTION,
  PHASE17A_RELEASE_TARGET_TYPE,
  parsePhase17aBaselineAuditRecord,
  parsePhase17aReleaseAuditRecord,
} from "@/lib/phase17a-release-gate";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import { formatDateTimeInTimeZone } from "@/lib/time-zones";

function formatCandidateMetric(value: number | null, suffix = "") {
  return value === null ? "Unavailable" : value.toFixed(2) + suffix;
}

function CandidateMetric({
  label,
  suffix,
  value,
}: {
  label: string;
  suffix?: string;
  value: number | null;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">
        {formatCandidateMetric(value, suffix)}
      </p>
    </div>
  );
}

export default async function ConversationEvaluationsPage({
  searchParams,
}: {
  searchParams: Promise<{ candidate?: string }>;
}) {
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);
  if (!context) return <NoProjectState title="Evaluations need a project" />;
  const params = await searchParams;
  const candidateLabel = params.candidate?.trim() || "current staging";
  const [dashboard, baselineAudits, optimizationAudits] = await Promise.all([
    getConversationEvaluationDashboard(context.project.id, candidateLabel),
    listAuditLogsForTarget({
      action: PHASE17A_BASELINE_AUDIT_ACTION,
      projectId: context.project.id,
      targetId: context.project.id,
      targetType: PHASE17A_BASELINE_TARGET_TYPE,
      limit: 1,
    }),
    listAuditLogsForTarget({
      action: PHASE17A_RELEASE_AUDIT_ACTION,
      projectId: context.project.id,
      targetId: context.project.id,
      targetType: PHASE17A_RELEASE_TARGET_TYPE,
      limit: 1,
    }),
  ]);
  const baselineAudit = baselineAudits[0];
  const baseline = baselineAudit
    ? parsePhase17aBaselineAuditRecord(baselineAudit.auditLog.metadata)
    : null;
  const candidateWindowEndedAt = new Date();
  const optimizationSnapshot = baseline
    ? await getPhase17aCandidateSnapshot(context.project.id, {
        since: new Date(baseline.capturedAt),
        until: candidateWindowEndedAt,
      })
    : null;
  const latestOptimizationAudit = optimizationAudits[0];
  const latestOptimizationRelease = latestOptimizationAudit
    ? parsePhase17aReleaseAuditRecord(latestOptimizationAudit.auditLog.metadata)
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <Button asChild variant="ghost">
        <Link href="/projects/diagnostics">
          <ArrowLeft className="size-4" /> Back to diagnostics
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="size-5" /> Conversation Evaluation Gate
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <form className="flex flex-wrap items-end gap-3" method="get">
            <div className="min-w-64 flex-1 space-y-2">
              <Label htmlFor="candidate">Candidate under review</Label>
              <Input
                defaultValue={candidateLabel}
                id="candidate"
                name="candidate"
                required
              />
            </div>
            <Button type="submit" variant="outline">
              Load candidate
            </Button>
          </form>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-md border p-3">
              <p className="text-sm text-muted-foreground">Cases</p>
              <p className="text-2xl font-semibold">{dashboard.cases.length}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-sm text-muted-foreground">Pass rate</p>
              <p className="text-2xl font-semibold">
                {dashboard.gate.passRate}%
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-sm text-muted-foreground">Safety failures</p>
              <p className="text-2xl font-semibold">
                {dashboard.gate.safetyFailures}
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-sm text-muted-foreground">Promotion</p>
              <p className="text-lg font-semibold">
                {dashboard.gate.ready ? "Ready" : "Blocked"}
              </p>
              <p className="text-xs text-muted-foreground">
                {dashboard.gate.unevaluatedCases} unevaluated
              </p>
            </div>
          </div>
          <div
            className={
              dashboard.gate.ready
                ? "rounded-md border border-green-200 bg-green-50 p-4"
                : "rounded-md border border-amber-200 bg-amber-50 p-4"
            }
          >
            <p className="flex items-center gap-2 font-semibold">
              {dashboard.gate.ready ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <ShieldAlert className="size-4" />
              )}{" "}
              Model or prompt promotion gate
            </p>
            <p className="mt-1 text-sm">
              Requires {dashboard.policy.minimumPassRate}% pass rate, no more
              than {dashboard.policy.maximumSafetyFailures} safety failures, and
              all five datasets.
            </p>
            {dashboard.gate.missingCategories.length > 0 && (
              <p className="mt-2 text-sm">
                Missing datasets: {dashboard.gate.missingCategories.join(", ")}
              </p>
            )}
          </div>
          <ActionStateForm
            action={updateEvaluationPolicy}
            className="grid gap-4 rounded-md border p-4 md:grid-cols-3"
          >
            <ActionFormSuccessToast />
            <input name="projectId" type="hidden" value={context.project.id} />
            <div className="space-y-2">
              <Label htmlFor="minimumPassRate">Minimum pass rate (%)</Label>
              <Input
                defaultValue={dashboard.policy.minimumPassRate}
                id="minimumPassRate"
                name="minimumPassRate"
                type="number"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maximumSafetyFailures">
                Maximum safety failures
              </Label>
              <Input
                defaultValue={dashboard.policy.maximumSafetyFailures}
                id="maximumSafetyFailures"
                name="maximumSafetyFailures"
                type="number"
              />
            </div>
            <div className="self-end">
              <ActionFormError />
              <FormSubmitButton
                label="Save thresholds"
                pendingLabel="Saving..."
              />
            </div>
          </ActionStateForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="size-5" /> Phase 17A Optimization Release Gate
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Record the Phase 17A baseline once. Candidate telemetry then
            includes only activity after that capture. The gate requires at
            least one measurable efficiency reduction and a passing conversation
            evaluation gate.
          </p>

          {baseline ? (
            <div className="space-y-3 rounded-md border border-green-200 bg-green-50 p-4">
              <div>
                <p className="font-semibold">Immutable baseline</p>
                <p className="text-xs text-muted-foreground">
                  Captured{" "}
                  {formatDateTimeInTimeZone(
                    new Date(baseline.capturedAt),
                    context.company.timeZone,
                  )}
                  . This snapshot cannot be replaced from this screen.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-5">
                <CandidateMetric
                  label="Tokens / direct chat"
                  value={baseline.metrics.tokensPerDirectChat}
                />
                <CandidateMetric
                  label="Request latency"
                  suffix=" ms"
                  value={baseline.metrics.averageRequestLatencyMs}
                />
                <CandidateMetric
                  label="Model rate"
                  suffix="%"
                  value={baseline.metrics.modelTurnRate}
                />
                <CandidateMetric
                  label="Retry rate"
                  suffix="%"
                  value={baseline.metrics.retryFallbackRate}
                />
                <CandidateMetric
                  label="Attempts / completion"
                  value={baseline.metrics.attemptsPerCompletion}
                />
              </div>
            </div>
          ) : (
            <ActionStateForm
              action={recordPhase17aOptimizationBaseline}
              className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4"
            >
              <ActionFormSuccessToast />
              <input
                name="projectId"
                type="hidden"
                value={context.project.id}
              />
              <div>
                <p className="font-semibold">No immutable baseline recorded</p>
                <p className="text-sm text-muted-foreground">
                  Capture the current 30-day telemetry before generating
                  candidate traffic. A project can record this baseline only
                  once.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <ActionFormError />
                <FormSubmitButton
                  label="Record immutable baseline"
                  pendingLabel="Recording..."
                />
              </div>
            </ActionStateForm>
          )}

          {baseline && optimizationSnapshot ? (
            <div className="space-y-3 rounded-md border p-4">
              <div>
                <p className="font-semibold">Post-baseline candidate</p>
                <p className="text-xs text-muted-foreground">
                  Activity from{" "}
                  {formatDateTimeInTimeZone(
                    new Date(baseline.capturedAt),
                    context.company.timeZone,
                  )}{" "}
                  through{" "}
                  {formatDateTimeInTimeZone(
                    candidateWindowEndedAt,
                    context.company.timeZone,
                  )}
                  .
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-5">
                <CandidateMetric
                  label="Tokens / direct chat"
                  value={optimizationSnapshot.metrics.tokensPerDirectChat}
                />
                <CandidateMetric
                  label="Request latency"
                  suffix=" ms"
                  value={optimizationSnapshot.metrics.averageRequestLatencyMs}
                />
                <CandidateMetric
                  label="Model rate"
                  suffix="%"
                  value={optimizationSnapshot.metrics.modelTurnRate}
                />
                <CandidateMetric
                  label="Retry rate"
                  suffix="%"
                  value={optimizationSnapshot.metrics.retryFallbackRate}
                />
                <CandidateMetric
                  label="Attempts / completion"
                  value={optimizationSnapshot.metrics.attemptsPerCompletion}
                />
              </div>
            </div>
          ) : null}

          {latestOptimizationRelease && latestOptimizationAudit ? (
            <div
              className={
                latestOptimizationRelease.ready
                  ? "rounded-md border border-green-200 bg-green-50 p-4"
                  : "rounded-md border border-amber-200 bg-amber-50 p-4"
              }
            >
              <p className="flex items-center gap-2 font-semibold">
                {latestOptimizationRelease.ready ? (
                  <CheckCircle2 className="size-4" />
                ) : (
                  <ShieldAlert className="size-4" />
                )}
                Latest comparison:{" "}
                {latestOptimizationRelease.ready ? "Ready" : "Blocked"}
              </p>
              <p className="mt-1 text-sm">
                {latestOptimizationRelease.candidateLabel} · candidate{" "}
                {latestOptimizationRelease.candidateReference} · rollback{" "}
                {latestOptimizationRelease.rollbackReference}
              </p>
              <p className="mt-1 text-sm">
                {latestOptimizationRelease.improvedMetricLabels.length > 0
                  ? "Reduced: " +
                    latestOptimizationRelease.improvedMetricLabels.join(", ") +
                    "."
                  : "No comparable efficiency metric improved."}{" "}
                Evaluation gate{" "}
                {latestOptimizationRelease.evaluationReady
                  ? "passed"
                  : "did not pass"}
                .
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Recorded{" "}
                {formatDateTimeInTimeZone(
                  latestOptimizationAudit.auditLog.createdAt,
                  context.company.timeZone,
                )}
                .
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm">
              No Phase 17A release comparison has been recorded for this
              project.
            </div>
          )}

          {baseline ? (
            <ActionStateForm
              action={recordPhase17aOptimizationRelease}
              className="space-y-4 rounded-md border p-4"
            >
              <ActionFormSuccessToast />
              <input
                name="projectId"
                type="hidden"
                value={context.project.id}
              />
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="optimizationCandidateLabel">
                    Candidate label
                  </Label>
                  <Input
                    defaultValue={candidateLabel}
                    id="optimizationCandidateLabel"
                    name="candidateLabel"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="candidateReference">
                    Candidate deployment or commit
                  </Label>
                  <Input
                    defaultValue={
                      latestOptimizationRelease?.candidateReference ?? ""
                    }
                    id="candidateReference"
                    name="candidateReference"
                    placeholder="Deployment ID or Git commit"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rollbackReference">
                    Rollback deployment or commit
                  </Label>
                  <Input
                    defaultValue={
                      latestOptimizationRelease?.rollbackReference ?? ""
                    }
                    id="rollbackReference"
                    name="rollbackReference"
                    placeholder="Known-good deployment or Git commit"
                    required
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The server compares the immutable baseline with activity after
                its capture. Recording creates project-scoped audit evidence; it
                does not deploy or roll back code.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <ActionFormError />
                <FormSubmitButton
                  label="Record release comparison"
                  pendingLabel="Recording..."
                />
              </div>
            </ActionStateForm>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href="/projects/analytics">Open analytics</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/projects/audit">Open audit logs</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {EVALUATION_CATEGORIES.map((category) => {
        const cases = dashboard.cases.filter(
          (item) => item.evaluationCategory === category,
        );
        return (
          <Card key={category}>
            <CardHeader>
              <CardTitle className="capitalize">
                {category} dataset ({cases.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {cases.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No regression cases in this dataset yet.
                </p>
              ) : (
                cases.map((item) => {
                  const latest = dashboard.latestByCase.get(item.id);
                  return (
                    <div className="rounded-md border p-4" key={item.id}>
                      <div className="flex justify-between gap-4">
                        <div>
                          <p className="font-semibold">{item.title}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Expected: {item.expectedBehavior}
                          </p>
                        </div>
                        <span className="text-sm font-medium">
                          {latest
                            ? latest.passed
                              ? "Passed"
                              : "Failed"
                            : "Not evaluated"}
                        </span>
                      </div>
                      <ActionStateForm
                        action={recordEvaluationResult}
                        className="mt-4 grid gap-3 md:grid-cols-4"
                      >
                        <ActionFormSuccessToast />
                        <input
                          name="projectId"
                          type="hidden"
                          value={context.project.id}
                        />
                        <input
                          name="regressionCaseId"
                          type="hidden"
                          value={item.id}
                        />
                        <div className="space-y-2">
                          <Label>Candidate label</Label>
                          <Input
                            defaultValue={candidateLabel}
                            name="candidateLabel"
                            readOnly
                            required
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>Observed behavior</Label>
                          <Textarea name="observedBehavior" required rows={2} />
                        </div>
                        <div className="space-y-2">
                          <Label>Result</Label>
                          <select
                            className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                            name="passed"
                          >
                            <option value="true">Pass</option>
                            <option value="false">Fail</option>
                          </select>
                          <ActionFormError />
                          <FormSubmitButton
                            label="Record"
                            pendingLabel="Recording..."
                          />
                        </div>
                      </ActionStateForm>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
