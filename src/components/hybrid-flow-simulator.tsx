"use client";

import {
  ArrowRight,
  CheckCircle2,
  CircleStop,
  MessageCircleQuestion,
  Play,
  RotateCcw,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CompiledHybridFlowGraphV1,
  HybridFlowNodeV1,
  HybridFlowTransitionV1,
} from "@/lib/hybrid-flow-contracts";
import {
  selectHybridFlowEntryNode,
  selectHybridFlowTransition,
} from "@/lib/hybrid-flow-runtime";

type EntryMode = "campaign" | "channel" | "deep_link" | "normal";
type TestStatus = "active" | "ended" | "idle";

type TestEvent = {
  description: string;
  id: number;
  title: string;
};

type HybridFlowSimulatorProps = {
  actionName: string;
  graph: CompiledHybridFlowGraphV1;
  versionNumber: number;
};

const ENTRY_LABELS: Record<EntryMode, string> = {
  normal: "Normal conversation",
  deep_link: "Website or deep link",
  campaign: "Campaign",
  channel: "Channel",
};

const OWNER_LABELS: Record<HybridFlowNodeV1["responseOwner"], string> = {
  deterministic: "Flow step",
  knowledge: "Knowledge Q&A",
  task: "Conversational task",
};

function getEntryRoutes(graph: CompiledHybridFlowGraphV1, mode: EntryMode) {
  if (mode === "deep_link") {
    return graph.entryPolicy.deepLinkRoutes;
  }
  if (mode === "campaign") {
    return graph.entryPolicy.campaignRoutes;
  }
  if (mode === "channel") {
    return graph.entryPolicy.channelRoutes;
  }
  return {};
}

function getTransitionLabel(
  transition: HybridFlowTransitionV1,
  sourceNode: HybridFlowNodeV1,
  targetNode: HybridFlowNodeV1 | null,
) {
  if (sourceNode.kind === "knowledge") {
    if (transition.triggerKey === "answered") {
      return "Answer and continue";
    }
    if (transition.triggerKey === "no_answer") {
      return "No grounded answer";
    }
    if (transition.triggerKey === "handoff") {
      return "Request human help";
    }
    if (transition.triggerKey?.startsWith("task:")) {
      return `Recommend ${targetNode?.label ?? "task"}`;
    }
  }

  if (sourceNode.kind === "conversational_task" && transition.triggerKey) {
    return (
      sourceNode.settings.task.outcomes.find(
        (outcome) => outcome.outputPort === transition.triggerKey,
      )?.label ?? transition.triggerKey
    );
  }

  if (transition.kind === "deterministic") {
    return transition.sourceRuleId
      ? `Use branch rule ${transition.sourceRuleId}`
      : "Use branch route";
  }
  return transition.targetNodeId ? "Continue" : "Finish flow";
}

function getNodeDescription(node: HybridFlowNodeV1) {
  if (node.kind === "knowledge") {
    return node.goal;
  }
  if (node.kind === "conversational_task") {
    return `${node.settings.task.name}, pinned to version ${node.settings.task.versionNumber}.`;
  }
  return `Run the published ${node.stepType.replaceAll("_", " ")} step.`;
}

