import { z } from "zod";
import {
  TOOL_RESULT_STATUSES,
  TOOL_STAGES,
} from "@/lib/conversation-contracts";

export const TASK_FIELD_STATES = [
  "missing",
  "candidate",
  "valid",
  "invalid",
  "confirmed",
  "cleared",
] as const;

export const CONVERSATION_RESPONSE_OWNERS = [
  "knowledge",
  "task",
  "deterministic",
  "human",
] as const;

export const TASK_RUN_STATUSES = [
  "active",
  "paused",
  "waiting",
  "handoff",
  "completed",
  "cancelled",
  "abandoned",
] as const;

const isoDateTime = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Use an ISO date and time.",
  });
const stableId = z.string().trim().min(1).max(160);
const fieldKey = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-zA-Z0-9_]*$/);
const safeRecord = z.record(z.string(), z.unknown());
const toolResultStatus = z.preprocess((value) => {
  if (value === "completed") return "success";
  if (value === "failed") return "provider_failure";
  if (value === "timed_out") return "timeout";
  if (value === "outcome_unknown") return "outcome_unknown";
  return value;
}, z.enum(TOOL_RESULT_STATUSES));

export const inboundEventAuthenticationV1Schema = z.object({
  kind: z.enum(["hmac", "api_key", "session", "user"]),
  principal: stableId,
  verifiedAt: isoDateTime,
  keyId: stableId.nullable().default(null),
});

export const fieldCandidateV1Schema = z
  .object({
    fieldKey,
    naturalValue: z.unknown(),
    canonicalValue: z.unknown().optional(),
    state: z.enum(["candidate", "valid", "invalid", "confirmed"]),
    provenance: z.object({
      source: z.enum(["visitor", "profile", "project_resource", "tool"]),
      sourceReference: stableId.nullable().default(null),
    }),
    validation: z
      .object({
        valid: z.boolean(),
        code: z.string().trim().min(1).max(120).nullable().default(null),
        message: z.string().trim().min(1).max(500).nullable().default(null),
      })
      .default({ valid: false, code: null, message: null }),
  })
  .superRefine((candidate, context) => {
    if (
      (candidate.state === "valid" || candidate.state === "confirmed") &&
      !candidate.validation.valid
    ) {
      context.addIssue({
        code: "custom",
        message: "Valid and confirmed candidates need a valid result.",
        path: ["validation", "valid"],
      });
    }
    if (candidate.state === "invalid" && candidate.validation.valid) {
      context.addIssue({
        code: "custom",
        message: "Invalid candidates cannot have a valid result.",
        path: ["validation", "valid"],
      });
    }
  });

const inboundEventEnvelopeV1Schema = z.object({
  schemaVersion: z.literal(1),
  eventId: stableId,
  projectId: z.number().int().positive(),
  conversationId: z.number().int().positive(),
  taskRunId: z.number().int().positive().nullable().default(null),
  channelType: z.string().trim().min(1).max(80),
  channelIdentity: safeRecord.default({}),
  providerSequence: z.number().int().nonnegative().nullable().default(null),
  expectedRevision: z.number().int().nonnegative().nullable().default(null),
  occurredAt: isoDateTime,
  receivedAt: isoDateTime,
  authentication: inboundEventAuthenticationV1Schema.nullable().default(null),
});

