import { ArchiveRestore, ListTodo, Plus } from "lucide-react";
import Link from "next/link";
import { NoProjectState } from "@/components/no-project-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { listProjectConversationalTasks } from "@/lib/conversational-tasks";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import { unarchiveConversationalTaskAction } from "./actions";

type TasksPageProps = {
  searchParams: Promise<{
    archived?: string;
    error?: string;
  }>;
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Tasks need a project" />;
  }

  const tasks = await listProjectConversationalTasks(context.project.id);
  const activeTasks = tasks.filter((task) => !task.isArchived);
  const archivedTasks = tasks.filter((task) => task.isArchived);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-5xl space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <ListTodo className="h-6 w-6" />
                  Conversational Tasks
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Define the business goals Lia should complete for{" "}
                  {context.project.name}.
                </p>
              </div>
              <Button asChild>
                <Link href="/projects/tasks/new">
                  <Plus className="h-4 w-4" />
                  New Task
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {params.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {params.error}
              </p>
            )}
            {params.archived && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                Task archived.
              </p>
            )}

            {activeTasks.length === 0 ? (
              <div className="rounded-md border bg-white p-6 text-center">
                <p className="font-medium">No conversational tasks yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Start with one clear business goal such as booking a service
                  or qualifying a lead.
                </p>
                <Button asChild className="mt-4">
                  <Link href="/projects/tasks/new">
                    <Plus className="h-4 w-4" />
                    Create First Task
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {activeTasks.map((task) => (
                  <Link
                    key={task.id}
                    href={`/projects/tasks/${task.id}`}
                    className="block rounded-md border bg-white px-4 py-3 hover:bg-accent/40"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium">{task.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {task.objective}
                        </p>
                      </div>
                      <Badge variant="secondary">Draft</Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {archivedTasks.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <ArchiveRestore className="h-5 w-5" />
                Archived Tasks
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {archivedTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex flex-col gap-3 rounded-md border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/projects/tasks/${task.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {task.name}
                    </Link>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {task.objective}
                    </p>
                  </div>
                  <form action={unarchiveConversationalTaskAction}>
                    <input
                      type="hidden"
                      name="projectId"
                      value={context.project.id}
                    />
                    <input type="hidden" name="taskId" value={task.id} />
                    <FormSubmitButton
                      variant="outline"
                      label="Restore"
                      pendingLabel="Restoring..."
                      icon={<ArchiveRestore className="h-4 w-4" />}
                    />
                  </form>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
