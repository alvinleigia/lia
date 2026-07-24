import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bot,
  ListTodo,
  Save,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ConversationalTaskDetailsFields } from "@/components/conversational-task-details-fields";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormActionBar } from "@/components/ui/form-action-bar";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { conversationalTaskIdSchema } from "@/lib/conversational-task-schema";
import { getProjectConversationalTask } from "@/lib/conversational-tasks";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import {
  archiveConversationalTaskAction,
  unarchiveConversationalTaskAction,
  updateConversationalTaskAction,
} from "../actions";

type TaskDetailsPageProps = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{
    created?: string;
    error?: string;
    restored?: string;
    updated?: string;
  }>;
};

export default async function TaskDetailsPage({
  params,
  searchParams,
}: TaskDetailsPageProps) {
  const routeParams = await params;
  const query = await searchParams;
  const taskId = conversationalTaskIdSchema.safeParse(routeParams.taskId);
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);

  if (!taskId.success || !context) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  const task = await getProjectConversationalTask(
    context.project.id,
    taskId.data,
  );

  if (!task) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-4xl space-y-6">
        <Link
          href="/projects/tasks"
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to tasks
        </Link>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <ListTodo className="h-6 w-6" />
                  {task.name}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Conversational task for {context.project.name}
                </p>
              </div>
              <Badge variant={task.isArchived ? "outline" : "secondary"}>
                {task.isArchived ? "Archived" : "Draft"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {query.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {query.error}
              </p>
            )}
            {(query.created || query.updated || query.restored) && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                {query.created
                  ? "Task created."
                  : query.restored
                    ? "Task restored."
                    : "Changes saved."}
              </p>
            )}

            {!task.isArchived && (
              <form
                id="archive-task-form"
                action={archiveConversationalTaskAction}
              >
                <input
                  type="hidden"
                  name="projectId"
                  value={context.project.id}
                />
                <input type="hidden" name="taskId" value={task.id} />
              </form>
            )}

            <ActionStateForm
              action={updateConversationalTaskAction}
              className="space-y-5"
            >
              <ActionFormError />
              <input
                type="hidden"
                name="projectId"
                value={context.project.id}
              />
              <input type="hidden" name="taskId" value={task.id} />
              <fieldset disabled={task.isArchived}>
                <ConversationalTaskDetailsFields defaultValues={task} />
              </fieldset>
              {!task.isArchived && (
                <FormActionBar
                  primaryAction={
                    <FormSubmitButton
                      label="Save Changes"
                      pendingLabel="Saving..."
                      icon={<Save className="h-4 w-4" />}
                    />
                  }
                  secondaryActions={
                    <>
                      <Button variant="outline" asChild>
                        <Link
                          href={`/projects/tasks/${task.id}/configure/assistant`}
                        >
                          <Bot className="h-4 w-4" />
                          Configure Conversation
                        </Link>
                      </Button>
                      <Button
                        type="submit"
                        form="archive-task-form"
                        variant="outline"
                      >
                        <Archive className="h-4 w-4" />
                        Archive Task
                      </Button>
                    </>
                  }
                />
              )}
            </ActionStateForm>

            {task.isArchived && (
              <FormActionBar
                secondaryActions={
                  <form action={unarchiveConversationalTaskAction}>
                    <input
                      type="hidden"
                      name="projectId"
                      value={context.project.id}
                    />
                    <input type="hidden" name="taskId" value={task.id} />
                    <FormSubmitButton
                      label="Restore Task"
                      pendingLabel="Restoring..."
                      icon={<ArchiveRestore className="h-4 w-4" />}
                    />
                  </form>
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
