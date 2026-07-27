"use client";

import { Loader2, Save } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type {
  FlowStep,
  HybridRouteTarget,
  HybridStepInput,
} from "@/components/action-flow-canvas/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { PublishedConversationalTaskOption } from "@/lib/conversational-tasks";
import {
  readConversationalTaskFlowNodeSettings,
  readKnowledgeFlowNodeSettings,
} from "@/lib/hybrid-flow-compiler";
import { getDefaultTaskOutcomeRoutes } from "./model";

export const HYBRID_STEP_TYPES = [
  "knowledge_conversation",
  "conversational_task",
] as const;

export function isHybridStepType(
  stepType: string,
): stepType is (typeof HYBRID_STEP_TYPES)[number] {
  return HYBRID_STEP_TYPES.includes(
    stepType as (typeof HYBRID_STEP_TYPES)[number],
  );
}

function RouteSelect({
  allowStayActive = false,
  id,
  label,
  onChange,
  sourceStepId,
  steps,
  value,
}: {
  allowStayActive?: boolean;
  id: string;
  label: string;
  onChange: (value: HybridRouteTarget | null) => void;
  sourceStepId?: number;
  steps: FlowStep[];
  value: HybridRouteTarget | null;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="flex h-10 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        value={value === null ? "stay" : String(value)}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(
            nextValue === "stay"
              ? null
              : nextValue === "end"
                ? "end"
                : Number(nextValue),
          );
        }}
      >
        {allowStayActive && <option value="stay">Stay in Knowledge</option>}
        <option value="end">End Conversation</option>
        {steps
          .filter((step) => step.isEnabled && step.id !== sourceStepId)
          .map((step) => (
            <option key={step.id} value={step.id}>
              {step.sortOrder}. {step.label || step.stepType}
            </option>
          ))}
      </select>
    </div>
  );
}

function ToggleList({
  emptyMessage,
  items,
  onChange,
  selected,
}: {
  emptyMessage: string;
  items: Array<{ key: string; label: string }>;
  onChange: (keys: string[]) => void;
  selected: string[];
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => {
        const checked = selected.includes(item.key);
        return (
          <Label
            className="rounded-md border bg-white px-3 py-2.5 font-normal"
            key={item.key}
          >
            <Checkbox
              checked={checked}
              onCheckedChange={(nextChecked) =>
                onChange(
                  nextChecked
                    ? [...selected, item.key]
                    : selected.filter((key) => key !== item.key),
                )
              }
            />
            <span className="min-w-0 truncate">{item.label}</span>
          </Label>
        );
      })}
    </div>
  );
}

