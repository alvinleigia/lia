import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  MessagesSquare,
  Send,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TaskConfigurationNav } from "@/components/task-configuration-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { getConversationProjectPolicy } from "@/lib/conversation-project-policies";
import { conversationalTaskIdSchema } from "@/lib/conversational-task-schema";
import { validateConversationalTaskForPublish } from "@/lib/conversational-task-validation";
import {
  getProjectConversationalTask,
  listConversationalTaskVersions,
  readConversationalTaskDefinition,
} from "@/lib/conversational-tasks";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import { publishConversationalTaskAction } from "../../../actions";

type PageProps = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ error?: string; published?: string }>;
};

export default async function TaskReviewPage({
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
  if (!task) redirect("/projects/tasks?error=Task%20not%20found.");
  const definition = readConversationalTaskDefinition(task.definition);
  const validation = validateConversationalTaskForPublish({
    definition,
    projectPolicy,
  });

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
        <TaskConfigurationNav active="review" taskId={task.id} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {validation.ready ? (
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              ) : (
                <CircleAlert className="h-6 w-6 text-amber-600" />
              )}
              Review and Publish
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Publishing creates an immutable runtime snapshot. Later edits
              remain a draft until published again.
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
            {validation.ready ? (
              <p className="rounded-md bg-green-50 px-3 py-3 text-sm text-green-800">
                Ready to publish. Contracts, dependencies, and terminal outcomes
                are valid.
              </p>
            ) : (
              <div className="rounded-md bg-amber-50 px-4 py-3">
                <p className="font-medium text-amber-900">Publish blockers</p>
                <ul className="mt-2 list-disc pl-5 text-sm text-amber-900">
                  {validation.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            <form action={publishConversationalTaskAction}>
              <input
                type="hidden"
                name="projectId"
                value={context.project.id}
              />
              <input type="hidden" name="taskId" value={task.id} />
              <FormSubmitButton
                label="Publish New Version"
                pendingLabel="Publishing..."
                disabled={!validation.ready}
                icon={<Send className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <MessagesSquare className="h-5 w-5" />
              Structured Conversation Test
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Verify grounded answers and recommendation-only model decisions
              before they reach the durable task runtime.
            </p>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/projects/tasks/${task.id}/configure/review/turn`}>
                <MessagesSquare className="h-4 w-4" />
                Open Conversation Test
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Activity className="h-5 w-5" />
              Runtime Lifecycle Test
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Verify durable fields, corrections, pause and resume, side
              questions, task switching, and completion against a published
              version.
            </p>
          </CardHeader>
          <CardContent>
            {versions.length > 0 ? (
              <Button asChild>
                <Link
                  href={`/projects/tasks/${task.id}/configure/review/runtime`}
                >
                  <Activity className="h-4 w-4" />
                  Open Runtime Test
                </Link>
              </Button>
            ) : (
              <Button disabled>
                <Activity className="h-4 w-4" />
                Publish Before Testing
              </Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Version History</CardTitle>
          </CardHeader>
          <CardContent>
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No published versions yet.
              </p>
            ) : (
              <div className="divide-y rounded-md border">
                {versions.map((version) => (
                  <div key={version.id} className="px-4 py-3">
                    <p className="font-medium">
                      Version {version.versionNumber}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {version.publishedAt.toLocaleString()}
                    </p>
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
