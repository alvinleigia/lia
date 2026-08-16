import {
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  Workflow,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HybridFlowSimulator } from "@/components/hybrid-flow-simulator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getActionFlowVersion, getProjectAction } from "@/lib/action-flows";
import { listAuditLogsForTarget } from "@/lib/audit";
import {
  AUTOMATED_FLOW_TEST_AUDIT_ACTION,
  AUTOMATED_FLOW_TEST_TARGET_TYPE,
  automatedFlowTestAuditMetadataSchema,
} from "@/lib/hybrid-flow-automated-test";
import { compiledHybridFlowGraphV1Schema } from "@/lib/hybrid-flow-contracts";
import {
  getActiveProjectIdCookie,
  resolvePageUserAndProject,
} from "@/lib/protected-page";
import { runAutomatedFlowTestAction } from "./actions";

type HybridFlowTestPageProps = {
  params: Promise<{
    actionId: string;
  }>;
  searchParams: Promise<{
    automatedTest?: string | string[];
    automatedTestError?: string | string[];
  }>;
};

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HybridFlowTestPage({
  params,
  searchParams,
}: HybridFlowTestPageProps) {
  const [routeParams, query] = await Promise.all([params, searchParams]);
  const actionId = Number(routeParams.actionId);

  if (!Number.isInteger(actionId) || actionId <= 0) {
    notFound();
  }

  const activeProjectId = await getActiveProjectIdCookie();
  const { project } = await resolvePageUserAndProject(activeProjectId);
  const action = await getProjectAction(project.id, actionId);

  if (!action) {
    notFound();
  }

  const version = action.publishedVersionId
    ? await getActionFlowVersion(
        project.id,
        action.id,
        action.publishedVersionId,
      )
    : null;
  const graph = version
    ? compiledHybridFlowGraphV1Schema.safeParse(
        (version.snapshot as { hybridGraph?: unknown }).hybridGraph,
      )
    : null;
  const automatedTestLogs = version
    ? await listAuditLogsForTarget({
        action: AUTOMATED_FLOW_TEST_AUDIT_ACTION,
        projectId: project.id,
        targetId: version.id,
        targetType: AUTOMATED_FLOW_TEST_TARGET_TYPE,
      })
    : [];
  const automatedTestRuns = automatedTestLogs.flatMap(({ actor, auditLog }) => {
    const metadata = automatedFlowTestAuditMetadataSchema.safeParse(
      auditLog.metadata,
    );
    return metadata.success
      ? [{ actor, auditLog, metadata: metadata.data }]
      : [];
  });
  const automatedTestCompleted =
    firstSearchParam(query.automatedTest) === "completed";
  const automatedTestError = firstSearchParam(query.automatedTestError);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <Link
          href={`/projects/actions/${action.id}/canvas`}
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to canvas
        </Link>

        {!version || !graph?.success ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Workflow className="h-6 w-6" />
                Published Flow Test
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Publish a valid flow version before testing its hybrid routes.
              </p>
              <Button asChild>
                <Link href={`/projects/actions/${action.id}`}>
                  Review and Publish
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <FlaskConical className="h-6 w-6" />
                  Automated Flow Test
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Check every published entry, node, route, finish path, and
                  supported core input without creating conversations,
                  submissions, tool attempts, or model calls.
                </p>
              </CardHeader>
              <CardContent className="space-y-5">
                {automatedTestCompleted && (
                  <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                    Automated test completed and recorded.
                  </p>
                )}
                {automatedTestError && (
                  <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {automatedTestError}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border p-4">
                  <div>
                    <p className="font-medium">
                      Published version v{version.versionNumber}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Structural, core input, and resource-backed checks run
                      against the immutable published version.
                    </p>
                  </div>
                  <form action={runAutomatedFlowTestAction}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="actionId" value={action.id} />
                    <input type="hidden" name="versionId" value={version.id} />
                    <Button type="submit" pendingContent="Running test...">
                      <FlaskConical className="h-4 w-4" />
                      Run Automated Test
                    </Button>
                  </form>
                </div>

                <div className="space-y-3">
                  <h2 className="font-semibold">Recent automated runs</h2>
                  {automatedTestRuns.length === 0 ? (
                    <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      No automated run has been recorded for this published
                      version yet.
                    </p>
                  ) : (
                    <ol className="space-y-3">
                      {automatedTestRuns.map(
                        ({ actor, auditLog, metadata }, index) => {
                          const report = metadata.report;
                          const passed = report.status === "passed";
                          return (
                            <li
                              key={auditLog.id}
                              className="rounded-md border p-4"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex items-start gap-3">
                                  {passed ? (
                                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" />
                                  ) : (
                                    <XCircle className="mt-0.5 h-5 w-5 text-red-600" />
                                  )}
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="font-medium">
                                        {index === 0
                                          ? "Latest run"
                                          : "Previous run"}
                                      </p>
                                      <Badge
                                        variant={
                                          passed ? "outline" : "destructive"
                                        }
                                      >
                                        {passed ? "Passed" : "Failed"}
                                      </Badge>
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                      {auditLog.createdAt.toLocaleString()} ·{" "}
                                      {actor?.name ??
                                        actor?.email ??
                                        "Unknown user"}
                                    </p>
                                  </div>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  {report.entriesTested} entries ·{" "}
                                  {report.nodesTested} nodes ·{" "}
                                  {report.routesTested} routes
                                  {report.behavioral
                                    ? ` · ${report.behavioral.casesRun} input cases`
                                    : ""}
                                  {report.resources
                                    ? ` · ${report.resources.checks.length} resource checks`
                                    : ""}
                                </p>
                              </div>

                              {report.errors.length > 0 && (
                                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-700">
                                  {report.errors.map((error) => (
                                    <li key={error}>{error}</li>
                                  ))}
                                </ul>
                              )}

                              <details className="mt-3 text-sm">
                                <summary className="cursor-pointer font-medium">
                                  View {report.checks.length} checks
                                </summary>
                                <ul className="mt-2 space-y-2">
                                  {report.checks.map((check) => (
                                    <li
                                      key={check.key}
                                      className="rounded-md bg-muted/40 px-3 py-2"
                                    >
                                      <span className="font-medium">
                                        {check.label}:
                                      </span>{" "}
                                      {check.detail}
                                    </li>
                                  ))}
                                </ul>
                              </details>

                              {report.behavioral && (
                                <details className="mt-3 text-sm">
                                  <summary className="cursor-pointer font-medium">
                                    View core input behavior
                                  </summary>
                                  <div className="mt-2 space-y-3 rounded-md border p-3">
                                    <p>
                                      <span className="font-medium">
                                        {report.behavioral.casesPassed} passed
                                      </span>
                                      {" · "}
                                      {report.behavioral.casesFailed} failed
                                      {" · "}
                                      {report.behavioral.stepsTested} of{" "}
                                      {report.behavioral.stepsConsidered} input
                                      blocks tested
                                    </p>
                                    {report.behavioral.skippedSteps.length >
                                      0 && (
                                      <div>
                                        <p className="font-medium">
                                          Covered by another check in this run
                                        </p>
                                        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                                          {report.behavioral.skippedSteps.map(
                                            (step) => (
                                              <li key={step.stepId}>
                                                {step.stepLabel}: {step.reason}
                                              </li>
                                            ),
                                          )}
                                        </ul>
                                      </div>
                                    )}
                                    <ul className="space-y-1">
                                      {report.behavioral.cases.map(
                                        (testCase, caseIndex) => (
                                          <li
                                            key={`${testCase.stepId}-${testCase.caseType}-${caseIndex}`}
                                            className={
                                              testCase.status === "passed"
                                                ? "text-muted-foreground"
                                                : "text-red-700"
                                            }
                                          >
                                            <span className="font-medium text-foreground">
                                              {testCase.stepLabel}
                                            </span>
                                            : {testCase.detail}
                                          </li>
                                        ),
                                      )}
                                    </ul>
                                  </div>
                                </details>
                              )}

                              {report.resources && (
                                <details className="mt-3 text-sm">
                                  <summary className="cursor-pointer font-medium">
                                    View resource-backed behavior
                                  </summary>
                                  <div className="mt-2 space-y-3 rounded-md border p-3">
                                    <p>
                                      <span className="font-medium">
                                        {report.resources.checksPassed} passed
                                      </span>
                                      {" · "}
                                      {report.resources.checksFailed} failed
                                      {" · "}
                                      {report.resources.stepsTested} of{" "}
                                      {report.resources.stepsConsidered}{" "}
                                      resource-backed blocks tested
                                    </p>
                                    {report.resources.warnings.length > 0 && (
                                      <div>
                                        <p className="font-medium">
                                          Channel fallbacks
                                        </p>
                                        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                                          {report.resources.warnings.map(
                                            (warning) => (
                                              <li key={warning}>{warning}</li>
                                            ),
                                          )}
                                        </ul>
                                      </div>
                                    )}
                                    <ul className="space-y-1">
                                      {report.resources.checks.map((check) => (
                                        <li
                                          key={check.key}
                                          className={
                                            check.status === "passed"
                                              ? "text-muted-foreground"
                                              : "text-red-700"
                                          }
                                        >
                                          <span className="font-medium text-foreground">
                                            {check.stepLabel}
                                          </span>
                                          : {check.detail}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                </details>
                              )}
                            </li>
                          );
                        },
                      )}
                    </ol>
                  )}
                </div>
              </CardContent>
            </Card>

            <HybridFlowSimulator
              actionName={action.name}
              graph={graph.data}
              versionNumber={version.versionNumber}
            />
          </>
        )}
      </div>
    </div>
  );
}
