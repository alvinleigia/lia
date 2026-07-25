import { z } from "zod";
import {
  AI_ANSWER_LENGTHS,
  AI_ASSISTANT_ROLES,
  AI_EXTRA_HELP_POLICIES,
  AI_FOLLOW_UP_POLICIES,
  AI_RESPONSE_PRESETS,
  AI_TONES,
  DEFAULT_PROJECT_AI_SETTINGS,
} from "@/lib/project-ai-settings";

const schemaVersion = z.literal(1);
const optionalText = z.string().trim().max(2000).nullable();
const stableKey = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-zA-Z0-9_]*$/);

export const FIELD_TYPES = [
  "text",
  "email",
  "phone",
  "integer",
  "decimal",
  "boolean",
  "date",
  "time",
  "date_range",
  "address",
  "location",
  "media",
  "enum",
  "project_resource",
] as const;

export const FIELD_CARDINALITIES = ["single", "multiple"] as const;

export const TASK_EXECUTION_STAGES = [
  "extraction",
  "validation",
  "lookup",
  "clarification",
  "confirmation",
  "operation",
  "routing",
] as const;

export const TOOL_STAGES = [
  "extraction",
  "lookup",
  "confirmation",
  "operation",
] as const;

export const TURN_MODEL_STAGES = [
  "knowledge",
  "extraction",
  "clarification",
  "lookup",
  "confirmation",
  "operation",
  "routing",
] as const;

export const CUSTOM_CONTEXT_SOURCES = [
  "tenant",
  "project",
  "contact",
  "channel",
  "webhook",
  "default",
] as const;

export const CONTEXT_SOURCE_PRECEDENCE = [
  "system",
  ...CUSTOM_CONTEXT_SOURCES,
] as const;

export const assistantPolicyV1Schema = z.object({
  schemaVersion,
  baseInstructions: optionalText,
  greeting: optionalText,
  greetingStrategy: z.enum(["wait", "exact", "generated"]),
  language: z.string().trim().min(2).max(40),
  modelPolicy: z.object({
    mode: z.enum(["platform_default", "project_override"]),
    primaryModelId: z.string().trim().min(1).max(120).default("gpt-5-mini"),
    fallbackModelId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .nullable()
      .default("gpt-4.1-mini"),
    timeoutMs: z.number().int().min(1_000).max(60_000).default(15_000),
    maxOutputTokens: z.number().int().min(64).max(4_096).default(900),
    maxRetries: z.number().int().min(0).max(2).default(1),
    maxRepairAttempts: z.number().int().min(0).max(2).default(1),
    stageOverrides: z
      .array(
        z.object({
          stage: z.enum(TURN_MODEL_STAGES),
          modelId: z.string().trim().min(1).max(120),
          fallbackModelId: z
            .string()
            .trim()
            .min(1)
            .max(120)
            .nullable()
            .default(null),
        }),
      )
      .max(TURN_MODEL_STAGES.length)
      .default([]),
  }),
});

export const knowledgeConversationV1Schema = z.object({
  schemaVersion,
  noAnswerBehavior: z.enum(["fallback", "handoff", "task_recommendation"]),
  outcomes: z.array(
    z.enum([
      "answered",
      "task_recommended",
      "no_answer",
      "handoff",
      "cancelled",
    ]),
  ),
  responseOwner: z.enum(["knowledge", "task", "deterministic", "human"]),
});

export const taskIntentRecommendationV1Schema = z.object({
  schemaVersion,
  taskId: z.number().int().positive(),
  candidateFieldMappings: z.record(z.string(), z.unknown()),
});

export const conversationEntryPolicyV1Schema = z.object({
  schemaVersion,
  allowTaskRecommendation: z.boolean(),
  maxConnectedFlowDepth: z.number().int().min(0).max(10),
  maxHandoffDepth: z.number().int().min(0).max(10),
  maxTaskSwitches: z.number().int().min(0).max(10),
  mode: z.enum(["knowledge_first", "task_first", "deterministic"]),
});

export const conversationIdentityV1Schema = z.object({
  schemaVersion,
  crossChannelLinkRule: z.enum([
    "never",
    "verified_contact_only",
    "authenticated_identity_only",
  ]),
  sessionMode: z.enum([
    "project_scoped_anonymous",
    "verified_contact",
    "authenticated_user",
  ]),
});

export const dataHandlingPolicyV1Schema = z.object({
  schemaVersion,
  consentRequired: z.boolean(),
  deletionMode: z.enum(["on_request", "automatic"]),
  exportAllowed: z.boolean(),
  fieldRetentionDays: z.number().int().min(1).max(3650),
  sensitiveLogVisibility: z.literal("redacted"),
  sensitiveModelVisibility: z.enum(["denied", "task_only"]),
  messageRetentionDays: z.number().int().min(1).max(3650),
  toolVisibility: z.enum(["binding_only", "denied"]),
});

export const conversationProjectPolicyV1Schema = z.object({
  schemaVersion,
  assistant: assistantPolicyV1Schema,
  dataHandling: dataHandlingPolicyV1Schema,
  entry: conversationEntryPolicyV1Schema,
  identity: conversationIdentityV1Schema,
  knowledge: knowledgeConversationV1Schema,
});

