import { ArrowLeft, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StructuredTurnTest } from "@/components/structured-turn-test";
import { TaskConfigurationNav } from "@/components/task-configuration-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listLatestPublishedTurnTasks } from "@/lib/conversation-turn-project";
import { conversationalTaskIdSchema } from "@/lib/conversational-task-schema";
import { getProjectConversationalTask } from "@/lib/conversational-tasks";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";

type PageProps = {
  params: Promise<{ taskId: string }>;
};

export default async function StructuredTurnTestPage({ params }: PageProps) {
  const route = conversationalTaskIdSchema.safeParse((await params).taskId);
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);
  if (!route.success || !context) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  const [task, publishedTasks] = await Promise.all([
    getProjectConversationalTask(context.project.id, route.data),
    listLatestPublishedTurnTasks(context.project.id),
  ]);
  if (!task) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  const taskOptions = publishedTasks.map(({ taskId, name, versionNumber }) => ({
    id: taskId,
    name,
    versionNumber,
  }));
  const defaultTaskId = taskOptions.some(({ id }) => id === task.id)
    ? task.id
    : null;

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
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <MessagesSquare className="h-6 w-6" />
              Structured Conversation Test
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Test grounded answers and validated recommendations without
              changing task runtime data.
            </p>
          </CardHeader>
          <CardContent>
            <StructuredTurnTest
              defaultTaskId={defaultTaskId}
              projectId={context.project.id}
              tasks={taskOptions}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
