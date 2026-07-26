import { z } from "zod";
import { taskOutcomeV1Schema } from "@/lib/conversation-contracts";

export const HYBRID_FLOW_NODE_KINDS = [
  "deterministic",
  "knowledge",
  "conversational_task",
] as const;

export const HYBRID_FLOW_TRANSITION_KINDS = [
  "deterministic",
  "default",
  "semantic",
  "tool_result",
  "task_outcome",
] as const;

export const HYBRID_INBOUND_INTERACTION_TYPES = [
  "text",
  "button",
  "list",
  "product",
  "location",
  "media",
] as const;

export const HYBRID_REPLY_INTENT_TYPES = [
  "text",
  "choice",
  "media",
  "product",
  "request_input",
  "handoff",
  "end",
] as const;

const stableKey = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z][a-zA-Z0-9_.:-]*$/);
const responseOwner = z.enum(["knowledge", "task", "deterministic", "human"]);
const routeTarget = z.union([z.literal("end"), z.number().int().positive()]);
const entryRoutes = z.record(stableKey, z.number().int().positive());

export const hybridFlowEntryPolicySettingsV1Schema = z.object({
  schemaVersion: z.literal(1).default(1),
  normalStepId: z.number().int().positive().nullable().default(null),
  deepLinkRoutes: entryRoutes.default({}),
  campaignRoutes: entryRoutes.default({}),
  channelRoutes: entryRoutes.default({}),
});

export type HybridFlowEntryPolicySettingsV1 = z.infer<
  typeof hybridFlowEntryPolicySettingsV1Schema
>;

export const hybridTaskReferenceV1Schema = z.object({
  schemaVersion: z.literal(1),
  taskId: z.number().int().positive(),
  taskVersionId: z.number().int().positive(),
  versionNumber: z.number().int().positive(),
  name: z.string().trim().min(1).max(160),
  outcomes: z.array(taskOutcomeV1Schema).min(1).max(50),
});

export type HybridTaskReferenceV1 = z.infer<typeof hybridTaskReferenceV1Schema>;

export const knowledgeFlowNodeSettingsV1Schema = z.object({
  schemaVersion: z.literal(1),
  stageMode: z.enum(["goal_driven", "exact"]).default("goal_driven"),
  remainActiveAfterAnswer: z.boolean().default(true),
  recommendationTargetStepIds: z
    .array(z.number().int().positive())
    .max(50)
    .default([]),
  answeredRoute: routeTarget.nullable().default(null),
  noAnswerRoute: routeTarget,
  handoffRoute: routeTarget,
});

export type KnowledgeFlowNodeSettingsV1 = z.infer<
  typeof knowledgeFlowNodeSettingsV1Schema
>;

export const conversationalTaskFlowNodeSettingsV1Schema = z.object({
  schemaVersion: z.literal(1),
  task: hybridTaskReferenceV1Schema,
  transferFieldKeys: z.array(stableKey).max(100).default([]),
  transferContextKeys: z.array(stableKey).max(100).default([]),
  outcomeRoutes: z.record(stableKey, routeTarget),
});

export type ConversationalTaskFlowNodeSettingsV1 = z.infer<
  typeof conversationalTaskFlowNodeSettingsV1Schema
>;

const hybridFlowNodeBaseV1Schema = z.object({
  id: stableKey,
  sourceStepId: z.number().int().positive(),
  label: z.string().trim().min(1).max(160),
});

export const hybridFlowNodeV1Schema = z.discriminatedUnion("kind", [
  hybridFlowNodeBaseV1Schema.extend({
    kind: z.literal("deterministic"),
    responseOwner: z.literal("deterministic"),
    stepType: z.string().trim().min(1).max(80),
  }),
  hybridFlowNodeBaseV1Schema.extend({
    kind: z.literal("knowledge"),
    responseOwner: z.literal("knowledge"),
    goal: z.string().trim().min(1).max(1000),
    settings: knowledgeFlowNodeSettingsV1Schema,
  }),
  hybridFlowNodeBaseV1Schema.extend({
    kind: z.literal("conversational_task"),
    responseOwner: z.literal("task"),
    settings: conversationalTaskFlowNodeSettingsV1Schema,
  }),
]);

