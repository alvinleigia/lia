import { ArrowLeft, GitCompareArrows, RotateCcw } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import {
  formatDiffValue,
  formatVersionDate,
  getActionFlowVersionDiff,
  getVersionSnapshotSummary,
} from "@/lib/action-flow-version-diff";
import {
  getActionFlowVersion,
  getProjectAction,
  listActionFlowBranchRules,
  listActionFlowSteps,
} from "@/lib/action-flows";
import {
  getActiveProjectIdCookie,
  resolvePageUserAndProject,
} from "@/lib/protected-page";
import { restoreProjectActionVersionDraftAction } from "../../../actions";

type ActionVersionDiffPageProps = {
  params: Promise<{
    actionId: string;
    versionId: string;
  }>;
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function ActionVersionDiffPage({
  params,
  searchParams,
}: ActionVersionDiffPageProps) {
  const routeParams = await params;
  const query = await searchParams;
  const actionId = Number(routeParams.actionId);
  const versionId = Number(routeParams.versionId);

  if (
    !Number.isInteger(actionId) ||
    actionId <= 0 ||
    !Number.isInteger(versionId) ||
    versionId <= 0
  ) {
    notFound();
  }

  const activeProjectId = await getActiveProjectIdCookie();
  const { project } = await resolvePageUserAndProject(activeProjectId);
  const action = await getProjectAction(project.id, actionId);

  if (!action) {
    notFound();
  }

  const [version, steps, branchRules] = await Promise.all([
    getActionFlowVersion(project.id, action.id, versionId),
    listActionFlowSteps(project.id, action.id),
    listActionFlowBranchRules(project.id, action.id),
  ]);

  if (!version) {
    notFound();
  }

  const summary = getVersionSnapshotSummary(version.snapshot);
  const diffSections = getActionFlowVersionDiff({
    action,
    branchRules,
    publishedSnapshot: version.snapshot,
    steps,
  });
  const changedCount = diffSections.filter((section) => section.changed).length;
  const isCurrent = action.publishedVersionId === version.id;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-6xl space-y-6">
        <Link
          href={`/projects/actions/${action.id}`}
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to action
        </Link>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <CardTitle className="flex items-center gap-2 text-2xl">
                <GitCompareArrows className="h-6 w-6" />
                Version {version.versionNumber} Diff
              </CardTitle>
              <Button asChild variant="outline">
                <Link href={`/projects/actions/${action.id}`}>
                  <ArrowLeft className="h-4 w-4" />
                  Action Detail
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {query.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {query.error}
              </p>
            )}

            <div className="grid gap-3 md:grid-cols-5">
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Runtime
                </p>
                <p className="font-medium">
                  {isCurrent ? "Current" : "Inactive"}
                </p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Published
                </p>
                <p className="font-medium">
                  {formatVersionDate(version.publishedAt)}
                </p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Changed Areas
                </p>
                <p className="font-medium">{changedCount}</p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Snapshot Steps
                </p>
                <p className="font-medium">{summary.steps}</p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Snapshot Branches
                </p>
                <p className="font-medium">{summary.branchRules}</p>
              </div>
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium">Restore Draft From Version</p>
                  <p>
                    This overwrites the editable draft action, steps, and branch
                    rules with this published snapshot. The live runtime version
                    does not change until you publish or activate a version.
                  </p>
                </div>
                <form action={restoreProjectActionVersionDraftAction}>
                  <input type="hidden" name="actionId" value={action.id} />
                  <input type="hidden" name="versionId" value={version.id} />
                  <FormSubmitButton
                    label="Restore Draft"
                    pendingLabel="Restoring..."
                    variant="outline"
                    icon={<RotateCcw className="h-4 w-4" />}
                  />
                </form>
              </div>
            </div>
          </CardContent>
        </Card>

        {diffSections.map((section) => (
          <Card key={section.key}>
            <CardHeader>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <CardTitle className="text-xl">{section.label}</CardTitle>
                <span
                  className={`w-fit rounded-full px-2 py-0.5 text-xs ${
                    section.changed
                      ? "bg-amber-50 text-amber-700"
                      : "bg-green-50 text-green-700"
                  }`}
                >
                  {section.changed ? "Changed" : "Matches draft"}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Published Version
                  </p>
                  <pre className="max-h-[520px] overflow-auto rounded-md border bg-white p-4 text-xs leading-relaxed">
                    {formatDiffValue(section.published)}
                  </pre>
                </div>
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Current Draft
                  </p>
                  <pre className="max-h-[520px] overflow-auto rounded-md border bg-white p-4 text-xs leading-relaxed">
                    {formatDiffValue(section.draft)}
                  </pre>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
