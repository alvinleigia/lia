import {
  FlaskConical,
  LayoutTemplate,
  Plus,
  Upload,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { NoProjectState } from "@/components/no-project-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getActionFlowAnalytics } from "@/lib/action-flow-analytics";
import {
  listActionFlowSteps,
  listProjectActions,
  listProjectReusableActionFields,
} from "@/lib/action-flows";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";

type ActionBuilderPageProps = {
  searchParams: Promise<{
    deleted?: string;
    error?: string;
  }>;
};

function getExperimentSummary(settings: Record<string, unknown>) {
  const experiment = settings.experiment;

  if (
    !experiment ||
    typeof experiment !== "object" ||
    Array.isArray(experiment)
  ) {
    return null;
  }

  const record = experiment as Record<string, unknown>;
  if (record.enabled !== true) {
    return null;
  }

  return {
    key: typeof record.key === "string" ? record.key.trim() : "",
    variantLabel:
      typeof record.variantLabel === "string" ? record.variantLabel.trim() : "",
    weight:
      typeof record.weight === "number" && Number.isFinite(record.weight)
        ? record.weight
        : 100,
  };
}

function formatStepType(stepType: string) {
  return stepType.replaceAll("_", " ");
}

function groupExperimentRows(
  rows: Array<{
    actionId: number;
    actionName: string;
    completionRate: number;
    experiment: NonNullable<ReturnType<typeof getExperimentSummary>>;
    submittedCount: number;
    totalSubmissions: number;
  }>,
) {
  const groups = new Map<string, typeof rows>();

  for (const row of rows) {
    const key = row.experiment.key || "Unkeyed experiment";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.entries()]
    .map(([key, variants]) => ({
      key,
      totalSubmissions: variants.reduce(
        (total, variant) => total + variant.totalSubmissions,
        0,
      ),
      variants: variants.sort((left, right) =>
        left.experiment.variantLabel.localeCompare(
          right.experiment.variantLabel,
        ),
      ),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export default async function ActionBuilderPage({
  searchParams,
}: ActionBuilderPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Actions need a project" />;
  }

  const { project } = context;
  const [actions, reusableFields] = await Promise.all([
    listProjectActions(project.id),
    listProjectReusableActionFields(project.id),
  ]);
  const experimentRows = await Promise.all(
    actions.flatMap((action) => {
      const experiment = getExperimentSummary(action.settings);

      if (!experiment) {
        return [];
      }

      return [
        (async () => {
          const steps = await listActionFlowSteps(project.id, action.id);
          const analytics = await getActionFlowAnalytics({
            actionId: action.id,
            projectId: project.id,
            steps,
          });

          return {
            actionId: action.id,
            actionName: action.name,
            completionRate: analytics.completionRate,
            experiment,
            submittedCount: analytics.submittedCount,
            totalSubmissions: analytics.totalSubmissions,
          };
        })(),
      ];
    }),
  );
  const experimentGroups = groupExperimentRows(experimentRows);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {experimentGroups.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl flex items-center gap-2">
                <FlaskConical className="h-6 w-6" />
                Experiments
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {experimentGroups.map((group) => (
                <div key={group.key} className="rounded-md border bg-white p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{group.key}</p>
                      <p className="text-sm text-muted-foreground">
                        {group.variants.length} variant
                        {group.variants.length === 1 ? "" : "s"} -{" "}
                        {group.totalSubmissions} start
                        {group.totalSubmissions === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {group.variants.map((variant) => (
                      <Link
                        key={variant.actionId}
                        href={`/projects/actions/${variant.actionId}`}
                        className="rounded-md border bg-muted/20 p-3 hover:bg-accent/40"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">
                              {variant.experiment.variantLabel || "Variant"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {variant.actionName}
                            </p>
                          </div>
                          <span className="rounded-full bg-white px-2 py-0.5 text-xs">
                            {variant.experiment.weight}%
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              Starts
                            </p>
                            <p className="font-medium">
                              {variant.totalSubmissions}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              Submitted
                            </p>
                            <p className="font-medium">
                              {variant.submittedCount}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              Complete
                            </p>
                            <p className="font-medium">
                              {variant.completionRate}%
                            </p>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {reusableFields.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Reusable Fields</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Shared field keys collected from this project's action steps.
                These keys can be reused in routing, templates, operation
                mappings, and submissions.
              </p>
              <div className="overflow-x-auto rounded-md border bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-4 pl-3">Field Key</th>
                      <th className="py-2 pr-4">Uses</th>
                      <th className="py-2 pr-4">Labels</th>
                      <th className="py-2 pr-4">Step Types</th>
                      <th className="py-2 pr-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reusableFields.map((field) => (
                      <tr
                        key={field.fieldKey}
                        className="border-b last:border-b-0"
                      >
                        <td className="py-2 pr-4 pl-3 font-medium">
                          {field.fieldKey}
                        </td>
                        <td className="py-2 pr-4">{field.usageCount}</td>
                        <td className="py-2 pr-4">
                          {field.labels.length > 0
                            ? field.labels.slice(0, 3).join(", ")
                            : "-"}
                        </td>
                        <td className="py-2 pr-4 capitalize">
                          {field.stepTypes.map(formatStepType).join(", ")}
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex flex-wrap gap-2">
                            {field.actions.map((action) => (
                              <Link
                                key={`${field.fieldKey}-${action.id}`}
                                href={`/projects/actions/${action.id}`}
                                className="rounded-full bg-muted px-2 py-0.5 text-xs underline-offset-4 hover:underline"
                              >
                                {action.name}
                              </Link>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-2xl flex items-center gap-2">
                <Workflow className="h-6 w-6" />
                Actions: {project.name}
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link href="/projects/templates">
                    <LayoutTemplate className="h-4 w-4" />
                    Templates
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/projects/actions/import">
                    <Upload className="h-4 w-4" />
                    Import
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/projects/actions/new">
                    <Plus className="h-4 w-4" />
                    New Action
                  </Link>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}
            {params.deleted && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Action deleted.
              </p>
            )}

            {actions.length === 0 ? (
              <div className="rounded-md border bg-white p-4">
                <p className="text-sm text-muted-foreground">
                  No actions configured yet.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {actions.map((action) => {
                  const experiment = getExperimentSummary(action.settings);

                  return (
                    <Link
                      key={action.id}
                      href={`/projects/actions/${action.id}`}
                      className="flex items-start justify-between gap-4 rounded-md border bg-white px-4 py-3 hover:bg-accent/40"
                    >
                      <div className="space-y-1">
                        <p className="font-medium">{action.name}</p>
                        {action.description && (
                          <p className="text-sm text-muted-foreground">
                            {action.description}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>
                            {action.triggerPhrases.length} trigger phrase
                            {action.triggerPhrases.length === 1 ? "" : "s"}
                          </span>
                          {experiment && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                              <FlaskConical className="h-3 w-3" />
                              {experiment.key || "Experiment"} /{" "}
                              {experiment.variantLabel || "Variant"} (
                              {experiment.weight}%)
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="rounded-md border px-2 py-1 text-xs capitalize">
                        {action.status}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
