import {
  Activity,
  Bot,
  Bug,
  FlaskConical,
  MessageSquare,
  ScanSearch,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import {
  promoteConversationRegressionCase,
  recordConversationDiagnosticFinding,
} from "@/app/projects/diagnostics/actions";
import { NoProjectState } from "@/components/no-project-state";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getProjectChatAnalytics } from "@/lib/chat-analytics";
import {
  CONVERSATION_DIAGNOSTIC_CATEGORIES,
  CONVERSATION_DIAGNOSTIC_CATEGORY_LABELS,
  type ConversationDiagnosticCategory,
} from "@/lib/conversation-diagnostic-contracts";
import { listConversationDiagnosticFindings } from "@/lib/conversation-diagnostic-findings";
import {
  getProjectConversationDiagnostics,
  listProjectDiagnosticConversations,
} from "@/lib/conversation-diagnostics";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";

type DiagnosticsPageProps = {
  searchParams: Promise<{
    conversationId?: string;
    findingRecorded?: string;
    regressionPromoted?: string;
  }>;
};

function formatDate(value: Date | null) {
  return value ? value.toLocaleString() : "Not recorded";
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function conversationLabel(channelType: string, id: number) {
  return `${formatLabel(channelType)} #${id}`;
}

export default async function DiagnosticsPage({
  searchParams,
}: DiagnosticsPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Diagnostics need a project" />;
  }

  const { project } = context;
  const [conversationRows, analytics] = await Promise.all([
    listProjectDiagnosticConversations(project.id),
    getProjectChatAnalytics(project.id),
  ]);
  const requestedConversationId = params.conversationId
    ? Number.parseInt(params.conversationId, 10)
    : null;
  const defaultConversationId = conversationRows[0]?.conversation.id ?? null;
  let diagnostics =
    requestedConversationId && Number.isFinite(requestedConversationId)
      ? await getProjectConversationDiagnostics(
          project.id,
          requestedConversationId,
        )
      : null;

  if (!diagnostics && defaultConversationId) {
    diagnostics = await getProjectConversationDiagnostics(
      project.id,
      defaultConversationId,
    );
  }

  const findings = diagnostics
    ? await listConversationDiagnosticFindings(
        project.id,
        diagnostics.conversation.id,
      )
    : [];

  const health = analytics.last24Hours;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-7xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <ScanSearch className="size-6" />
              Conversation Diagnostics: {project.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Inspect safe operational evidence for a conversation. Raw provider
              payloads, hidden prompts, credentials, and collected field values
              are not displayed here.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Requests - 24h
                </p>
                <p className="text-xl font-semibold">{health.totalRequests}</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Average latency
                </p>
                <p className="text-xl font-semibold">
                  {health.avgLatencyMs} ms
                </p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Error rate
                </p>
                <p className="text-xl font-semibold">{health.errorRate}%</p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Model tokens
                </p>
                <p className="text-xl font-semibold">{health.totalTokens}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-lg">Recent Conversations</CardTitle>
            </CardHeader>
            <CardContent>
              {conversationRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No channel conversations have been recorded yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {conversationRows.map(({ conversation }) => {
                    const isSelected =
                      conversation.id === diagnostics?.conversation.id;

                    return (
                      <Link
                        className={`block rounded-md border bg-white px-4 py-3 hover:bg-accent/40 ${
                          isSelected ? "border-foreground" : ""
                        }`}
                        href={`/projects/diagnostics?conversationId=${conversation.id}`}
                        key={conversation.id}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 truncate font-medium">
                            {conversationLabel(
                              conversation.channelType,
                              conversation.id,
                            )}
                          </p>
                          <span className="rounded-md border px-2 py-1 text-xs capitalize">
                            {formatLabel(conversation.status)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs capitalize text-muted-foreground">
                          {formatLabel(conversation.channelType)}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Last message: {formatDate(conversation.lastMessageAt)}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {!diagnostics ? (
            <Card>
              <CardContent className="py-10 text-sm text-muted-foreground">
                Select a conversation after one is recorded.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Activity className="size-5" />
                    Runtime Snapshot
                  </CardTitle>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/projects/diagnostics/evaluations">
                      Evaluation gate
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-md border bg-white p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Channel
                      </p>
                      <p className="mt-1 font-medium capitalize">
                        {formatLabel(diagnostics.conversation.channelType)}
                      </p>
                    </div>
                    <div className="rounded-md border bg-white p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Messages
                      </p>
                      <p className="mt-1 font-medium">
                        {diagnostics.messages.length}
                      </p>
                    </div>
                    <div className="rounded-md border bg-white p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Linked flows
                      </p>
                      <p className="mt-1 font-medium">
                        {diagnostics.submissions.length}
                      </p>
                    </div>
                    <div className="rounded-md border bg-white p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Task runs
                      </p>
                      <p className="mt-1 font-medium">
                        {diagnostics.taskRuns.length}
                      </p>
                    </div>
                  </div>

                  {diagnostics.executionState && (
                    <div className="rounded-md border bg-white p-4">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">Execution:</span>
                        <span className="rounded-md border px-2 py-1 capitalize">
                          {formatLabel(
                            diagnostics.executionState.executionMode,
                          )}
                        </span>
                        <span className="rounded-md border px-2 py-1 capitalize">
                          Owner:{" "}
                          {formatLabel(
                            diagnostics.executionState.responseOwner,
                          )}
                        </span>
                        <span className="rounded-md border px-2 py-1 capitalize">
                          {formatLabel(diagnostics.executionState.status)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Revision {diagnostics.executionState.revision} - Updated{" "}
                        {formatDate(diagnostics.executionState.updatedAt)}
                      </p>
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-md border bg-white p-3">
                      <p className="text-xs text-muted-foreground">
                        Validation failures
                      </p>
                      <p className="text-lg font-semibold">
                        {diagnostics.eventSummary.validationFailures}
                      </p>
                    </div>
                    <div className="rounded-md border bg-white p-3">
                      <p className="text-xs text-muted-foreground">
                        Handoff events
                      </p>
                      <p className="text-lg font-semibold">
                        {diagnostics.eventSummary.handoffs}
                      </p>
                    </div>
                    <div className="rounded-md border bg-white p-3">
                      <p className="text-xs text-muted-foreground">
                        Cancellation events
                      </p>
                      <p className="text-lg font-semibold">
                        {diagnostics.eventSummary.cancellations}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <MessageSquare className="size-5" />
                    Ordered Transcript
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {diagnostics.messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No transcript messages were recorded.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {diagnostics.messages.map((message) => (
                        <div
                          className="rounded-md border bg-white p-4"
                          key={message.id}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium capitalize">
                                {message.direction}
                              </span>
                              <span className="rounded-md border px-2 py-1 text-xs capitalize">
                                {formatLabel(message.messageType)}
                              </span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(message.createdAt)}
                            </span>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap break-words text-sm">
                            {message.text || "No text body recorded."}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Workflow className="size-5" />
                    Linked Flow Lifecycle
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {diagnostics.submissions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No flow submission is linked to this conversation.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {diagnostics.submissions.map((submission) => {
                        const events = diagnostics.submissionEvents.filter(
                          (event) => event.submissionId === submission.id,
                        );

                        return (
                          <div
                            className="rounded-md border bg-white p-4"
                            key={submission.id}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-semibold">
                                  #{submission.id} {submission.actionName}
                                </p>
                                <p className="mt-1 text-sm capitalize text-muted-foreground">
                                  {formatLabel(submission.status)} - Created{" "}
                                  {formatDate(submission.createdAt)}
                                </p>
                                {submission.traceId && (
                                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                                    Trace: {submission.traceId}
                                  </p>
                                )}
                              </div>
                              <Button asChild size="sm" variant="outline">
                                <Link
                                  href={`/projects/submissions/${submission.id}`}
                                >
                                  View submission
                                </Link>
                              </Button>
                            </div>
                            <div className="mt-4 space-y-2">
                              {events.map((event) => (
                                <div
                                  className="rounded-md bg-muted/60 px-3 py-2 text-sm"
                                  key={event.id}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-medium">
                                      {event.eventType}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {formatDate(event.createdAt)}
                                    </span>
                                  </div>
                                  {event.message && (
                                    <p className="mt-1 text-muted-foreground">
                                      {event.message}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Bot className="size-5" />
                    Conversational Task Runs
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {diagnostics.taskRuns.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No conversational task run is linked to this conversation.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {diagnostics.taskRuns.map((run) => (
                        <div
                          className="rounded-md border bg-white p-4"
                          key={run.id}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold">
                                Run #{run.id} - {run.taskName}
                              </p>
                              <p className="mt-1 text-sm capitalize text-muted-foreground">
                                {formatLabel(run.status)} - Stage{" "}
                                {formatLabel(run.currentStage)}
                              </p>
                            </div>
                            {run.outcomeKey && (
                              <span className="rounded-md border px-2 py-1 text-xs capitalize">
                                {formatLabel(run.outcomeKey)}
                              </span>
                            )}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>Started {formatDate(run.startedAt)}</span>
                            {run.lastRequestedFieldKey && (
                              <span>
                                Last requested: {run.lastRequestedFieldKey}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Bug className="size-5" />
                    Tester Findings & Regression Cases
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {params.findingRecorded === "1" && (
                    <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
                      Tester finding recorded.
                    </p>
                  )}
                  {params.regressionPromoted === "1" && (
                    <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
                      Regression case promoted with synthetic test data.
                    </p>
                  )}

                  <div className="rounded-md border bg-white p-4">
                    <h3 className="font-semibold">Record a tester finding</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Describe the observable problem. Do not enter secrets,
                      credentials, or personal information.
                    </p>
                    <ActionStateForm
                      action={recordConversationDiagnosticFinding}
                      className="mt-4 space-y-4"
                    >
                      <input
                        name="projectId"
                        type="hidden"
                        value={project.id}
                      />
                      <input
                        name="conversationId"
                        type="hidden"
                        value={diagnostics.conversation.id}
                      />
                      <div className="space-y-2">
                        <Label htmlFor="diagnostic-category">Category</Label>
                        <select
                          className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                          defaultValue="response_quality"
                          id="diagnostic-category"
                          name="category"
                        >
                          {CONVERSATION_DIAGNOSTIC_CATEGORIES.map(
                            (category) => (
                              <option key={category} value={category}>
                                {
                                  CONVERSATION_DIAGNOSTIC_CATEGORY_LABELS[
                                    category
                                  ]
                                }
                              </option>
                            ),
                          )}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="diagnostic-note">Finding</Label>
                        <Textarea
                          id="diagnostic-note"
                          maxLength={2000}
                          minLength={10}
                          name="note"
                          placeholder="Describe what happened and what should have happened."
                          required
                          rows={4}
                        />
                      </div>
                      <ActionFormError />
                      <FormSubmitButton
                        icon={<Bug className="size-4" />}
                        label="Record finding"
                        pendingLabel="Recording..."
                      />
                    </ActionStateForm>
                  </div>

                  <div className="space-y-3">
                    <h3 className="font-semibold">Recorded findings</h3>
                    {findings.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No tester findings have been recorded for this
                        conversation.
                      </p>
                    ) : (
                      findings.map(({ finding, author, regressionCase }) => (
                        <div
                          className="rounded-md border bg-white p-4"
                          key={finding.id}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold">
                                {CONVERSATION_DIAGNOSTIC_CATEGORY_LABELS[
                                  finding.category as ConversationDiagnosticCategory
                                ] ?? formatLabel(finding.category)}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {author.name ?? author.email} -{" "}
                                {formatDate(finding.createdAt)}
                              </p>
                            </div>
                            <span className="rounded-md border px-2 py-1 text-xs">
                              Finding #{finding.id}
                            </span>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap text-sm">
                            {finding.note}
                          </p>

                          {regressionCase ? (
                            <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-4">
                              <div className="flex items-center gap-2 font-semibold text-green-900">
                                <FlaskConical className="size-4" />
                                {regressionCase.title}
                              </div>
                              <p className="mt-2 text-xs font-medium uppercase tracking-wide text-green-800">
                                Synthetic input
                              </p>
                              <p className="mt-1 whitespace-pre-wrap text-sm">
                                {regressionCase.syntheticInput}
                              </p>
                              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-green-800">
                                Expected behavior
                              </p>
                              <p className="mt-1 whitespace-pre-wrap text-sm">
                                {regressionCase.expectedBehavior}
                              </p>
                            </div>
                          ) : (
                            <ActionStateForm
                              action={promoteConversationRegressionCase}
                              className="mt-4 space-y-4 rounded-md border bg-muted/30 p-4"
                            >
                              <input
                                name="projectId"
                                type="hidden"
                                value={project.id}
                              />
                              <input
                                name="conversationId"
                                type="hidden"
                                value={diagnostics.conversation.id}
                              />
                              <input
                                name="findingId"
                                type="hidden"
                                value={finding.id}
                              />
                              <div>
                                <h4 className="font-semibold">
                                  Promote to regression case
                                </h4>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  Write a synthetic case. Transcript messages
                                  are never copied automatically.
                                </p>
                              </div>
                              <div className="space-y-2">
                                <Label
                                  htmlFor={`regression-category-${finding.id}`}
                                >
                                  Evaluation dataset
                                </Label>
                                <select
                                  className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                                  defaultValue="completion"
                                  id={`regression-category-${finding.id}`}
                                  name="evaluationCategory"
                                >
                                  <option value="extraction">Extraction</option>
                                  <option value="correction">Correction</option>
                                  <option value="clarification">
                                    Clarification
                                  </option>
                                  <option value="safety">Safety</option>
                                  <option value="completion">Completion</option>
                                </select>
                              </div>
                              <div className="space-y-2">
                                <Label
                                  htmlFor={`regression-title-${finding.id}`}
                                >
                                  Title
                                </Label>
                                <Input
                                  id={`regression-title-${finding.id}`}
                                  maxLength={120}
                                  minLength={3}
                                  name="title"
                                  placeholder="Short regression name"
                                  required
                                />
                              </div>
                              <div className="space-y-2">
                                <Label
                                  htmlFor={`regression-input-${finding.id}`}
                                >
                                  Synthetic visitor input
                                </Label>
                                <Textarea
                                  id={`regression-input-${finding.id}`}
                                  maxLength={2000}
                                  name="syntheticInput"
                                  placeholder="Use invented, non-personal test input."
                                  required
                                  rows={3}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label
                                  htmlFor={`regression-expected-${finding.id}`}
                                >
                                  Expected behavior
                                </Label>
                                <Textarea
                                  id={`regression-expected-${finding.id}`}
                                  maxLength={2000}
                                  minLength={10}
                                  name="expectedBehavior"
                                  placeholder="Describe the response, route, or lifecycle result that should occur."
                                  required
                                  rows={3}
                                />
                              </div>
                              <ActionFormError />
                              <FormSubmitButton
                                icon={<FlaskConical className="size-4" />}
                                label="Promote regression case"
                                pendingLabel="Promoting..."
                              />
                            </ActionStateForm>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
