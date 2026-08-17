import { z } from "zod";
import { behavioralFlowTestReportV1Schema } from "@/lib/hybrid-flow-behavioral-test";
import { combinationFlowTestReportV1Schema } from "@/lib/hybrid-flow-combination-test";
import type {
  CompiledHybridFlowGraphV1,
  HybridFlowNodeV1,
} from "@/lib/hybrid-flow-contracts";
import { resourceFlowTestReportV1Schema } from "@/lib/hybrid-flow-resource-test";

export const AUTOMATED_FLOW_TEST_AUDIT_ACTION =
  "chatbot_action.automated_test_completed";
export const AUTOMATED_FLOW_TEST_TARGET_TYPE = "action_flow_version";

const automatedFlowTestCheckV1Schema = z.object({
  detail: z.string(),
  key: z.string(),
  label: z.string(),
  status: z.enum(["failed", "passed"]),
});

export const automatedFlowTestReportV1Schema = z.object({
  behavioral: behavioralFlowTestReportV1Schema.optional(),
  checks: z.array(automatedFlowTestCheckV1Schema),
  combinations: combinationFlowTestReportV1Schema.optional(),
  entriesTested: z.number().int().nonnegative(),
  errors: z.array(z.string()),
  maximumDepth: z.number().int().nonnegative(),
  nodesTested: z.number().int().nonnegative(),
  resources: resourceFlowTestReportV1Schema.optional(),
  routesTested: z.number().int().nonnegative(),
  schemaVersion: z.literal(1),
  status: z.enum(["failed", "passed"]),
  terminalNodes: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export type AutomatedFlowTestReportV1 = z.infer<
  typeof automatedFlowTestReportV1Schema
>;

export const automatedFlowTestAuditMetadataSchema = z.object({
  actionId: z.number().int().positive(),
  report: automatedFlowTestReportV1Schema,
  versionId: z.number().int().positive(),
  versionNumber: z.number().int().positive(),
});

function listEntryNodeIds(graph: CompiledHybridFlowGraphV1) {
  return [
    graph.entryPolicy.normalNodeId,
    ...Object.values(graph.entryPolicy.deepLinkRoutes),
    ...Object.values(graph.entryPolicy.campaignRoutes),
    ...Object.values(graph.entryPolicy.channelRoutes),
  ].filter((nodeId): nodeId is string => Boolean(nodeId));
}

function isStableTerminalNode(node: HybridFlowNodeV1) {
  if (node.kind === "knowledge") {
    return node.settings.remainActiveAfterAnswer;
  }

  return (
    node.kind === "deterministic" &&
    ["confirmation", "connect_flow", "handoff", "submit"].includes(
      node.stepType,
    )
  );
}

function addUnique(target: string[], message: string) {
  if (!target.includes(message)) {
    target.push(message);
  }
}

export function runAutomatedHybridFlowTest(
  graph: CompiledHybridFlowGraphV1,
): AutomatedFlowTestReportV1 {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeById = new Map<string, HybridFlowNodeV1>();
  const transitionIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeById.has(node.id)) {
      addUnique(errors, `Node ID ${node.id} is duplicated.`);
    }
    nodeById.set(node.id, node);
  }

  for (const transition of graph.transitions) {
    if (transitionIds.has(transition.id)) {
      addUnique(errors, `Route ID ${transition.id} is duplicated.`);
    }
    transitionIds.add(transition.id);
    if (!nodeById.has(transition.sourceNodeId)) {
      addUnique(
        errors,
        `Route ${transition.id} starts from missing node ${transition.sourceNodeId}.`,
      );
    }
    if (transition.targetNodeId && !nodeById.has(transition.targetNodeId)) {
      addUnique(
        errors,
        `Route ${transition.id} points to missing node ${transition.targetNodeId}.`,
      );
    }
  }

  const entryNodeIds = listEntryNodeIds(graph);
  if (entryNodeIds.length === 0) {
    errors.push("No published entry route is configured.");
  }
  for (const nodeId of entryNodeIds) {
    if (!nodeById.has(nodeId)) {
      addUnique(errors, `Entry route points to missing node ${nodeId}.`);
    }
  }

  const targetsBySource = new Map<string, string[]>();
  const reverseEdges = new Map<string, string[]>();
  for (const transition of graph.transitions) {
    if (!nodeById.has(transition.sourceNodeId)) {
      continue;
    }
    if (!transition.targetNodeId || !nodeById.has(transition.targetNodeId)) {
      continue;
    }
    targetsBySource.set(transition.sourceNodeId, [
      ...(targetsBySource.get(transition.sourceNodeId) ?? []),
      transition.targetNodeId,
    ]);
    reverseEdges.set(transition.targetNodeId, [
      ...(reverseEdges.get(transition.targetNodeId) ?? []),
      transition.sourceNodeId,
    ]);
  }

  const reachable = new Set<string>();
  const pending = entryNodeIds.filter((nodeId) => nodeById.has(nodeId));
  while (pending.length > 0) {
    const nodeId = pending.shift();
    if (!nodeId || reachable.has(nodeId)) {
      continue;
    }
    reachable.add(nodeId);
    pending.push(...(targetsBySource.get(nodeId) ?? []));
  }

  const unreachableNodes = graph.nodes.filter(
    (node) => !reachable.has(node.id),
  );
  for (const node of unreachableNodes) {
    errors.push(
      `${node.label} (${node.id}) is not reachable from an entry route.`,
    );
  }

  const terminalNodeIds = new Set(
    graph.nodes.filter(isStableTerminalNode).map((node) => node.id),
  );
  for (const transition of graph.transitions) {
    if (!transition.targetNodeId && nodeById.has(transition.sourceNodeId)) {
      terminalNodeIds.add(transition.sourceNodeId);
    }
  }

  const canFinish = new Set(terminalNodeIds);
  const finishPending = [...canFinish];
  while (finishPending.length > 0) {
    const nodeId = finishPending.shift();
    if (!nodeId) {
      continue;
    }
    for (const sourceNodeId of reverseEdges.get(nodeId) ?? []) {
      if (!canFinish.has(sourceNodeId)) {
        canFinish.add(sourceNodeId);
        finishPending.push(sourceNodeId);
      }
    }
  }
  for (const nodeId of reachable) {
    if (!canFinish.has(nodeId)) {
      const node = nodeById.get(nodeId);
      errors.push(
        `${node?.label ?? nodeId} (${nodeId}) cannot reach a terminal path.`,
      );
    }
  }

  const visiting = new Set<string>();
  const depthByNode = new Map<string, number>();
  let cycleDetected = false;

  function findDepth(nodeId: string): number {
    const knownDepth = depthByNode.get(nodeId);
    if (knownDepth !== undefined) {
      return knownDepth;
    }
    if (visiting.has(nodeId)) {
      cycleDetected = true;
      return 0;
    }

    visiting.add(nodeId);
    let depth = 1;
    for (const targetNodeId of targetsBySource.get(nodeId) ?? []) {
      depth = Math.max(depth, findDepth(targetNodeId) + 1);
    }
    visiting.delete(nodeId);
    depthByNode.set(nodeId, depth);
    return depth;
  }

  let maximumDepth = 0;
  for (const nodeId of entryNodeIds) {
    if (nodeById.has(nodeId)) {
      maximumDepth = Math.max(maximumDepth, findDepth(nodeId));
    }
  }
  if (cycleDetected) {
    errors.push("A reachable route cycle was detected.");
  } else if (maximumDepth > graph.maxTraversalDepth) {
    errors.push(
      `The longest route depth is ${maximumDepth}, above the published limit of ${graph.maxTraversalDepth}.`,
    );
  }

  const routesTested = graph.transitions.filter((transition) =>
    reachable.has(transition.sourceNodeId),
  ).length;
  const referenceErrors = errors.filter(
    (message) =>
      message.includes("duplicated") || message.includes("missing node"),
  );
  const entryErrors = errors.filter(
    (message) =>
      message.startsWith("Entry route") ||
      message.startsWith("No published entry"),
  );
  const completionErrors = errors.filter((message) =>
    message.includes("terminal path"),
  );
  const depthErrors = errors.filter(
    (message) => message.includes("cycle") || message.includes("longest route"),
  );

  const checks: AutomatedFlowTestReportV1["checks"] = [
    {
      detail:
        entryErrors[0] ??
        `${entryNodeIds.length} published entry route(s) resolved.`,
      key: "entries",
      label: "Entry routes",
      status: entryErrors.length > 0 ? "failed" : "passed",
    },
    {
      detail:
        referenceErrors[0] ??
        `${graph.nodes.length} node(s) and ${graph.transitions.length} route reference(s) are valid.`,
      key: "references",
      label: "Graph references",
      status: referenceErrors.length > 0 ? "failed" : "passed",
    },
    {
      detail:
        unreachableNodes.length > 0
          ? `${unreachableNodes.length} published node(s) could not be reached.`
          : `${reachable.size} published node(s) were reached.`,
      key: "reachability",
      label: "Node reachability",
      status: unreachableNodes.length > 0 ? "failed" : "passed",
    },
    {
      detail: `${routesTested} of ${graph.transitions.length} published route(s) were covered.`,
      key: "routes",
      label: "Route coverage",
      status: routesTested === graph.transitions.length ? "passed" : "failed",
    },
    {
      detail:
        completionErrors[0] ??
        `${terminalNodeIds.size} terminal or stable completion node(s) were verified.`,
      key: "completion",
      label: "Finish paths",
      status: completionErrors.length > 0 ? "failed" : "passed",
    },
    {
      detail:
        depthErrors[0] ??
        `Maximum route depth ${maximumDepth} is within the limit of ${graph.maxTraversalDepth}.`,
      key: "depth",
      label: "Cycle and depth limit",
      status: depthErrors.length > 0 ? "failed" : "passed",
    },
  ];

  const status = errors.length === 0 ? "passed" : "failed";
  return automatedFlowTestReportV1Schema.parse({
    checks,
    entriesTested: entryNodeIds.length,
    errors,
    maximumDepth,
    nodesTested: reachable.size,
    routesTested,
    schemaVersion: 1,
    status,
    terminalNodes: terminalNodeIds.size,
    warnings,
  });
}