function KnowledgeStepForm({
  isPending,
  onSubmit,
  step,
  steps,
}: {
  isPending: boolean;
  onSubmit: (input: HybridStepInput) => void;
  step?: FlowStep;
  steps: FlowStep[];
}) {
  const stored = step ? readKnowledgeFlowNodeSettings(step.settings) : null;
  const [label, setLabel] = useState(step?.label ?? "Knowledge");
  const [goal, setGoal] = useState(
    (typeof step?.settings.knowledgeGoal === "string"
      ? step.settings.knowledgeGoal
      : "") || "Answer visitor questions using approved project knowledge.",
  );
  const [stageMode, setStageMode] = useState<"exact" | "goal_driven">(
    stored?.stageMode ?? "goal_driven",
  );
  const [remainActiveAfterAnswer, setRemainActiveAfterAnswer] = useState(
    stored?.remainActiveAfterAnswer ?? true,
  );
  const [answeredRoute, setAnsweredRoute] = useState<HybridRouteTarget | null>(
    stored?.answeredRoute ?? null,
  );
  const [noAnswerRoute, setNoAnswerRoute] = useState<HybridRouteTarget>(
    stored?.noAnswerRoute ?? "end",
  );
  const [handoffRoute, setHandoffRoute] = useState<HybridRouteTarget>(
    stored?.handoffRoute ?? "end",
  );
  const [recommendationTargetStepIds, setRecommendationTargetStepIds] =
    useState<number[]>(stored?.recommendationTargetStepIds ?? []);
  const [isEnabled, setIsEnabled] = useState(step?.isEnabled ?? true);
  const [error, setError] = useState("");
  const taskSteps = steps.filter(
    (candidate) =>
      candidate.stepType === "conversational_task" && candidate.id !== step?.id,
  );

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        if (!label.trim() || !goal.trim()) {
          setError("Add a step name and a clear knowledge goal.");
          return;
        }
        if (!remainActiveAfterAnswer && answeredRoute === null) {
          setError("Choose where to go after a successful answer.");
          return;
        }
        onSubmit({
          answeredRoute,
          goal,
          handoffRoute,
          isEnabled,
          label,
          noAnswerRoute,
          recommendationTargetStepIds,
          remainActiveAfterAnswer,
          stageMode,
          stepType: "knowledge_conversation",
        });
      }}
    >
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="hybrid-knowledge-label">Step Name</Label>
        <Input
          id="hybrid-knowledge-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Product questions"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="hybrid-knowledge-goal">
          What Should Lia Help With?
        </Label>
        <Textarea
          id="hybrid-knowledge-goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          rows={4}
          placeholder="Answer product and policy questions using approved project knowledge."
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="hybrid-stage-mode">Conversation Style</Label>
        <select
          id="hybrid-stage-mode"
          className="flex h-10 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          value={stageMode}
          onChange={(event) =>
            setStageMode(event.target.value as "exact" | "goal_driven")
          }
        >
          <option value="goal_driven">Natural conversation</option>
          <option value="exact">Follow the goal strictly</option>
        </select>
      </div>
      <Label className="justify-between rounded-md border px-3 py-3">
        <span>
          <span className="block">Keep answering questions</span>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Stay in this knowledge stage after a successful answer.
          </span>
        </span>
        <Switch
          checked={remainActiveAfterAnswer}
          onCheckedChange={setRemainActiveAfterAnswer}
        />
      </Label>

      <div className="grid gap-4 sm:grid-cols-2">
        <RouteSelect
          allowStayActive={remainActiveAfterAnswer}
          id="knowledge-answered-route"
          label="After Answering"
          onChange={setAnsweredRoute}
          sourceStepId={step?.id}
          steps={steps}
          value={answeredRoute}
        />
        <RouteSelect
          id="knowledge-no-answer-route"
          label="When No Answer Is Found"
          onChange={(value) => value !== null && setNoAnswerRoute(value)}
          sourceStepId={step?.id}
          steps={steps}
          value={noAnswerRoute}
        />
        <RouteSelect
          id="knowledge-handoff-route"
          label="When Human Help Is Needed"
          onChange={(value) => value !== null && setHandoffRoute(value)}
          sourceStepId={step?.id}
          steps={steps}
          value={handoffRoute}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Tasks Lia May Recommend</p>
        {taskSteps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a Business Task block to enable recommendations.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {taskSteps.map((taskStep) => (
              <Label
                className="rounded-md border bg-white px-3 py-2.5 font-normal"
                key={taskStep.id}
              >
                <Checkbox
                  checked={recommendationTargetStepIds.includes(taskStep.id)}
                  onCheckedChange={(checked) =>
                    setRecommendationTargetStepIds(
                      checked
                        ? [...recommendationTargetStepIds, taskStep.id]
                        : recommendationTargetStepIds.filter(
                            (stepId) => stepId !== taskStep.id,
                          ),
                    )
                  }
                />
                {taskStep.label || `Step ${taskStep.sortOrder}`}
              </Label>
            ))}
          </div>
        )}
      </div>

      <Label className="justify-between rounded-md border px-3 py-3">
        <span>Enabled</span>
        <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
      </Label>

      <Button type="submit" disabled={isPending}>
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        {step ? "Save Knowledge Step" : "Create Knowledge Step"}
      </Button>
    </form>
  );
}

