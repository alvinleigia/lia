import {
  AlertTriangle,
  Filter,
  LayoutTemplate,
  Plus,
  Search,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { NoProjectState } from "@/components/no-project-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { assertPermission } from "@/lib/access-control";
import { listProjectActions } from "@/lib/action-flows";
import {
  filterActionTemplates,
  filterProjectActionTemplates,
  listActionTemplateBusinessTypes,
  listProjectActionTemplates,
} from "@/lib/action-templates";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import { applyActionTemplateAction } from "../actions/actions";

type TemplatesPageProps = {
  searchParams: Promise<{
    businessType?: string;
    error?: string;
    q?: string;
  }>;
};

function formatStepType(stepType: string) {
  return stepType.replaceAll("_", " ");
}

function formatChannel(channel: string) {
  return channel.replaceAll("_", " ");
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getAppliedTemplateMetadata(settings: Record<string, unknown>) {
  const templateKey =
    typeof settings.templateKey === "string" ? settings.templateKey.trim() : "";

  if (!templateKey) {
    return null;
  }

  return {
    appliedAt:
      typeof settings.templateAppliedAt === "string"
        ? settings.templateAppliedAt
        : null,
    key: templateKey,
    version:
      typeof settings.templateVersion === "string"
        ? settings.templateVersion.trim()
        : "",
  };
}

function getTemplateAdoptionStats(
  actions: Awaited<ReturnType<typeof listProjectActions>>,
) {
  const stats = new Map<
    string,
    {
      appliedCount: number;
      lastAppliedAt: string | null;
      versions: Set<string>;
    }
  >();

  for (const action of actions) {
    const metadata = getAppliedTemplateMetadata(action.settings);

    if (!metadata) {
      continue;
    }

    const current = stats.get(metadata.key) ?? {
      appliedCount: 0,
      lastAppliedAt: null,
      versions: new Set<string>(),
    };

    current.appliedCount += 1;
    if (metadata.version) {
      current.versions.add(metadata.version);
    }

    if (
      metadata.appliedAt &&
      (!current.lastAppliedAt ||
        new Date(metadata.appliedAt).getTime() >
          new Date(current.lastAppliedAt).getTime())
    ) {
      current.lastAppliedAt = metadata.appliedAt;
    }

    stats.set(metadata.key, current);
  }

  return stats;
}

export default async function TemplatesPage({
  searchParams,
}: TemplatesPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Templates need a project" />;
  }

  assertPermission(context.membership, "company.project.manage");

  const { project } = context;
  const query = params.q?.trim() ?? "";
  const selectedBusinessType = params.businessType?.trim() ?? "";
  const [actions, projectTemplateCatalog, projectTemplates] = await Promise.all(
    [
      listProjectActions(project.id),
      listProjectActionTemplates(project.id),
      filterProjectActionTemplates({
        businessType: selectedBusinessType,
        projectId: project.id,
        query,
      }),
    ],
  );
  const templateAdoptionStats = getTemplateAdoptionStats(actions);
  const businessTypes = [
    ...listActionTemplateBusinessTypes(),
    ...(projectTemplateCatalog.length > 0 ? ["project"] : []),
  ];
  const bundledTemplates = filterActionTemplates({
    businessType: selectedBusinessType,
    query,
  });
  const templates = [...projectTemplates, ...bundledTemplates];

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-2xl flex items-center gap-2">
                <LayoutTemplate className="h-6 w-6" />
                Templates: {project.name}
              </CardTitle>
              <Button asChild variant="outline">
                <Link href="/projects/actions">
                  <Workflow className="h-4 w-4" />
                  Actions
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}

            <form className="grid gap-3 rounded-md border bg-white p-4 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="template-search">Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="template-search"
                    name="q"
                    defaultValue={query}
                    className="pl-9"
                    placeholder="Search by industry, trigger, or use case"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-business-type">Industry</Label>
                <select
                  id="template-business-type"
                  name="businessType"
                  defaultValue={selectedBusinessType}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                >
                  <option value="">All industries</option>
                  {businessTypes.map((businessType) => (
                    <option key={businessType} value={businessType}>
                      {businessType}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" variant="outline">
                <Filter className="h-4 w-4" />
                Filter
              </Button>
            </form>

            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Templates
                </p>
                <p className="text-xl font-semibold">{templates.length}</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Industries
                </p>
                <p className="text-xl font-semibold">{businessTypes.length}</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Setup Checks
                </p>
                <p className="text-xl font-semibold">
                  {templates.reduce(
                    (count, template) =>
                      count + template.summary.compatibilityIssues.length,
                    0,
                  )}
                </p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Applied
                </p>
                <p className="text-xl font-semibold">
                  {[...templateAdoptionStats.values()].reduce(
                    (total, stat) => total + stat.appliedCount,
                    0,
                  )}
                </p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {templates.length === 0 ? (
                <div className="rounded-md border bg-white p-4 text-sm text-muted-foreground lg:col-span-2">
                  No templates match the current filters.
                </div>
              ) : (
                templates.map((template) => {
                  const adoption = templateAdoptionStats.get(template.key);
                  const appliedVersions = adoption
                    ? [...adoption.versions].sort()
                    : [];
                  const isCurrentVersionApplied = appliedVersions.includes(
                    template.summary.version,
                  );

                  return (
                    <div
                      key={template.key}
                      className="rounded-md border bg-white p-4"
                    >
                      <div className="flex h-full flex-col gap-4">
                        <div className="space-y-2">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-medium">{template.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {template.description}
                              </p>
                            </div>
                            <span className="rounded-md border px-2 py-1 text-xs">
                              v{template.summary.version}
                            </span>
                          </div>
                          {adoption && (
                            <div className="rounded-md border bg-green-50 p-3 text-sm text-green-900">
                              <p className="font-medium">
                                Applied {adoption.appliedCount} time
                                {adoption.appliedCount === 1 ? "" : "s"}
                              </p>
                              <p className="text-xs">
                                Last applied{" "}
                                {adoption.lastAppliedAt
                                  ? formatDate(adoption.lastAppliedAt)
                                  : "date unavailable"}
                                {appliedVersions.length > 0
                                  ? ` / versions used: ${appliedVersions
                                      .map((version) => `v${version}`)
                                      .join(", ")}`
                                  : ""}
                              </p>
                              {!isCurrentVersionApplied && (
                                <p className="mt-1 text-xs">
                                  Current version v{template.summary.version}{" "}
                                  has not been applied in this project yet.
                                </p>
                              )}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-md border bg-green-50 px-2 py-1 text-xs text-green-700">
                              {template.summary.status}
                            </span>
                            {template.summary.compatibilityErrors > 0 && (
                              <span className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                                {template.summary.compatibilityErrors} setup
                                error
                                {template.summary.compatibilityErrors === 1
                                  ? ""
                                  : "s"}
                              </span>
                            )}
                            {template.summary.compatibilityWarnings > 0 && (
                              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                                {template.summary.compatibilityWarnings} setup
                                note
                                {template.summary.compatibilityWarnings === 1
                                  ? ""
                                  : "s"}
                              </span>
                            )}
                            <span className="rounded-md border bg-slate-50 px-2 py-1 text-xs text-slate-700">
                              {template.summary.stepCount} steps
                            </span>
                            <span className="rounded-md border bg-slate-50 px-2 py-1 text-xs text-slate-700">
                              {template.summary.requiredFieldCount}/
                              {template.summary.fieldCount} required fields
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {template.businessTypes.map((businessType) => (
                              <span
                                key={businessType}
                                className="rounded-md border bg-slate-50 px-2 py-1 text-xs text-slate-700"
                              >
                                {businessType}
                              </span>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {template.summary.channels.map((channel) => (
                              <span
                                key={`${template.key}-${channel}`}
                                className="rounded-md border bg-blue-50 px-2 py-1 text-xs text-blue-700"
                              >
                                {formatChannel(channel)}
                              </span>
                            ))}
                          </div>
                        </div>

                        {template.summary.compatibilityIssues.length > 0 && (
                          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                            <p className="flex items-center gap-2 font-medium">
                              <AlertTriangle className="h-4 w-4" />
                              Setup checks
                            </p>
                            <div className="space-y-1">
                              {template.summary.compatibilityIssues
                                .slice(0, 3)
                                .map((issue) => (
                                  <p
                                    key={`${template.key}-${issue.severity}-${issue.message}`}
                                    className="text-xs"
                                  >
                                    <span className="font-medium capitalize">
                                      {issue.severity}:
                                    </span>{" "}
                                    {issue.message}
                                  </p>
                                ))}
                              {template.summary.compatibilityIssues.length >
                                3 && (
                                <p className="text-xs text-amber-800">
                                  +
                                  {template.summary.compatibilityIssues.length -
                                    3}{" "}
                                  more setup check
                                  {template.summary.compatibilityIssues.length -
                                    3 ===
                                  1
                                    ? ""
                                    : "s"}
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="space-y-2">
                          <p className="text-xs uppercase text-muted-foreground">
                            Trigger phrases
                          </p>
                          <p className="text-sm">
                            {template.action.triggerPhrases.join(", ")}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs uppercase text-muted-foreground">
                            Flow preview
                          </p>
                          <div className="space-y-1">
                            {template.steps.map((step) => (
                              <div
                                key={`${template.key}-${step.sortOrder}`}
                                className="rounded-md border bg-slate-50 px-3 py-2"
                              >
                                <p className="text-sm font-medium">
                                  {step.sortOrder}.{" "}
                                  {step.label || step.stepType}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatStepType(step.stepType)}
                                  {step.isRequired ? " / required" : ""}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>

                        <form
                          action={applyActionTemplateAction}
                          className="mt-auto"
                        >
                          <input
                            type="hidden"
                            name="templateKey"
                            value={template.key}
                          />
                          <input
                            type="hidden"
                            name="sourcePath"
                            value="/projects/templates"
                          />
                          <FormSubmitButton
                            className="w-full"
                            label="Apply Template"
                            pendingLabel="Applying..."
                            icon={<Plus className="h-4 w-4" />}
                          />
                        </form>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
