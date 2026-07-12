import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  CheckCircle2,
  ClipboardPlus,
  Copy,
  Download,
  Eye,
  EyeOff,
  FlaskConical,
  GitBranch,
  History,
  LayoutTemplate,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Settings,
  Trash2,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionFlowAnalyticsCharts } from "@/components/action-flow-analytics-charts";
import { ActionFlowPreview } from "@/components/action-flow-preview";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { getActionFlowAnalytics } from "@/lib/action-flow-analytics";
import {
  formatVersionDate,
  getDraftRuntimeChangeSummary,
  getVersionSnapshotSummary,
} from "@/lib/action-flow-version-diff";
import {
  countBlockingActionFlowIssues,
  getProjectAction,
  listActionFlowBranchRules,
  listActionFlowSteps,
  listActionFlowVersions,
  validateActionFlowRoutes,
} from "@/lib/action-flows";
import {
  getActiveProjectIdCookie,
  resolvePageUserAndProject,
} from "@/lib/protected-page";
import { toRuntimeAction } from "@/lib/runtime-actions";
import { createTestActionSubmissionAction } from "../../submissions/actions";
import {
  activateProjectActionVersionAction,
  deleteActionFlowStepAction,
  duplicateActionFlowStepAction,
  moveActionFlowStepAction,
  publishProjectActionVersionAction,
  saveProjectActionAsTemplateAction,
  toggleActionFlowStepEnabledAction,
} from "../actions";

type ActionDetailPageProps = {
  params: Promise<{
    actionId: string;
  }>;
  searchParams: Promise<{
    created?: string;
    error?: string;
    updated?: string;
    stepCreated?: string;
    stepUpdated?: string;
    stepDeleted?: string;
    published?: string;
    versionActivated?: string;
    versionRestored?: string;
    templateSaved?: string;
  }>;
};

function formatOptionLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isInputStepType(stepType: string) {
  return [
    "collect_input",
    "choice",
    "date",
    "date_range",
    "address",
    "time",
    "number",
    "email",
    "phone",
    "location",
    "product_selection",
  ].includes(stepType);
}

function hasDynamicOptions(settings: Record<string, unknown>) {
  return typeof settings.sourceType === "string" && settings.sourceType.trim();
}

function getSettingText(settings: Record<string, unknown>, key: string) {
  const value = settings[key];
  return typeof value === "string" ? value.trim() : "";
}

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

function isSilentActionStep(stepType: string) {
  return ["operation", "set_attribute", "add_tag"].includes(stepType);
}

function isProductMessageStep(stepType: string) {
  return [
    "catalog_message",
    "single_product",
    "multiple_products",
    "product_selection",
  ].includes(stepType);
}

function hasProductSnapshot(settings: Record<string, unknown>) {
  return Array.isArray(settings.products) && settings.products.length > 0;
}

function getStepLabel(
  step: Awaited<ReturnType<typeof listActionFlowSteps>>[number],
) {
  return step.label || step.fieldKey || formatOptionLabel(step.stepType);
}

function getRouteTargetLabel(
  stepId: number | null,
  stepById: Map<
    number,
    Awaited<ReturnType<typeof listActionFlowSteps>>[number]
  >,
) {
  if (stepId === null) {
    return "next enabled step by order";
  }

  const targetStep = stepById.get(stepId);
  return targetStep
    ? `${targetStep.sortOrder}. ${getStepLabel(targetStep)}`
    : `missing step #${stepId}`;
}