export type ConversationProjectPolicyV1 = z.infer<
  typeof conversationProjectPolicyV1Schema
>;

export const DEFAULT_CONVERSATION_PROJECT_POLICY: ConversationProjectPolicyV1 =
  {
    schemaVersion: 1,
    assistant: {
      schemaVersion: 1,
      baseInstructions: null,
      greeting: null,
      greetingStrategy: "wait",
      language: "English",
      modelPolicy: {
        mode: "platform_default",
        primaryModelId: "gpt-5-mini",
        fallbackModelId: "gpt-4.1-mini",
        timeoutMs: 15_000,
        maxOutputTokens: 900,
        maxRetries: 1,
        maxRepairAttempts: 1,
        stageOverrides: [],
      },
    },
    dataHandling: {
      schemaVersion: 1,
      consentRequired: false,
      deletionMode: "on_request",
      exportAllowed: true,
      fieldRetentionDays: 365,
      sensitiveLogVisibility: "redacted",
      sensitiveModelVisibility: "task_only",
      messageRetentionDays: 90,
      toolVisibility: "binding_only",
    },
    entry: {
      schemaVersion: 1,
      allowTaskRecommendation: true,
      maxConnectedFlowDepth: 3,
      maxHandoffDepth: 1,
      maxTaskSwitches: 2,
      mode: "knowledge_first",
    },
    identity: {
      schemaVersion: 1,
      crossChannelLinkRule: "verified_contact_only",
      sessionMode: "project_scoped_anonymous",
    },
    knowledge: {
      schemaVersion: 1,
      noAnswerBehavior: "fallback",
      outcomes: [
        "answered",
        "task_recommended",
        "no_answer",
        "handoff",
        "cancelled",
      ],
      responseOwner: "knowledge",
    },
  };

export const taskFieldOptionV1Schema = z.object({
  value: z.string().trim().min(1).max(240),
  label: z.string().trim().min(1).max(240),
});

export const taskFieldOptionSourceV1Schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("static"),
    options: z.array(taskFieldOptionV1Schema).min(1).max(200),
  }),
  z.object({
    kind: z.literal("project_resource"),
    resourceType: stableKey,
    collectionKey: z.string().trim().min(1).max(120).nullable(),
    filterByField: stableKey.nullable(),
  }),
]);

export const taskFieldV1Schema = z.object({
  id: z.string().uuid(),
  key: stableKey.refine((key) => !key.startsWith("lia_"), {
    message: "The lia_ prefix is reserved for system context.",
  }),
  label: z.string().trim().min(1).max(120),
  type: z.enum(FIELD_TYPES),
  cardinality: z.enum(FIELD_CARDINALITIES).default("single"),
  prompt: optionalText.default(null),
  optionSource: taskFieldOptionSourceV1Schema.nullable().default(null),
  required: z.boolean(),
  requiredWhen: optionalText,
  validation: optionalText,
  normalization: optionalText,
  sensitivity: z.enum(["standard", "personal", "sensitive"]),
  confirmation: z.enum(["never", "when_changed", "always"]),
  sourcePriority: z
    .array(z.enum(["visitor", "profile", "project_resource", "tool"]))
    .min(1),
  dependsOn: z.array(stableKey),
});

export const contextVariableDefinitionV1Schema = z.object({
  key: stableKey,
  type: z.enum(FIELD_TYPES),
  source: z.enum(CONTEXT_SOURCE_PRECEDENCE),
  defaultValue: optionalText,
  sensitivity: z.enum(["standard", "personal", "sensitive"]),
  expiresAfterMinutes: z.number().int().positive().nullable(),
  modelVisible: z.boolean(),
  toolVisible: z.boolean(),
});

export const toolDefinitionRefV1Schema = z.object({
  id: z.string().min(1).max(120),
  version: z.number().int().positive(),
});

export const toolBindingV1Schema = z.object({
  tool: toolDefinitionRefV1Schema,
  access: z.enum(["read", "write"]),
  allowedStages: z.array(z.enum(TOOL_STAGES)).min(1),
});

export const fieldTransferRuleV1Schema = z.object({
  fieldKey: stableKey,
  allowedSources: z.array(
    z.enum(["visitor", "profile", "project_resource", "tool"]),
  ),
  minimumValidationState: z.enum(["candidate", "valid", "confirmed"]),
  maximumAgeMinutes: z.number().int().positive().nullable(),
  allowSensitive: z.boolean(),
  requireProvenance: z.boolean(),
});

export const taskOutcomeV1Schema = z.object({
  id: z.string().uuid(),
  key: stableKey,
  label: z.string().trim().min(1).max(120),
  type: z.enum(["completed", "cancelled", "failed", "no_answer", "handoff"]),
  condition: optionalText,
  outputPort: stableKey,
});

