import { ArrowLeft, ListChecks, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TaskConfigurationNav } from "@/components/task-configuration-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getConversationProjectPolicy } from "@/lib/conversation-project-policies";
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
  addConversationalTaskOutcomeAction,
  removeConversationalTaskOutcomeAction,
  updateConversationalTaskSafetyAction,
} from "../../../actions";

type PageProps = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
};
const selectClass = "h-9 w-full rounded-md border bg-white px-3 text-sm";

export default async function TaskOutcomesPage({
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
  const [task, projectPolicy] = await Promise.all([
    getProjectConversationalTask(context.project.id, route.data),
    getConversationProjectPolicy(context.project.id),
  ]);
  if (!task) redirect("/projects/tasks?error=Task%20not%20found.");
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
        <TaskConfigurationNav active="outcomes" taskId={task.id} />
        {query.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {query.error}
          </p>
        )}
        {query.saved && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            Policies saved.
          </p>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <ListChecks className="h-6 w-6" />
              Named Outcomes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="divide-y rounded-md border">
              {definition.outcomes.map((outcome) => (
                <div
                  key={outcome.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div>
                    <p className="font-medium">{outcome.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {outcome.type} → {outcome.outputPort}
                    </p>
                  </div>
                  <form action={removeConversationalTaskOutcomeAction}>
                    <input
                      type="hidden"
                      name="projectId"
                      value={context.project.id}
                    />
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="outcomeId" value={outcome.id} />
                    <Button type="submit" size="icon" variant="ghost">
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Remove {outcome.label}</span>
                    </Button>
                  </form>
                </div>
              ))}
            </div>
            <form
              action={addConversationalTaskOutcomeAction}
              className="grid gap-4 rounded-md border p-4 md:grid-cols-5"
            >
              <input
                type="hidden"
                name="projectId"
                value={context.project.id}
              />
              <input type="hidden" name="taskId" value={task.id} />
              <Input name="label" placeholder="Booked" required />
              <Input name="key" placeholder="booked" required />
              <select name="type" className={selectClass}>
                {[
                  "completed",
                  "cancelled",
                  "failed",
                  "no_answer",
                  "handoff",
                ].map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              <Input name="outputPort" placeholder="booked" required />
              <FormSubmitButton
                label="Add"
                pendingLabel="Adding..."
                icon={<Plus className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Behavior and Safety</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={updateConversationalTaskSafetyAction}
              className="space-y-6"
            >
              <input
                type="hidden"
                name="projectId"
                value={context.project.id}
              />
              <input type="hidden" name="taskId" value={task.id} />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Task Language</Label>
                  <Input
                    name="language"
                    defaultValue={definition.taskPolicy.language}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Response Length</Label>
                  <select
                    name="responseLength"
                    className={selectClass}
                    defaultValue={definition.taskPolicy.responseLength}
                  >
                    <option value="short">Short</option>
                    <option value="balanced">Balanced</option>
                    <option value="detailed">Detailed</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Fallback Message</Label>
                  <Input
                    name="fallbackMessage"
                    defaultValue={definition.taskPolicy.fallbackMessage ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Handoff Message</Label>
                  <Input
                    name="handoffMessage"
                    defaultValue={definition.taskPolicy.handoffMessage ?? ""}
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-5">
                {(
                  [
                    ["completed", ["return_to_knowledge", "end"]],
                    ["cancelled", ["return_to_knowledge", "end"]],
                    ["failed", ["return_to_knowledge", "handoff", "end"]],
                    ["noAnswer", ["return_to_knowledge", "handoff", "end"]],
                    ["handoff", ["suspend", "end"]],
                  ] as const
                ).map(([key, values]) => (
                  <div key={key} className="space-y-2">
                    <Label>{key}</Label>
                    <select
                      name={key}
                      className={selectClass}
                      defaultValue={definition.returnPolicy[key]}
                    >
                      {values.map((value) => (
                        <option key={value} value={value}>
                          {value.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <input
                  type="hidden"
                  name="model"
                  value={definition.degradedMode.model}
                />
                <input
                  type="hidden"
                  name="retrieval"
                  value={definition.degradedMode.retrieval}
                />
                <input
                  type="hidden"
                  name="tool"
                  value={definition.degradedMode.tool}
                />
                <input
                  type="hidden"
                  name="outboundChannel"
                  value={definition.degradedMode.outboundChannel}
                />
                <div className="space-y-2">
                  <Label>Field Retention (days)</Label>
                  <Input
                    type="number"
                    name="fieldRetentionDays"
                    defaultValue={projectPolicy.dataHandling.fieldRetentionDays}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Message Retention (days)</Label>
                  <Input
                    type="number"
                    name="messageRetentionDays"
                    defaultValue={
                      projectPolicy.dataHandling.messageRetentionDays
                    }
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="consentRequired"
                    defaultChecked={projectPolicy.dataHandling.consentRequired}
                  />
                  Consent required
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="exportAllowed"
                    defaultChecked={projectPolicy.dataHandling.exportAllowed}
                  />
                  Export allowed
                </label>
              </div>
              <FormSubmitButton
                label="Save Policies"
                pendingLabel="Saving..."
                icon={<Save className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
