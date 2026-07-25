import { ArrowLeft, Bot, Save } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TURN_MODEL_STAGES } from "@/lib/conversation-contracts";
import { getConversationProjectPolicy } from "@/lib/conversation-project-policies";
import { conversationalTaskIdSchema } from "@/lib/conversational-task-schema";
import { getProjectConversationalTask } from "@/lib/conversational-tasks";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import { updateConversationProjectPolicyAction } from "../../../actions";

type PageProps = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
};

const selectClass = "h-9 w-full rounded-md border bg-white px-3 text-sm";
const stageLabels: Record<(typeof TURN_MODEL_STAGES)[number], string> = {
  knowledge: "Knowledge answers",
  extraction: "Field extraction",
  clarification: "Clarification",
  lookup: "Data lookup",
  confirmation: "Confirmation",
  operation: "Tool operation",
  routing: "Task routing",
};

export default async function AssistantPolicyPage({
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

  const [task, policy] = await Promise.all([
    getProjectConversationalTask(context.project.id, route.data),
    getConversationProjectPolicy(context.project.id),
  ]);
  if (!task) {
    redirect("/projects/tasks?error=Task%20not%20found.");
  }
  const stageOverrides = new Map(
    policy.assistant.modelPolicy.stageOverrides.map((override) => [
      override.stage,
      override,
    ]),
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
        <TaskConfigurationNav active="assistant" taskId={task.id} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Bot className="h-6 w-6" />
              Assistant and Entry Policy
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Shared project behavior for knowledge answers and conversational
              tasks. Task-specific fields and tools remain separate.
            </p>
          </CardHeader>
          <CardContent>
            {query.error && (
              <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {query.error}
              </p>
            )}
            {query.saved && (
              <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                Conversation policy saved.
              </p>
            )}
            <ActionStateForm
              action={updateConversationProjectPolicyAction}
              className="space-y-6"
            >
              <ActionFormError />
              <input
                type="hidden"
                name="projectId"
                value={context.project.id}
              />
              <input type="hidden" name="taskId" value={task.id} />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="greetingStrategy">Greeting</Label>
                  <select
                    id="greetingStrategy"
                    name="greetingStrategy"
                    defaultValue={policy.assistant.greetingStrategy}
                    className={selectClass}
                  >
                    <option value="wait">Wait for visitor</option>
                    <option value="exact">Use exact greeting</option>
                    <option value="generated">Generate from policy</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="language">Default Language</Label>
                  <Input
                    id="language"
                    name="language"
                    defaultValue={policy.assistant.language}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="greeting">Greeting Text</Label>
                <Input
                  id="greeting"
                  name="greeting"
                  defaultValue={policy.assistant.greeting ?? ""}
                  placeholder="Welcome. How can I help?"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="baseInstructions">Shared Instructions</Label>
                <Textarea
                  id="baseInstructions"
                  name="baseInstructions"
                  defaultValue={policy.assistant.baseInstructions ?? ""}
                  rows={4}
                  placeholder="Project-wide behavior and constraints."
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="entryMode">Conversation Entry</Label>
                  <select
                    id="entryMode"
                    name="entryMode"
                    defaultValue={policy.entry.mode}
                    className={selectClass}
                  >
                    <option value="knowledge_first">Knowledge first</option>
                    <option value="task_first">Task first</option>
                    <option value="deterministic">Configured flow first</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="noAnswerBehavior">
                    When no answer exists
                  </Label>
                  <select
                    id="noAnswerBehavior"
                    name="noAnswerBehavior"
                    defaultValue={policy.knowledge.noAnswerBehavior}
                    className={selectClass}
                  >
                    <option value="fallback">Use fallback</option>
                    <option value="handoff">Handoff</option>
                    <option value="task_recommendation">
                      Recommend a task
                    </option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="sessionMode">Visitor Identity</Label>
                  <select
                    id="sessionMode"
                    name="sessionMode"
                    defaultValue={policy.identity.sessionMode}
                    className={selectClass}
                  >
                    <option value="project_scoped_anonymous">
                      Project-scoped visitor
                    </option>
                    <option value="verified_contact">Verified contact</option>
                    <option value="authenticated_user">
                      Authenticated user
                    </option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="crossChannelLinkRule">
                    Cross-channel linking
                  </Label>
                  <select
                    id="crossChannelLinkRule"
                    name="crossChannelLinkRule"
                    defaultValue={policy.identity.crossChannelLinkRule}
                    className={selectClass}
                  >
                    <option value="never">Never link</option>
                    <option value="verified_contact_only">
                      Verified contacts only
                    </option>
                    <option value="authenticated_identity_only">
                      Authenticated users only
                    </option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  name="allowTaskRecommendation"
                  defaultChecked={policy.entry.allowTaskRecommendation}
                />
                Allow knowledge answers to recommend published tasks
              </label>
              <Accordion
                type="single"
                collapsible
                className="rounded-md border px-4"
              >
                <AccordionItem value="advanced">
                  <AccordionTrigger>
                    Advanced model and transition limits
                  </AccordionTrigger>
                  <AccordionContent forceMount className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="modelPolicyMode">Model Policy</Label>
                      <select
                        id="modelPolicyMode"
                        name="modelPolicyMode"
                        defaultValue={policy.assistant.modelPolicy.mode}
                        className={selectClass}
                      >
                        <option value="platform_default">
                          Use platform default
                        </option>
                        <option value="project_override">
                          Use project override
                        </option>
                      </select>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="primaryModelId">Primary Model</Label>
                        <Input
                          id="primaryModelId"
                          name="primaryModelId"
                          defaultValue={
                            policy.assistant.modelPolicy.primaryModelId
                          }
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="fallbackModelId">Fallback Model</Label>
                        <Input
                          id="fallbackModelId"
                          name="fallbackModelId"
                          defaultValue={
                            policy.assistant.modelPolicy.fallbackModelId ?? ""
                          }
                          placeholder="No fallback"
                        />
                      </div>
                    </div>
                    <div className="space-y-3 rounded-md border p-4">
                      <div>
                        <p className="text-sm font-medium">
                          Stage Model Overrides
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Leave a model blank to inherit the primary and
                          fallback models above.
                        </p>
                      </div>
                      <div className="space-y-3">
                        {TURN_MODEL_STAGES.map((stage) => {
                          const override = stageOverrides.get(stage);

                          return (
                            <div
                              key={stage}
                              className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-end"
                            >
                              <p className="pb-2 text-sm font-medium">
                                {stageLabels[stage]}
                              </p>
                              <div className="space-y-2">
                                <Label htmlFor={`stageModelId:${stage}`}>
                                  Model
                                </Label>
                                <Input
                                  id={`stageModelId:${stage}`}
                                  name={`stageModelId:${stage}`}
                                  defaultValue={override?.modelId ?? ""}
                                  placeholder="Inherit primary"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label
                                  htmlFor={`stageFallbackModelId:${stage}`}
                                >
                                  Fallback
                                </Label>
                                <Input
                                  id={`stageFallbackModelId:${stage}`}
                                  name={`stageFallbackModelId:${stage}`}
                                  defaultValue={override?.fallbackModelId ?? ""}
                                  placeholder="Inherit fallback"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="space-y-2">
                        <Label htmlFor="timeoutMs">Timeout (ms)</Label>
                        <Input
                          id="timeoutMs"
                          name="timeoutMs"
                          type="number"
                          min={1000}
                          max={60000}
                          defaultValue={policy.assistant.modelPolicy.timeoutMs}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="maxOutputTokens">Output Tokens</Label>
                        <Input
                          id="maxOutputTokens"
                          name="maxOutputTokens"
                          type="number"
                          min={64}
                          max={4096}
                          defaultValue={
                            policy.assistant.modelPolicy.maxOutputTokens
                          }
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="maxRetries">Provider Retries</Label>
                        <Input
                          id="maxRetries"
                          name="maxRetries"
                          type="number"
                          min={0}
                          max={2}
                          defaultValue={policy.assistant.modelPolicy.maxRetries}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="maxRepairAttempts">
                          Validation Repairs
                        </Label>
                        <Input
                          id="maxRepairAttempts"
                          name="maxRepairAttempts"
                          type="number"
                          min={0}
                          max={2}
                          defaultValue={
                            policy.assistant.modelPolicy.maxRepairAttempts
                          }
                          required
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="space-y-2">
                        <Label htmlFor="maxVisitorCharacters">
                          Message Characters
                        </Label>
                        <Input
                          id="maxVisitorCharacters"
                          name="maxVisitorCharacters"
                          type="number"
                          min={500}
                          max={32000}
                          defaultValue={
                            policy.assistant.modelPolicy.maxVisitorCharacters
                          }
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="maxHistoryMessages">
                          History Messages
                        </Label>
                        <Input
                          id="maxHistoryMessages"
                          name="maxHistoryMessages"
                          type="number"
                          min={1}
                          max={50}
                          defaultValue={
                            policy.assistant.modelPolicy.maxHistoryMessages
                          }
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="maxTurnsPerMinute">
                          Turns per Minute
                        </Label>
                        <Input
                          id="maxTurnsPerMinute"
                          name="maxTurnsPerMinute"
                          type="number"
                          min={1}
                          max={300}
                          defaultValue={
                            policy.assistant.modelPolicy.maxTurnsPerMinute
                          }
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="maxCostUnitsPerTurn">
                          Cost Units per Turn
                        </Label>
                        <Input
                          id="maxCostUnitsPerTurn"
                          name="maxCostUnitsPerTurn"
                          type="number"
                          min={500}
                          max={100000}
                          defaultValue={
                            policy.assistant.modelPolicy.maxCostUnitsPerTurn
                          }
                          required
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="maxTaskSwitches">
                          Maximum Task Switches
                        </Label>
                        <Input
                          id="maxTaskSwitches"
                          name="maxTaskSwitches"
                          type="number"
                          min={0}
                          max={10}
                          defaultValue={policy.entry.maxTaskSwitches}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="maxConnectedFlowDepth">
                          Connected Flow Depth
                        </Label>
                        <Input
                          id="maxConnectedFlowDepth"
                          name="maxConnectedFlowDepth"
                          type="number"
                          min={0}
                          max={10}
                          defaultValue={policy.entry.maxConnectedFlowDepth}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="maxHandoffDepth">Handoff Depth</Label>
                        <Input
                          id="maxHandoffDepth"
                          name="maxHandoffDepth"
                          type="number"
                          min={0}
                          max={10}
                          defaultValue={policy.entry.maxHandoffDepth}
                          required
                        />
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              <FormSubmitButton
                label="Save Policy"
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
