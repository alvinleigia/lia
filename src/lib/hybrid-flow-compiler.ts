import {
  type ActionFlowCompilerBranchRule,
  type ActionFlowCompilerIssue,
  type ActionFlowCompilerStep,
  compileActionFlowGraph,
} from "@/lib/action-flow-compiler";
import {
  type CompiledHybridFlowGraphV1,
  conversationalTaskFlowNodeSettingsV1Schema,
  getHybridNodeId,
  type HybridFlowNodeV1,
  type HybridFlowTransitionV1,
  hybridFlowEntryPolicySettingsV1Schema,
  knowledgeFlowNodeSettingsV1Schema,
} from "@/lib/hybrid-flow-contracts";

const BASE_TERMINAL_STEP_TYPES = new Set([
  "confirmation",
  "connect_flow",
  "handoff",
  "submit",
]);
const HYBRID_GRAPH_ISSUE_CODES = new Set([
  "graph_cycle_detected",
  "graph_step_unreachable",
  "graph_terminal_unreachable",
]);

export type HybridFlowCompilerIssue = {
  code:
    | "hybrid_config_invalid"
    | "hybrid_depth_exceeded"
    | "hybrid_route_invalid"
    | "hybrid_step_unreachable"
    | "hybrid_terminal_unreachable";
  message: string;
  severity: "error" | "warning";
  stepId?: number;
};

