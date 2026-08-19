import { z } from "zod";
import type { ActionFlowVersionSnapshot } from "@/lib/action-flows";
import {
  buildActionStepChannelMessage,
  buildActionStepTextFallbackMessage,
  buildStepAnswerResult,
  getActionStepOptions,
  getNextActionStepDecision,
  getRunnableActionSteps,
  isActionConfirmationStep,
  isActionInputStep,
  isActionReplyOption,
  type RuntimeAction,
  type RuntimeActionStep,
  validateStepAnswer,
} from "@/lib/action-runtime";
import { buildValidBehavioralCandidates } from "@/lib/hybrid-flow-behavioral-test";
import type { CompiledHybridFlowGraphV1 } from "@/lib/hybrid-flow-contracts";
import { getHybridNodeId } from "@/lib/hybrid-flow-contracts";

const conversationScenarioTurnV1Schema = z.object({
  answer: z.string().nullable(),
  detail: z.string(),
  nextNodeId: z.string().nullable(),
  nodeId: z.string(),
  prompt: z.string(),
  replyType: z.enum(["buttons", "text"]),
  status: z.enum(["failed", "passed"]),
  stepLabel: z.string(),
});

const conversationScenarioV1Schema = z.object({
  entryNodeId: z.string(),
  errors: z.array(z.string()),
  key: z.string(),
  label: z.string(),
  status: z.enum(["failed", "passed", "skipped"]),
  turns: z.array(conversationScenarioTurnV1Schema),
  warnings: z.array(z.string()),
});

export const conversationScenarioTestReportV1Schema = z.object({
  errors: z.array(z.string()),
  scenarios: z.array(conversationScenarioV1Schema),
  scenariosFailed: z.number().int().nonnegative(),
  scenariosPassed: z.number().int().nonnegative(),
  scenariosRun: z.number().int().nonnegative(),
  scenariosSkipped: z.number().int().nonnegative(),
  schemaVersion: z.literal(1),
  status: z.enum(["failed", "passed"]),
  turnsChecked: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export type ConversationScenarioTestReportV1 = z.infer<
  typeof conversationScenarioTestReportV1Schema
>;

type RunConversationScenarioTestInput = {
  graph: CompiledHybridFlowGraphV1;
  snapshot: ActionFlowVersionSnapshot;
  versionId: number;
  versionNumber: number;
};

function getStepLabel(step: RuntimeActionStep) {
  return step.label?.trim() || step.prompt?.trim() || `Step ${step.sortOrder}`;
}

function toRuntimeAction({
  graph,
  snapshot,
  versionId,
  versionNumber,
}: RunConversationScenarioTestInput): RuntimeAction {
  return {
    ...snapshot.action,
    branchRules: snapshot.branchRules,
    hybridGraph: graph,
    steps: snapshot.steps,
    versionId,
    versionNumber,
  };
}

function listEntryScenarios(graph: CompiledHybridFlowGraphV1) {
  const candidates = [
    {
      key: "normal",
      label: "Normal conversation",
      nodeId: graph.entryPolicy.normalNodeId,
    },
    ...Object.entries(graph.entryPolicy.deepLinkRoutes).map(
      ([key, nodeId]) => ({
        key: `deep-link:${key}`,
        label: `Deep link: ${key}`,
        nodeId,
      }),
    ),
    ...Object.entries(graph.entryPolicy.campaignRoutes).map(
      ([key, nodeId]) => ({
        key: `campaign:${key}`,
        label: `Campaign: ${key}`,
        nodeId,
      }),
    ),
    ...Object.entries(graph.entryPolicy.channelRoutes).map(([key, nodeId]) => ({
      key: `channel:${key}`,
      label: `Channel: ${key}`,
      nodeId,
    })),
  ];
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    if (!candidate.nodeId || seen.has(candidate.nodeId)) {
      return false;
    }
    seen.add(candidate.nodeId);
    return true;
  }) as Array<{ key: string; label: string; nodeId: string }>;
}

