import { ArrowLeft, Braces, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TaskConfigurationNav } from "@/components/task-configuration-nav";
import { TaskContextVariableRow } from "@/components/task-context-variable-row";
import { TaskFieldCard } from "@/components/task-field-card";
import { TaskFieldFormFields } from "@/components/task-field-form-fields";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listProjectReusableActionFields } from "@/lib/action-flows";
import { evaluateContextVariableRemoval } from "@/lib/context-variable-dependencies";
import {
  CUSTOM_CONTEXT_SOURCES,
  FIELD_TYPES,
} from "@/lib/conversation-contracts";
import { taskFieldNeedsSetup } from "@/lib/conversational-task-builder";
import { conversationalTaskIdSchema } from "@/lib/conversational-task-schema";
import {
  getProjectConversationalTask,
  readConversationalTaskDefinition,
} from "@/lib/conversational-tasks";
import { listProjectMediaAssets } from "@/lib/media-assets";
import {
  listProjectCatalogProducts,
  listProjectCatalogs,
} from "@/lib/product-catalogs";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import {
  addConversationalTaskFieldAction,
  addReusableConversationalTaskFieldAction,
  addTaskContextVariableAction,
  applyReferenceBookingTaskAction,
  duplicateConversationalTaskFieldAction,
  moveConversationalTaskFieldAction,
  removeConversationalTaskFieldAction,
  removeTaskContextVariableAction,
  updateConversationalTaskFieldAction,
  updateTaskContextVariableAction,
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
  const [task, catalogs, productRows, mediaAssets, reusableFields] =
    await Promise.all([
      getProjectConversationalTask(context.project.id, route.data),
      listProjectCatalogs(context.project.id),
      listProjectCatalogProducts(context.project.id),
      listProjectMediaAssets(context.project.id),
      listProjectReusableActionFields(context.project.id),
    ]);
  if (!task) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }
  const definition = readConversationalTaskDefinition(task.definition);
  const resources = {
    catalogIds: new Set(catalogs.map((catalog) => catalog.id)),
    catalogCount: catalogs.length,
    mediaCount: mediaAssets.length,
    productCatalogIds: new Set(
      productRows.map(({ product }) => product.catalogId),
    ),
    productCount: productRows.length,
  };
  const reusableChoices = reusableFields.filter(
    (candidate) =>
      !definition.fields.some((field) => field.key === candidate.fieldKey),
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
        <TaskConfigurationNav active="context" taskId={task.id} />
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
                <form
                  action={applyReferenceBookingTaskAction}
                  data-preserve-scroll
                >
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
                {definition.fields.map((field, index) => (
                  <TaskFieldCard
                    key={field.id}
                    catalogs={catalogs}
                    duplicateAction={duplicateConversationalTaskFieldAction}
                    field={field}
                    fields={definition.fields}
                    index={index}
                    moveAction={moveConversationalTaskFieldAction}
                    needsSetup={taskFieldNeedsSetup(field, resources)}
                    projectId={context.project.id}
                    removeAction={removeConversationalTaskFieldAction}
                    taskId={task.id}
                    updateAction={updateConversationalTaskFieldAction}
                  />
                ))}
              </div>
            )}

            <ActionStateForm
              action={addConversationalTaskFieldAction}
              resetKey={definition.fields.map((field) => field.id).join(":")}
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
              <TaskFieldFormFields
                catalogs={catalogs}
                fields={definition.fields}
                idPrefix="add-task-field"
              />
              <FormSubmitButton
                label="Add Field"
                pendingLabel="Adding..."
                icon={<Plus className="h-4 w-4" />}
              />
            </ActionStateForm>

            {reusableChoices.length > 0 && (
              <ActionStateForm
                action={addReusableConversationalTaskFieldAction}
                resetKey={definition.fields.map((field) => field.key).join(":")}
                className="space-y-4 rounded-md border p-4"
              >
                <h3 className="font-semibold">Reuse an Automation Field</h3>
                <ActionFormError />
                <input
                  type="hidden"
                  name="projectId"
                  value={context.project.id}
                />
                <input type="hidden" name="taskId" value={task.id} />
                <div className="space-y-2">
                  <Label htmlFor="reusableFieldKey">Existing Field</Label>
                  <select
                    id="reusableFieldKey"
                    name="reusableFieldKey"
                    className={selectClass}
                    required
                  >
                    <option value="">Choose a field</option>
                    {reusableChoices.map((field) => (
                      <option key={field.fieldKey} value={field.fieldKey}>
                        {field.labels[0] || field.fieldKey} -{" "}
                        {field.actions.map((action) => action.name).join(", ")}
                      </option>
                    ))}
                  </select>
                </div>
                <FormSubmitButton
                  label="Reuse Field"
                  pendingLabel="Adding..."
                  icon={<Plus className="h-4 w-4" />}
                />
              </ActionStateForm>
            )}
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
                {definition.contextVariables.map((variable) => {
                  const removal = evaluateContextVariableRemoval(
                    definition,
                    variable.key,
                  );

                  return (
                    <TaskContextVariableRow
                      key={`${variable.key}:${variable.source}:${variable.type}`}
                      projectId={context.project.id}
                      taskId={task.id}
                      variable={variable}
                      removal={removal}
                      updateAction={updateTaskContextVariableAction}
                      removeAction={removeTaskContextVariableAction}
                    />
                  );
                })}
              </div>
            )}
            <ActionStateForm
              action={addTaskContextVariableAction}
              resetKey={definition.contextVariables
                .map((variable) => variable.key)
                .join(":")}
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
                    {CUSTOM_CONTEXT_SOURCES.map((source) => (
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
              <Accordion
                type="single"
                collapsible
                className="rounded-md border px-4"
              >
                <AccordionItem value="advanced">
                  <AccordionTrigger>
                    Default, privacy, and expiry
                  </AccordionTrigger>
                  <AccordionContent forceMount className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="defaultValue">Default Value</Label>
                        <Input
                          id="defaultValue"
                          name="defaultValue"
                          placeholder="Optional fallback"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="contextSensitivity">Sensitivity</Label>
                        <select
                          id="contextSensitivity"
                          name="contextSensitivity"
                          className={selectClass}
                          defaultValue="standard"
                        >
                          <option value="standard">Standard</option>
                          <option value="personal">Personal</option>
                          <option value="sensitive">Sensitive</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="expiresAfterMinutes">
                          Expires After (minutes)
                        </Label>
                        <Input
                          id="expiresAfterMinutes"
                          name="expiresAfterMinutes"
                          type="number"
                          min={1}
                          placeholder="No expiry"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-6">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          name="modelVisible"
                          defaultChecked
                        />
                        Visible to the assistant
                      </label>
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          name="toolVisible"
                          defaultChecked
                        />
                        Visible to allowed tools
                      </label>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
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
