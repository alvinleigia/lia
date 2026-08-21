import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  Eraser,
  History,
  MessageCircleQuestion,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  SearchCheck,
  Shuffle,
  Square,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TaskConfigurationNav } from "@/components/task-configuration-nav";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmSubmitButton } from "@/components/ui/confirm-action-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getTaskOperationAttempt } from "@/lib/conversational-task-operations";
import {
  getConversationTaskRuntimeSession,
  getTaskRuntimeTestConversationId,
} from "@/lib/conversational-task-runtime-session";
import { conversationalTaskIdSchema } from "@/lib/conversational-task-schema";
import {
  getProjectConversationalTask,
  listConversationalTaskVersions,
  listProjectConversationalTasks,
} from "@/lib/conversational-tasks";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import { formatDateTimeInTimeZone } from "@/lib/time-zones";
import {
  applyTaskRuntimeTestLifecycleAction,
  clearTaskRuntimeTestFieldAction,
  requestTaskRuntimeTestFieldAction,
  requestTaskRuntimeTestToolAction,
  resetTaskRuntimeTestAction,
  startTaskRuntimeTestAction,
  switchTaskRuntimeTestAction,
  updateTaskRuntimeTestFieldAction,
} from "./actions";
import { OperationTestPanel } from "./operation-test-panel";

type PageProps = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ error?: string; event?: string }>;
};

const eventMessages: Record<string, string> = {
  cancel: "The task was cancelled and control returned to knowledge mode.",
  complete: "The task completed and its published outcome was recorded.",
  field_cleared: "The selected value was cleared.",
  field_corrected: "The value was corrected and dependent fields were checked.",
  field_requested: "The selected field is now the requested field.",
  field_saved: "The test value was validated and saved.",
  operation_completed:
    "The confirmed operation completed and the task outcome was recorded.",
  operation_confirmed: "The current operation summary was confirmed.",
  operation_duplicate_prevented:
    "Duplicate protection reused the existing durable operation attempt.",
  operation_failed:
    "The operation failed and the configured failure outcome was recorded.",
  operation_outcome_unknown:
    "The provider outcome is uncertain. Manual reconciliation is required.",
  operation_pending: "The operation is still waiting in the durable queue.",
  operation_prepared: "Review the operation summary before confirming it.",
  operation_queued: "The confirmed operation was queued once.",
  operation_reconciled_completed:
    "The uncertain provider outcome was reconciled as completed.",
  operation_reconciled_failed:
    "The uncertain provider outcome was reconciled as failed.",
  pause: "The task is paused without losing its execution position.",
  reset: "The isolated runtime test data was reset.",
  restart: "The task restarted and its collected values were cleared.",
  resume: "The paused task resumed.",
  rotate_session: "The session rotated while preserving the active task.",
  side_question: "Knowledge mode owns the bounded side question.",
  side_question_resolved: "Control returned to the task and requested field.",
  started: "A new run started on the latest published version.",
  task_switched: "The active conversation switched to the selected task.",
  tool_completed: "The business lookup finished. Review its result below.",
};

const ownerLabels: Record<string, string> = {
  deterministic: "Deterministic Flow",
  human: "Authorized Human",
  knowledge: "Knowledge Q&A",
  task: "Conversational Task",
};