export type HybridFlowNodeV1 = z.infer<typeof hybridFlowNodeV1Schema>;

export const hybridFlowTransitionV1Schema = z.object({
  id: stableKey,
  sourceNodeId: stableKey,
  targetNodeId: stableKey.nullable(),
  kind: z.enum(HYBRID_FLOW_TRANSITION_KINDS),
  priority: z.number().int().min(0).max(1000),
  triggerKey: z.string().trim().min(1).max(160).nullable(),
  sourceRuleId: z.number().int().positive().nullable(),
});

export type HybridFlowTransitionV1 = z.infer<
  typeof hybridFlowTransitionV1Schema
>;

export const compiledHybridFlowGraphV1Schema = z.object({
  schemaVersion: z.literal(1),
  entryNodeId: stableKey.nullable(),
  entryPolicy: z.object({
    normalNodeId: stableKey.nullable(),
    deepLinkRoutes: z.record(stableKey, stableKey),
    campaignRoutes: z.record(stableKey, stableKey),
    channelRoutes: z.record(stableKey, stableKey),
  }),
  maxTraversalDepth: z.number().int().min(1).max(100),
  nodes: z.array(hybridFlowNodeV1Schema).max(500),
  transitions: z.array(hybridFlowTransitionV1Schema).max(2000),
});

export type CompiledHybridFlowGraphV1 = z.infer<
  typeof compiledHybridFlowGraphV1Schema
>;

export const normalizedHybridInboundV1Schema = z.object({
  schemaVersion: z.literal(1),
  interactionId: stableKey,
  channelType: z.string().trim().min(1).max(80),
  type: z.enum(HYBRID_INBOUND_INTERACTION_TYPES),
  text: z.string().max(8000).nullable().default(null),
  selectionKey: z.string().trim().max(240).nullable().default(null),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type NormalizedHybridInboundV1 = z.infer<
  typeof normalizedHybridInboundV1Schema
>;

export const channelNeutralReplyIntentV1Schema = z.object({
  schemaVersion: z.literal(1),
  type: z.enum(HYBRID_REPLY_INTENT_TYPES),
  text: z.string().trim().max(8000).nullable().default(null),
  options: z
    .array(
      z.object({
        key: stableKey,
        label: z.string().trim().min(1).max(240),
      }),
    )
    .max(50)
    .default([]),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type ChannelNeutralReplyIntentV1 = z.infer<
  typeof channelNeutralReplyIntentV1Schema
>;

const hybridGraphReturnRouteV1Schema = z.object({
  nodeId: stableKey.nullable(),
  responseOwner,
});

export const hybridGraphTaskReturnTargetV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("hybrid_graph_task"),
  actionVersionId: z.number().int().positive(),
  taskNodeId: stableKey,
  outcomeRoutes: z.record(stableKey, hybridGraphReturnRouteV1Schema),
});

export type HybridGraphTaskReturnTargetV1 = z.infer<
  typeof hybridGraphTaskReturnTargetV1Schema
>;

export const sideQuestionReturnTargetV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("task_side_question"),
  lastRequestedFieldKey: z.string().trim().max(80).nullable(),
  taskRunId: z.number().int().positive(),
  graphReturnTarget: hybridGraphTaskReturnTargetV1Schema.nullable(),
});

export const taskSuspensionReturnTargetV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("task_suspension"),
  boundaryReturnTarget: z.record(z.string(), z.unknown()).nullable(),
  graphReturnTarget: hybridGraphTaskReturnTargetV1Schema.nullable(),
});

export function parseHybridGraphTaskReturnTarget(value: unknown) {
  const direct = hybridGraphTaskReturnTargetV1Schema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  const sideQuestion = sideQuestionReturnTargetV1Schema.safeParse(value);
  if (sideQuestion.success) {
    return sideQuestion.data.graphReturnTarget;
  }

  const suspension = taskSuspensionReturnTargetV1Schema.safeParse(value);
  return suspension.success ? suspension.data.graphReturnTarget : null;
}

export function getHybridNodeId(stepId: number) {
  return `step:${stepId}`;
}