function getPublishReadinessIssues(input: {
  routeIssueCount: number;
  steps: Awaited<ReturnType<typeof listActionFlowSteps>>;
}) {
  const issues: string[] = [];
  const enabledSteps = input.steps.filter((step) => step.isEnabled);
  const runnableSteps = enabledSteps.filter(
    (step) => step.stepType !== "operation",
  );
  const enabledFieldKeys = enabledSteps
    .filter((step) => isInputStepType(step.stepType))
    .map((step) => step.fieldKey?.trim())
    .filter((fieldKey): fieldKey is string => Boolean(fieldKey));
  const fieldKeyCounts = enabledFieldKeys.reduce<Map<string, number>>(
    (counts, fieldKey) => counts.set(fieldKey, (counts.get(fieldKey) ?? 0) + 1),
    new Map(),
  );

  if (input.steps.length === 0) {
    issues.push("Add at least one flow step.");
  }

  if (enabledSteps.length === 0) {
    issues.push("Enable at least one flow step.");
  }

  if (runnableSteps.length === 0) {
    issues.push("Add at least one enabled customer-facing step.");
  }

  for (const [fieldKey, count] of fieldKeyCounts) {
    if (count > 1) {
      issues.push(`Field key "${fieldKey}" is used by multiple enabled steps.`);
    }
  }

  for (const step of enabledSteps) {
    if (!isSilentActionStep(step.stepType) && !step.prompt?.trim()) {
      issues.push(`Step ${step.sortOrder} is missing a prompt.`);
    }

    if (isInputStepType(step.stepType)) {
      if (!step.fieldKey?.trim()) {
        issues.push(`Step ${step.sortOrder} is missing a field key.`);
      }

      if (!step.label?.trim()) {
        issues.push(`Step ${step.sortOrder} is missing a label.`);
      }
    }

    if (
      step.stepType === "choice" &&
      (!Array.isArray(step.options) || step.options.length === 0) &&
      !hasDynamicOptions(step.settings)
    ) {
      issues.push(`Step ${step.sortOrder} needs options or an option source.`);
    }

    if (step.stepType === "operation" && !step.operationId) {
      issues.push(`Step ${step.sortOrder} is missing an operation.`);
    }

    if (
      isProductMessageStep(step.stepType) &&
      !hasProductSnapshot(step.settings)
    ) {
      issues.push(`Step ${step.sortOrder} needs a product selection.`);
    }

    if (step.stepType === "set_attribute") {
      const valueSource =
        getSettingText(step.settings, "contactAttributeValueSource") || "field";
      const hasValue =
        valueSource === "static"
          ? Boolean(getSettingText(step.settings, "contactAttributeValue"))
          : Boolean(getSettingText(step.settings, "contactAttributeFieldKey"));

      if (!getSettingText(step.settings, "contactAttributeKey") || !hasValue) {
        issues.push(
          `Step ${step.sortOrder} needs a contact attribute key and value source.`,
        );
      }
    }

    if (
      step.stepType === "add_tag" &&
      !getSettingText(step.settings, "contactTagNames")
    ) {
      issues.push(`Step ${step.sortOrder} needs at least one contact tag.`);
    }
  }

  if (
    enabledSteps.length > 0 &&
    !enabledSteps.some((step) =>
      ["confirmation", "submit"].includes(step.stepType),
    )
  ) {
    issues.push("Add an enabled confirmation or submit step.");
  }

  if (input.routeIssueCount > 0) {
    issues.push(`${input.routeIssueCount} route issue(s) need attention.`);
  }

  return issues;
}