function displayValue(value: unknown) {
  if (value === null || value === undefined) return "Not collected";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function displayToolResultValue(input: {
  key: string;
  result: Record<string, unknown> | null;
  toolId: string;
  value: unknown;
}) {
  if (
    input.toolId === "catalog.service_price" &&
    input.key === "amount" &&
    typeof input.value === "number" &&
    typeof input.result?.currency === "string"
  ) {
    try {
      const currencyOptions = new Intl.NumberFormat("en", {
        currency: input.result.currency,
        style: "currency",
      }).resolvedOptions();
      return new Intl.NumberFormat("en", {
        maximumFractionDigits: currencyOptions.maximumFractionDigits,
        minimumFractionDigits: currencyOptions.minimumFractionDigits,
      }).format(input.value);
    } catch {
      return displayValue(input.value);
    }
  }
  return displayValue(input.value);
}

const toolStatusLabels: Record<string, string> = {
  cancelled: "Cancelled",
  completed: "Completed",
  failed: "Provider failed",
  no_result: "No current result",
  outcome_unknown: "Outcome unknown",
  pending: "Waiting",
  processing: "Running",
  provider_failure: "Provider failed",
  rejected: "Rejected",
  success: "Completed",
  timed_out: "Timed out",
  timeout: "Timed out",
};

const toolErrorLabels: Record<string, string> = {
  availability_not_recorded: "No current availability is recorded.",
  built_in_tool_failed: "The lookup could not be completed.",
  catalog_not_found: "The selected service catalog is no longer available.",
  duration_not_recorded: "No current duration is recorded.",
  price_not_recorded: "No current price is recorded.",
  service_not_found: "The selected service is no longer available.",
  tool_result_mapping_invalid: "The lookup result did not match this task.",
};

function toolResultEntries(value: Record<string, unknown> | null) {
  return value ? Object.entries(value) : [];
}

function hiddenContext(projectId: number, taskId: number) {
  return (
    <>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
    </>
  );
}

export default async function TaskRuntimeTestPage({
  params,
  searchParams,
}: PageProps) {
  const route = conversationalTaskIdSchema.safeParse((await params).taskId);
  const query = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);
  if (!route.success || !context) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  const [task, versions, projectTasks, session] = await Promise.all([
    getProjectConversationalTask(context.project.id, route.data),
    listConversationalTaskVersions(context.project.id, route.data),
    listProjectConversationalTasks(context.project.id),
    getConversationTaskRuntimeSession({
      channelType: "project_chat",
      externalConversationId: getTaskRuntimeTestConversationId(context.user.id),
      projectId: context.project.id,
    }),
  ]);
  if (!task) redirect("/projects/tasks?error=Task%20not%20found.");

  const publishedTargets = (
    await Promise.all(
      projectTasks
        .filter((candidate) => !candidate.isArchived)
        .map(async (candidate) => ({
          task: candidate,
          versions: await listConversationalTaskVersions(
            context.project.id,
            candidate.id,
          ),
        })),
    )
  )
    .filter(
      ({ task: candidate, versions: candidateVersions }) =>
        candidateVersions.length > 0 &&
        candidate.id !== session.runtime?.run.taskId,
    )
    .map(({ task: candidate }) => candidate);

  const runtime = session.runtime;
  const execution = session.execution;
  const isActive =
    Boolean(runtime && execution?.activeTaskRunId === runtime.run.id) &&
    ["active", "paused", "waiting"].includes(runtime?.run.status ?? "");
  const isDifferentTask = Boolean(runtime) && runtime?.run.taskId !== task.id;
  const isPaused =
    runtime?.run.status === "paused" || runtime?.run.status === "waiting";
  const isAnsweringSideQuestion =
    isActive && execution?.responseOwner === "knowledge";
  const fieldDefinitions = session.snapshot?.task.definition.fields ?? [];
  const fieldLabels = new Map(
    fieldDefinitions.map((field) => [field.key, field.label]),
  );
  const selectedField =
    runtime?.fields.find(
      (field) => field.fieldKey === runtime.run.lastRequestedFieldKey,
    ) ??
    runtime?.fields.find(
      (field) => field.state === "missing" || field.state === "cleared",
    ) ??
    runtime?.fields[0];
  const toolBindings = session.snapshot?.task.definition.tools ?? [];
  const runnableTools =
    session.snapshot?.toolDefinitions.filter((definition) => {
      const binding = toolBindings.find(
        (candidate) =>
          candidate.tool.id === definition.id &&
          candidate.tool.version === definition.version,
      );
      return (
        binding?.access === "read" &&
        binding.allowedStages.includes("lookup") &&
        definition.access === "read" &&
        definition.execution.adapter === "built_in" &&
        definition.execution.mode === "synchronous"
      );
    }) ?? [];
  const writeOperations =
    session.snapshot?.toolDefinitions.flatMap((definition) => {
      const binding = toolBindings.find(
        (candidate) =>
          candidate.tool.id === definition.id &&
          candidate.tool.version === definition.version,
      );
      return binding?.access === "write" &&
        binding.allowedStages.includes("operation") &&
        definition.access === "write" &&
        definition.execution.adapter === "operation"
        ? [{ id: definition.id, name: definition.name }]
        : [];
    }) ?? [];
  const latestConfirmation = runtime?.confirmations[0] ?? null;
  const operationAttemptDetails = latestConfirmation
    ? await getTaskOperationAttempt({
        confirmationId: latestConfirmation.id,
        projectId: context.project.id,
      })
    : null;
  const operationEvent = query.event?.startsWith("operation_")
    ? query.event
    : undefined;
  const operationFeedback = operationEvent
    ? {
        message: eventMessages[operationEvent],
        tone: (["operation_failed", "operation_reconciled_failed"].includes(
          operationEvent,
        )
          ? "error"
          : ["operation_outcome_unknown", "operation_pending"].includes(
                operationEvent,
              )
            ? "warning"
            : "success") as "error" | "success" | "warning",
      }
    : undefined;
  const toolNames = new Map(
    (session.snapshot?.toolDefinitions ?? []).map((definition) => [
      definition.id,
      definition.name,
    ]),
  );

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <Link
          href={`/projects/tasks/${task.id}/configure/review`}
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to review
        </Link>
        <TaskConfigurationNav active="test" taskId={task.id} />

        <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Activity className="h-6 w-6" />
                Runtime Lifecycle Test
              </CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                Exercise one isolated project-chat conversation against an
                immutable published task version.
              </p>
            </div>
            <Badge variant={isActive ? "default" : "secondary"}>
              {isActive ? "Active test run" : "No active run"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            {query.error && (
              <p
                role="alert"
                className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {query.error}
              </p>
            )}
            {query.event &&
              !operationEvent &&
              !["field_saved", "field_corrected"].includes(query.event) &&
              eventMessages[query.event] && (
                <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
                  {eventMessages[query.event]}
                </p>
              )}
            {isDifferentTask && session.snapshot && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {isActive ? (
                  <>
                    The active test belongs to{" "}
                    <span className="font-medium">
                      {session.snapshot.task.name}
                    </span>
                    . Switch the active task below to test{" "}
                    <span className="font-medium">{task.name}</span>.
                  </>
                ) : (
                  <>
                    The results below are from the last completed test for{" "}
                    <span className="font-medium">
                      {session.snapshot.task.name}
                    </span>
                    . Select Start Test Run to test{" "}
                    <span className="font-medium">{task.name}</span>.
                  </>
                )}
              </p>
            )}

            {runtime && session.snapshot && session.version ? (
              <div className="grid gap-4 border-y py-5 sm:grid-cols-2 lg:grid-cols-5">
                <div>
                  <p className="text-xs uppercase text-muted-foreground">
                    {isActive ? "Active Task" : "Last Tested Task"}
                  </p>
                  <p className="mt-1 font-medium">
                    {session.snapshot.task.name}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">
                    Pinned Version
                  </p>
                  <p className="mt-1 font-medium">
                    v{session.version.versionNumber}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">
                    Run Status
                  </p>
                  <p className="mt-1 font-medium capitalize">
                    {runtime.run.status}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">
                    Response Owner
                  </p>
                  <p className="mt-1 font-medium">
                    {ownerLabels[execution?.responseOwner ?? ""] ??
                      execution?.responseOwner ??
                      "None"}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">
                    Revision
                  </p>
                  <p className="mt-1 font-medium">
                    {execution?.revision ?? runtime.run.revision}
                  </p>
                </div>
              </div>
            ) : (
              <p className="border-y py-5 text-sm text-muted-foreground">
                Start the test to create a durable conversation and pin it to
                the latest published version of {task.name}.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {!isActive && (
                  <form
                    action={startTaskRuntimeTestAction}
                    data-preserve-scroll
                  >
                    {hiddenContext(context.project.id, task.id)}
                    <Button type="submit" disabled={versions.length === 0}>
                      <Play className="h-4 w-4" />
                      Start Test Run
                    </Button>
                  </form>
                )}
                {isActive && !isAnsweringSideQuestion && (
                  <form
                    action={applyTaskRuntimeTestLifecycleAction}
                    data-preserve-scroll
                  >
                    {hiddenContext(context.project.id, task.id)}
                    <Button
                      type="submit"
                      name="transition"
                      value={isPaused ? "resume" : "pause"}
                      variant="outline"
                    >
                      {isPaused ? (
                        <CirclePlay className="h-4 w-4" />
                      ) : (
                        <CirclePause className="h-4 w-4" />
                      )}
                      {isPaused ? "Resume" : "Pause"}
                    </Button>
                  </form>
                )}
                {isActive && !isPaused && (
                  <form
                    action={applyTaskRuntimeTestLifecycleAction}
                    data-preserve-scroll
                  >
                    {hiddenContext(context.project.id, task.id)}
                    <Button
                      type="submit"
                      name="transition"
                      value={
                        isAnsweringSideQuestion
                          ? "side_question_resolved"
                          : "side_question"
                      }
                      variant="outline"
                    >
                      <MessageCircleQuestion className="h-4 w-4" />
                      {isAnsweringSideQuestion
                        ? "Return to Task"
                        : "Ask Side Question"}
                    </Button>
                  </form>
                )}
                {isActive && (
                  <form
                    action={applyTaskRuntimeTestLifecycleAction}
                    data-preserve-scroll
                  >
                    {hiddenContext(context.project.id, task.id)}
                    <Button
                      type="submit"
                      name="transition"
                      value="rotate_session"
                      variant="outline"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Rotate Session
                    </Button>
                  </form>
                )}
              </div>

              {runtime && (
                <form action={resetTaskRuntimeTestAction} data-preserve-scroll>
                  {hiddenContext(context.project.id, task.id)}
                  <ConfirmSubmitButton
                    variant="destructive"
                    confirmation={{
                      title: "Reset all runtime test data?",
                      description:
                        "This permanently removes the current test session and its recorded runtime data.",
                      confirmLabel: "Reset Test Data",
                      confirmVariant: "destructive",
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Reset Test Data
                  </ConfirmSubmitButton>
                </form>
              )}
            </div>

            {versions.length === 0 && (
              <p className="text-sm text-amber-700">
                Publish this task before starting its runtime test.
              </p>
            )}
          </CardContent>
        </Card>

        {runtime && session.snapshot && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Field Lifecycle</CardTitle>
              <p className="text-sm text-muted-foreground">
                Save, correct, request, or clear values in the pinned task
                contract. Multiple-value fields accept comma-separated or
                line-separated entries.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              {runtime.fields.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This published task has no fields.
                </p>
              ) : (
                <>
                  <div className="divide-y rounded-md border">
                    {runtime.fields.map((field) => (
                      <div
                        key={field.id}
                        className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">
                              {fieldLabels.get(field.fieldKey) ??
                                field.fieldKey}
                            </p>
                            {field.isRequired && (
                              <Badge variant="outline">Required</Badge>
                            )}
                            {runtime.run.lastRequestedFieldKey ===
                              field.fieldKey && (
                              <Badge variant="secondary">Requested</Badge>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {field.fieldKey} / {field.fieldType}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium">
                            {displayValue(field.canonicalValue)}
                          </p>
                          <p className="mt-1 text-xs capitalize text-muted-foreground">
                            {field.state} / {field.attemptCount} attempt
                            {field.attemptCount === 1 ? "" : "s"}
                          </p>
                          {field.state === "invalid" &&
                            typeof field.validation.message === "string" && (
                              <p className="mt-1 text-xs text-destructive">
                                {field.validation.message}
                              </p>
                            )}
                        </div>
                        {isActive && !isPaused && !isAnsweringSideQuestion && (
                          <div className="flex gap-2">
                            <form
                              action={requestTaskRuntimeTestFieldAction}
                              data-preserve-scroll
                            >
                              {hiddenContext(context.project.id, task.id)}
                              <input
                                type="hidden"
                                name="fieldKey"
                                value={field.fieldKey}
                              />
                              <Button type="submit" size="sm" variant="outline">
                                <MessageCircleQuestion className="h-4 w-4" />
                                Request
                              </Button>
                            </form>
                            <form
                              action={clearTaskRuntimeTestFieldAction}
                              data-preserve-scroll
                            >
                              {hiddenContext(context.project.id, task.id)}
                              <input
                                type="hidden"
                                name="fieldKey"
                                value={field.fieldKey}
                              />
                              <Button
                                type="submit"
                                size="sm"
                                variant="outline"
                                disabled={
                                  field.state === "missing" ||
                                  field.state === "cleared"
                                }
                              >
                                <Eraser className="h-4 w-4" />
                                Clear
                              </Button>
                            </form>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {isActive && !isPaused && !isAnsweringSideQuestion && (
                    <ActionStateForm
                      action={updateTaskRuntimeTestFieldAction}
                      resetKey={`${runtime.run.id}:${execution?.revision ?? 0}`}
                      className="space-y-4 rounded-md border p-4"
                    >
                      {hiddenContext(context.project.id, task.id)}
                      <div>
                        <h3 className="font-medium">Save or Correct a Value</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Saving an existing field value records a correction
                          and rechecks its dependents.
                        </p>
                      </div>
                      <ActionFormError />
                      <div className="grid gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] md:items-end">
                        <div className="space-y-2">
                          <Label htmlFor="runtimeFieldKey">Field</Label>
                          <Select
                            name="fieldKey"
                            defaultValue={selectedField?.fieldKey}
                          >
                            <SelectTrigger
                              id="runtimeFieldKey"
                              className="w-full"
                            >
                              <SelectValue placeholder="Choose a field" />
                            </SelectTrigger>
                            <SelectContent>
                              {runtime.fields.map((field) => (
                                <SelectItem
                                  key={field.id}
                                  value={field.fieldKey}
                                >
                                  {fieldLabels.get(field.fieldKey) ??
                                    field.fieldKey}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="runtimeFieldValue">Test Value</Label>
                          <Input
                            id="runtimeFieldValue"
                            name="value"
                            placeholder="Enter a value from your UAT scenario"
                            required
                          />
                        </div>
                        <Button type="submit">
                          <Save className="h-4 w-4" />
                          Save Value
                        </Button>
                      </div>
                    </ActionStateForm>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {runtime && session.snapshot && toolBindings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <SearchCheck className="h-5 w-5" />
                Business Lookup Test
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Run a published read-only lookup using the current validated
                task values. Lia cannot replace its inputs or expose provider
                data here.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              {runnableTools.length > 0 &&
                isActive &&
                !isPaused &&
                !isAnsweringSideQuestion && (
                  <ActionStateForm
                    action={requestTaskRuntimeTestToolAction}
                    className="space-y-4 rounded-md border p-4"
                  >
                    {hiddenContext(context.project.id, task.id)}
                    <ActionFormError />
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                      <div className="space-y-2">
                        <Label htmlFor="runtimeToolId">Business Lookup</Label>
                        <Select
                          name="toolId"
                          defaultValue={runnableTools[0]?.id}
                        >
                          <SelectTrigger id="runtimeToolId" className="w-full">
                            <SelectValue placeholder="Choose a lookup" />
                          </SelectTrigger>
                          <SelectContent>
                            {runnableTools.map((definition) => (
                              <SelectItem
                                key={definition.id}
                                value={definition.id}
                              >
                                {definition.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button type="submit">
                        <SearchCheck className="h-4 w-4" />
                        Run Lookup
                      </Button>
                    </div>
                  </ActionStateForm>
                )}

              {runnableTools.length === 0 && (
                <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
                  Publish at least one read-only built-in tool with the Lookup
                  stage enabled to test it here.
                </p>
              )}

              {runtime.tools.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No business lookups have run in this test conversation.
                </p>
              ) : (
                <div className="divide-y rounded-md border">
                  {runtime.tools.slice(0, 8).map((tool) => {
                    const entries = toolResultEntries(tool.result);
                    return (
                      <div key={tool.id} className="space-y-3 px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-medium">
                              {toolNames.get(tool.toolId) ?? tool.toolId}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {tool.stage} / {tool.requestMode}
                            </p>
                          </div>
                          <Badge
                            variant={
                              [
                                "failed",
                                "provider_failure",
                                "rejected",
                              ].includes(tool.status)
                                ? "destructive"
                                : tool.status === "success" ||
                                    tool.status === "completed"
                                  ? "default"
                                  : "secondary"
                            }
                          >
                            {toolStatusLabels[tool.status] ?? tool.status}
                          </Badge>
                        </div>
                        {entries.length > 0 && (
                          <dl className="grid gap-2 sm:grid-cols-2">
                            {entries.map(([key, value]) => (
                              <div key={key}>
                                <dt className="text-xs capitalize text-muted-foreground">
                                  {key.replace(/([A-Z])/g, " $1")}
                                </dt>
                                <dd className="break-words text-sm font-medium">
                                  {displayToolResultValue({
                                    key,
                                    result: tool.result,
                                    toolId: tool.toolId,
                                    value,
                                  })}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {tool.errorCode && (
                          <p className="text-sm text-muted-foreground">
                            {toolErrorLabels[tool.errorCode] ??
                              "The lookup did not return a usable result."}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {runtime && session.snapshot && (
          <OperationTestPanel
            attempt={operationAttemptDetails?.attempt ?? null}
            confirmation={latestConfirmation}
            isActive={isActive}
            isPaused={isPaused || isAnsweringSideQuestion}
            operationFeedback={operationFeedback}
            projectId={context.project.id}
            taskId={task.id}
            timeZone={context.company.timeZone}
            writeOperations={writeOperations}
          />
        )}

        {isActive && runtime && session.snapshot && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Task Lifecycle</CardTitle>
              <p className="text-sm text-muted-foreground">
                These controls preserve the pinned version and audit every
                accepted transition.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <form
                action={applyTaskRuntimeTestLifecycleAction}
                className="flex flex-wrap gap-2"
                data-preserve-scroll
              >
                {hiddenContext(context.project.id, task.id)}
                <Button
                  type="submit"
                  name="transition"
                  value="restart"
                  variant="outline"
                  disabled={isAnsweringSideQuestion}
                >
                  <RotateCcw className="h-4 w-4" />
                  Restart
                </Button>
                <Button
                  type="submit"
                  name="transition"
                  value="complete"
                  disabled={isPaused || isAnsweringSideQuestion}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Complete
                </Button>
                <Button
                  type="submit"
                  name="transition"
                  value="cancel"
                  variant="outline"
                  disabled={isAnsweringSideQuestion}
                >
                  <Square className="h-4 w-4" />
                  Cancel
                </Button>
              </form>

              {publishedTargets.length > 0 && !isPaused && (
                <ActionStateForm
                  action={switchTaskRuntimeTestAction}
                  className="space-y-4 border-t pt-5"
                >
                  {hiddenContext(context.project.id, task.id)}
                  <div>
                    <h3 className="font-medium">Switch Active Task</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The current run is cancelled only after the target task
                      passes its published-version preflight.
                    </p>
                  </div>
                  <ActionFormError />
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-64 flex-1 space-y-2">
                      <Label htmlFor="targetTaskId">Published Task</Label>
                      <Select name="targetTaskId">
                        <SelectTrigger id="targetTaskId" className="w-full">
                          <SelectValue placeholder="Choose another task" />
                        </SelectTrigger>
                        <SelectContent>
                          {publishedTargets.map((candidate) => (
                            <SelectItem
                              key={candidate.id}
                              value={String(candidate.id)}
                            >
                              {candidate.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="submit" variant="outline">
                      <Shuffle className="h-4 w-4" />
                      Switch Task
                    </Button>
                  </div>
                </ActionStateForm>
              )}
            </CardContent>
          </Card>
        )}

        {(runtime || session.safeAudit.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <History className="h-5 w-5" />
                Safe Audit Trail
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Routine diagnostics store event summaries and lifecycle
                metadata, not collected field values.
              </p>
            </CardHeader>
            <CardContent>
              {session.safeAudit.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No runtime events have been recorded.
                </p>
              ) : (
                <div className="divide-y rounded-md border">
                  {session.safeAudit.map((event) => (
                    <div
                      key={event.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                    >
                      <p className="font-medium">{event.eventType}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDateTimeInTimeZone(
                          event.createdAt,
                          context.company.timeZone,
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
