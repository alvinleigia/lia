import { z } from "zod";
import { TOOL_STAGES, TURN_MODEL_STAGES } from "@/lib/conversation-contracts";
import { TASK_FIELD_STATES } from "@/lib/conversational-task-runtime-contracts";

export const STRUCTURED_TURN_SCHEMA_VERSION = 1 as const;

export const TURN_NEXT_ACTIONS = [
  "ask",
  "clarify",
  "lookup",
  "confirm",
  "complete",
  "cancel",
  "handoff",
  "fail",
] as const;

export const TURN_KINDS = [
  "greeting",
  "ordinary_question",
  "field_answer",
  "field_correction",
  "side_question",
  "task_recommendation",
  "task_switch",
  "cancellation",
] as const;

const stableKey = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-zA-Z0-9_.:-]*$/);
const confidence = z.number().min(0).max(1);
const proposalValue = z.union([
  z.string().max(2_000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(500)).max(50),
]);

export const turnFieldCandidateProposalV1Schema = z
  .object({
    fieldKey: stableKey,
    naturalValue: proposalValue,
    confidence,
    source: z.literal("visitor"),
  })
  .strict();

export const turnTaskRecommendationV1Schema = z
  .object({
    taskId: z.number().int().positive(),
    confidence,
    reason: z.string().trim().min(1).max(300),
  })
  .strict();

export const turnToolRequestProposalV1Schema = z
  .object({
    toolId: z.string().trim().min(1).max(120),
    stage: z.enum(TOOL_STAGES),
    arguments: z
      .array(
        z
          .object({
            key: stableKey,
            value: proposalValue,
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

const turnResultV1BaseSchema = z
  .object({
    schemaVersion: z.literal(STRUCTURED_TURN_SCHEMA_VERSION),
    turnKind: z.enum(TURN_KINDS),
    reply: z.string().trim().min(1).max(2_000),
    grounding: z
      .object({
        status: z.enum(["grounded", "not_needed", "no_answer"]),
        excerptIds: z.array(z.string().trim().min(1).max(120)).max(8),
      })
      .strict(),
    fieldCandidates: z.array(turnFieldCandidateProposalV1Schema).max(50),
    taskRecommendation: turnTaskRecommendationV1Schema.nullable(),
    toolRequest: turnToolRequestProposalV1Schema.nullable(),
    routeRecommendation: z
      .object({
        outputPort: stableKey,
        confidence,
      })
      .strict()
      .nullable(),
    outcomeRecommendation: z
      .object({
        outcomeKey: stableKey,
        confidence,
      })
      .strict()
      .nullable(),
    nextAction: z.enum(TURN_NEXT_ACTIONS),
    ambiguity: z
      .object({
        requiresClarification: z.boolean(),
        question: z.string().trim().min(1).max(500).nullable(),
        fieldKeys: z.array(stableKey).max(50).nullable().optional(),
      })
      .strict(),
    safety: z
      .object({
        decision: z.enum(["allow", "refuse", "clarify", "handoff"]),
        reasonCode: stableKey.nullable(),
      })
      .strict(),
    decisionSummary: z.string().trim().min(1).max(500),
  })
  .strict();

// Providers require every property; older deterministic proposals remain valid.
export const turnResultV1ProviderSchema = turnResultV1BaseSchema.extend({
  ambiguity: turnResultV1BaseSchema.shape.ambiguity.extend({
    fieldKeys: z.array(stableKey).max(50).nullable(),
  }),
});

// An active task's knowledge interruption may answer, clarify or decline; it
// cannot collect fields or propose operations. Enforce this at generation too.
export const taskKnowledgeTurnProviderSchema =
  turnResultV1ProviderSchema.extend({
    turnKind: z.enum(["ordinary_question", "side_question"]),
    fieldCandidates: z.array(turnFieldCandidateProposalV1Schema).max(0),
    taskRecommendation: z.null(),
    toolRequest: z.null(),
    routeRecommendation: z.null(),
    outcomeRecommendation: z.null(),
    nextAction: z.enum(["ask", "clarify", "handoff", "fail"]),
  });

// Constants and audit wording are supplied by the server, not generated tokens.
// Keep the full turn contract at the validation/runtime boundary.
export const compactTaskExtractionProviderSchema = turnResultV1ProviderSchema
  .omit({ schemaVersion: true, decisionSummary: true })
  .extend({
    fieldCandidates: z
      .array(turnFieldCandidateProposalV1Schema.omit({ source: true }))
      .max(50),
  });

export const compactTaskKnowledgeProviderSchema =
  taskKnowledgeTurnProviderSchema.omit({
    schemaVersion: true,
    decisionSummary: true,
    fieldCandidates: true,
    taskRecommendation: true,
    toolRequest: true,
    routeRecommendation: true,
    outcomeRecommendation: true,
  });

export function expandCompactTaskTurn(
  output: unknown,
  stage: "extraction" | "knowledge",
) {
  const constants = {
    schemaVersion: STRUCTURED_TURN_SCHEMA_VERSION,
    decisionSummary: `${stage} proposal; see structured fields.`,
  };
  if (stage === "knowledge") {
    return {
      ...compactTaskKnowledgeProviderSchema.parse(output),
      ...constants,
      fieldCandidates: [],
      taskRecommendation: null,
      toolRequest: null,
      routeRecommendation: null,
      outcomeRecommendation: null,
    };
  }
  const proposal = compactTaskExtractionProviderSchema.parse(output);
  return {
    ...proposal,
    ...constants,
    fieldCandidates: proposal.fieldCandidates.map((candidate) => ({
      ...candidate,
      source: "visitor" as const,
    })),
  };
}

export const turnResultV1Schema = turnResultV1BaseSchema.superRefine(
  (result, context) => {
    if (
      !result.ambiguity.requiresClarification &&
      result.ambiguity.fieldKeys?.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Uncertain fields require ambiguity.",
        path: ["ambiguity", "fieldKeys"],
      });
    }
    if (
      result.ambiguity.requiresClarification &&
      (!result.ambiguity.question || result.nextAction !== "clarify")
    ) {
      context.addIssue({
        code: "custom",
        message: "Ambiguous turns require one clarification question.",
        path: ["ambiguity"],
      });
    }
    if (
      !result.ambiguity.requiresClarification &&
      result.ambiguity.question !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "A clarification question requires ambiguity.",
        path: ["ambiguity", "question"],
      });
    }
    if (
      result.grounding.status === "grounded" &&
      result.grounding.excerptIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Grounded answers require at least one excerpt reference.",
        path: ["grounding", "excerptIds"],
      });
    }
    if (
      result.grounding.status !== "grounded" &&
      result.grounding.excerptIds.length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Only grounded answers may reference excerpts.",
        path: ["grounding", "excerptIds"],
      });
    }
  },
);