function TaskStepForm({
  isPending,
  onSubmit,
  step,
  steps,
  taskOptions,
}: {
  isPending: boolean;
  onSubmit: (input: HybridStepInput) => void;
  step?: FlowStep;
  steps: FlowStep[];
  taskOptions: PublishedConversationalTaskOption[];
}) {
  const stored = step
    ? readConversationalTaskFlowNodeSettings(step.settings)
    : null;
  const boundOption = stored
    ? {
        contextKeys: stored.transferContextKeys,
        fieldKeys: stored.transferFieldKeys,
        name: stored.task.name,
        objective: step?.prompt ?? "",
        outcomes: stored.task.outcomes,
        taskId: stored.task.taskId,
        taskVersionId: stored.task.taskVersionId,
        versionNumber: stored.task.versionNumber,
      }
    : null;
  const availableOptions =
    !boundOption ||
    taskOptions.some(
      (option) => option.taskVersionId === boundOption.taskVersionId,
    )
      ? taskOptions
      : [boundOption, ...taskOptions];
  const initialTaskVersionId =
    stored?.task.taskVersionId ?? taskOptions[0]?.taskVersionId ?? 0;
  const initialTask = availableOptions.find(
    (option) => option.taskVersionId === initialTaskVersionId,
  );
  const [label, setLabel] = useState(step?.label ?? "Business Task");
  const [taskVersionId, setTaskVersionId] = useState(initialTaskVersionId);
  const [transferFieldKeys, setTransferFieldKeys] = useState<string[]>(
    stored?.transferFieldKeys ?? [],
  );
  const [transferContextKeys, setTransferContextKeys] = useState<string[]>(
    stored?.transferContextKeys ?? [],
  );
  const [outcomeRoutes, setOutcomeRoutes] = useState<
    Record<string, HybridRouteTarget>
  >(
    stored?.outcomeRoutes ??
      getDefaultTaskOutcomeRoutes(initialTask?.outcomes ?? []),
  );
  const [isEnabled, setIsEnabled] = useState(step?.isEnabled ?? true);
  const [error, setError] = useState("");
  const selectedTask = availableOptions.find(
    (option) => option.taskVersionId === taskVersionId,
  );
  const outputPorts = selectedTask
    ? Array.from(
        new Map(
          selectedTask.outcomes.map((outcome) => [
            outcome.outputPort,
            outcome.label,
          ]),
        ),
      )
    : [];

  if (availableOptions.length === 0) {
    return (
      <div className="space-y-4 rounded-md border p-4">
        <p className="text-sm font-medium">Publish a business task first</p>
        <p className="text-sm text-muted-foreground">
          This block pins an exact published task version so live conversations
          do not change unexpectedly.
        </p>
        <Button asChild variant="outline">
          <Link href="/projects/tasks">Open Conversational Tasks</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        if (!label.trim() || !selectedTask) {
          setError("Add a step name and choose a published task.");
          return;
        }
        if (
          outputPorts.some(
            ([outputPort]) => outcomeRoutes[outputPort] === undefined,
          )
        ) {
          setError("Choose a destination for every task outcome.");
          return;
        }
        onSubmit({
          isEnabled,
          label,
          outcomeRoutes,
          stepType: "conversational_task",
          taskVersionId,
          transferContextKeys,
          transferFieldKeys,
        });
      }}
    >
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="hybrid-task-label">Step Name</Label>
        <Input
          id="hybrid-task-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Book an appointment"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="hybrid-task-version">Published Business Task</Label>
        <select
          id="hybrid-task-version"
          className="flex h-10 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          value={taskVersionId}
          onChange={(event) => {
            const nextId = Number(event.target.value);
            const nextTask = availableOptions.find(
              (option) => option.taskVersionId === nextId,
            );
            setTaskVersionId(nextId);
            setTransferFieldKeys([]);
            setTransferContextKeys([]);
            setOutcomeRoutes(
              getDefaultTaskOutcomeRoutes(nextTask?.outcomes ?? []),
            );
          }}
        >
          {availableOptions.map((option) => (
            <option key={option.taskVersionId} value={option.taskVersionId}>
              {option.name} - version {option.versionNumber}
            </option>
          ))}
        </select>
        {selectedTask && (
          <p className="text-xs text-muted-foreground">
            {selectedTask.objective}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">After the Task</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {outputPorts.map(([outputPort, outcomeName]) => (
            <RouteSelect
              id={`task-outcome-${outputPort}`}
              key={outputPort}
              label={outcomeName}
              onChange={(value) =>
                value !== null &&
                setOutcomeRoutes((current) => ({
                  ...current,
                  [outputPort]: value,
                }))
              }
              sourceStepId={step?.id}
              steps={steps}
              value={outcomeRoutes[outputPort] ?? "end"}
            />
          ))}
        </div>
      </div>

      <details className="group rounded-md border bg-white">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">
          Values Shared With This Task
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Only selected values cross into the task.
          </span>
        </summary>
        <div className="space-y-5 border-t p-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Visitor Answers</p>
            <ToggleList
              emptyMessage="This task has no visitor fields."
              items={(selectedTask?.fieldKeys ?? []).map((key) => ({
                key,
                label: key,
              }))}
              onChange={setTransferFieldKeys}
              selected={transferFieldKeys}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Trusted Context</p>
            <ToggleList
              emptyMessage="This task has no trusted context variables."
              items={(selectedTask?.contextKeys ?? []).map((key) => ({
                key,
                label: key,
              }))}
              onChange={setTransferContextKeys}
              selected={transferContextKeys}
            />
          </div>
        </div>
      </details>

      <Label className="justify-between rounded-md border px-3 py-3">
        <span>Enabled</span>
        <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
      </Label>

      <Button type="submit" disabled={isPending}>
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        {step ? "Save Business Task Step" : "Create Business Task Step"}
      </Button>
    </form>
  );
}

export function HybridStepForm({
  isPending,
  onSubmit,
  step,
  stepType,
  steps,
  taskOptions,
}: {
  isPending: boolean;
  onSubmit: (input: HybridStepInput) => void;
  step?: FlowStep;
  stepType: (typeof HYBRID_STEP_TYPES)[number];
  steps: FlowStep[];
  taskOptions: PublishedConversationalTaskOption[];
}) {
  return stepType === "knowledge_conversation" ? (
    <KnowledgeStepForm
      isPending={isPending}
      onSubmit={onSubmit}
      step={step}
      steps={steps}
    />
  ) : (
    <TaskStepForm
      isPending={isPending}
      onSubmit={onSubmit}
      step={step}
      steps={steps}
      taskOptions={taskOptions}
    />
  );
}
