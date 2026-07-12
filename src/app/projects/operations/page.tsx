import { PlugZap, Plus, Workflow } from "lucide-react";
import Link from "next/link";
import { NoProjectState } from "@/components/no-project-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { assertPermission } from "@/lib/access-control";
import {
  getActiveProjectIdCookie,
  resolveOptionalUserAndProject,
} from "@/lib/auth-project";
import {
  getOperationAttemptMappedOutput,
  getProjectOperationAttemptWithDetails,
  INTEGRATION_PROVIDER_TYPES,
  listProjectIntegrationProviders,
  listProjectOperationAttemptsWithDetails,
  listProjectOperations,
  OPERATION_ATTEMPT_STATUSES,
} from "@/lib/operations";
import {
  createApiRequestOperationAction,
  createIntegrationProviderAction,
  createMetaConversionOperationAction,
  createOperationAction,
  previewOperationAction,
  processOperationRetryQueueAction,
  replayOperationAttemptAction,
  updateIntegrationProviderStatusAction,
  updateOperationStatusAction,
} from "./actions";

type OperationsPageProps = {
  searchParams: Promise<{
    error?: string;
    operationCreated?: string;
    operationReplayed?: string;
    operationUpdated?: string;
    attemptOperationId?: string;
    attemptReplay?: string;
    attemptStatus?: string;
    previewAttemptId?: string;
    providerCreated?: string;
    providerUpdated?: string;
    retryCompleted?: string;
    retryFailed?: string;
    retryProcessed?: string;
    retryQueueProcessed?: string;
    retrySkipped?: string;
  }>;
};

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background";
const ATTEMPT_REPLAY_FILTERS = ["all", "originals", "replays"] as const;