export function HybridFlowSimulator({
  actionName,
  graph,
  versionNumber,
}: HybridFlowSimulatorProps) {
  const [entryMode, setEntryMode] = useState<EntryMode>("normal");
  const [entryKey, setEntryKey] = useState("");
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [status, setStatus] = useState<TestStatus>("idle");
  const [error, setError] = useState("");
  const [events, setEvents] = useState<TestEvent[]>([]);

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const activeNode = activeNodeId ? (nodeById.get(activeNodeId) ?? null) : null;
  const entryRoutes = getEntryRoutes(graph, entryMode);
  const entryKeys = Object.keys(entryRoutes);
  const outgoingTransitions = activeNode
    ? graph.transitions.filter(
        (transition) => transition.sourceNodeId === activeNode.id,
      )
    : [];

  function appendEvent(title: string, description: string) {
    setEvents((current) => [
      ...current,
      { description, id: current.length + 1, title },
    ]);
  }

  function changeEntryMode(value: EntryMode) {
    const routes = getEntryRoutes(graph, value);
    setEntryMode(value);
    setEntryKey(Object.keys(routes)[0] ?? "");
    setError("");
  }

  function startTest() {
    const selectedNodeId = selectHybridFlowEntryNode({
      campaignKey: entryMode === "campaign" ? entryKey : null,
      channelType: entryMode === "channel" ? entryKey : null,
      deepLinkKey: entryMode === "deep_link" ? entryKey : null,
      graph,
    });

    if (!selectedNodeId || !nodeById.has(selectedNodeId)) {
      setError("This entry option does not have a published start node.");
      return;
    }

    const node = nodeById.get(selectedNodeId);
    setActiveNodeId(selectedNodeId);
    setStatus("active");
    setError("");
    setEvents([
      {
        description: `Entered at ${node?.label ?? selectedNodeId}.`,
        id: 1,
        title: ENTRY_LABELS[entryMode],
      },
    ]);
  }

  function followTransition(transition: HybridFlowTransitionV1) {
    if (!activeNode) {
      return;
    }

    const selected = selectHybridFlowTransition({
      graph,
      signals: [
        {
          kind: transition.kind,
          sourceRuleId: transition.sourceRuleId,
          triggerKey: transition.triggerKey,
        },
      ],
      sourceNodeId: activeNode.id,
    });

    if (!selected) {
      setError("The published runtime could not resolve this route.");
      return;
    }

    const targetNode = selected.targetNodeId
      ? (nodeById.get(selected.targetNodeId) ?? null)
      : null;
    const label = getTransitionLabel(selected, activeNode, targetNode);
    appendEvent(
      label,
      targetNode ? `Moved to ${targetNode.label}.` : "The flow ended.",
    );
    setActiveNodeId(targetNode?.id ?? null);
    setStatus(targetNode ? "active" : "ended");
    setError("");
  }

  function keepCurrentNode(title: string, description: string) {
    appendEvent(title, description);
    setError("");
  }

  function resetTest() {
    setActiveNodeId(null);
    setStatus("idle");
    setEvents([]);
    setError("");
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Play className="h-6 w-6" />
            Published Flow Test
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Test {actionName} version {versionNumber} without creating live
            conversations, submissions, or tool attempts.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase text-muted-foreground">Version</p>
              <p className="font-medium">v{versionNumber}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase text-muted-foreground">Nodes</p>
              <p className="font-medium">{graph.nodes.length}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase text-muted-foreground">Routes</p>
              <p className="font-medium">{graph.transitions.length}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase text-muted-foreground">Status</p>
              <p className="font-medium capitalize">{status}</p>
            </div>
          </div>

          <div className="grid gap-4 border-t pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="entry-mode">
                Start From
              </label>
              <Select
                value={entryMode}
                onValueChange={(value) => changeEntryMode(value as EntryMode)}
              >
                <SelectTrigger id="entry-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal conversation</SelectItem>
                  <SelectItem
                    value="deep_link"
                    disabled={
                      Object.keys(graph.entryPolicy.deepLinkRoutes).length === 0
                    }
                  >
                    Website or deep link
                  </SelectItem>
                  <SelectItem
                    value="campaign"
                    disabled={
                      Object.keys(graph.entryPolicy.campaignRoutes).length === 0
                    }
                  >
                    Campaign
                  </SelectItem>
                  <SelectItem
                    value="channel"
                    disabled={
                      Object.keys(graph.entryPolicy.channelRoutes).length === 0
                    }
                  >
                    Channel
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="entry-key">
                Entry Rule
              </label>
              {entryMode === "normal" ? (
                <div
                  id="entry-key"
                  className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground"
                >
                  Published normal route
                </div>
              ) : (
                <Select value={entryKey} onValueChange={setEntryKey}>
                  <SelectTrigger id="entry-key" className="w-full">
                    <SelectValue placeholder="Choose an entry rule" />
                  </SelectTrigger>
                  <SelectContent>
                    {entryKeys.map((key) => (
                      <SelectItem key={key} value={key}>
                        {key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                onClick={startTest}
                disabled={entryMode !== "normal" && !entryKey}
              >
                <Play className="h-4 w-4" />
                {status === "idle" ? "Start Test" : "Start Again"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={resetTest}
                disabled={status === "idle" && events.length === 0}
                title="Reset test"
              >
                <RotateCcw className="h-4 w-4" />
                <span className="sr-only">Reset test</span>
              </Button>
            </div>
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Current Node</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {status === "idle" && (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                Choose an entry route and start the test.
              </p>
            )}

            {status === "ended" && (
              <div className="flex items-start gap-3 rounded-md border border-green-200 bg-green-50 p-4 text-green-900">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-medium">Flow completed</p>
                  <p className="text-sm">
                    The selected published route reached an end target.
                  </p>
                </div>
              </div>
            )}

            {activeNode && (
              <>
                <div className="space-y-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">
                        {activeNode.kind.replaceAll("_", " ")}
                      </p>
                      <h2 className="text-xl font-semibold">
                        {activeNode.label}
                      </h2>
                    </div>
                    <Badge>
                      Response owner: {OWNER_LABELS[activeNode.responseOwner]}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {getNodeDescription(activeNode)}
                  </p>
                </div>

                <div className="space-y-3">
                  <h3 className="font-medium">Simulate This Node</h3>
                  <div className="flex flex-wrap gap-2">
                    {activeNode.kind === "knowledge" &&
                      activeNode.settings.remainActiveAfterAnswer &&
                      !outgoingTransitions.some(
                        (transition) => transition.triggerKey === "answered",
                      ) && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            keepCurrentNode(
                              "Knowledge answer",
                              "The answer was sent and Knowledge Q&A remains active.",
                            )
                          }
                        >
                          <MessageCircleQuestion className="h-4 w-4" />
                          Answer and stay here
                        </Button>
                      )}

                    {activeNode.kind === "conversational_task" && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          keepCurrentNode(
                            "Side question",
                            "The task was paused, the side question was answered, and the same task resumed.",
                          )
                        }
                      >
                        <MessageCircleQuestion className="h-4 w-4" />
                        Ask a side question
                      </Button>
                    )}

                    {outgoingTransitions.map((transition) => {
                      const targetNode = transition.targetNodeId
                        ? (nodeById.get(transition.targetNodeId) ?? null)
                        : null;
                      return (
                        <Button
                          key={transition.id}
                          type="button"
                          variant="outline"
                          onClick={() => followTransition(transition)}
                        >
                          {transition.targetNodeId ? (
                            <ArrowRight className="h-4 w-4" />
                          ) : (
                            <CircleStop className="h-4 w-4" />
                          )}
                          {getTransitionLabel(
                            transition,
                            activeNode,
                            targetNode,
                          )}
                        </Button>
                      );
                    })}
                  </div>

                  {outgoingTransitions.length === 0 &&
                    activeNode.kind !== "knowledge" && (
                      <p className="text-sm text-muted-foreground">
                        This node has no published outgoing route.
                      </p>
                    )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Test Trail</CardTitle>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Test events will appear here.
              </p>
            ) : (
              <ol className="space-y-3">
                {events.map((event) => (
                  <li key={event.id} className="rounded-md border p-3">
                    <p className="font-medium">{event.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {event.description}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
