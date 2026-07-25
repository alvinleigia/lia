import { ArrowLeft, ListChecks, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TaskConfigurationNav } from "@/components/task-configuration-nav";
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
import { Textarea } from "@/components/ui/textarea";
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
                      {outcome.type} -&gt; {outcome.outputPort}
                    </p>
                    {outcome.condition && (
                      <p className="text-sm text-muted-foreground">
                        When: {outcome.condition}
                      </p>
                    )}
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
            <ActionStateForm
              action={addConversationalTaskOutcomeAction}
              resetKey={definition.outcomes
                .map((outcome) => outcome.id)
                .join(":")}
              className="grid gap-4 rounded-md border p-4 md:grid-cols-5"
            >
              <ActionFormError className="md:col-span-5" />
              <input
                type="hidden"
                name="projectId"
                value={context.project.id}
              />
              <input type="hidden" name="taskId" value={task.id} />
              <div className="space-y-2">
                <Label htmlFor="outcomeLabel">Outcome Name</Label>
                <Input
                  id="outcomeLabel"
                  name="label"
                  placeholder="Booked"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="outcomeKey">Outcome Key</Label>
                <Input
                  id="outcomeKey"
                  name="key"
                  placeholder="booked"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="outcomeType">Result Type</Label>
                <select id="outcomeType" name="type" className={selectClass}>
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="outcomeOutputPort">Output Port</Label>
                <Input
                  id="outcomeOutputPort"
                  name="outputPort"
                  placeholder="booked"
                  required
                />
              </div>
              <div className="flex items-end">
                <FormSubmitButton
                  className="w-full"
                  label="Add"
                  pendingLabel="Adding..."
                  icon={<Plus className="h-4 w-4" />}
                />
              </div>
              <div className="space-y-2 md:col-span-5">
                <Label htmlFor="outcomeCondition">
                  Completion Condition (optional)
                </Label>
                <Input
                  id="outcomeCondition"
                  name="condition"
                  placeholder="e.g. appointmentRequestId is present"
                />
              </div>
            </ActionStateForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Behavior and Safety</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionStateForm
              action={updateConversationalTaskSafetyAction}
              className="space-y-6"
            >
              <ActionFormError />
              <input
                type="hidden"
                name="projectId"
                value={context.project.id}
              />
              <input type="hidden" name="taskId" value={task.id} />
              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="taskLanguage">Task Language</Label>
                  <Input
                    id="taskLanguage"
                    name="language"
                    defaultValue={definition.taskPolicy.language}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="responseLength">Response Length</Label>
                  <select
                    id="responseLength"
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
                  <Label htmlFor="identityRequirement">Visitor Identity</Label>
                  <select
                    id="identityRequirement"
                    name="identityRequirement"
                    className={selectClass}
                    defaultValue={definition.taskPolicy.identityRequirement}
                  >
                    <option value="anonymous">Anonymous allowed</option>
                    <option value="verified_contact">
                      Verified contact required
                    </option>
                    <option value="authenticated_user">
                      Signed-in user required
                    </option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="consentRequirement">Task Consent</Label>
                  <select
                    id="consentRequirement"
                    name="consentRequirement"
                    className={selectClass}
                    defaultValue={definition.taskPolicy.consentRequirement}
                  >
                    <option value="inherit">Use project policy</option>
                    <option value="required">Always require consent</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="instructions">Task Instructions</Label>
                <Textarea
                  id="instructions"
                  name="instructions"
                  rows={3}
                  defaultValue={definition.taskPolicy.instructions ?? ""}
                  placeholder="Task-specific behavior and boundaries."
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fallbackMessage">Fallback Message</Label>
                  <Input
                    id="fallbackMessage"
                    name="fallbackMessage"
                    defaultValue={definition.taskPolicy.fallbackMessage ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="handoffMessage">Handoff Message</Label>
                  <Input
                    id="handoffMessage"
                    name="handoffMessage"
                    defaultValue={definition.taskPolicy.handoffMessage ?? ""}
                  />
                </div>
              </div>
              <Accordion type="multiple" className="rounded-md border px-4">
                <AccordionItem value="return">
                  <AccordionTrigger>Return behavior</AccordionTrigger>
                  <AccordionContent forceMount>
                    <div className="grid gap-4 md:grid-cols-5">
                      {(
                        [
                          ["completed", ["return_to_knowledge", "end"]],
                          ["cancelled", ["return_to_knowledge", "end"]],
                          ["failed", ["return_to_knowledge", "handoff", "end"]],
                          [
                            "noAnswer",
                            ["return_to_knowledge", "handoff", "end"],
                          ],
                          ["handoff", ["suspend", "end"]],
                        ] as const
                      ).map(([key, values]) => (
                        <div key={key} className="space-y-2">
                          <Label htmlFor={`return-${key}`}>
                            {key === "noAnswer" ? "No answer" : key}
                          </Label>
                          <select
                            id={`return-${key}`}
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
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="degraded">
                  <AccordionTrigger>
                    Unavailable-service behavior
                  </AccordionTrigger>
                  <AccordionContent forceMount>
                    <div className="grid gap-4 md:grid-cols-4">
                      {(
                        [
                          [
                            "model",
                            ["deterministic_fallback", "handoff", "fail"],
                          ],
                          ["retrieval", ["clarify", "handoff", "fail"]],
                          ["tool", ["retry", "handoff", "fail"]],
                          ["outboundChannel", ["retry", "fail"]],
                        ] as const
                      ).map(([key, values]) => (
                        <div key={key} className="space-y-2">
                          <Label htmlFor={`degraded-${key}`}>
                            {key === "outboundChannel"
                              ? "Outbound channel"
                              : key}
                          </Label>
                          <select
                            id={`degraded-${key}`}
                            name={key}
                            className={selectClass}
                            defaultValue={definition.degradedMode[key]}
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
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="data">
                  <AccordionTrigger>Project data handling</AccordionTrigger>
                  <AccordionContent forceMount className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="fieldRetentionDays">
                          Field Retention (days)
                        </Label>
                        <Input
                          id="fieldRetentionDays"
                          type="number"
                          min={1}
                          max={3650}
                          name="fieldRetentionDays"
                          defaultValue={
                            projectPolicy.dataHandling.fieldRetentionDays
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="messageRetentionDays">
                          Message Retention (days)
                        </Label>
                        <Input
                          id="messageRetentionDays"
                          type="number"
                          min={1}
                          max={3650}
                          name="messageRetentionDays"
                          defaultValue={
                            projectPolicy.dataHandling.messageRetentionDays
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="deletionMode">Deletion</Label>
                        <select
                          id="deletionMode"
                          name="deletionMode"
                          className={selectClass}
                          defaultValue={projectPolicy.dataHandling.deletionMode}
                        >
                          <option value="on_request">On request</option>
                          <option value="automatic">Automatic</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="sensitiveModelVisibility">
                          Sensitive Data in Model
                        </Label>
                        <select
                          id="sensitiveModelVisibility"
                          name="sensitiveModelVisibility"
                          className={selectClass}
                          defaultValue={
                            projectPolicy.dataHandling.sensitiveModelVisibility
                          }
                        >
                          <option value="denied">Denied</option>
                          <option value="task_only">Current task only</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="toolVisibility">
                          Sensitive Data in Tools
                        </Label>
                        <select
                          id="toolVisibility"
                          name="toolVisibility"
                          className={selectClass}
                          defaultValue={
                            projectPolicy.dataHandling.toolVisibility
                          }
                        >
                          <option value="binding_only">
                            Allowed bindings only
                          </option>
                          <option value="denied">Denied</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-6">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="consentRequired"
                          defaultChecked={
                            projectPolicy.dataHandling.consentRequired
                          }
                        />
                        Require consent for all project conversations
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="exportAllowed"
                          defaultChecked={
                            projectPolicy.dataHandling.exportAllowed
                          }
                        />
                        Allow data export
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Sensitive values are always redacted from logs.
                    </p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              <FormSubmitButton
                label="Save Policies"
                pendingLabel="Saving..."
                icon={<Save className="h-4 w-4" />}
              />
            </ActionStateForm>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