export default async function ActionDetailPage({
  params,
  searchParams,
}: ActionDetailPageProps) {
  const routeParams = await params;
  const query = await searchParams;
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

  const steps = await listActionFlowSteps(project.id, action.id);
  const [branchRules, routeIssues] = await Promise.all([
    listActionFlowBranchRules(project.id, action.id),
    validateActionFlowRoutes(project.id, action.id),
  ]);
  const publishedVersions = await listActionFlowVersions(project.id, action.id);
  const currentPublishedVersion =
    publishedVersions.find(
      (version) => version.id === action.publishedVersionId,
    ) ?? null;
  const branchRulesByStepId = new Map<number, number>();
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const branchTargetsByStepId = new Map<number, string[]>();
  for (const rule of branchRules) {
    if (!rule.isEnabled) {
      continue;
    }

    branchRulesByStepId.set(
      rule.sourceStepId,
      (branchRulesByStepId.get(rule.sourceStepId) ?? 0) + 1,
    );
    const targetLabel = getRouteTargetLabel(rule.targetStepId, stepById);
    const ruleLabel = `${rule.sourceFieldKey} ${formatOptionLabel(
      rule.operator,
    ).toLowerCase()}${rule.comparisonValue ? ` ${rule.comparisonValue}` : ""} -> ${targetLabel}`;
    branchTargetsByStepId.set(rule.sourceStepId, [
      ...(branchTargetsByStepId.get(rule.sourceStepId) ?? []),
      ruleLabel,
    ]);
  }
  const blockingRouteIssueCount = countBlockingActionFlowIssues(routeIssues);
  const readinessIssues = getPublishReadinessIssues({
    routeIssueCount: blockingRouteIssueCount,
    steps,
  });
  const draftRuntimeChanges = getDraftRuntimeChangeSummary({
    action,
    branchRules,
    publishedSnapshot: currentPublishedVersion?.snapshot,
    steps,
  });
  const analytics = await getActionFlowAnalytics({
    actionId: action.id,
    projectId: project.id,
    steps,
  });
  const experiment = getExperimentSummary(action.settings);
  const previewAction = toRuntimeAction({ action, branchRules, steps });

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <Link
          href="/projects/actions"
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to actions
        </Link>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <CardTitle className="text-2xl flex items-center gap-2">
                <Workflow className="h-6 w-6" />
                {action.name}
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <form action={publishProjectActionVersionAction}>
                  <input type="hidden" name="actionId" value={action.id} />
                  <FormSubmitButton
                    label="Publish"
                    pendingLabel="Publishing..."
                    disabled={readinessIssues.length > 0}
                    icon={<Send className="h-4 w-4" />}
                  />
                </form>
                <Button asChild variant="outline">
                  <Link href={`/projects/actions/${action.id}/canvas`}>
                    <GitBranch className="h-4 w-4" />
                    Canvas
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href={`/projects/actions/${action.id}/export`}>
                    <Download className="h-4 w-4" />
                    Export
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href={`/projects/actions/${action.id}/settings`}>
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                </Button>
                <form action={saveProjectActionAsTemplateAction}>
                  <input type="hidden" name="actionId" value={action.id} />
                  <FormSubmitButton
                    label="Save Template"
                    pendingLabel="Saving..."
                    variant="outline"
                    icon={<LayoutTemplate className="h-4 w-4" />}
                  />
                </form>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {(query.created ||
              query.updated ||
              query.stepCreated ||
              query.stepUpdated ||
              query.stepDeleted ||
              query.published ||
              query.versionActivated ||
              query.versionRestored ||
              query.templateSaved) && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                {query.published
                  ? "Action published."
                  : query.versionActivated
                    ? "Runtime version updated."
                    : query.versionRestored
                      ? "Draft restored from version."
                      : query.templateSaved
                        ? "Template saved."
                        : "Changes saved."}
              </p>
            )}

            {query.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {query.error}
              </p>
            )}

            <div className="grid gap-3 md:grid-cols-5">
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Status
                </p>
                <p className="font-medium capitalize">{action.status}</p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Flow Steps
                </p>
                <p className="font-medium">
                  {steps.filter((step) => step.isEnabled).length}/{steps.length}
                </p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Branch Rules
                </p>
                <p className="font-medium">
                  {branchRules.filter((rule) => rule.isEnabled).length}/
                  {branchRules.length}
                </p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Trigger Phrases
                </p>
                <p className="font-medium">{action.triggerPhrases.length}</p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Published Version
                </p>
                <p className="font-medium">
                  {currentPublishedVersion
                    ? `v${currentPublishedVersion.versionNumber}`
                    : "None"}
                </p>
              </div>
            </div>

            {action.description && (
              <p className="text-sm text-muted-foreground">
                {action.description}
              </p>
            )}

            {experiment && (
              <div className="rounded-md border bg-white p-4 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <FlaskConical className="h-4 w-4" />
                  Experiment Variant
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-2 py-0.5">
                    Key: {experiment.key || "Not set"}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5">
                    Variant: {experiment.variantLabel || "Not set"}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5">
                    Weight: {experiment.weight}%
                  </span>
                </div>
              </div>
            )}

            <div
              className={`rounded-md border p-4 text-sm ${
                readinessIssues.length === 0
                  ? "border-green-200 bg-green-50 text-green-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              <p className="font-medium">
                {readinessIssues.length === 0
                  ? "Ready to publish"
                  : "Publish readiness"}
              </p>
              {readinessIssues.length === 0 ? (
                <p>
                  This action has enabled steps, valid routing, and a terminal
                  path.
                </p>
              ) : (
                <div className="mt-2 space-y-1">
                  {readinessIssues.map((issue) => (
                    <p key={issue}>
                      <AlertTriangle className="mr-2 inline h-4 w-4" />
                      {issue}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {draftRuntimeChanges && (
              <div
                className={`rounded-md border p-4 text-sm ${
                  draftRuntimeChanges.hasChanges
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-green-200 bg-green-50 text-green-900"
                }`}
              >
                <p className="font-medium">
                  {draftRuntimeChanges.hasChanges
                    ? "Draft has unpublished changes"
                    : "Draft matches runtime"}
                </p>
                {draftRuntimeChanges.hasChanges ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {draftRuntimeChanges.actionChanged && (
                      <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs">
                        Action settings
                      </span>
                    )}
                    {draftRuntimeChanges.stepsChanged && (
                      <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs">
                        Flow steps
                      </span>
                    )}
                    {draftRuntimeChanges.branchesChanged && (
                      <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs">
                        Branch rules
                      </span>
                    )}
                  </div>
                ) : (
                  <p>
                    The editable draft is the same configuration as the current
                    published runtime version.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <History className="h-5 w-5" />
              Version History
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {publishedVersions.length === 0 ? (
              <div className="rounded-md border bg-white p-4">
                <p className="text-sm text-muted-foreground">
                  No published versions yet. Publish this action when the draft
                  is ready for live chat runtime.
                </p>
              </div>
            ) : (
              publishedVersions.map((version) => {
                const summary = getVersionSnapshotSummary(version.snapshot);
                const isCurrent = version.id === action.publishedVersionId;

                return (
                  <div
                    key={version.id}
                    className="flex flex-col gap-3 rounded-md border bg-white p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="space-y-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span>Version {version.versionNumber}</span>
                        {isCurrent && (
                          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                            Current runtime
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Published {formatVersionDate(version.publishedAt)}
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 md:items-end">
                      <div className="grid grid-cols-3 gap-2 text-sm md:min-w-80">
                        <div className="rounded-md border bg-muted/30 p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Steps
                          </p>
                          <p className="font-medium">{summary.steps}</p>
                        </div>
                        <div className="rounded-md border bg-muted/30 p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Branches
                          </p>
                          <p className="font-medium">{summary.branchRules}</p>
                        </div>
                        <div className="rounded-md border bg-muted/30 p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Triggers
                          </p>
                          <p className="font-medium">
                            {summary.triggerPhrases}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 md:justify-end">
                        <Button asChild variant="outline">
                          <Link
                            href={`/projects/actions/${action.id}/versions/${version.id}`}
                          >
                            <Eye className="h-4 w-4" />
                            View Diff
                          </Link>
                        </Button>
                        {!isCurrent && (
                          <form action={activateProjectActionVersionAction}>
                            <input
                              type="hidden"
                              name="actionId"
                              value={action.id}
                            />
                            <input
                              type="hidden"
                              name="versionId"
                              value={version.id}
                            />
                            <FormSubmitButton
                              label="Use Version"
                              pendingLabel="Updating..."
                              variant="outline"
                              icon={<RotateCcw className="h-4 w-4" />}
                            />
                          </form>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {routeIssues.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Flow Diagnostics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {routeIssues.map((issue, index) => (
                  <p
                    key={`${issue.source}-${issue.stepId ?? issue.ruleId}-${index}`}
                    className="flex gap-2"
                  >
                    <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                      {issue.severity === "warning" ? "Warning" : "Error"}
                    </span>
                    <span>{issue.message}</span>
                  </p>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Flow Analytics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-5">
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Starts
                </p>
                <p className="font-medium">{analytics.totalSubmissions}</p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Submitted
                </p>
                <p className="font-medium">{analytics.submittedCount}</p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Completion
                </p>
                <p className="font-medium">{analytics.completionRate}%</p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  In Progress
                </p>
                <p className="font-medium">{analytics.inProgressCount}</p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Validation Fails
                </p>
                <p className="font-medium">
                  {analytics.validationFailureCount}
                </p>
              </div>
            </div>

            <ActionFlowAnalyticsCharts analytics={analytics} />

            {analytics.sourceCounts.length > 0 && (
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Sources
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {analytics.sourceCounts.map((source) => (
                    <span
                      key={source.source}
                      className="rounded-full bg-muted px-2 py-0.5 text-xs"
                    >
                      {formatOptionLabel(source.source)}: {source.count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {analytics.stepAnalytics.length === 0 ? (
                <div className="rounded-md border bg-white p-4">
                  <p className="text-sm text-muted-foreground">
                    Add flow steps to see step-level analytics.
                  </p>
                </div>
              ) : (
                analytics.stepAnalytics.map((step) => (
                  <div
                    key={step.stepId}
                    className="rounded-md border bg-white p-4"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="space-y-1">
                        <p className="font-medium">
                          {step.sortOrder}. {step.label}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatOptionLabel(step.stepType)}
                          {step.fieldKey ? ` - ${step.fieldKey}` : ""}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                        <div className="rounded-md border bg-muted/30 p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Collected
                          </p>
                          <p className="font-medium">{step.collectedCount}</p>
                        </div>
                        <div className="rounded-md border bg-muted/30 p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Routes
                          </p>
                          <p className="font-medium">
                            {step.routeDecisionCount}
                          </p>
                        </div>
                        <div className="rounded-md border bg-muted/30 p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Fails
                          </p>
                          <p className="font-medium">
                            {step.validationFailureCount}
                          </p>
                        </div>
                        <div className="rounded-md border bg-muted/30 p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Drop-Off
                          </p>
                          <p className="font-medium">{step.dropOffCount}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-xl">Flow Steps</CardTitle>
              <Button asChild>
                <Link href={`/projects/actions/${action.id}/steps/new`}>
                  <Plus className="h-4 w-4" />
                  Add Step
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {steps.length === 0 ? (
              <div className="rounded-md border bg-white p-4">
                <p className="text-sm text-muted-foreground">
                  No flow steps configured yet.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {steps.map((step, index) => (
                  <div
                    key={step.id}
                    className={`flex flex-col gap-3 rounded-md border px-4 py-3 md:flex-row md:items-center md:justify-between ${
                      step.isEnabled ? "bg-white" : "bg-muted/40"
                    }`}
                  >
                    <div className="space-y-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span>
                          {step.sortOrder}. {getStepLabel(step)}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            step.isEnabled
                              ? "bg-green-50 text-green-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {step.isEnabled ? "Enabled" : "Disabled"}
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatOptionLabel(step.stepType)}
                        {step.inputType
                          ? ` - ${formatOptionLabel(step.inputType)}`
                          : ""}
                        {step.isRequired ? " - Required" : ""}
                      </p>
                      {(step.nextStepId ||
                        branchRulesByStepId.has(step.id)) && (
                        <p className="text-xs text-muted-foreground">
                          Default route:{" "}
                          {getRouteTargetLabel(step.nextStepId, stepById)}
                          {branchRulesByStepId.has(step.id)
                            ? ` - ${branchRulesByStepId.get(
                                step.id,
                              )} branch rule(s)`
                            : ""}
                        </p>
                      )}
                      {branchTargetsByStepId.has(step.id) && (
                        <div className="space-y-1 text-xs text-muted-foreground">
                          {branchTargetsByStepId.get(step.id)?.map((route) => (
                            <p key={route}>Branch: {route}</p>
                          ))}
                        </div>
                      )}
                      {step.prompt && (
                        <p className="text-xs text-muted-foreground">
                          {step.prompt}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <form action={moveActionFlowStepAction}>
                        <input
                          type="hidden"
                          name="actionId"
                          value={action.id}
                        />
                        <input type="hidden" name="stepId" value={step.id} />
                        <input type="hidden" name="direction" value="up" />
                        <FormSubmitButton
                          label="Up"
                          pendingLabel="Moving..."
                          variant="outline"
                          disabled={index === 0}
                          icon={<ArrowUp className="h-4 w-4" />}
                        />
                      </form>
                      <form action={moveActionFlowStepAction}>
                        <input
                          type="hidden"
                          name="actionId"
                          value={action.id}
                        />
                        <input type="hidden" name="stepId" value={step.id} />
                        <input type="hidden" name="direction" value="down" />
                        <FormSubmitButton
                          label="Down"
                          pendingLabel="Moving..."
                          variant="outline"
                          disabled={index === steps.length - 1}
                          icon={<ArrowDown className="h-4 w-4" />}
                        />
                      </form>
                      <form action={duplicateActionFlowStepAction}>
                        <input
                          type="hidden"
                          name="actionId"
                          value={action.id}
                        />
                        <input type="hidden" name="stepId" value={step.id} />
                        <FormSubmitButton
                          label="Duplicate"
                          pendingLabel="Duplicating..."
                          variant="outline"
                          icon={<Copy className="h-4 w-4" />}
                        />
                      </form>
                      <form action={toggleActionFlowStepEnabledAction}>
                        <input
                          type="hidden"
                          name="actionId"
                          value={action.id}
                        />
                        <input type="hidden" name="stepId" value={step.id} />
                        <input
                          type="hidden"
                          name="isEnabled"
                          value={step.isEnabled ? "false" : "true"}
                        />
                        <FormSubmitButton
                          label={step.isEnabled ? "Disable" : "Enable"}
                          pendingLabel="Saving..."
                          variant="outline"
                          icon={
                            step.isEnabled ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )
                          }
                        />
                      </form>
                      <Button asChild variant="outline">
                        <Link
                          href={`/projects/actions/${action.id}/steps/${step.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                          Edit
                        </Link>
                      </Button>
                      <form action={deleteActionFlowStepAction}>
                        <input
                          type="hidden"
                          name="actionId"
                          value={action.id}
                        />
                        <input type="hidden" name="stepId" value={step.id} />
                        <FormSubmitButton
                          label="Delete"
                          pendingLabel="Deleting..."
                          variant="destructive"
                          icon={<Trash2 className="h-4 w-4" />}
                        />
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Preview And Test Mode</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionFlowPreview action={previewAction} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <ClipboardPlus className="h-5 w-5" />
              Test Submission
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Create a saved test submission from this action's current fields.
            </p>
            <form action={createTestActionSubmissionAction}>
              <input type="hidden" name="actionId" value={action.id} />
              <FormSubmitButton
                label="Create Test Submission"
                pendingLabel="Creating..."
                icon={<ClipboardPlus className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