function parsePositiveInteger(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseAttemptStatus(value: string | undefined) {
  return OPERATION_ATTEMPT_STATUSES.includes(
    value as (typeof OPERATION_ATTEMPT_STATUSES)[number],
  )
    ? (value as (typeof OPERATION_ATTEMPT_STATUSES)[number])
    : undefined;
}

function parseReplayFilter(value: string | undefined) {
  return ATTEMPT_REPLAY_FILTERS.includes(
    value as (typeof ATTEMPT_REPLAY_FILTERS)[number],
  )
    ? (value as (typeof ATTEMPT_REPLAY_FILTERS)[number])
    : "all";
}

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "active";

  return (
    <span
      className={`rounded-md border px-2 py-1 text-xs capitalize ${
        isActive
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      {status}
    </span>
  );
}

function getAttemptDeliverySummary(responsePayload: Record<string, unknown>) {
  const finalAttempt =
    typeof responsePayload.finalAttempt === "number"
      ? responsePayload.finalAttempt
      : null;
  const retryCount =
    typeof responsePayload.retryCount === "number"
      ? responsePayload.retryCount
      : null;

  if (finalAttempt === null) {
    return null;
  }

  return `Delivery attempt ${finalAttempt}${
    retryCount !== null ? ` of ${retryCount + 1}` : ""
  }`;
}

function getAttemptReplaySource(requestPayload: Record<string, unknown>) {
  const replay = requestPayload.replay;
  if (!replay || typeof replay !== "object" || Array.isArray(replay)) {
    return null;
  }

  const sourceAttemptId = (replay as Record<string, unknown>).sourceAttemptId;

  return typeof sourceAttemptId === "number" ? sourceAttemptId : null;
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default async function OperationsPage({
  searchParams,
}: OperationsPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Operations need a project" />;
  }

  assertPermission(context.membership, "company.operations.manage");

  const { project } = context;
  const previewAttemptId = params.previewAttemptId
    ? Number.parseInt(params.previewAttemptId, 10)
    : null;
  const attemptOperationId = parsePositiveInteger(params.attemptOperationId);
  const attemptStatus = parseAttemptStatus(params.attemptStatus);
  const attemptReplayFilter = parseReplayFilter(params.attemptReplay);
  const [providers, operationRows, attemptRows] = await Promise.all([
    listProjectIntegrationProviders(project.id),
    listProjectOperations(project.id),
    listProjectOperationAttemptsWithDetails({
      projectId: project.id,
      limit: attemptReplayFilter === "all" ? 25 : 100,
      operationId: attemptOperationId,
      status: attemptStatus,
    }),
  ]);
  const recentAttempts = attemptRows
    .filter(({ attempt }) => {
      const replaySource = getAttemptReplaySource(attempt.requestPayload);

      if (attemptReplayFilter === "replays") {
        return replaySource !== null;
      }

      if (attemptReplayFilter === "originals") {
        return replaySource === null;
      }

      return true;
    })
    .slice(0, 25);
  const previewAttempt =
    previewAttemptId && Number.isInteger(previewAttemptId)
      ? await getProjectOperationAttemptWithDetails(
          project.id,
          previewAttemptId,
        )
      : null;
  const previewMappedOutput = previewAttempt
    ? getOperationAttemptMappedOutput({
        attempt: previewAttempt.attempt,
        operation: previewAttempt.operation,
      })
    : null;
  const activeProviders = providers.filter(
    (provider) => provider.status === "active",
  );

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <PlugZap className="h-6 w-6" />
              Operations: {project.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}
            {params.providerCreated && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Provider created.
              </p>
            )}
            {params.providerUpdated && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Provider updated.
              </p>
            )}
            {params.operationCreated && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Operation created.
              </p>
            )}
            {params.operationUpdated && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Operation updated.
              </p>
            )}
            {params.operationReplayed && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Operation attempt replayed.
              </p>
            )}
            {params.retryQueueProcessed && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Retry queue processed {params.retryProcessed ?? "0"} attempt(s)
                ({params.retryCompleted ?? "0"} completed,{" "}
                {params.retryFailed ?? "0"} failed, {params.retrySkipped ?? "0"}{" "}
                skipped).
              </p>
            )}

            {operationRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No operations configured yet.
              </p>
            ) : (
              <div className="space-y-2">
                {operationRows.map(({ operation, provider }) => (
                  <div
                    key={operation.id}
                    className="rounded-md border bg-white px-4 py-3"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{operation.name}</p>
                          <StatusBadge status={operation.status} />
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {operation.operationType} via {provider.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Provider: {provider.providerType} ({provider.status})
                        </p>
                      </div>
                      <form
                        action={updateOperationStatusAction}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="hidden"
                          name="operationId"
                          value={operation.id}
                        />
                        <input
                          type="hidden"
                          name="status"
                          value={
                            operation.status === "active"
                              ? "disabled"
                              : "active"
                          }
                        />
                        <Button type="submit" variant="outline" size="sm">
                          {operation.status === "active" ? "Disable" : "Enable"}
                        </Button>
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
            <CardTitle className="text-xl flex items-center gap-2">
              <Workflow className="h-5 w-5" />
              Operation Sandbox
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form action={previewOperationAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="previewOperationId">Operation</Label>
                <select
                  id="previewOperationId"
                  name="operationId"
                  className={selectClassName}
                  disabled={operationRows.length === 0}
                  required
                >
                  {operationRows.map(({ operation, provider }) => (
                    <option key={operation.id} value={operation.id}>
                      {operation.name} ({provider.providerType})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="previewFields">Sample Fields JSON</Label>
                <Textarea
                  id="previewFields"
                  name="fields"
                  placeholder={
                    '{\n  "guestEmail": "test@example.com",\n  "preferredDate": "2026-08-15"\n}'
                  }
                  rows={5}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Sandbox runs create an operation attempt without linking to a
                live submission. Webhook and n8n providers still call the
                configured endpoint.
              </p>
              <FormSubmitButton
                className="w-full"
                disabled={operationRows.length === 0}
                label="Run Preview"
                pendingLabel="Running..."
                icon={<Workflow className="h-4 w-4" />}
              />
            </form>

            {previewAttempt && (
              <div className="space-y-3 border-t pt-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-medium">
                      Attempt #{previewAttempt.attempt.id}:{" "}
                      {previewAttempt.operation.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {previewAttempt.operation.operationType} via{" "}
                      {previewAttempt.provider.providerType}
                    </p>
                  </div>
                  <span className="w-fit rounded-md border px-2 py-1 text-xs capitalize">
                    {previewAttempt.attempt.status}
                  </span>
                </div>
                {previewAttempt.attempt.errorMessage && (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                    {previewAttempt.attempt.errorMessage}
                  </p>
                )}
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Request</p>
                    <pre className="max-h-80 overflow-auto rounded-md bg-gray-50 p-3 text-xs">
                      {formatJson(previewAttempt.attempt.requestPayload)}
                    </pre>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Response</p>
                    <pre className="max-h-80 overflow-auto rounded-md bg-gray-50 p-3 text-xs">
                      {formatJson(previewAttempt.attempt.responsePayload)}
                    </pre>
                  </div>
                </div>
                {previewMappedOutput && (
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Mapped Fields</p>
                      <pre className="max-h-80 overflow-auto rounded-md bg-gray-50 p-3 text-xs">
                        {formatJson(previewMappedOutput.fields)}
                      </pre>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">
                        Mapped Contact Attributes
                      </p>
                      <pre className="max-h-80 overflow-auto rounded-md bg-gray-50 p-3 text-xs">
                        {formatJson(previewMappedOutput.contactAttributes)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <Workflow className="h-5 w-5" />
              Recent Operation Attempts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-3 rounded-md border bg-white p-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Automated Retry Queue</p>
                <p className="text-xs text-muted-foreground">
                  Replays failed linked attempts for active API providers that
                  have queued retries enabled.
                </p>
              </div>
              <form action={processOperationRetryQueueAction}>
                <FormSubmitButton
                  className="w-full md:w-auto"
                  label="Process Retry Queue"
                  pendingLabel="Processing..."
                  icon={<Workflow className="h-4 w-4" />}
                />
              </form>
            </div>

            <form className="grid gap-3 rounded-md border bg-white p-3 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="attemptOperationId">Operation</Label>
                <select
                  id="attemptOperationId"
                  name="attemptOperationId"
                  className={selectClassName}
                  defaultValue={attemptOperationId ?? ""}
                >
                  <option value="">All operations</option>
                  {operationRows.map(({ operation, provider }) => (
                    <option key={operation.id} value={operation.id}>
                      {operation.name} ({provider.providerType})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="attemptStatus">Status</Label>
                <select
                  id="attemptStatus"
                  name="attemptStatus"
                  className={selectClassName}
                  defaultValue={attemptStatus ?? ""}
                >
                  <option value="">All statuses</option>
                  {OPERATION_ATTEMPT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="attemptReplay">Replay</Label>
                <select
                  id="attemptReplay"
                  name="attemptReplay"
                  className={selectClassName}
                  defaultValue={attemptReplayFilter}
                >
                  <option value="all">All attempts</option>
                  <option value="originals">Original attempts</option>
                  <option value="replays">Replay attempts</option>
                </select>
              </div>
              <div className="flex items-end gap-2">
                <Button type="submit" className="flex-1">
                  Filter
                </Button>
                <Button asChild type="button" variant="outline">
                  <Link href="/projects/operations">Clear</Link>
                </Button>
              </div>
            </form>

            {recentAttempts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No operation attempts match the current filters.
              </p>
            ) : (
              recentAttempts.map(({ attempt, operation, provider }) => (
                <div
                  key={attempt.id}
                  className="rounded-md border bg-white p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{operation.name}</p>
                        <span className="rounded-md border px-2 py-1 text-xs capitalize">
                          {attempt.status}
                        </span>
                        {getAttemptReplaySource(attempt.requestPayload) ? (
                          <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                            replay
                          </span>
                        ) : (
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                            original
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {operation.operationType} via {provider.name} (
                        {provider.providerType})
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Submission:{" "}
                        {attempt.submissionId ? (
                          <Link
                            href={`/projects/submissions/${attempt.submissionId}`}
                            className="underline underline-offset-4"
                          >
                            #{attempt.submissionId}
                          </Link>
                        ) : (
                          "Not linked"
                        )}
                      </p>
                      {getAttemptDeliverySummary(attempt.responsePayload) && (
                        <p className="text-xs text-muted-foreground">
                          {getAttemptDeliverySummary(attempt.responsePayload)}
                        </p>
                      )}
                      {getAttemptReplaySource(attempt.requestPayload) && (
                        <p className="text-xs text-muted-foreground">
                          Replay of attempt #
                          {getAttemptReplaySource(attempt.requestPayload)}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2 text-left text-xs text-muted-foreground md:text-right">
                      <div>
                        <p>Started</p>
                        <p>
                          {attempt.startedAt
                            ? attempt.startedAt.toLocaleString()
                            : attempt.createdAt.toLocaleString()}
                        </p>
                      </div>
                      <form action={replayOperationAttemptAction}>
                        <input
                          type="hidden"
                          name="attemptId"
                          value={attempt.id}
                        />
                        <FormSubmitButton
                          label={
                            attempt.status === "failed" ? "Retry" : "Replay"
                          }
                          pendingLabel="Running..."
                          className="w-full md:w-auto"
                          icon={<Workflow className="h-4 w-4" />}
                        />
                      </form>
                    </div>
                  </div>
                  {attempt.errorMessage && (
                    <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                      {attempt.errorMessage}
                    </p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <Workflow className="h-5 w-5" />
              Create API Request
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={createApiRequestOperationAction}
              className="space-y-4"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="apiRequestName">Name</Label>
                  <Input
                    id="apiRequestName"
                    name="name"
                    placeholder="Check Availability"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apiRequestProviderType">Provider</Label>
                  <select
                    id="apiRequestProviderType"
                    name="providerType"
                    className={selectClassName}
                    defaultValue="webhook"
                  >
                    <option value="webhook">Webhook</option>
                    <option value="n8n_webhook">n8n Webhook</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="apiRequestUrl">Endpoint URL</Label>
                <Input
                  id="apiRequestUrl"
                  name="url"
                  placeholder="https://example.com/api/check-availability"
                  type="url"
                  required
                />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="apiRequestTimeoutMs">Timeout</Label>
                  <Input
                    id="apiRequestTimeoutMs"
                    name="timeoutMs"
                    type="number"
                    min="1000"
                    max="30000"
                    step="1000"
                    defaultValue="15000"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apiRequestRetryCount">Retries</Label>
                  <Input
                    id="apiRequestRetryCount"
                    name="retryCount"
                    type="number"
                    min="0"
                    max="5"
                    defaultValue="0"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apiRequestSecret">Secret</Label>
                  <Input
                    id="apiRequestSecret"
                    name="secret"
                    placeholder="optional signing secret"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <label
                  htmlFor="apiRequestAutoRetryEnabled"
                  className="flex items-center gap-2 pt-8 text-sm"
                >
                  <input
                    id="apiRequestAutoRetryEnabled"
                    name="autoRetryEnabled"
                    type="checkbox"
                  />
                  Auto retry failed attempts
                </label>
                <div className="space-y-2">
                  <Label htmlFor="apiRequestAutoRetryMaxAttempts">
                    Queued Retries
                  </Label>
                  <Input
                    id="apiRequestAutoRetryMaxAttempts"
                    name="autoRetryMaxAttempts"
                    type="number"
                    min="0"
                    max="10"
                    defaultValue="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apiRequestAutoRetryDelayMinutes">
                    Retry Delay
                  </Label>
                  <Input
                    id="apiRequestAutoRetryDelayMinutes"
                    name="autoRetryDelayMinutes"
                    type="number"
                    min="0"
                    max="10080"
                    defaultValue="5"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Queued retries are separate from immediate delivery retries.
                They only replay failed attempts linked to live submissions.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="apiRequestInputMapping">Input Mapping</Label>
                  <Textarea
                    id="apiRequestInputMapping"
                    name="inputMapping"
                    placeholder={
                      '{\n  "email": "guestEmail",\n  "date": "preferredDate"\n}'
                    }
                    rows={5}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apiRequestOutputMapping">
                    Output Mapping
                  </Label>
                  <Textarea
                    id="apiRequestOutputMapping"
                    name="outputMapping"
                    placeholder={
                      '{\n  "fields.available": "status",\n  "fields.referenceId": "responsePayload.attempts.0.body.id"\n}'
                    }
                    rows={5}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The request is sent as a signed POST. Add the created operation
                to an inline API Request flow block, then use success/failure
                routes or mapped fields to continue the conversation.
              </p>
              <FormSubmitButton
                className="w-full"
                label="Create API Request"
                pendingLabel="Creating..."
                icon={<Plus className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <PlugZap className="h-5 w-5" />
              Create Meta Conversion Event
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={createMetaConversionOperationAction}
              className="space-y-4"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="metaConversionName">Name</Label>
                  <Input
                    id="metaConversionName"
                    name="name"
                    placeholder="Qualified Lead"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="metaConversionEventName">Event Name</Label>
                  <Input
                    id="metaConversionEventName"
                    name="eventName"
                    defaultValue="Lead"
                    placeholder="Lead"
                    required
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="metaConversionDatasetId">
                    Pixel / Dataset ID
                  </Label>
                  <Input
                    id="metaConversionDatasetId"
                    name="datasetId"
                    placeholder="123456789012345"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="metaConversionApiVersion">API Version</Label>
                  <Input
                    id="metaConversionApiVersion"
                    name="apiVersion"
                    defaultValue="v23.0"
                    placeholder="v23.0"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="metaConversionActionSource">
                    Action Source
                  </Label>
                  <Input
                    id="metaConversionActionSource"
                    name="actionSource"
                    defaultValue="website"
                    placeholder="website"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="metaConversionAccessToken">Access Token</Label>
                <Input
                  id="metaConversionAccessToken"
                  name="accessToken"
                  placeholder="Meta system user token"
                  type="password"
                  required
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="metaConversionEventSourceUrl">
                    Event Source URL
                  </Label>
                  <Input
                    id="metaConversionEventSourceUrl"
                    name="eventSourceUrl"
                    placeholder="https://example.com"
                    type="url"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="metaConversionTestEventCode">
                    Test Event Code
                  </Label>
                  <Input
                    id="metaConversionTestEventCode"
                    name="testEventCode"
                    placeholder="Optional Meta test code"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="metaConversionInputMapping">
                  Input Mapping
                </Label>
                <Textarea
                  id="metaConversionInputMapping"
                  name="inputMapping"
                  placeholder={
                    '{\n  "user_data.em": "guestEmail",\n  "user_data.ph": "phone",\n  "custom_data.value": "cartTotal",\n  "custom_data.currency": "currency"\n}'
                  }
                  rows={6}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The operation hashes common Meta user data fields before
                delivery and can be triggered from any channel through an
                Operation block.
              </p>
              <FormSubmitButton
                className="w-full"
                label="Create Meta Conversion"
                pendingLabel="Creating..."
                icon={<Plus className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <PlugZap className="h-5 w-5" />
                Providers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {providers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No providers configured yet.
                  </p>
                ) : (
                  providers.map((provider) => (
                    <div
                      key={provider.id}
                      className="rounded-md border bg-white px-3 py-2"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">
                              {provider.name}
                            </p>
                            <StatusBadge status={provider.status} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {provider.providerType}
                          </p>
                        </div>
                        <form
                          action={updateIntegrationProviderStatusAction}
                          className="flex items-center gap-2"
                        >
                          <input
                            type="hidden"
                            name="providerId"
                            value={provider.id}
                          />
                          <input
                            type="hidden"
                            name="status"
                            value={
                              provider.status === "active"
                                ? "disabled"
                                : "active"
                            }
                          />
                          <Button type="submit" variant="outline" size="sm">
                            {provider.status === "active"
                              ? "Disable"
                              : "Enable"}
                          </Button>
                        </form>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <form
                action={createIntegrationProviderAction}
                className="space-y-4 border-t pt-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="providerName">Provider Name</Label>
                  <Input
                    id="providerName"
                    name="name"
                    placeholder="Manual Review"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="providerType">Provider Type</Label>
                  <select
                    id="providerType"
                    name="providerType"
                    className={selectClassName}
                    required
                  >
                    {INTEGRATION_PROVIDER_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="providerConfig">Config JSON</Label>
                  <Textarea
                    id="providerConfig"
                    name="config"
                    placeholder={
                      '{\n  "url": "https://example.com/webhook",\n  "secret": "optional-signing-secret",\n  "timeoutMs": 15000,\n  "retryCount": 2,\n  "retryDelayMs": 1000,\n  "headers": {\n    "x-api-key": "optional-key"\n  }\n}'
                    }
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    Webhook and n8n providers use config.url. Email providers
                    can use config.webhookUrl. Meta Conversions providers use
                    config.datasetId and config.accessToken. retryCount is
                    additional attempts after the first delivery.
                  </p>
                </div>
                <FormSubmitButton
                  className="w-full"
                  label="Create Provider"
                  pendingLabel="Creating..."
                  icon={<Plus className="h-4 w-4" />}
                />
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <Workflow className="h-5 w-5" />
                Create Operation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createOperationAction} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="operationName">Operation Name</Label>
                  <Input
                    id="operationName"
                    name="name"
                    placeholder="Manual Review"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="operationType">Operation Type</Label>
                  <Input
                    id="operationType"
                    name="operationType"
                    placeholder="manual_review"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="operationProviderId">Provider</Label>
                  <select
                    id="operationProviderId"
                    name="providerId"
                    className={selectClassName}
                    disabled={providers.length === 0}
                    required
                  >
                    {(activeProviders.length > 0
                      ? activeProviders
                      : providers
                    ).map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name} ({provider.providerType})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="inputMapping">Input Mapping</Label>
                    <Textarea
                      id="inputMapping"
                      name="inputMapping"
                      placeholder="{}"
                      rows={5}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="outputMapping">Output Mapping</Label>
                    <Textarea
                      id="outputMapping"
                      name="outputMapping"
                      placeholder={
                        '{\n  "fields.bookingId": "responsePayload.attempts.0.body.id",\n  "contactAttributes.lead_status": "status"\n}'
                      }
                      rows={5}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Output mapping reads from status, errorMessage,
                  requestPayload, responsePayload, and attemptId. Use fields.*
                  for flow fields and contactAttributes.* for contact profile
                  attributes.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="operationSettings">Settings JSON</Label>
                  <Textarea
                    id="operationSettings"
                    name="settings"
                    placeholder="{}"
                    rows={4}
                  />
                </div>
                <input type="hidden" name="status" value="active" />
                <FormSubmitButton
                  className="w-full"
                  disabled={providers.length === 0}
                  label="Create Operation"
                  pendingLabel="Creating..."
                  icon={<Plus className="h-4 w-4" />}
                />
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