export type HybridFlowCompilerResult = {
  baseIssues: ActionFlowCompilerIssue[];
  graph: CompiledHybridFlowGraphV1;
  issues: HybridFlowCompilerIssue[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readKnowledgeFlowNodeSettings(value: unknown) {
  const record = isRecord(value) ? value.knowledgeConversation : null;
  const parsed = knowledgeFlowNodeSettingsV1Schema.safeParse(record);
  return parsed.success ? parsed.data : null;
}

export function readConversationalTaskFlowNodeSettings(value: unknown) {
  const record = isRecord(value) ? value.conversationalTask : null;
  const parsed = conversationalTaskFlowNodeSettingsV1Schema.safeParse(record);
  return parsed.success ? parsed.data : null;
}

export function readHybridFlowEntryPolicySettings(value: unknown) {
  const settings = isRecord(value) ? value.hybridEntryPolicy : null;
  const parsed = hybridFlowEntryPolicySettingsV1Schema.safeParse(
    settings ?? {},
  );
  return parsed.success ? parsed.data : null;
}

function addTransition(
  transitions: HybridFlowTransitionV1[],
  input: Omit<HybridFlowTransitionV1, "id"> & { idPart: string },
) {
  transitions.push({
    id: `${input.sourceNodeId}:${input.kind}:${input.idPart}`,
    kind: input.kind,
    priority: input.priority,
    sourceNodeId: input.sourceNodeId,
    sourceRuleId: input.sourceRuleId,
    targetNodeId: input.targetNodeId,
    triggerKey: input.triggerKey,
  });
}

function routeTargetNodeId(
  route: number | "end",
  stepById: Map<number, ActionFlowCompilerStep>,
) {
  return route === "end" || !stepById.has(route)
    ? null
    : getHybridNodeId(route);
}

function buildReachableNodeIds(
  entryNodeIds: string[],
  transitions: HybridFlowTransitionV1[],
) {
  if (entryNodeIds.length === 0) {
    return new Set<string>();
  }

  const targetsBySource = new Map<string, string[]>();
  for (const transition of transitions) {
    if (!transition.targetNodeId) {
      continue;
    }
    targetsBySource.set(transition.sourceNodeId, [
      ...(targetsBySource.get(transition.sourceNodeId) ?? []),
      transition.targetNodeId,
    ]);
  }

  const reachable = new Set<string>();
  const pending = [...entryNodeIds];
  while (pending.length > 0) {
    const nodeId = pending.shift();
    if (!nodeId || reachable.has(nodeId)) {
      continue;
    }
    reachable.add(nodeId);
    pending.push(...(targetsBySource.get(nodeId) ?? []));
  }
  return reachable;
}

function findMaximumTraversalDepth(input: {
  entryNodeId: string | null;
  transitions: HybridFlowTransitionV1[];
}) {
  if (!input.entryNodeId) {
    return 0;
  }

  const targetsBySource = new Map<string, string[]>();
  for (const transition of input.transitions) {
    if (
      !transition.targetNodeId ||
      transition.kind === "task_outcome" ||
      transition.kind === "tool_result"
    ) {
      continue;
    }
    targetsBySource.set(transition.sourceNodeId, [
      ...(targetsBySource.get(transition.sourceNodeId) ?? []),
      transition.targetNodeId,
    ]);
  }

  let maximum = 1;
  const visit = (nodeId: string, path: Set<string>): number => {
    if (path.has(nodeId)) {
      return Number.POSITIVE_INFINITY;
    }
    const nextPath = new Set(path).add(nodeId);
    const targets = targetsBySource.get(nodeId) ?? [];
    let depth = 1;
    for (const target of targets) {
      const childDepth: number = visit(target, nextPath);
      if (!Number.isFinite(childDepth)) {
        return childDepth;
      }
      depth = Math.max(depth, childDepth + 1);
    }
    return depth;
  };

  maximum = visit(input.entryNodeId, new Set());
  return maximum;
}

function buildTerminalReachability(input: {
  nodes: HybridFlowNodeV1[];
  transitions: HybridFlowTransitionV1[];
}) {
  const canTerminate = new Set<string>();
  const reverseEdges = new Map<string, string[]>();

  for (const node of input.nodes) {
    if (
      (node.kind === "knowledge" && node.settings.remainActiveAfterAnswer) ||
      (node.kind === "deterministic" &&
        BASE_TERMINAL_STEP_TYPES.has(node.stepType))
    ) {
      canTerminate.add(node.id);
    }
  }

  for (const transition of input.transitions) {
    if (!transition.targetNodeId) {
      canTerminate.add(transition.sourceNodeId);
      continue;
    }
    reverseEdges.set(transition.targetNodeId, [
      ...(reverseEdges.get(transition.targetNodeId) ?? []),
      transition.sourceNodeId,
    ]);
  }

  const pending = [...canTerminate];
  while (pending.length > 0) {
    const nodeId = pending.shift();
    if (!nodeId) {
      continue;
    }
    for (const source of reverseEdges.get(nodeId) ?? []) {
      if (!canTerminate.has(source)) {
        canTerminate.add(source);
        pending.push(source);
      }
    }
  }

  return canTerminate;
}

export function compileHybridFlowGraph(input: {
  actionSettings?: Record<string, unknown>;
  branchRules: ActionFlowCompilerBranchRule[];
  maxTraversalDepth?: number;
  steps: ActionFlowCompilerStep[];
}): HybridFlowCompilerResult {
  const maxTraversalDepth = input.maxTraversalDepth ?? 20;
  const base = compileActionFlowGraph(input);
  const runnableSteps = input.steps
    .filter((step) => base.runnableStepIds.includes(step.id))
    .sort(
      (left, right) => left.sortOrder - right.sortOrder || left.id - right.id,
    );
  const stepById = new Map(runnableSteps.map((step) => [step.id, step]));
  const issues: HybridFlowCompilerIssue[] = [];
  const nodes: HybridFlowNodeV1[] = [];
  const transitions: HybridFlowTransitionV1[] = [];

  for (const step of runnableSteps) {
    const id = getHybridNodeId(step.id);
    const label =
      (typeof step.settings.nodeLabel === "string" &&
        step.settings.nodeLabel.trim()) ||
      `Step ${step.sortOrder}`;

    if (step.stepType === "knowledge_conversation") {
      const settings = readKnowledgeFlowNodeSettings(step.settings);
      if (!settings) {
        issues.push({
          code: "hybrid_config_invalid",
          message: `Step ${step.sortOrder} has invalid knowledge settings.`,
          severity: "error",
          stepId: step.id,
        });
        continue;
      }
      nodes.push({
        goal:
          (typeof step.settings.knowledgeGoal === "string" &&
            step.settings.knowledgeGoal.trim()) ||
          "Answer the visitor using approved project knowledge.",
        id,
        kind: "knowledge",
        label,
        responseOwner: "knowledge",
        settings,
        sourceStepId: step.id,
      });
      continue;
    }

    if (step.stepType === "conversational_task") {
      const settings = readConversationalTaskFlowNodeSettings(step.settings);
      if (!settings) {
        issues.push({
          code: "hybrid_config_invalid",
          message: `Step ${step.sortOrder} has an invalid conversational task reference.`,
          severity: "error",
          stepId: step.id,
        });
        continue;
      }
      nodes.push({
        id,
        kind: "conversational_task",
        label,
        responseOwner: "task",
        settings,
        sourceStepId: step.id,
      });
      continue;
    }

    nodes.push({
      id,
      kind: "deterministic",
      label,
      responseOwner: "deterministic",
      sourceStepId: step.id,
      stepType: step.stepType,
    });
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  for (const edge of base.edges) {
    const sourceNodeId = getHybridNodeId(edge.sourceStepId);
    const targetNodeId = getHybridNodeId(edge.targetStepId);
    const sourceNode = nodeById.get(sourceNodeId);
    if (
      !sourceNode ||
      !nodeById.has(targetNodeId) ||
      (sourceNode.kind !== "deterministic" && edge.type === "ordered")
    ) {
      continue;
    }
    addTransition(transitions, {
      idPart: String(edge.ruleId ?? edge.targetStepId),
      kind: edge.type === "branch" ? "deterministic" : "default",
      priority: edge.type === "branch" ? 100 : 20,
      sourceNodeId,
      sourceRuleId: edge.ruleId ?? null,
      targetNodeId,
      triggerKey: edge.type,
    });
  }

  for (const node of nodes) {
    const step = stepById.get(node.sourceStepId);
    if (!step) {
      continue;
    }

    if (node.kind === "knowledge") {
      if (
        !node.settings.remainActiveAfterAnswer &&
        node.settings.answeredRoute === null
      ) {
        issues.push({
          code: "hybrid_config_invalid",
          message: `Step ${step.sortOrder} needs an answered route when it does not remain active.`,
          severity: "error",
          stepId: step.id,
        });
      }

      if (node.settings.answeredRoute !== null) {
        const targetNodeId = routeTargetNodeId(
          node.settings.answeredRoute,
          stepById,
        );
        if (node.settings.answeredRoute !== "end" && !targetNodeId) {
          issues.push({
            code: "hybrid_route_invalid",
            message: `Step ${step.sortOrder} has an unavailable answered route.`,
            severity: "error",
            stepId: step.id,
          });
        } else {
          addTransition(transitions, {
            idPart: "answered",
            kind: "semantic",
            priority: 60,
            sourceNodeId: node.id,
            sourceRuleId: null,
            targetNodeId,
            triggerKey: "answered",
          });
        }
      }

      for (const targetStepId of node.settings.recommendationTargetStepIds) {
        const targetNode = nodeById.get(getHybridNodeId(targetStepId));
        if (!targetNode || targetNode.kind !== "conversational_task") {
          issues.push({
            code: "hybrid_route_invalid",
            message: `Step ${step.sortOrder} has a task recommendation route to an unavailable task node.`,
            severity: "error",
            stepId: step.id,
          });
          continue;
        }
        addTransition(transitions, {
          idPart: `task-${targetStepId}`,
          kind: "semantic",
          priority: 50,
          sourceNodeId: node.id,
          sourceRuleId: null,
          targetNodeId: targetNode.id,
          triggerKey: `task:${targetNode.settings.task.taskId}`,
        });
      }

      for (const [triggerKey, route] of [
        ["no_answer", node.settings.noAnswerRoute],
        ["handoff", node.settings.handoffRoute],
      ] as const) {
        const targetNodeId = routeTargetNodeId(route, stepById);
        if (route !== "end" && !targetNodeId) {
          issues.push({
            code: "hybrid_route_invalid",
            message: `Step ${step.sortOrder} has an unavailable ${triggerKey.replace("_", " ")} route.`,
            severity: "error",
            stepId: step.id,
          });
          continue;
        }
        addTransition(transitions, {
          idPart: triggerKey,
          kind: triggerKey === "handoff" ? "tool_result" : "semantic",
          priority: 80,
          sourceNodeId: node.id,
          sourceRuleId: null,
          targetNodeId,
          triggerKey,
        });
      }
    }

    if (node.kind === "conversational_task") {
      const outputPorts = new Set(
        node.settings.task.outcomes.map((outcome) => outcome.outputPort),
      );
      for (const outputPort of outputPorts) {
        const route = node.settings.outcomeRoutes[outputPort];
        if (route === undefined) {
          issues.push({
            code: "hybrid_route_invalid",
            message: `Step ${step.sortOrder} needs a route for task output "${outputPort}".`,
            severity: "error",
            stepId: step.id,
          });
          continue;
        }
        const targetNodeId = routeTargetNodeId(route, stepById);
        if (route !== "end" && !targetNodeId) {
          issues.push({
            code: "hybrid_route_invalid",
            message: `Step ${step.sortOrder} has an unavailable route for task output "${outputPort}".`,
            severity: "error",
            stepId: step.id,
          });
          continue;
        }
        addTransition(transitions, {
          idPart: outputPort,
          kind: "task_outcome",
          priority: 90,
          sourceNodeId: node.id,
          sourceRuleId: null,
          targetNodeId,
          triggerKey: outputPort,
        });
      }
    }
  }

  const entrySettings = readHybridFlowEntryPolicySettings(input.actionSettings);
  if (!entrySettings) {
    issues.push({
      code: "hybrid_config_invalid",
      message: "The flow has an invalid entry policy.",
      severity: "error",
    });
  }
  const normalStepId = entrySettings?.normalStepId ?? base.entryStepId ?? null;
  const normalNodeId =
    normalStepId && nodeById.has(getHybridNodeId(normalStepId))
      ? getHybridNodeId(normalStepId)
      : null;
  if (normalStepId && !normalNodeId) {
    issues.push({
      code: "hybrid_route_invalid",
      message: "The normal entry route points to an unavailable node.",
      severity: "error",
      stepId: normalStepId,
    });
  }

  function compileEntryRoutes(routes: Record<string, number>) {
    return Object.fromEntries(
      Object.entries(routes).flatMap(([key, stepId]) => {
        const nodeId = getHybridNodeId(stepId);
        if (!nodeById.has(nodeId)) {
          issues.push({
            code: "hybrid_route_invalid",
            message: `Entry route "${key}" points to an unavailable node.`,
            severity: "error",
            stepId,
          });
          return [];
        }
        return [[key, nodeId]];
      }),
    );
  }

  const entryPolicy = {
    campaignRoutes: compileEntryRoutes(entrySettings?.campaignRoutes ?? {}),
    channelRoutes: compileEntryRoutes(entrySettings?.channelRoutes ?? {}),
    deepLinkRoutes: compileEntryRoutes(entrySettings?.deepLinkRoutes ?? {}),
    normalNodeId,
  };
  const entryNodeIds = [
    normalNodeId,
    ...Object.values(entryPolicy.deepLinkRoutes),
    ...Object.values(entryPolicy.campaignRoutes),
    ...Object.values(entryPolicy.channelRoutes),
  ].filter((nodeId): nodeId is string => Boolean(nodeId));
  const reachableNodeIds = buildReachableNodeIds(entryNodeIds, transitions);
  for (const node of nodes) {
    if (!reachableNodeIds.has(node.id)) {
      issues.push({
        code: "hybrid_step_unreachable",
        message: `${node.label} is not reachable from the graph entry.`,
        severity: "error",
        stepId: node.sourceStepId,
      });
    }
  }

  const canTerminate = buildTerminalReachability({ nodes, transitions });
  for (const node of nodes) {
    if (reachableNodeIds.has(node.id) && !canTerminate.has(node.id)) {
      issues.push({
        code: "hybrid_terminal_unreachable",
        message: `${node.label} cannot reach a stable knowledge state or terminal route.`,
        severity: "error",
        stepId: node.sourceStepId,
      });
    }
  }

  const maximumDepth = entryNodeIds.reduce(
    (maximum, entryNodeId) =>
      Math.max(
        maximum,
        findMaximumTraversalDepth({
          entryNodeId,
          transitions,
        }),
      ),
    0,
  );
  if (!Number.isFinite(maximumDepth) || maximumDepth > maxTraversalDepth) {
    issues.push({
      code: "hybrid_depth_exceeded",
      message: `The graph exceeds the maximum traversal depth of ${maxTraversalDepth}.`,
      severity: "error",
    });
  }

  return {
    baseIssues: base.issues.filter(
      (issue) => !HYBRID_GRAPH_ISSUE_CODES.has(issue.code),
    ),
    graph: {
      entryNodeId: normalNodeId,
      entryPolicy,
      maxTraversalDepth,
      nodes,
      schemaVersion: 1,
      transitions,
    },
    issues,
  };
}