const inboundEventPayloadV1Schema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("field.candidates"),
    candidates: z.array(fieldCandidateV1Schema).min(1).max(50),
    correction: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("field.clear"),
    fieldKey,
    reason: z.enum([
      "visitor_correction",
      "upstream_change",
      "restart",
      "retention",
    ]),
  }),
  z.object({
    type: z.literal("field.requested"),
    fieldKey,
  }),
  z.object({
    type: z.literal("task.pause"),
    boundary: z.enum(["wait", "connected_flow", "no_reply", "manual"]),
    reason: z.string().trim().min(1).max(240).nullable().default(null),
    resumeAt: isoDateTime.nullable().default(null),
    returnTarget: safeRecord.nullable().default(null),
  }),
  z.object({
    type: z.literal("task.resume"),
    reason: z.string().trim().min(1).max(240).nullable().default(null),
  }),
  z.object({
    type: z.literal("task.cancel"),
    outcomeKey: fieldKey.nullable().default(null),
  }),
  z.object({
    type: z.literal("task.restart"),
  }),
  z.object({
    type: z.literal("task.complete"),
    outcomeKey: fieldKey,
  }),
  z.object({
    type: z.literal("task.fail"),
    outcomeKey: fieldKey,
    reason: z.enum([
      "provider_failure",
      "timeout",
      "validation",
      "unavailable",
    ]),
  }),
  z.object({
    type: z.literal("task.handoff"),
    outcomeKey: fieldKey.nullable().default(null),
    reason: z.string().trim().min(1).max(240),
  }),
  z.object({
    type: z.literal("task.side_question"),
    category: z.string().trim().min(1).max(120),
  }),
  z.object({
    type: z.literal("task.side_question_resolved"),
  }),
  z.object({
    type: z.literal("owner.change"),
    responseOwner: z.enum(CONVERSATION_RESPONSE_OWNERS),
    executionMode: z.enum(CONVERSATION_RESPONSE_OWNERS),
    activeNodeId: stableId.nullable().default(null),
  }),
  z.object({
    type: z.literal("session.rotate"),
    sessionId: stableId,
    sessionExpiresAt: isoDateTime.nullable().default(null),
  }),
  z.object({
    type: z.literal("tool.requested"),
    requestId: stableId,
    idempotencyKey: stableId,
    toolId: stableId,
    stage: z.enum(TOOL_STAGES),
    requestMode: z.enum(["synchronous", "asynchronous"]),
    input: safeRecord.default({}),
    timeoutAt: isoDateTime.nullable().default(null),
  }),
  z.object({
    type: z.literal("tool.result"),
    requestId: stableId,
    status: toolResultStatus,
    result: safeRecord.nullable().default(null),
    errorCode: z.string().trim().min(1).max(120).nullable().default(null),
  }),
]);

export const inboundEventV1Schema = inboundEventEnvelopeV1Schema
  .and(inboundEventPayloadV1Schema)
  .superRefine((event, context) => {
    if (
      (event.type === "tool.result" ||
        event.type === "task.fail" ||
        event.type === "task.handoff" ||
        (event.type === "tool.requested" &&
          (event.stage === "confirmation" || event.stage === "operation")) ||
        (event.type === "owner.change" && event.responseOwner === "human")) &&
      !event.authentication
    ) {
      context.addIssue({
        code: "custom",
        message: "This event requires authenticated provenance.",
        path: ["authentication"],
      });
    }
  });

export type InboundEventV1 = z.infer<typeof inboundEventV1Schema>;
export type InboundEventInputV1 = z.input<typeof inboundEventV1Schema>;
export type FieldCandidateV1 = z.infer<typeof fieldCandidateV1Schema>;
export type TaskFieldState = (typeof TASK_FIELD_STATES)[number];
export type ConversationResponseOwner =
  (typeof CONVERSATION_RESPONSE_OWNERS)[number];
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];

export const startConversationalTaskRunV1Schema = z
  .object({
    projectId: z.number().int().positive(),
    conversationId: z.number().int().positive(),
    taskId: z.number().int().positive(),
    eventId: stableId,
    channelType: z.string().trim().min(1).max(80),
    channelIdentity: safeRecord.default({}),
    anonymousVisitorId: stableId.nullable().default(null),
    sessionId: stableId,
    sessionExpiresAt: isoDateTime.nullable().default(null),
    verifiedContactId: z.number().int().positive().nullable().default(null),
    authenticatedUserId: z.number().int().positive().nullable().default(null),
    identityKind: z
      .enum(["anonymous", "verified_contact", "authenticated_user"])
      .default("anonymous"),
    occurredAt: isoDateTime,
    receivedAt: isoDateTime,
    providerSequence: z.number().int().nonnegative().nullable().default(null),
    initializationContext: safeRecord.default({}),
  })
  .superRefine((input, context) => {
    if (input.identityKind === "verified_contact" && !input.verifiedContactId) {
      context.addIssue({
        code: "custom",
        message: "Verified contact identity requires a contact reference.",
        path: ["verifiedContactId"],
      });
    }
    if (
      input.identityKind === "authenticated_user" &&
      !input.authenticatedUserId
    ) {
      context.addIssue({
        code: "custom",
        message: "Authenticated identity requires a user reference.",
        path: ["authenticatedUserId"],
      });
    }
  });

export type StartConversationalTaskRunV1 = z.infer<
  typeof startConversationalTaskRunV1Schema
>;

export const switchConversationalTaskRunV1Schema = z.object({
  projectId: z.number().int().positive(),
  conversationId: z.number().int().positive(),
  currentTaskRunId: z.number().int().positive(),
  targetTaskId: z.number().int().positive(),
  eventId: stableId,
  channelType: z.string().trim().min(1).max(80),
  channelIdentity: safeRecord.default({}),
  occurredAt: isoDateTime,
  receivedAt: isoDateTime,
  initializationContext: safeRecord.default({}),
});

export type SwitchConversationalTaskRunV1 = z.infer<
  typeof switchConversationalTaskRunV1Schema
>;