function isStableTerminalStep(step: RuntimeActionStep) {
  return (
    isActionConfirmationStep(step) ||
    ["connect_flow", "handoff", "submit"].includes(step.stepType)
  );
}

function findSyntheticAnswer(
  step: RuntimeActionStep,
  fields: Record<string, unknown>,
) {
  const option = getActionStepOptions(step, fields).find(isActionReplyOption);
  if (option) {
    return option.label;
  }

  return buildValidBehavioralCandidates(step).find(
    (candidate) => validateStepAnswer(step, candidate, fields).isValid,
  );
}

function hasPublishedRoute(
  graph: CompiledHybridFlowGraphV1,
  sourceNodeId: string,
  targetNodeId: string | null,
) {
  return graph.transitions.some(
    (transition) =>
      transition.sourceNodeId === sourceNodeId &&
      transition.targetNodeId === targetNodeId,
  );
}

export function runConversationScenarioTest(
  input: RunConversationScenarioTestInput,
): ConversationScenarioTestReportV1 {
  const action = toRuntimeAction(input);
  const runnableSteps = getRunnableActionSteps(action);
  const stepByNodeId = new Map(
    runnableSteps.map((step) => [getHybridNodeId(step.id), step]),
  );
  const nodeById = new Map(input.graph.nodes.map((node) => [node.id, node]));
  const scenarios: ConversationScenarioTestReportV1["scenarios"] = [];

  for (const entry of listEntryScenarios(input.graph)) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const turns: ConversationScenarioTestReportV1["scenarios"][number]["turns"] =
      [];
    const entryNode = nodeById.get(entry.nodeId);

    if (!entryNode) {
      errors.push(
        `Entry node ${entry.nodeId} is missing from the published graph.`,
      );
      scenarios.push({
        entryNodeId: entry.nodeId,
        errors,
        key: entry.key,
        label: entry.label,
        status: "failed",
        turns,
        warnings,
      });
      continue;
    }

    if (entryNode.kind !== "deterministic") {
      warnings.push(
        `${entry.label} starts with a ${entryNode.kind.replaceAll("_", " ")} node, so deterministic reply replay was skipped.`,
      );
      scenarios.push({
        entryNodeId: entry.nodeId,
        errors,
        key: entry.key,
        label: entry.label,
        status: "skipped",
        turns,
        warnings,
      });
      continue;
    }

    const fields: Record<string, unknown> = {};
    const visited = new Set<string>();
    let currentNodeId: string | null = entry.nodeId;
    let depth = 0;
    let replayStopped = false;

    while (currentNodeId && depth < input.graph.maxTraversalDepth) {
      if (visited.has(currentNodeId)) {
        errors.push(`The scenario revisited ${currentNodeId} and would loop.`);
        replayStopped = true;
        break;
      }
      visited.add(currentNodeId);
      depth += 1;

      const node = nodeById.get(currentNodeId);
      if (!node || node.kind !== "deterministic") {
        warnings.push(
          `Replay stopped at ${currentNodeId} because the next reply is owned by ${node?.responseOwner ?? "an unknown owner"}.`,
        );
        replayStopped = true;
        break;
      }

      const step = stepByNodeId.get(currentNodeId);
      if (!step) {
        errors.push(`${node.label} has no runnable published step.`);
        replayStopped = true;
        break;
      }

      const stepLabel = getStepLabel(step);
      const prompt = buildActionStepChannelMessage(step).trim();
      const fallback = buildActionStepTextFallbackMessage(step, fields).trim();
      const options = getActionStepOptions(step, fields).filter(
        isActionReplyOption,
      );
      let answer: string | null = null;
      let nextNodeId: string | null = null;
      let detail = "Reply text and progression are valid.";
      let turnStatus: "failed" | "passed" = "passed";

      if (!prompt || !fallback) {
        turnStatus = "failed";
        detail = "The published step produced an empty visitor reply.";
      } else {
        const missingOption = options.find(
          (option) => !fallback.includes(option.label),
        );
        if (missingOption) {
          turnStatus = "failed";
          detail = `The text fallback does not include option "${missingOption.label}".`;
        }
      }

      if (isActionInputStep(step)) {
        if (["file_upload", "product_selection"].includes(step.stepType)) {
          warnings.push(
            `${stepLabel}: synthetic resource input is covered by the resource-backed checks, so replay stopped here.`,
          );
          turns.push({
            answer,
            detail,
            nextNodeId,
            nodeId: currentNodeId,
            prompt: fallback,
            replyType: options.length > 0 ? "buttons" : "text",
            status: turnStatus,
            stepLabel,
          });
          if (turnStatus === "failed") {
            errors.push(`${stepLabel}: ${detail}`);
          }
          replayStopped = true;
          break;
        }

        answer = findSyntheticAnswer(step, fields) ?? null;
        const validation = answer
          ? validateStepAnswer(step, answer, fields)
          : null;
        if (!answer || !validation?.isValid) {
          turnStatus = "failed";
          detail = "No safe synthetic visitor answer satisfied this step.";
        } else if (step.fieldKey) {
          Object.assign(
            fields,
            buildStepAnswerResult(step, step.fieldKey, validation.value, fields)
              .fields,
          );
        }
      }

      if (!isStableTerminalStep(step)) {
        const stepIndex = runnableSteps.findIndex(
          (item) => item.id === step.id,
        );
        const decision = getNextActionStepDecision(
          action,
          step,
          stepIndex,
          fields,
        );
        nextNodeId = decision.targetStepId
          ? getHybridNodeId(decision.targetStepId)
          : null;

        if (!hasPublishedRoute(input.graph, currentNodeId, nextNodeId)) {
          turnStatus = "failed";
          detail = nextNodeId
            ? `Runtime progression to ${nextNodeId} is missing from the published graph.`
            : "Runtime progression ended before a terminal step.";
        }
      }

      turns.push({
        answer,
        detail,
        nextNodeId,
        nodeId: currentNodeId,
        prompt: fallback,
        replyType: options.length > 0 ? "buttons" : "text",
        status: turnStatus,
        stepLabel,
      });
      if (turnStatus === "failed") {
        errors.push(`${stepLabel}: ${detail}`);
        replayStopped = true;
        break;
      }
      if (isStableTerminalStep(step)) {
        replayStopped = true;
        break;
      }

      currentNodeId = nextNodeId;
    }

    if (
      !replayStopped &&
      depth >= input.graph.maxTraversalDepth &&
      currentNodeId
    ) {
      errors.push(
        `The scenario reached the published depth limit of ${input.graph.maxTraversalDepth}.`,
      );
    }

    scenarios.push({
      entryNodeId: entry.nodeId,
      errors,
      key: entry.key,
      label: entry.label,
      status: errors.length > 0 ? "failed" : "passed",
      turns,
      warnings,
    });
  }

  const errors = scenarios.flatMap((scenario) => scenario.errors);
  const warnings = scenarios.flatMap((scenario) => scenario.warnings);
  const scenariosFailed = scenarios.filter(
    (scenario) => scenario.status === "failed",
  ).length;
  const scenariosPassed = scenarios.filter(
    (scenario) => scenario.status === "passed",
  ).length;
  const scenariosSkipped = scenarios.filter(
    (scenario) => scenario.status === "skipped",
  ).length;

  return conversationScenarioTestReportV1Schema.parse({
    errors,
    scenarios,
    scenariosFailed,
    scenariosPassed,
    scenariosRun: scenarios.length,
    scenariosSkipped,
    schemaVersion: 1,
    status: scenariosFailed === 0 ? "passed" : "failed",
    turnsChecked: scenarios.reduce(
      (total, scenario) => total + scenario.turns.length,
      0,
    ),
    warnings,
  });
}
