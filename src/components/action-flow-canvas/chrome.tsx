import {
  AlertTriangle,
  CheckCircle2,
  FileDown,
  ListTodo,
  Loader2,
  Save,
  Wand2,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ActionFlowRouteValidationIssue } from "@/lib/action-flows";
import {
  type FlowComponentDefinition,
  type FlowComponentGroup,
  listEnabledStepFlowComponents,
  listPlannedFlowComponents,
} from "@/lib/flow-components";
import {
  countBlockingDiagnostics,
  countWarningDiagnostics,
  isWarningDiagnostic,
} from "./model";

function getComponentGroupLabel(group: FlowComponentGroup) {
  return group === "message" ? "Message types" : "Actions";
}

function groupFlowComponents(components: readonly FlowComponentDefinition[]) {
  return {
    action: components.filter((component) => component.group === "action"),
    message: components.filter((component) => component.group === "message"),
  };
}

export function FlowComponentPalette({
  onSelectStepType,
  selectedStepType,
}: {
  onSelectStepType: (stepType: string) => void;
  selectedStepType: string;
}) {
  const enabledGroups = groupFlowComponents(listEnabledStepFlowComponents());
  const plannedGroups = groupFlowComponents(listPlannedFlowComponents());
  const groups: FlowComponentGroup[] = ["message", "action"];

  return (
    <aside className="h-full overflow-hidden rounded-md border bg-white">
      <div className="border-b px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Wand2 className="h-4 w-4" />
          Blocks
        </p>
      </div>
      <div className="h-[716px] space-y-5 overflow-y-auto p-3">
        <div className="space-y-2">
          <p className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
            Conversational tasks
          </p>
          <div className="rounded-md border border-green-200 bg-green-50/40 p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ListTodo className="h-4 w-4 text-green-700" />
              Business Task
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Blend natural conversation with validated fields, tools, and
              outcomes.
            </p>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="mt-3 w-full bg-white"
            >
              <Link href="/projects/tasks">Configure Tasks</Link>
            </Button>
          </div>
        </div>

        {groups.map((group) => (
          <div key={group} className="space-y-2">
            <p className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
              {getComponentGroupLabel(group)}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {enabledGroups[group].map((component) => (
                <button
                  key={component.key}
                  type="button"
                  onClick={() =>
                    component.stepType && onSelectStepType(component.stepType)
                  }
                  className={`min-h-24 w-full rounded-md border px-2 py-2 text-center transition-colors hover:bg-gray-50 ${
                    selectedStepType === component.stepType
                      ? "border-gray-900 bg-gray-50"
                      : "border-gray-200"
                  }`}
                >
                  <span className="flex h-full flex-col items-center justify-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: component.color }}
                    />
                    <span className="min-w-0 space-y-1">
                      <span className="block text-sm font-medium leading-tight">
                        {component.label}
                      </span>
                      <span className="line-clamp-2 text-xs leading-tight text-muted-foreground">
                        {component.description}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="border-t pt-4">
          <p className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
            Planned
          </p>
          <div className="mt-2 space-y-4">
            {groups.map((group) => (
              <div key={group} className="space-y-2">
                <p className="px-1 text-xs font-medium text-muted-foreground">
                  {getComponentGroupLabel(group)}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {plannedGroups[group].map((component) => (
                    <div
                      key={component.key}
                      title={component.disabledReason ?? component.description}
                      className="min-h-24 rounded-md border border-dashed px-2 py-2 text-center opacity-75"
                    >
                      <span className="flex h-full flex-col items-center justify-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: component.color }}
                        />
                        <span className="min-w-0 space-y-1">
                          <span className="block text-sm font-medium leading-tight">
                            {component.label}
                          </span>
                          <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-600">
                            Planned
                          </span>
                          <span className="line-clamp-2 text-xs leading-tight text-muted-foreground">
                            {component.disabledReason ?? component.description}
                          </span>
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

export function CanvasToolbar({
  actionId,
  branchRuleCount,
  defaultRouteCount,
  hasUnsavedLayout,
  isPending,
  onSaveLayout,
  routeIssueCount,
  routeWarningCount,
  stepCount,
}: {
  actionId: number;
  branchRuleCount: number;
  defaultRouteCount: number;
  hasUnsavedLayout: boolean;
  isPending: boolean;
  onSaveLayout: () => void;
  routeIssueCount: number;
  routeWarningCount: number;
  stepCount: number;
}) {
  return (
    <div className="rounded-md border bg-white px-4 py-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid gap-2 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Nodes
            </p>
            <p className="font-medium">{stepCount}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Branches
            </p>
            <p className="font-medium">{branchRuleCount}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Default Routes
            </p>
            <p className="font-medium">{defaultRouteCount}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Blockers
            </p>
            <p
              className={
                routeIssueCount > 0
                  ? "font-medium text-amber-700"
                  : "font-medium"
              }
            >
              {routeIssueCount}
            </p>
            {routeWarningCount > 0 && (
              <p className="text-xs text-amber-700">
                {routeWarningCount} warning(s)
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!hasUnsavedLayout || isPending}
            onClick={onSaveLayout}
          >
            {isPending && hasUnsavedLayout ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Layout
          </Button>
          <Button asChild variant="outline">
            <Link href={`/projects/actions/${actionId}`}>
              <Workflow className="h-4 w-4" />
              Overview
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/projects/actions/${actionId}/export`}>
              <FileDown className="h-4 w-4" />
              Export
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RouteValidationPanel({
  routeIssues,
}: {
  routeIssues: ActionFlowRouteValidationIssue[];
}) {
  const errorCount = countBlockingDiagnostics(routeIssues);
  const warningCount = countWarningDiagnostics(routeIssues);

  function getIssueLabel(issue: ActionFlowRouteValidationIssue) {
    if (issue.source === "graph_cycle") {
      return "Loop";
    }
    if (issue.source === "graph_reachability") {
      return "Unreachable step";
    }
    if (issue.source === "graph_terminal") {
      return "Finish path";
    }
    if (
      issue.source === "branch_condition" ||
      issue.source === "branch_rule" ||
      issue.source === "default_next_step"
    ) {
      return "Route";
    }
    if (issue.source === "channel_capability") {
      return "Channel";
    }
    return "Step setup";
  }

  return (
    <div className="rounded-md border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4" />
            Flow checks
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Publishing uses these same route and finish-path checks.
          </p>
        </div>
        {routeIssues.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-800">
              {errorCount} error{errorCount === 1 ? "" : "s"}
            </span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">
              {warningCount} warning{warningCount === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>
      {routeIssues.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" />
          Flow compiled. Every reachable path can finish.
        </p>
      ) : (
        <div className="space-y-2">
          {routeIssues.map((issue, index) => (
            <div
              key={`${issue.code ?? issue.source}-${issue.stepId ?? issue.ruleId ?? index}`}
              className={`rounded-md border px-3 py-2 text-sm ${
                isWarningDiagnostic(issue)
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              <p className="flex gap-2">
                <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                  {getIssueLabel(issue)}
                </span>
                <span>{issue.message}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
