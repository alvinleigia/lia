import {
  ArrowLeft,
  ClipboardList,
  GitBranch,
  Save,
  UserCheck,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  FlowMediaPayloadCards,
  FlowMediaValueCard,
} from "@/components/flow-media-value-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Label } from "@/components/ui/label";
import {
  ACTION_SUBMISSION_STATUS_LABELS,
  getActionSubmission,
  getProjectAction,
  listActionSubmissionEvents,
  listActionSubmissionsWithActions,
} from "@/lib/action-flows";
import {
  buildConnectFlowRelationship,
  getConnectFlowSubmissionSummary,
} from "@/lib/connect-flow-reporting";
import {
  type FlowMediaUploadValue,
  isFlowMediaUploadValue,
} from "@/lib/flow-media-values";
import { listOperationAttemptsWithDetailsForSubmission } from "@/lib/operations";
import {
  getActiveProjectIdCookie,
  resolvePageUserAndProject,
} from "@/lib/protected-page";
import {
  importSubmissionMediaAction,
  updateActionSubmissionStatusAction,
  updateHandoffAssignmentAction,
} from "../actions";

type SubmissionDetailPageProps = {
  params: Promise<{
    submissionId: string;
  }>;
  searchParams: Promise<{
    assignmentError?: string;
    assignmentUpdated?: string;
    created?: string;
    mediaImported?: string;
    mediaImportError?: string;
    updated?: string;
  }>;
};

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatStatus(status: string) {
  return (
    ACTION_SUBMISSION_STATUS_LABELS[
      status as keyof typeof ACTION_SUBMISSION_STATUS_LABELS
    ] ?? status.replaceAll("_", " ")
  );
}

function canImportMedia(value: FlowMediaUploadValue) {
  return value.provider === "whatsapp" && Boolean(value.providerMediaId);
}

function getHandoffDetails(metadata: Record<string, unknown>) {
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
    notifyTeam:
      typeof record.notifyTeam === "boolean" ? record.notifyTeam : true,
    priority: typeof record.priority === "string" ? record.priority : "normal",
    queue: typeof record.queue === "string" ? record.queue : null,
    requestedAt:
      typeof record.requestedAt === "string" ? record.requestedAt : null,
    stepLabel: typeof record.stepLabel === "string" ? record.stepLabel : null,
  };
}

function FieldValue({
  fieldKey,
  submissionId,
  value,
}: {
  fieldKey: string;
  submissionId: number;
  value: unknown;
}) {
  if (isFlowMediaUploadValue(value)) {
    const media = value as FlowMediaUploadValue;

    return (
      <FlowMediaValueCard media={media}>
        {canImportMedia(media) ? (
          <form action={importSubmissionMediaAction}>
            <input name="submissionId" type="hidden" value={submissionId} />
            <input name="fieldKey" type="hidden" value={fieldKey} />
            <FormSubmitButton
              label="Import To Media Library"
              pendingLabel="Importing..."
            />
          </form>
        ) : null}
      </FlowMediaValueCard>
    );
  }

  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">Not recorded</span>;
  }

  if (typeof value === "object") {
    return (
      <pre className="overflow-auto rounded-md bg-gray-50 p-3 text-xs">
        {formatJson(value)}
      </pre>
    );
  }

  return <span className="break-words">{String(value)}</span>;
}

function FieldsView({
  fields,
  submissionId,
}: {
  fields: Record<string, unknown>;
  submissionId: number;
}) {
  const entries = Object.entries(fields);

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No fields collected.</p>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-md border bg-white p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            {key}
          </p>
          <FieldValue
            fieldKey={key}
            submissionId={submissionId}
            value={value}
          />
        </div>
      ))}
    </div>
  );
}

function PayloadView({ payload }: { payload: unknown }) {
  return (
    <div className="mt-3 space-y-3">
      <FlowMediaPayloadCards payload={payload} />
      <pre className="overflow-auto rounded-md bg-gray-50 p-3 text-xs">
        {formatJson(payload)}
      </pre>
    </div>
  );
}

