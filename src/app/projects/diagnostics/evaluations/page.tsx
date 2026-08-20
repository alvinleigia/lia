import {
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import {
  recordEvaluationResult,
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
import {
  EVALUATION_CATEGORIES,
  getConversationEvaluationDashboard,
} from "@/lib/conversation-evaluations";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";

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
  const dashboard = await getConversationEvaluationDashboard(
    context.project.id,
    candidateLabel,
  );

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
