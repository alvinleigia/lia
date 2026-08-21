import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  History,
  Send,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TaskConfigurationNav } from "@/components/task-configuration-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { getConversationProjectPolicy } from "@/lib/conversation-project-policies";
import { conversationalTaskIdSchema } from "@/lib/conversational-task-schema";
import { resolveProjectTaskToolDefinitions } from "@/lib/conversational-task-tools";
import { validateConversationalTaskForPublish } from "@/lib/conversational-task-validation";
import {
  buildConversationalTaskSnapshot,
  conversationalTaskSnapshotsMatch,
} from "@/lib/conversational-task-versioning";
import {
  getProjectConversationalTask,
  listConversationalTaskVersions,
  readConversationalTaskDefinition,
} from "@/lib/conversational-tasks";
import { normalizeProjectAiSettings } from "@/lib/project-ai-settings";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import { formatDateTimeInTimeZone } from "@/lib/time-zones";
import { publishConversationalTaskAction } from "../../../actions";

type PageProps = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ error?: string; published?: string }>;
};

export default async function TaskVersionsPage({
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

  const [task, projectPolicy, versions] = await Promise.all([
    getProjectConversationalTask(context.project.id, route.data),
    getConversationProjectPolicy(context.project.id),
    listConversationalTaskVersions(context.project.id, route.data),
  ]);
  if (!task) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  const definition = readConversationalTaskDefinition(task.definition);
  const validation = validateConversationalTaskForPublish({
    definition,
    projectPolicy,
  });
  let toolDefinitions: Awaited<
    ReturnType<typeof resolveProjectTaskToolDefinitions>
  > = [];
  let toolIssue: string | null = null;
  try {
    toolDefinitions = await resolveProjectTaskToolDefinitions({
      definition,
      projectId: context.project.id,
    });
  } catch (error) {
    toolIssue =
      error instanceof Error ? error.message : "A bound tool is unavailable.";
  }
  const ready = validation.ready && !toolIssue;
  const issues = toolIssue
    ? [...validation.issues, toolIssue]
    : validation.issues;
  const latestVersion = versions[0];
  const currentSnapshot = toolIssue
    ? null
    : buildConversationalTaskSnapshot({
        assistantBehavior: normalizeProjectAiSettings(
          context.project.aiSettings,
        ),
        conversationPolicy: projectPolicy,
        task: {
          definition,
          description: task.description,
          id: task.id,
          name: task.name,
          objective: task.objective,
          schemaVersion: task.schemaVersion,
        },
        toolDefinitions,
      });
  const draftMatchesCurrent = Boolean(
    latestVersion &&
      currentSnapshot &&
      conversationalTaskSnapshotsMatch(currentSnapshot, latestVersion.snapshot),
  );
  const canPublish = ready && !draftMatchesCurrent;

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <Link
          href={`/projects/tasks/${task.id}`}
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to task
        </Link>
        <TaskConfigurationNav active="versions" taskId={task.id} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {ready ? (
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              ) : (
                <CircleAlert className="h-6 w-6 text-amber-600" />
              )}
              Publish
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Publishing creates an immutable version. Later changes stay in the
              draft until you publish again.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {query.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {query.error}
              </p>
            )}
            {query.published && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                Version {query.published} published.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-4">
              {[
                ["Fields", definition.fields.length],
                ["Context", definition.contextVariables.length],
                ["Tools", definition.tools.length],
                ["Outcomes", definition.outcomes.length],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border p-4">
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
            {draftMatchesCurrent ? (
              <p className="rounded-md bg-green-50 px-3 py-3 text-sm text-green-800">
                Draft matches the current published version. Make a change
                before publishing again.
              </p>
            ) : ready ? (
              <p className="rounded-md bg-green-50 px-3 py-3 text-sm text-green-800">
                Ready to publish. Fields, dependencies, tools, and outcomes are
                valid.
              </p>
            ) : (
              <div className="rounded-md bg-amber-50 px-4 py-3">
                <p className="font-medium text-amber-900">Needs attention</p>
                <ul className="mt-2 list-disc pl-5 text-sm text-amber-900">
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            <form action={publishConversationalTaskAction} data-preserve-scroll>
              <input
                type="hidden"
                name="projectId"
                value={context.project.id}
              />
              <input type="hidden" name="taskId" value={task.id} />
              <FormSubmitButton
                label={
                  draftMatchesCurrent
                    ? "Draft Already Published"
                    : "Publish New Version"
                }
                pendingLabel="Publishing..."
                disabled={!canPublish}
                icon={<Send className="h-4 w-4" />}
                confirmation={{
                  title: "Publish this task version?",
                  description:
                    "This creates an immutable version for new task runs.",
                  confirmLabel: "Publish Version",
                }}
              />
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <History className="h-5 w-5" />
              Version History
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Times shown in {context.company.timeZone}.
            </p>
          </CardHeader>
          <CardContent>
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No published versions yet.
              </p>
            ) : (
              <div className="divide-y rounded-md border">
                {versions.map((version, index) => (
                  <div
                    key={version.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium">
                        Version {version.versionNumber}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatDateTimeInTimeZone(
                          version.publishedAt,
                          context.company.timeZone,
                        )}
                      </p>
                    </div>
                    {index === 0 && (
                      <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs text-green-700">
                        Current
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
