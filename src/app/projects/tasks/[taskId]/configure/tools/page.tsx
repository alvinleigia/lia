import {
  ArrowLeft,
  CircleCheck,
  Plus,
  Settings,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TaskConfigurationNav } from "@/components/task-configuration-nav";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmSubmitButton } from "@/components/ui/confirm-action-button";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Label } from "@/components/ui/label";
import { conversationalTaskIdSchema } from "@/lib/conversational-task-schema";
import {
  getMissingTaskToolSourceKeys,
  listProjectTaskToolOptions,
  resolveProjectTaskToolDefinition,
} from "@/lib/conversational-task-tools";
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

const stageLabels = {
  extraction: "While understanding answers",
  lookup: "While checking business data",
  confirmation: "Before final confirmation",
  operation: "When completing the task",
} as const;

function toolReference(id: string, version: number) {
  return `${id}@${version}`;
}

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
  const toolAvailability = await Promise.all(
    toolOptions.map(async (option) => {
      const toolDefinition = await resolveProjectTaskToolDefinition({
        definition,
        projectId: context.project.id,
        toolId: option.id,
        version: option.version,
      });
      const missingSourceKeys = toolDefinition
        ? getMissingTaskToolSourceKeys({
            definition,
            toolDefinition,
          })
        : [];
      return {
        missingSourceKeys,
        option,
        ready: Boolean(toolDefinition) && missingSourceKeys.length === 0,
      };
    }),
  );
  const availabilityByReference = new Map(
    toolAvailability.map((availability) => [
      toolReference(availability.option.id, availability.option.version),
      availability,
    ]),
  );
  const availableTools = toolAvailability.filter(
    ({ option }) =>
      !definition.tools.some((binding) => binding.tool.id === option.id),
  );
  const hasReadyAvailableTool = availableTools.some(({ ready }) => ready);

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
          <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <CardTitle className="flex items-center gap-2 text-2xl">
                <ShieldCheck className="h-6 w-6" />
                Tools and Permissions
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Tools remain off until you allow them for this task.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/projects/operations">
                <Settings className="h-4 w-4" />
                Manage Tool Library
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            {query.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {query.error}
              </p>
            )}
            <section className="space-y-3">
              <div>
                <h3 className="font-semibold">Tool Library</h3>
                <p className="text-sm text-muted-foreground">
                  Ready tools can be allowed below. Setup stays in the shared
                  project library.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {toolAvailability.map(
                  ({ missingSourceKeys, option, ready }) => {
                    const missingLabels = missingSourceKeys.map(
                      (key) =>
                        definition.fields.find((field) => field.key === key)
                          ?.label ??
                        definition.contextVariables.find(
                          (variable) => variable.key === key,
                        )?.key ??
                        key,
                    );
                    return (
                      <div
                        key={toolReference(option.id, option.version)}
                        className="space-y-2 rounded-md border p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{option.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {option.description}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              ready
                                ? "border-green-200 bg-green-50 text-green-700"
                                : "border-amber-200 bg-amber-50 text-amber-800"
                            }
                          >
                            {ready ? (
                              <CircleCheck className="h-3 w-3" />
                            ) : (
                              <TriangleAlert className="h-3 w-3" />
                            )}
                            {ready ? "Ready" : "Needs setup"}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">
                            {option.access === "read"
                              ? "Read only"
                              : "Can take action"}
                          </Badge>
                          <Badge variant="outline">
                            Version {option.version}
                          </Badge>
                        </div>
                        {!ready && (
                          <p className="text-xs text-amber-800">
                            {missingLabels.length > 0
                              ? `Add these task fields first: ${missingLabels.join(", ")}.`
                              : "This tool version is no longer available."}
                          </p>
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            </section>
            <section className="space-y-3">
              <h3 className="font-semibold">Allowed for This Task</h3>
              {definition.tools.length === 0 ? (
                <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
                  No tools are allowed for this task.
                </p>
              ) : (
                <div className="divide-y rounded-md border">
                  {definition.tools.map((binding) => (
                    <div
                      key={toolReference(binding.tool.id, binding.tool.version)}
                      className="flex items-center justify-between gap-4 px-4 py-3"
                    >
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">
                            {availabilityByReference.get(
                              toolReference(
                                binding.tool.id,
                                binding.tool.version,
                              ),
                            )?.option.name ?? binding.tool.id}
                          </p>
                          <Badge variant="secondary">
                            {binding.access === "read"
                              ? "Read only"
                              : "Can take action"}
                          </Badge>
                          <Badge variant="outline">
                            Version {binding.tool.version}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Available{" "}
                          {binding.allowedStages
                            .map((stage) => stageLabels[stage])
                            .join(", ")
                            .toLocaleLowerCase()}
                          .
                        </p>
                      </div>
                      <form
                        action={unbindConversationalTaskToolAction}
                        data-preserve-scroll
                      >
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
                        <ConfirmSubmitButton
                          size="icon"
                          variant="ghost"
                          confirmation={{
                            title: "Remove this allowed tool?",
                            description:
                              "The task will no longer be able to use this tool in new published versions.",
                            confirmLabel: "Remove Tool",
                            confirmVariant: "destructive",
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">
                            Remove {binding.tool.id}
                          </span>
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  ))}
                </div>
              )}
            </section>
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
                <div className="space-y-2">
                  <Label htmlFor="toolRef">Tool</Label>
                  <select
                    id="toolRef"
                    name="toolRef"
                    className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                    defaultValue=""
                    required
                  >
                    <option value="" disabled>
                      Choose a ready tool
                    </option>
                    {availableTools.map(({ option, ready }) => (
                      <option
                        key={toolReference(option.id, option.version)}
                        value={toolReference(option.id, option.version)}
                        disabled={!ready}
                      >
                        {option.name} - {ready ? "Ready" : "Needs setup"}
                      </option>
                    ))}
                  </select>
                </div>
                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">
                    When Lia May Use It
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(stageLabels).map(([stage, label]) => (
                      <label
                        key={stage}
                        className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          name={`stage_${stage}`}
                          defaultChecked={stage === "operation"}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {!hasReadyAvailableTool && (
                  <p className="text-sm text-amber-800">
                    Complete the setup shown in the Tool Library before allowing
                    another tool.
                  </p>
                )}
                <FormSubmitButton
                  label="Allow Tool"
                  pendingLabel="Allowing..."
                  icon={<Plus className="h-4 w-4" />}
                  disabled={!hasReadyAvailableTool}
                />
              </ActionStateForm>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
