import {
  CheckCircle2,
  ClipboardList,
  Inbox,
  RotateCcw,
  UserCheck,
  UserX,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { NoProjectState } from "@/components/no-project-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ACTION_SUBMISSION_STATUS_LABELS,
  listActionSubmissionsWithActions,
} from "@/lib/action-flows";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import { cn } from "@/lib/utils";
import { updateHandoffQueueAction } from "../submissions/actions";

type HandoffsPageProps = {
  searchParams: Promise<{
    assigned?: string;
    error?: string;
    queue?: string;
    status?: string;
    updated?: string;
  }>;
};

type HandoffSummary = {
  assignedAt: string | null;
  assignedUserEmail: string | null;
  assignedUserId: number | null;
  assignedUserName: string | null;
  priority: string;
  queue: string | null;
  requestedAt: string | null;
  stepLabel: string | null;
};

const closedStatuses = new Set(["cancelled", "completed", "rejected"]);

function getHandoffSummary(
  metadata: Record<string, unknown>,
): HandoffSummary | null {
  const handoff = metadata.handoff;

  if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) {
    return null;
  }

  const record = handoff as Record<string, unknown>;

  return {
    assignedAt:
      typeof record.assignedAt === "string" ? record.assignedAt : null,
    assignedUserEmail:
      typeof record.assignedUserEmail === "string"
        ? record.assignedUserEmail
        : null,
    assignedUserId:
      typeof record.assignedUserId === "number" ? record.assignedUserId : null,
    assignedUserName:
      typeof record.assignedUserName === "string"
        ? record.assignedUserName
        : null,
    priority: typeof record.priority === "string" ? record.priority : "normal",
    queue: typeof record.queue === "string" ? record.queue : null,
    requestedAt:
      typeof record.requestedAt === "string" ? record.requestedAt : null,
    stepLabel: typeof record.stepLabel === "string" ? record.stepLabel : null,
  };
}

