import { ArrowLeft, Braces, Plus, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FIELD_TYPES } from "@/lib/conversation-contracts";
import { conversationalTaskIdSchema } from "@/lib/conversational-task-schema";
import {
  getProjectConversationalTask,
  readConversationalTaskDefinition,
} from "@/lib/conversational-tasks";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import {
  addConversationalTaskFieldAction,
  addTaskContextVariableAction,
  applyReferenceBookingTaskAction,
  removeConversationalTaskFieldAction,
  removeTaskContextVariableAction,
} from "../../../actions";

type PageProps = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ error?: string }>;
};

const selectClass = "h-9 w-full rounded-md border bg-white px-3 text-sm";

export default async function TaskFieldsPage({
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
  const task = await getProjectConversationalTask(
    context.project.id,
    route.data,
  );
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
        <TaskConfigurationNav active="fields" taskId={task.id} />
        {query.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {query.error}
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Braces className="h-6 w-6" />
              Task Fields
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Information Lia must collect and validate to complete this task.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {definition.fields.length === 0 ? (
              <div className="flex flex-col gap-3 rounded-md border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  No fields configured yet.
                </p>
                <form action={applyReferenceBookingTaskAction}>
                  <input
                    type="hidden"
                    name="projectId"
                    value={context.project.id}
                  />
                  <input type="hidden" name="taskId" value={task.id} />
                  <Button type="submit" variant="outline">
                    Apply Booking Starter
                  </Button>
                </form>
              </div>
            ) : (
              <div className="divide-y rounded-md border">
                {definition.fields.map((field) => (
                  <div
                    key={field.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium">{field.label}</p>
                      <p className="text-sm text-muted-foreground">
                        {field.key} · {field.type}
                        {field.required ? " · required" : ""}
                      </p>
                    </div>
                    <form action={removeConversationalTaskFieldAction}>
                      <input
                        type="hidden"
                        name="projectId"
                        value={context.project.id}
                      />
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="fieldId" value={field.id} />
                      <Button type="submit" size="icon" variant="ghost">
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Remove {field.label}</span>
                      </Button>
                    </form>
                  </div>
                ))}
              </div>
            )}

            <ActionStateForm
              action={addConversationalTaskFieldAction}
              className="space-y-4 rounded-md border p-4"
            >
              <h3 className="font-semibold">Add Field</h3>
              <ActionFormError />
              <input
                type="hidden"
                name="projectId"
                value={context.project.id}
              />
              <input type="hidden" name="taskId" value={task.id} />
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="label">Visitor Label</Label>
                  <Input
                    id="label"
                    name="label"
                    placeholder="Guest Email"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="key">Field Key</Label>
                  <Input
                    id="key"
                    name="key"
                    placeholder="guestEmail"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <select id="type" name="type" className={selectClass}>
                    {FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="sensitivity">Sensitivity</Label>
                  <select
                    id="sensitivity"
                    name="sensitivity"
                    className={selectClass}
                    defaultValue="standard"
                  >
                    <option value="standard">Standard</option>
                    <option value="personal">Personal</option>
                    <option value="sensitive">Sensitive</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmation">Confirmation</Label>
                  <select
                    id="confirmation"
                    name="confirmation"
                    className={selectClass}
                    defaultValue="when_changed"
                  >
                    <option value="never">Never</option>
                    <option value="when_changed">When changed</option>
                    <option value="always">Always</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dependsOn">Depends On</Label>
                  <Input
                    id="dependsOn"
                    name="dependsOn"
                    placeholder="serviceCategoryId"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="validation">Validation Rule</Label>
                  <Input
                    id="validation"
                    name="validation"
                    placeholder="Optional business rule"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="normalization">Normalization</Label>
                  <Input
                    id="normalization"
                    name="normalization"
                    placeholder="e.g. E.164"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" name="required" defaultChecked />
                Required
              </label>
              <FormSubmitButton
                label="Add Field"
                pendingLabel="Adding..."
                icon={<Plus className="h-4 w-4" />}
              />
            </ActionStateForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Trusted Context</CardTitle>
            <p className="text-sm text-muted-foreground">
              Server-provided values kept separate from visitor answers. The
              lia_ prefix is reserved for system context.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {definition.contextVariables.length > 0 && (
              <div className="divide-y rounded-md border">
                {definition.contextVariables.map((variable) => (
                  <div
                    key={variable.key}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium">{variable.key}</p>
                      <p className="text-sm text-muted-foreground">
                        {variable.source} · {variable.type}
                      </p>
                    </div>
                    <form action={removeTaskContextVariableAction}>
                      <input
                        type="hidden"
                        name="projectId"
                        value={context.project.id}
                      />
                      <input type="hidden" name="taskId" value={task.id} />
                      <input
                        type="hidden"
                        name="contextKey"
                        value={variable.key}
                      />
                      <Button type="submit" size="icon" variant="ghost">
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Remove {variable.key}</span>
                      </Button>
                    </form>
                  </div>
                ))}
              </div>
            )}
            <ActionStateForm
              action={addTaskContextVariableAction}
              className="space-y-4 rounded-md border p-4"
            >
              <h3 className="font-semibold">Add Context Variable</h3>
              <ActionFormError />
              <input
                type="hidden"
                name="projectId"
                value={context.project.id}
              />
              <input type="hidden" name="taskId" value={task.id} />
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="contextKey">Key</Label>
                  <Input
                    id="contextKey"
                    name="contextKey"
                    placeholder="lia_timezone"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contextSource">Source</Label>
                  <select
                    id="contextSource"
                    name="contextSource"
                    className={selectClass}
                  >
                    {[
                      "system",
                      "tenant",
                      "project",
                      "contact",
                      "channel",
                      "webhook",
                      "default",
                    ].map((source) => (
                      <option key={source} value={source}>
                        {source}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contextType">Type</Label>
                  <select
                    id="contextType"
                    name="contextType"
                    className={selectClass}
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <input type="hidden" name="contextSensitivity" value="standard" />
              <input type="hidden" name="modelVisible" value="on" />
              <input type="hidden" name="toolVisible" value="on" />
              <FormSubmitButton
                label="Add Context"
                pendingLabel="Adding..."
                icon={<Plus className="h-4 w-4" />}
              />
            </ActionStateForm>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