export default async function SubmissionDetailPage({
  params,
  searchParams,
}: SubmissionDetailPageProps) {
  const routeParams = await params;
  const query = await searchParams;
  const submissionId = Number(routeParams.submissionId);

  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    notFound();
  }

  const activeProjectId = await getActiveProjectIdCookie();
  const { project } = await resolvePageUserAndProject(activeProjectId);
  const submission = await getActionSubmission(project.id, submissionId);

  if (!submission) {
    notFound();
  }

  const [action, events, operationAttempts, projectSubmissions] =
    await Promise.all([
      getProjectAction(project.id, submission.actionId),
      listActionSubmissionEvents(project.id, submission.id),
      listOperationAttemptsWithDetailsForSubmission(project.id, submission.id),
      listActionSubmissionsWithActions(project.id),
    ]);

  if (!action) {
    notFound();
  }

  const handoff = getHandoffDetails(submission.metadata);
  const connectFlowRelationship = buildConnectFlowRelationship(
    projectSubmissions,
    submission.id,
  );

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <Link
          href="/projects/submissions"
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to submissions
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <ClipboardList className="h-6 w-6" />
              Submission #{submission.id}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(query.created ||
              query.updated ||
              query.mediaImported ||
              query.assignmentUpdated) && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Submission saved.
              </p>
            )}

            {(query.mediaImportError || query.assignmentError) && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {query.mediaImportError ?? query.assignmentError}
              </p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Action
                </p>
                <p className="font-medium">{action.name}</p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Source
                </p>
                <p className="font-medium">{submission.source}</p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Status
                </p>
                <p className="font-medium">{formatStatus(submission.status)}</p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Created
                </p>
                <p className="font-medium">
                  {submission.createdAt.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="rounded-md border bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Submitted
              </p>
              <p className="font-medium">
                {submission.submittedAt
                  ? submission.submittedAt.toLocaleString()
                  : "Not submitted"}
              </p>
            </div>

            {handoff && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs uppercase tracking-wide text-amber-700">
                  Handoff
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Priority
                    </p>
                    <p className="font-medium capitalize">{handoff.priority}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Queue
                    </p>
                    <p className="font-medium">{handoff.queue ?? "Default"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Requested
                    </p>
                    <p className="font-medium">
                      {handoff.requestedAt
                        ? new Date(handoff.requestedAt).toLocaleString()
                        : "Not recorded"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Notification
                    </p>
                    <p className="font-medium">
                      {handoff.notifyTeam ? "Requested" : "Not requested"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Assigned To
                    </p>
                    <p className="font-medium">
                      {handoff.assignedUserName ??
                        handoff.assignedUserEmail ??
                        "Unassigned"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Assigned
                    </p>
                    <p className="font-medium">
                      {handoff.assignedAt
                        ? new Date(handoff.assignedAt).toLocaleString()
                        : "Not assigned"}
                    </p>
                  </div>
                </div>
                {handoff.stepLabel && (
                  <p className="mt-3 text-sm text-amber-900">
                    Step: {handoff.stepLabel}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-3">
                  <form action={updateHandoffAssignmentAction}>
                    <input
                      type="hidden"
                      name="submissionId"
                      value={submission.id}
                    />
                    <input
                      type="hidden"
                      name="assignmentAction"
                      value="claim"
                    />
                    <FormSubmitButton
                      label="Claim Handoff"
                      pendingLabel="Claiming..."
                      icon={<UserCheck className="h-4 w-4" />}
                    />
                  </form>
                  {handoff.assignedUserId && (
                    <form action={updateHandoffAssignmentAction}>
                      <input
                        type="hidden"
                        name="submissionId"
                        value={submission.id}
                      />
                      <input
                        type="hidden"
                        name="assignmentAction"
                        value="release"
                      />
                      <FormSubmitButton
                        label="Release"
                        pendingLabel="Releasing..."
                        icon={<UserX className="h-4 w-4" />}
                      />
                    </form>
                  )}
                </div>
              </div>
            )}

            <form
              action={updateActionSubmissionStatusAction}
              className="flex flex-wrap items-end gap-3 rounded-md border bg-white p-4"
            >
              <input type="hidden" name="submissionId" value={submission.id} />
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <select
                  id="status"
                  name="status"
                  defaultValue={submission.status}
                  className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {Object.entries(ACTION_SUBMISSION_STATUS_LABELS).map(
                    ([status, label]) => (
                      <option key={status} value={status}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <FormSubmitButton
                label="Update Status"
                pendingLabel="Updating..."
                icon={<Save className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>

        {(connectFlowRelationship.parent ||
          connectFlowRelationship.children.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <GitBranch className="h-5 w-5" />
                Connected Flow
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {connectFlowRelationship.parent && (
                <div className="rounded-md border bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Parent Submission
                  </p>
                  <Link
                    href={`/projects/submissions/${connectFlowRelationship.parent.submission.id}`}
                    className="mt-1 inline-flex font-medium underline underline-offset-4"
                  >
                    #{connectFlowRelationship.parent.submission.id}{" "}
                    {connectFlowRelationship.parent.action.name}
                  </Link>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Mode: {connectFlowRelationship.summary.mode ?? "unknown"} /
                    Depth: {connectFlowRelationship.summary.depth}
                  </p>
                </div>
              )}

              {connectFlowRelationship.children.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Connected Child Submissions
                  </p>
                  {connectFlowRelationship.children.map((child) => {
                    const childSummary = getConnectFlowSubmissionSummary(
                      child.submission,
                    );

                    return (
                      <Link
                        key={child.submission.id}
                        href={`/projects/submissions/${child.submission.id}`}
                        className="flex items-start justify-between gap-4 rounded-md border bg-white px-4 py-3 hover:bg-accent/40"
                      >
                        <div>
                          <p className="font-medium">
                            #{child.submission.id} {child.action.name}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Mode: {childSummary.mode ?? "unknown"} / Depth:{" "}
                            {childSummary.depth}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Created:{" "}
                            {child.submission.createdAt.toLocaleString()}
                          </p>
                        </div>
                        <span className="rounded-md border px-2 py-1 text-xs capitalize">
                          {formatStatus(child.submission.status)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Fields</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FieldsView
              fields={submission.fields}
              submissionId={submission.id}
            />
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Raw Fields
              </p>
              <pre className="overflow-auto rounded-md border bg-white p-4 text-sm">
                {formatJson(submission.fields)}
              </pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Operation Attempts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {operationAttempts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No operation attempts yet.
              </p>
            ) : (
              operationAttempts.map(({ attempt, operation, provider }) => (
                <div
                  key={attempt.id}
                  className="rounded-md border bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{operation.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {operation.operationType} via {provider.name} (
                        {provider.providerType})
                      </p>
                    </div>
                    <span className="rounded-md border px-2 py-1 text-xs capitalize">
                      {attempt.status}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Started
                      </p>
                      <p className="text-sm">
                        {attempt.startedAt
                          ? attempt.startedAt.toLocaleString()
                          : "Not started"}
                      </p>
                    </div>
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Finished
                      </p>
                      <p className="text-sm">
                        {attempt.finishedAt
                          ? attempt.finishedAt.toLocaleString()
                          : "Not finished"}
                      </p>
                    </div>
                  </div>
                  {attempt.errorMessage && (
                    <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                      {attempt.errorMessage}
                    </p>
                  )}
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                        Request Payload
                      </p>
                      <pre className="overflow-auto rounded-md bg-gray-50 p-3 text-xs">
                        {formatJson(attempt.requestPayload)}
                      </pre>
                    </div>
                    <div>
                      <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                        Response Payload
                      </p>
                      <pre className="overflow-auto rounded-md bg-gray-50 p-3 text-xs">
                        {formatJson(attempt.responsePayload)}
                      </pre>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            ) : (
              events.map((event) => (
                <div key={event.id} className="rounded-md border bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{event.eventType}</p>
                    <p className="text-xs text-muted-foreground">
                      {event.createdAt.toLocaleString()}
                    </p>
                  </div>
                  {event.message && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {event.message}
                    </p>
                  )}
                  <PayloadView payload={event.payload} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
