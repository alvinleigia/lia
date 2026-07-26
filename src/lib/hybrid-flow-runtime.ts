import type { TaskOutcomeV1 } from "@/lib/conversation-contracts";
import type {
  CompiledHybridFlowGraphV1,
  HybridFlowTransitionV1,
  HybridGraphTaskReturnTargetV1,
} from "@/lib/hybrid-flow-contracts";

const TRANSITION_PRECEDENCE = {
  deterministic: 4,
  task_outcome: 3,
  tool_result: 3,
  semantic: 2,
  default: 1,
} satisfies Record<HybridFlowTransitionV1["kind"], number>;

export type HybridTransitionSignal = {
  kind: HybridFlowTransitionV1["kind"];
  sourceRuleId?: number | null;
  triggerKey?: string | null;
};

export function selectHybridFlowEntryNode(input: {
  campaignKey?: string | null;
  channelType?: string | null;
  deepLinkKey?: string | null;
  graph: CompiledHybridFlowGraphV1;
}) {
  if (input.deepLinkKey) {
    const nodeId = input.graph.entryPolicy.deepLinkRoutes[input.deepLinkKey];
    if (nodeId) {
      return nodeId;
    }
  }
  if (input.campaignKey) {
    const nodeId = input.graph.entryPolicy.campaignRoutes[input.campaignKey];
    if (nodeId) {
      return nodeId;
    }
  }
  if (input.channelType) {
    const nodeId = input.graph.entryPolicy.channelRoutes[input.channelType];
    if (nodeId) {
      return nodeId;
    }
  }
  return input.graph.entryPolicy.normalNodeId;
}

function signalMatchesTransition(
  transition: HybridFlowTransitionV1,
  signal: HybridTransitionSignal,
) {
  if (transition.kind !== signal.kind) {
    return false;
  }
  if (
    signal.sourceRuleId !== undefined &&
    transition.sourceRuleId !== signal.sourceRuleId
  ) {
    return false;
  }
  return (
    signal.triggerKey === undefined ||
    transition.triggerKey === signal.triggerKey
  );
}

export function selectHybridFlowTransition(input: {
  graph: CompiledHybridFlowGraphV1;
  signals: HybridTransitionSignal[];
  sourceNodeId: string;
}) {
  const matching = input.graph.transitions.filter(
    (transition) =>
      transition.sourceNodeId === input.sourceNodeId &&
      input.signals.some((signal) =>
        signalMatchesTransition(transition, signal),
      ),
  );

  return (
    matching.sort(
      (left, right) =>
        TRANSITION_PRECEDENCE[right.kind] - TRANSITION_PRECEDENCE[left.kind] ||
        right.priority - left.priority ||
        left.id.localeCompare(right.id),
    )[0] ?? null
  );
}

export function buildHybridGraphTaskReturnTarget(input: {
  actionVersionId: number;
  graph: CompiledHybridFlowGraphV1;
  taskNodeId: string;
}): HybridGraphTaskReturnTargetV1 | null {
  const taskNode = input.graph.nodes.find(
    (node) =>
      node.id === input.taskNodeId && node.kind === "conversational_task",
  );
  if (!taskNode) {
    return null;
  }

  const outcomeRoutes = Object.fromEntries(
    input.graph.transitions
      .filter(
        (transition) =>
          transition.sourceNodeId === taskNode.id &&
          transition.kind === "task_outcome" &&
          transition.triggerKey,
      )
      .map((transition) => {
        const targetNode = transition.targetNodeId
          ? input.graph.nodes.find(
              (candidate) => candidate.id === transition.targetNodeId,
            )
          : null;
        return [
          transition.triggerKey as string,
          {
            nodeId: transition.targetNodeId,
            responseOwner: targetNode?.responseOwner ?? "knowledge",
          },
        ];
      }),
  );

  return {
    actionVersionId: input.actionVersionId,
    kind: "hybrid_graph_task",
    outcomeRoutes,
    schemaVersion: 1,
    taskNodeId: taskNode.id,
  };
}

export function resolveTaskOutputPort(input: {
  eventType: "cancelled" | "completed" | "failed" | "handoff";
  outcomeKey: string | null;
  outcomes: TaskOutcomeV1[];
}) {
  const explicit = input.outcomeKey
    ? input.outcomes.find(
        (outcome) =>
          outcome.key === input.outcomeKey ||
          outcome.outputPort === input.outcomeKey,
      )
    : null;
  return (
    explicit?.outputPort ??
    input.outcomes.find((outcome) => outcome.type === input.eventType)
      ?.outputPort ??
    null
  );
}

export function resolveHybridTaskOutcomeRoute(input: {
  eventType: "cancelled" | "completed" | "failed" | "handoff";
  outcomeKey: string | null;
  outcomes: TaskOutcomeV1[];
  returnTarget: HybridGraphTaskReturnTargetV1 | null;
}) {
  const outputPort = resolveTaskOutputPort(input);
  return outputPort && input.returnTarget
    ? (input.returnTarget.outcomeRoutes[outputPort] ?? null)
    : null;
}