export const conversationReturnPolicyV1Schema = z.object({
  schemaVersion,
  completed: z.enum(["return_to_knowledge", "end"]),
  cancelled: z.enum(["return_to_knowledge", "end"]),
  failed: z.enum(["return_to_knowledge", "handoff", "end"]),
  handoff: z.enum(["suspend", "end"]),
  noAnswer: z.enum(["return_to_knowledge", "handoff", "end"]),
});

export const conversationalTaskDefinitionV1Schema = z.object({
  schemaVersion,
  contextVariables: z.array(contextVariableDefinitionV1Schema),
  degradedMode: z.object({
    model: z.enum(["deterministic_fallback", "handoff", "fail"]),
    retrieval: z.enum(["clarify", "handoff", "fail"]),
    tool: z.enum(["retry", "handoff", "fail"]),
    outboundChannel: z.enum(["retry", "fail"]),
  }),
  executionOrder: z.array(z.enum(TASK_EXECUTION_STAGES)),
  fieldTransferWhitelist: z.array(fieldTransferRuleV1Schema),
  fields: z.array(taskFieldV1Schema),
  outcomes: z.array(taskOutcomeV1Schema),
  returnPolicy: conversationReturnPolicyV1Schema,
  taskPolicy: z.object({
    fallbackMessage: optionalText,
    handoffMessage: optionalText,
    instructions: optionalText.default(null),
    identityRequirement: z
      .enum(["anonymous", "verified_contact", "authenticated_user"])
      .default("anonymous"),
    consentRequirement: z.enum(["inherit", "required"]).default("inherit"),
    language: z.string().trim().min(2).max(40),
    responseLength: z.enum(["short", "balanced", "detailed"]),
  }),
  tools: z.array(toolBindingV1Schema),
});

export type ConversationalTaskDefinitionV1 = z.infer<
  typeof conversationalTaskDefinitionV1Schema
>;

export const DEFAULT_CONVERSATIONAL_TASK_DEFINITION: ConversationalTaskDefinitionV1 =
  {
    schemaVersion: 1,
    contextVariables: [],
    degradedMode: {
      model: "deterministic_fallback",
      outboundChannel: "retry",
      retrieval: "clarify",
      tool: "retry",
    },
    executionOrder: [...TASK_EXECUTION_STAGES],
    fieldTransferWhitelist: [],
    fields: [],
    outcomes: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        key: "completed",
        label: "Completed",
        type: "completed",
        condition: null,
        outputPort: "completed",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        key: "cancelled",
        label: "Cancelled",
        type: "cancelled",
        condition: null,
        outputPort: "cancelled",
      },
    ],
    returnPolicy: {
      schemaVersion: 1,
      cancelled: "return_to_knowledge",
      completed: "return_to_knowledge",
      failed: "handoff",
      handoff: "suspend",
      noAnswer: "return_to_knowledge",
    },
    taskPolicy: {
      fallbackMessage: null,
      handoffMessage: null,
      instructions: null,
      identityRequirement: "anonymous",
      consentRequirement: "inherit",
      language: "English",
      responseLength: "short",
    },
    tools: [],
  };

export const projectAiBehaviorSnapshotV1Schema = z.object({
  answerLength: z.enum(AI_ANSWER_LENGTHS),
  answerGuidance: z.string().trim().max(800).nullable(),
  assistantName: z.string().trim().max(80).nullable(),
  businessName: z.string().trim().max(120).nullable(),
  extraHelpPolicy: z.enum(AI_EXTRA_HELP_POLICIES),
  fallbackEmail: z.string().trim().max(160).nullable(),
  fallbackMessage: z.string().trim().max(500).nullable(),
  fallbackPhone: z.string().trim().max(80).nullable(),
  followUpPolicy: z.enum(AI_FOLLOW_UP_POLICIES),
  responsePreset: z.enum(AI_RESPONSE_PRESETS),
  role: z.enum(AI_ASSISTANT_ROLES),
  tone: z.enum(AI_TONES),
});

export const conversationalTaskSnapshotV1Schema = z.object({
  schemaVersion,
  assistantBehavior: projectAiBehaviorSnapshotV1Schema.default(
    DEFAULT_PROJECT_AI_SETTINGS,
  ),
  assistantPolicy: assistantPolicyV1Schema,
  conversationPolicy: conversationProjectPolicyV1Schema,
  task: z.object({
    id: z.number().int().positive(),
    schemaVersion,
    name: z.string().trim().min(1).max(120),
    objective: z.string().trim().min(1).max(600),
    description: z.string().trim().max(2000).nullable(),
    definition: conversationalTaskDefinitionV1Schema,
  }),
});

export type ConversationalTaskSnapshotV1 = z.infer<
  typeof conversationalTaskSnapshotV1Schema
>;

export function normalizeConversationProjectPolicy(
  value: unknown,
): ConversationProjectPolicyV1 {
  const parsed = conversationProjectPolicyV1Schema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_CONVERSATION_PROJECT_POLICY;
}

export function normalizeConversationalTaskDefinition(
  value: unknown,
): ConversationalTaskDefinitionV1 {
  const parsed = conversationalTaskDefinitionV1Schema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_CONVERSATIONAL_TASK_DEFINITION;
}
