import { ArrowLeft, Plus, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TaskConfigurationNav } from "@/components/task-configuration-nav";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Label } from "@/components/ui/label";
import { conversationalTaskIdSchema } from "@/lib/conversational-task-schema";
import { listProjectTaskToolOptions } from "@/lib/conversational-task-tools";
import {
  getProjectConversationalTask,
  readConversationalTaskDefinition,
} from "@/lib/conversational-tasks";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import {
  bindConversationalTaskToolAction,
  unbindConversationalTaskToolAction,
} from "../../../actions";

type PageProps = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function TaskToolsPage({
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
  const [task, toolOptions] = await Promise.all([
    getProjectConversationalTask(context.project.id, route.data),
    listProjectTaskToolOptions(context.project.id),
  ]);
  if (!task) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }
  const definition = readConversationalTaskDefinition(task.definition);
  const toolOptionsById = new Map(toolOptions.map((tool) => [tool.id, tool]));
  const availableTools = toolOptions.filter(
    (tool) => !definition.tools.some((binding) => binding.tool.id === tool.id),
  );

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
        <TaskConfigurationNav active="tools" taskId={task.id} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <ShieldCheck className="h-6 w-6" />
              Tools and Permissions
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Tools are denied until explicitly bound. Provider credentials
              remain in Operations and are never copied into the task.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {query.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {query.error}
              </p>
            )}
            {definition.tools.length === 0 ? (
              <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
                No tools are allowed for this task.
              </p>
            ) : (
              <div className="divide-y rounded-md border">
                {definition.tools.map((binding) => (
                  <div
                    key={binding.tool.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium">
                        {toolOptionsById.get(binding.tool.id)?.name ??
                          binding.tool.id}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {binding.access === "read"
                          ? "Read data"
                          : "Take action"}{" "}
                        / {binding.allowedStages.join(", ")} / v
                        {binding.tool.version}
                      </p>
                      {toolOptionsById.get(binding.tool.id)?.description && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {toolOptionsById.get(binding.tool.id)?.description}
                        </p>
                      )}
                    </div>
                    <form action={unbindConversationalTaskToolAction}>
                      <input
                        type="hidden"
                        name="projectId"
                        value={context.project.id}
                      />
                      <input type="hidden" name="taskId" value={task.id} />
                      <input
                        type="hidden"
                        name="toolId"
                        value={binding.tool.id}
                      />
                      <Button type="submit" size="icon" variant="ghost">
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">
                          Remove {binding.tool.id}
                        </span>
                      </Button>
                    </form>
                  </div>
                ))}
              </div>
            )}
            {availableTools.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                All available project tools are already allowed.
              </p>
            ) : (
              <ActionStateForm
                action={bindConversationalTaskToolAction}
                resetKey={definition.tools
                  .map(({ tool }) => `${tool.id}@${tool.version}`)
                  .join(":")}
                className="space-y-4 rounded-md border p-4"
              >
                <h3 className="font-semibold">Allow a Tool</h3>
                <ActionFormError />
                <input
                  type="hidden"
                  name="projectId"
                  value={context.project.id}
                />
                <input type="hidden" name="taskId" value={task.id} />
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="toolId">Tool</Label>
                    <select
                      id="toolId"
                      name="toolId"
                      className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                    >
                      {availableTools.map((tool) => (
                        <option key={tool.id} value={tool.id}>
                          {tool.name} ({tool.access})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Permission</Label>
                    <p className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                      Set by the versioned tool definition
                    </p>
                  </div>
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">
                    Allowed Stages
                  </legend>
                  <div className="flex flex-wrap gap-4">
                    {["extraction", "lookup", "confirmation", "operation"].map(
                      (stage) => (
                        <label
                          key={stage}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            name={`stage_${stage}`}
                            defaultChecked={stage === "operation"}
                          />
                          {stage}
                        </label>
                      ),
                    )}
                  </div>
                </fieldset>
                <FormSubmitButton
                  label="Allow Tool"
                  pendingLabel="Binding..."
                  icon={<Plus className="h-4 w-4" />}
                />
              </ActionStateForm>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