export type TurnResultV1 = z.infer<typeof turnResultV1Schema>;
export type TurnNextAction = (typeof TURN_NEXT_ACTIONS)[number];
export type TurnKind = (typeof TURN_KINDS)[number];

export const turnMessageV1Schema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(8_000),
  })
  .strict();

export type TurnMessageV1 = z.infer<typeof turnMessageV1Schema>;

export const structuredTurnRequestV1Schema = z
  .object({
    activeTaskId: z.number().int().positive().nullable().default(null),
    assistantIntroduced: z.boolean().default(false),
    channel: z
      .enum(["project_chat", "widget", "whatsapp", "telnyx_voice"])
      .default("project_chat"),
    contactId: z.number().int().positive().nullable().default(null),
    history: z.array(turnMessageV1Schema).max(50).default([]),
    projectId: z.number().int().positive(),
    stage: z.enum(TURN_MODEL_STAGES).default("knowledge"),
    visitorMessage: z.string().trim().min(1).max(32_000),
  })
  .strict();

export type StructuredTurnRequestV1 = z.infer<
  typeof structuredTurnRequestV1Schema
>;

export const turnFieldStateV1Schema = z
  .object({
    fieldKey: stableKey,
    label: z.string().trim().min(1).max(120),
    state: z.enum(TASK_FIELD_STATES),
    required: z.boolean(),
    sensitivity: z.enum(["standard", "personal", "sensitive"]),
    value: proposalValue.nullable(),
  })
  .strict();

export type TurnFieldStateV1 = z.infer<typeof turnFieldStateV1Schema>;

export const turnContextValueV1Schema = z
  .object({
    key: stableKey,
    modelVisible: z.boolean(),
    sensitivity: z.enum(["standard", "personal", "sensitive"]),
    value: proposalValue,
  })
  .strict();

export type TurnContextValueV1 = z.infer<typeof turnContextValueV1Schema>;

export const turnRetrievalExcerptV1Schema = z
  .object({
    id: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(4_000),
  })
  .strict();

export type TurnRetrievalExcerptV1 = z.infer<
  typeof turnRetrievalExcerptV1Schema
>;

export type ValidatedTurnProposalV1 = TurnResultV1 & {
  validation: {
    accepted: true;
    modelAttemptCount: number;
    providerModelId: string;
  };
};
