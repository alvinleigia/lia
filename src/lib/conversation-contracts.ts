import { z } from "zod";

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

export const assistantPolicyV1Schema = z.object({
  schemaVersion,
  baseInstructions: optionalText,
  greeting: optionalText,
  greetingStrategy: z.enum(["wait", "exact", "generated"]),
  language: z.string().trim().min(2).max(40),
  modelPolicy: z.object({
    mode: z.enum(["platform_default", "project_override"]),
  }),
});

export const knowledgeConversationV1Schema = z.object({
  schemaVersion,
  noAnswerBehavior: z.enum(["fallback", "handoff", "task_recommendation"]),
  responseOwner: z.enum(["knowledge", "task", "deterministic", "human"]),
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
  crossChannelLinkRule: z.enum(["never", "verified_contact_only"]),
  sessionMode: z.enum(["project_scoped_anonymous", "verified_contact"]),
});

export const dataHandlingPolicyV1Schema = z.object({
  schemaVersion,
  consentRequired: z.boolean(),
  exportAllowed: z.boolean(),
  fieldRetentionDays: z.number().int().min(1).max(3650),
  messageRetentionDays: z.number().int().min(1).max(3650),
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
      modelPolicy: { mode: "platform_default" },
    },
    dataHandling: {
      schemaVersion: 1,
      consentRequired: false,
      exportAllowed: true,
      fieldRetentionDays: 365,
      messageRetentionDays: 90,
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
      responseOwner: "knowledge",
    },
  };

export const taskFieldV1Schema = z.object({
  id: z.string().uuid(),
  key: stableKey.refine((key) => !key.startsWith("lia_"), {
    message: "The lia_ prefix is reserved for system context.",
  }),
  label: z.string().trim().min(1).max(120),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
  requiredWhen: optionalText,
  validation: optionalText,
  normalization: optionalText,
  sensitivity: z.enum(["standard", "personal", "sensitive"]),
  confirmation: z.enum(["never", "when_changed", "always"]),
  sourcePriority: z.array(
    z.enum(["visitor", "profile", "project_resource", "tool"]),
  ),
  dependsOn: z.array(stableKey),
});

export const contextVariableDefinitionV1Schema = z.object({
  key: stableKey,
  type: z.enum(FIELD_TYPES),
  source: z.enum([
    "system",
    "tenant",
    "project",
    "contact",
    "channel",
    "webhook",
    "default",
  ]),
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
  allowedStages: z.array(
    z.enum(["extraction", "lookup", "confirmation", "operation"]),
  ),
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
  executionOrder: z.array(
    z.enum([
      "extraction",
      "validation",
      "lookup",
      "clarification",
      "confirmation",
      "operation",
      "routing",
    ]),
  ),
  fieldTransferWhitelist: z.array(stableKey),
  fields: z.array(taskFieldV1Schema),
  outcomes: z.array(taskOutcomeV1Schema),
  returnPolicy: conversationReturnPolicyV1Schema,
  taskPolicy: z.object({
    fallbackMessage: optionalText,
    handoffMessage: optionalText,
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
    executionOrder: [
      "extraction",
      "validation",
      "lookup",
      "clarification",
      "confirmation",
      "operation",
      "routing",
    ],
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
      language: "English",
      responseLength: "short",
    },
    tools: [],
  };

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
