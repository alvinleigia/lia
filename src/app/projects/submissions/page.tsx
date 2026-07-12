import { ClipboardList } from "lucide-react";
import Link from "next/link";
import { NoProjectState } from "@/components/no-project-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ACTION_SUBMISSION_STATUS_LABELS,
  listActionSubmissionsWithActions,
} from "@/lib/action-flows";
import {
  getActiveProjectIdCookie,
  resolveOptionalUserAndProject,
} from "@/lib/auth-project";
import {
  getConnectFlowReportingCounts,
  getConnectFlowSubmissionSummary,
  hasConnectFlowRelationship,
} from "@/lib/connect-flow-reporting";

type SubmissionsPageProps = {
  searchParams: Promise<{
    assigned?: string;
    connected?: string;
    error?: string;
    handoff?: string;
    queue?: string;
  }>;
};

function getHandoffSummary(metadata: Record<string, unknown>) {
  const handoff = metadata.handoff;

  if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) {
    return null;
  }

  const record = handoff as Record<string, unknown>;
  const priority =
    typeof record.priority === "string" ? record.priority : "normal";
  const queue = typeof record.queue === "string" ? record.queue : null;
  const assignedUserId =
    typeof record.assignedUserId === "number" ? record.assignedUserId : null;
  const assignedUserName =
    typeof record.assignedUserName === "string"
      ? record.assignedUserName
      : null;
  const assignedUserEmail =
    typeof record.assignedUserEmail === "string"
      ? record.assignedUserEmail
      : null;

  return {
    assignedUserEmail,
    assignedUserId,
    assignedUserName,
    priority,
    queue,
  };
}

export default async function SubmissionsPage({
  searchParams,
}: SubmissionsPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Submissions need a project" />;
  }

  const { project, user } = context;
  const submissions = await listActionSubmissionsWithActions(project.id);
  const connectFlowCounts = getConnectFlowReportingCounts(submissions);
  const handoffQueueNames = Array.from(
    new Set(
      submissions
        .map(({ submission }) => getHandoffSummary(submission.metadata)?.queue)
        .filter((queue): queue is string => Boolean(queue)),
    ),
  ).sort((first, second) => first.localeCompare(second));
  const filteredSubmissions = submissions.filter(({ submission, action }) => {
    const handoff = getHandoffSummary(submission.metadata);

    if (params.handoff === "1" && !handoff) {
      return false;
    }

    if (params.queue && handoff?.queue !== params.queue) {
      return false;
    }

    if (params.assigned === "me" && handoff?.assignedUserId !== user.id) {
      return false;
    }

    if (params.assigned === "unassigned" && handoff?.assignedUserId) {
      return false;
    }

    if (
      params.connected === "1" &&
      !hasConnectFlowRelationship({ submission, action }, submissions)
    ) {
      return false;
    }

    return true;
  });
  const statusCounts: Record<string, number> = {};
  for (const { submission } of submissions) {
    statusCounts[submission.status] =
      (statusCounts[submission.status] ?? 0) + 1;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <ClipboardList className="h-6 w-6" />
              Submissions: {project.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              {Object.entries(ACTION_SUBMISSION_STATUS_LABELS).map(
                ([status, label]) => (
                  <div key={status} className="rounded-md border bg-white p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {label}
                    </p>
                    <p className="text-xl font-semibold">
                      {statusCounts[status] ?? 0}
                    </p>
                  </div>
                ),
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Parent Flows
                </p>
                <p className="text-xl font-semibold">
                  {connectFlowCounts.parentSubmissionCount}
                </p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Connected Children
                </p>
                <p className="text-xl font-semibold">
                  {connectFlowCounts.childSubmissionCount}
                </p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Return / Jump
                </p>
                <p className="text-xl font-semibold">
                  {connectFlowCounts.returnModeCount} /{" "}
                  {connectFlowCounts.jumpModeCount}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 rounded-md border bg-white p-3 text-sm">
              <Link
                href="/projects/submissions"
                className="rounded-md border px-3 py-1 hover:bg-accent/40"
              >
                All
              </Link>
              <Link
                href="/projects/submissions?handoff=1"
                className="rounded-md border px-3 py-1 hover:bg-accent/40"
              >
                Handoffs
              </Link>
              <Link
                href="/projects/submissions?handoff=1&assigned=me"
                className="rounded-md border px-3 py-1 hover:bg-accent/40"
              >
                My Handoffs
              </Link>
              <Link
                href="/projects/submissions?handoff=1&assigned=unassigned"
                className="rounded-md border px-3 py-1 hover:bg-accent/40"
              >
                Unassigned
              </Link>
              <Link
                href="/projects/submissions?connected=1"
                className="rounded-md border px-3 py-1 hover:bg-accent/40"
              >
                Connected Flows
              </Link>
              {handoffQueueNames.map((queue) => (
                <Link
                  key={queue}
                  href={`/projects/submissions?handoff=1&queue=${encodeURIComponent(
                    queue,
                  )}`}
                  className="rounded-md border px-3 py-1 hover:bg-accent/40"
                >
                  Queue: {queue}
                </Link>
              ))}
            </div>

            {filteredSubmissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No action submissions match this view.
              </p>
            ) : (
              <div className="space-y-2">
                {filteredSubmissions.map(({ submission, action }) => {
                  const handoff = getHandoffSummary(submission.metadata);
                  const connectFlow =
                    getConnectFlowSubmissionSummary(submission);
                  const hasConnectedChildren = submissions.some(
                    (candidate) =>
                      getConnectFlowSubmissionSummary(candidate.submission)
                        .parentSubmissionId === submission.id,
                  );

                  return (
                    <Link
                      key={submission.id}
                      href={`/projects/submissions/${submission.id}`}
                      className="flex items-start justify-between gap-4 rounded-md border bg-white px-4 py-3 hover:bg-accent/40"
                    >
                      <div className="space-y-1">
                        <p className="font-medium">
                          #{submission.id} {action.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Source: {submission.source}
                        </p>
                        {(connectFlow.parentSubmissionId !== null ||
                          hasConnectedChildren) && (
                          <div className="flex flex-wrap gap-2 text-xs">
                            {connectFlow.parentSubmissionId !== null && (
                              <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700">
                                Child of #{connectFlow.parentSubmissionId}
                                {connectFlow.mode
                                  ? ` / ${connectFlow.mode}`
                                  : ""}
                              </span>
                            )}
                            {hasConnectedChildren && (
                              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
                                Parent flow
                              </span>
                            )}
                          </div>
                        )}
                        {handoff && (
                          <div className="space-y-0.5 text-xs font-medium text-amber-700">
                            <p>
                              Handoff: {handoff.priority}
                              {handoff.queue ? ` / ${handoff.queue}` : ""}
                            </p>
                            <p>
                              Assigned:{" "}
                              {handoff.assignedUserName ??
                                handoff.assignedUserEmail ??
                                "Unassigned"}
                            </p>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Created: {submission.createdAt.toLocaleString()}
                        </p>
                      </div>
                      <span className="rounded-md border px-2 py-1 text-xs capitalize">
                        {ACTION_SUBMISSION_STATUS_LABELS[
                          submission.status as keyof typeof ACTION_SUBMISSION_STATUS_LABELS
                        ] ?? submission.status.replaceAll("_", " ")}
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
