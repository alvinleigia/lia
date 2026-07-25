"use client";

import { Bot, CircleAlert, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TURN_MODEL_STAGES } from "@/lib/conversation-contracts";
import type { TurnMessageV1 } from "@/lib/conversation-turn-contracts";
import type { ProjectStructuredTurnResult } from "@/lib/conversation-turn-service";

type TaskOption = {
  id: number;
  name: string;
  versionNumber: number;
};

type StructuredTurnTestProps = {
  defaultTaskId: number | null;
  projectId: number;
  tasks: TaskOption[];
};

const stageLabels: Record<(typeof TURN_MODEL_STAGES)[number], string> = {
  clarification: "Clarify",
  confirmation: "Confirm",
  extraction: "Collect details",
  knowledge: "Answer a question",
  lookup: "Look up information",
  operation: "Prepare an operation",
  routing: "Recommend a route",
};

function displayProposal(value: unknown) {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function StructuredTurnTest({
  defaultTaskId,
  projectId,
  tasks,
}: StructuredTurnTestProps) {
  const [activeTaskId, setActiveTaskId] = useState(
    defaultTaskId === null ? "knowledge" : String(defaultTaskId),
  );
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<TurnMessageV1[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ProjectStructuredTurnResult | null>(
    null,
  );
  const [stage, setStage] =
    useState<(typeof TURN_MODEL_STAGES)[number]>("knowledge");

  async function submitTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const visitorMessage = message.trim();
    if (!visitorMessage || pending) return;

    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/conversation/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeTaskId:
            activeTaskId === "knowledge" ? null : Number(activeTaskId),
          assistantIntroduced: history.some(({ role }) => role === "assistant"),
          channel: "project_chat",
          history,
          projectId,
          stage,
          visitorMessage,
        }),
      });
      const payload = (await response.json()) as
        | ProjectStructuredTurnResult
        | { error?: string };
      if (!response.ok || !("execution" in payload)) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "The turn could not be processed.",
        );
      }

      setResult(payload);
      setHistory((current) => [
        ...current,
        { role: "user", content: visitorMessage },
        { role: "assistant", content: payload.execution.proposal.reply },
      ]);
      setMessage("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The turn could not be processed.",
      );
    } finally {
      setPending(false);
    }
  }

  function resetTest() {
    setError(null);
    setHistory([]);
    setMessage("");
    setResult(null);
    setStage("knowledge");
  }

  const proposal = result?.execution.proposal;

  return (
    <div className="space-y-6">
      <form onSubmit={submitTurn} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="turnTask">Conversation Context</Label>
            <Select value={activeTaskId} onValueChange={setActiveTaskId}>
              <SelectTrigger id="turnTask" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="knowledge">Knowledge only</SelectItem>
                {tasks.map((task) => (
                  <SelectItem key={task.id} value={String(task.id)}>
                    {task.name} (v{task.versionNumber})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="turnStage">Turn Purpose</Label>
            <Select
              value={stage}
              onValueChange={(value) =>
                setStage(value as (typeof TURN_MODEL_STAGES)[number])
              }
            >
              <SelectTrigger id="turnStage" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TURN_MODEL_STAGES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {stageLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {history.length > 0 && (
          <div className="divide-y rounded-md border">
            {history.slice(-6).map((entry, index) => (
              <div
                key={`${entry.role}-${index}-${entry.content}`}
                className="grid gap-1 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)]"
              >
                <p className="text-sm font-medium capitalize">{entry.role}</p>
                <p className="whitespace-pre-wrap text-sm">{entry.content}</p>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="turnMessage">Visitor Message</Label>
          <Textarea
            id="turnMessage"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Enter one UAT message"
            rows={4}
            required
          />
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit" disabled={pending || !message.trim()}>
            <Send className="h-4 w-4" />
            {pending ? "Testing..." : "Test Turn"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={resetTest}
            disabled={pending}
          >
            <RefreshCw className="h-4 w-4" />
            Reset Conversation
          </Button>
        </div>
      </form>

      {proposal && result && (
        <div className="space-y-5 border-t pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <Bot className="h-5 w-5" />
                Proposed Turn
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Server validated. No runtime value or route was changed.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{proposal.turnKind.replaceAll("_", " ")}</Badge>
              <Badge variant="outline">
                Next: {proposal.nextAction.replaceAll("_", " ")}
              </Badge>
              <Badge variant="secondary">{result.execution.source}</Badge>
            </div>
          </div>

          <div className="rounded-md border p-4">
            <p className="text-sm font-medium">Visitor Reply</p>
            <p className="mt-2 whitespace-pre-wrap">{proposal.reply}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border p-4">
              <p className="flex items-center gap-2 font-medium">
                <ShieldCheck className="h-4 w-4 text-green-600" />
                Grounding and Safety
              </p>
              <dl className="mt-3 grid grid-cols-[8rem_minmax(0,1fr)] gap-2 text-sm">
                <dt className="text-muted-foreground">Grounding</dt>
                <dd>{proposal.grounding.status.replaceAll("_", " ")}</dd>
                <dt className="text-muted-foreground">Sources</dt>
                <dd>
                  {proposal.grounding.excerptIds.length > 0
                    ? proposal.grounding.excerptIds.join(", ")
                    : "None"}
                </dd>
                <dt className="text-muted-foreground">Safety</dt>
                <dd>{proposal.safety.decision}</dd>
                <dt className="text-muted-foreground">Reason</dt>
                <dd>{proposal.safety.reasonCode}</dd>
              </dl>
            </div>

            <div className="rounded-md border p-4">
              <p className="flex items-center gap-2 font-medium">
                <CircleAlert className="h-4 w-4" />
                Model Attempt
              </p>
              <dl className="mt-3 grid grid-cols-[8rem_minmax(0,1fr)] gap-2 text-sm">
                <dt className="text-muted-foreground">Active task</dt>
                <dd>
                  {result.activeTask
                    ? `${result.activeTask.name} (v${result.activeTask.versionNumber})`
                    : "Knowledge only"}
                </dd>
                <dt className="text-muted-foreground">Model</dt>
                <dd>{proposal.validation.providerModelId}</dd>
                <dt className="text-muted-foreground">Attempts</dt>
                <dd>{result.execution.attempts}</dd>
                <dt className="text-muted-foreground">Tokens</dt>
                <dd>{result.execution.usage.totalTokens ?? "Unavailable"}</dd>
              </dl>
            </div>
          </div>

          <div className="rounded-md border">
            <div className="border-b px-4 py-3">
              <h3 className="font-medium">Recommendations Only</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                These items require a later deterministic server decision.
              </p>
            </div>
            <dl className="grid gap-0 sm:grid-cols-2">
              <div className="border-b p-4 sm:border-r">
                <dt className="text-sm text-muted-foreground">
                  Field candidates
                </dt>
                <dd className="mt-1 break-words">
                  {proposal.fieldCandidates.length > 0
                    ? proposal.fieldCandidates
                        .map(
                          ({ fieldKey, naturalValue }) =>
                            `${fieldKey}: ${displayProposal(naturalValue)}`,
                        )
                        .join(", ")
                    : "None"}
                </dd>
              </div>
              <div className="border-b p-4">
                <dt className="text-sm text-muted-foreground">Task</dt>
                <dd className="mt-1 break-words">
                  {proposal.taskRecommendation
                    ? `Task #${proposal.taskRecommendation.taskId} (${Math.round(
                        proposal.taskRecommendation.confidence * 100,
                      )}% confidence)`
                    : "None"}
                </dd>
              </div>
              <div className="border-b p-4 sm:border-r sm:border-b-0">
                <dt className="text-sm text-muted-foreground">Tool</dt>
                <dd className="mt-1 break-words">
                  {proposal.toolRequest
                    ? `${proposal.toolRequest.toolId} at ${proposal.toolRequest.stage}`
                    : "None"}
                </dd>
              </div>
              <div className="p-4">
                <dt className="text-sm text-muted-foreground">
                  Route or outcome
                </dt>
                <dd className="mt-1 break-words">
                  {proposal.routeRecommendation?.outputPort ??
                    proposal.outcomeRecommendation?.outcomeKey ??
                    "None"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
