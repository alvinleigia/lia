import { Activity, ArrowLeft, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TaskChannelPreview } from "@/components/task-channel-preview";
import { TaskConfigurationNav } from "@/components/task-configuration-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { conversationalTaskIdSchema } from "@/lib/conversational-task-schema";
import {
  getProjectConversationalTask,
  listConversationalTaskVersions,
  readConversationalTaskDefinition,
} from "@/lib/conversational-tasks";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";

type PageProps = {
  params: Promise<{ taskId: string }>;
};

export default async function TaskTestPage({ params }: PageProps) {
  const route = conversationalTaskIdSchema.safeParse((await params).taskId);
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);
  if (!route.success || !context) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  const [task, versions] = await Promise.all([
    getProjectConversationalTask(context.project.id, route.data),
    listConversationalTaskVersions(context.project.id, route.data),
  ]);
  if (!task) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }
  const definition = readConversationalTaskDefinition(task.definition);

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
        <TaskConfigurationNav active="test" taskId={task.id} />

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Channel Preview</CardTitle>
            <p className="text-sm text-muted-foreground">
              Preview the same channel-independent task on each supported
              conversation surface.
            </p>
          </CardHeader>
          <CardContent>
            <TaskChannelPreview definition={definition} />
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <MessagesSquare className="h-5 w-5" />
                Conversation Test
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Test answers, task recommendations, and safe model proposals
                without changing live runtime data.
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
                Runtime Test
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Test fields, corrections, lookups, confirmation, and completion
                against a published version.
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
                <Button asChild variant="outline">
                  <Link href={`/projects/tasks/${task.id}/configure/versions`}>
                    Publish Before Testing
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