function formatDate(value: Date | string | null) {
  if (!value) {
    return "Not recorded";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return date.toLocaleString();
}

function formatStatus(status: string) {
  return (
    ACTION_SUBMISSION_STATUS_LABELS[
      status as keyof typeof ACTION_SUBMISSION_STATUS_LABELS
    ] ?? status.replaceAll("_", " ")
  );
}

function formatSource(source: string) {
  return source.replaceAll("_", " ");
}

function getFilterClass(isActive: boolean) {
  return cn(
    "inline-flex items-center rounded-md border px-3 py-1 text-sm hover:bg-accent/40",
    isActive && "bg-foreground text-background hover:bg-foreground/90",
  );
}

function getPriorityClass(priority: string) {
  switch (priority) {
    case "urgent":
      return "border-red-200 bg-red-50 text-red-700";
    case "high":
      return "border-orange-200 bg-orange-50 text-orange-700";
    case "low":
      return "border-slate-200 bg-slate-50 text-slate-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

export default async function HandoffsPage({
  searchParams,
}: HandoffsPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Handoffs need a project" />;
  }

  const { project, user } = context;
  const submissions = await listActionSubmissionsWithActions(project.id);
  const handoffs = submissions.flatMap(({ action, submission }) => {
    const handoff = getHandoffSummary(submission.metadata);

    return handoff ? [{ action, handoff, submission }] : [];
  });
  const queueNames = Array.from(
    new Set(
      handoffs
        .map(({ handoff }) => handoff.queue)
        .filter((queue): queue is string => Boolean(queue)),
    ),
  ).sort((first, second) => first.localeCompare(second));
  const statusFilter = params.status ?? "open";
  const filteredHandoffs = handoffs.filter(({ handoff, submission }) => {
    const isClosed = closedStatuses.has(submission.status);

    if (statusFilter === "closed" && !isClosed) {
      return false;
    }

    if (statusFilter !== "all" && statusFilter !== "closed" && isClosed) {
      return false;
    }

    if (params.assigned === "me" && handoff.assignedUserId !== user.id) {
      return false;
    }

    if (params.assigned === "unassigned" && handoff.assignedUserId) {
      return false;
    }

    if (params.queue && handoff.queue !== params.queue) {
      return false;
    }

    return true;
  });
  const openCount = handoffs.filter(
    ({ submission }) => !closedStatuses.has(submission.status),
  ).length;
  const closedCount = handoffs.length - openCount;
  const myCount = handoffs.filter(
    ({ handoff, submission }) =>
      handoff.assignedUserId === user.id &&
      !closedStatuses.has(submission.status),
  ).length;
  const unassignedCount = handoffs.filter(
    ({ handoff, submission }) =>
      !handoff.assignedUserId && !closedStatuses.has(submission.status),
  ).length;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Inbox className="h-6 w-6" />
              Handoff Queue: {project.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {params.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {params.error}
              </p>
            )}
            {params.updated && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                Updated {params.updated} handoff
                {params.updated === "1" ? "" : "s"}.
              </p>
            )}

            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Open
                </p>
                <p className="text-xl font-semibold">{openCount}</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  My Handoffs
                </p>
                <p className="text-xl font-semibold">{myCount}</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Unassigned
                </p>
                <p className="text-xl font-semibold">{unassignedCount}</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Closed
                </p>
                <p className="text-xl font-semibold">{closedCount}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 rounded-md border bg-white p-3">
              <Link
                href="/projects/handoffs"
                className={getFilterClass(
                  statusFilter === "open" && !params.assigned && !params.queue,
                )}
              >
                Open
              </Link>
              <Link
                href="/projects/handoffs?assigned=me"
                className={getFilterClass(params.assigned === "me")}
              >
                My Handoffs
              </Link>
              <Link
                href="/projects/handoffs?assigned=unassigned"
                className={getFilterClass(params.assigned === "unassigned")}
              >
                Unassigned
              </Link>
              <Link
                href="/projects/handoffs?status=closed"
                className={getFilterClass(statusFilter === "closed")}
              >
                Closed
              </Link>
              <Link
                href="/projects/handoffs?status=all"
                className={getFilterClass(statusFilter === "all")}
              >
                All
              </Link>
              {queueNames.map((queue) => (
                <Link
                  key={queue}
                  href={`/projects/handoffs?queue=${encodeURIComponent(queue)}`}
                  className={getFilterClass(params.queue === queue)}
                >
                  Queue: {queue}
                </Link>
              ))}
            </div>

            {filteredHandoffs.length === 0 ? (
              <div className="rounded-md border bg-white p-6 text-sm text-muted-foreground">
                No handoffs match this queue view.
              </div>
            ) : (
              <form action={updateHandoffQueueAction} className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 rounded-md border bg-white p-3">
                  <span className="mr-2 text-sm font-medium">
                    Selected rows
                  </span>
                  <Button
                    type="submit"
                    name="queueAction"
                    value="claim_selected"
                    variant="outline"
                  >
                    <UserCheck className="h-4 w-4" />
                    Claim
                  </Button>
                  <Button
                    type="submit"
                    name="queueAction"
                    value="release_selected"
                    variant="outline"
                  >
                    <UserX className="h-4 w-4" />
                    Release
                  </Button>
                  <Button
                    type="submit"
                    name="queueAction"
                    value="mark_under_review"
                    variant="outline"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Under Review
                  </Button>
                  <Button
                    type="submit"
                    name="queueAction"
                    value="mark_completed"
                    variant="outline"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Complete
                  </Button>
                  <Button
                    type="submit"
                    name="queueAction"
                    value="mark_rejected"
                    variant="outline"
                  >
                    <XCircle className="h-4 w-4" />
                    Reject
                  </Button>
                </div>

                <div className="space-y-3">
                  {filteredHandoffs.map(({ action, handoff, submission }) => (
                    <div
                      key={submission.id}
                      className="rounded-md border bg-white p-4"
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="flex gap-3">
                          <input
                            type="checkbox"
                            name="submissionIds"
                            value={submission.id}
                            aria-label={`Select handoff ${submission.id}`}
                            className="mt-1 h-4 w-4 rounded border-input"
                          />
                          <div className="space-y-2">
                            <div>
                              <Link
                                href={`/projects/submissions/${submission.id}`}
                                className="font-semibold underline-offset-4 hover:underline"
                              >
                                #{submission.id} {action.name}
                              </Link>
                              {handoff.stepLabel && (
                                <p className="text-sm text-muted-foreground">
                                  Step: {handoff.stepLabel}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs">
                              <span
                                className={cn(
                                  "rounded-md border px-2 py-1 font-medium capitalize",
                                  getPriorityClass(handoff.priority),
                                )}
                              >
                                {handoff.priority}
                              </span>
                              <span className="rounded-md border px-2 py-1 capitalize">
                                {formatStatus(submission.status)}
                              </span>
                              <span className="rounded-md border px-2 py-1 capitalize">
                                {formatSource(submission.source)}
                              </span>
                              <span className="rounded-md border px-2 py-1">
                                Queue: {handoff.queue ?? "Default"}
                              </span>
                            </div>
                            <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                              <p>
                                Assigned:{" "}
                                <span className="text-foreground">
                                  {handoff.assignedUserName ??
                                    handoff.assignedUserEmail ??
                                    "Unassigned"}
                                </span>
                              </p>
                              <p>
                                Requested:{" "}
                                <span className="text-foreground">
                                  {formatDate(handoff.requestedAt)}
                                </span>
                              </p>
                              <p>
                                Assigned At:{" "}
                                <span className="text-foreground">
                                  {formatDate(handoff.assignedAt)}
                                </span>
                              </p>
                              <p>
                                Created:{" "}
                                <span className="text-foreground">
                                  {formatDate(submission.createdAt)}
                                </span>
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 md:justify-end">
                          <Button
                            type="submit"
                            name="queueAction"
                            value={`single:claim:${submission.id}`}
                            variant="outline"
                          >
                            <UserCheck className="h-4 w-4" />
                            Claim
                          </Button>
                          {handoff.assignedUserId && (
                            <Button
                              type="submit"
                              name="queueAction"
                              value={`single:release:${submission.id}`}
                              variant="outline"
                            >
                              <UserX className="h-4 w-4" />
                              Release
                            </Button>
                          )}
                          <Button
                            type="submit"
                            name="queueAction"
                            value={`single:mark_completed:${submission.id}`}
                            variant="outline"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Complete
                          </Button>
                          <Button
                            type="submit"
                            name="queueAction"
                            value={`single:mark_rejected:${submission.id}`}
                            variant="outline"
                          >
                            <XCircle className="h-4 w-4" />
                            Reject
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </form>
            )}

            <Link
              href="/projects/submissions"
              className="inline-flex items-center text-sm underline underline-offset-4"
            >
              <ClipboardList className="h-4 w-4 mr-2" />
              View all submissions
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
