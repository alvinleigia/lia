import { z } from "zod";
import {
  claimNextDurableJob,
  completeDurableJob,
  enqueueDurableJob,
  failDurableJob,
} from "@/lib/durable-jobs";

const selectedFactSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,63}$/),
    value: z.union([z.string().max(2_000), z.number().finite(), z.boolean()]),
  })
  .strict();

export const postConversationJobPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.enum(["summary", "crm_log", "quality_check", "structured_insight"]),
    conversationId: z.string().trim().min(1).max(160),
    outcome: z.enum(["completed", "cancelled", "handoff", "failed"]),
    selectedFacts: z.array(selectedFactSchema).max(32).default([]),
    taskRunId: z.number().int().positive(),
  })
  .strict();

export type PostConversationJobPayload = z.infer<
  typeof postConversationJobPayloadSchema
>;

const APPROVED_TOOL_IDS = {
  summary: "conversation_summary_v1",
  crm_log: "crm_log_v1",
  quality_check: "conversation_quality_check_v1",
  structured_insight: "structured_insight_v1",
} as const;

export const POST_CONVERSATION_JOB_KINDS = [
  "summary",
  "crm_log",
  "quality_check",
  "structured_insight",
] as const;

export function buildPostConversationJobResult(
  payload: PostConversationJobPayload,
) {
  return {
    schemaVersion: 1,
    processorVersion: 1,
    kind: payload.kind,
    approvedToolId: APPROVED_TOOL_IDS[payload.kind],
    outcome: payload.outcome,
    selectedFactCount: payload.selectedFacts.length,
  };
}

export async function enqueuePostConversationJob(input: {
  payload: PostConversationJobPayload;
  projectId: number;
  submissionId?: number | null;
  traceId?: string | null;
}) {
  const payload = postConversationJobPayloadSchema.parse(input.payload);

  return enqueueDurableJob({
    dedupeKey: `${payload.conversationId}:${payload.taskRunId}:${payload.kind}:v${payload.schemaVersion}`,
    jobType: "post_conversation",
    maxAttempts: 3,
    payload,
    projectId: input.projectId,
    submissionId: input.submissionId ?? null,
    traceId: input.traceId,
  });
}

export async function enqueueDefaultPostConversationJobs(input: {
  conversationId: string;
  outcome: PostConversationJobPayload["outcome"];
  projectId: number;
  taskRunId: number;
  traceId?: string | null;
}) {
  return Promise.all(
    POST_CONVERSATION_JOB_KINDS.map((kind) =>
      enqueuePostConversationJob({
        payload: {
          schemaVersion: 1,
          conversationId: input.conversationId,
          kind,
          outcome: input.outcome,
          selectedFacts: [],
          taskRunId: input.taskRunId,
        },
        projectId: input.projectId,
        traceId: input.traceId,
      }),
    ),
  );
}

export async function processProjectPostConversationQueue(input: {
  maxJobs?: number;
  projectId: number;
  workerId: string;
}) {
  const maxJobs = Math.max(1, Math.min(Math.trunc(input.maxJobs ?? 5), 25));
  let completed = 0;
  let failed = 0;
  let processed = 0;

  for (let index = 0; index < maxJobs; index += 1) {
    const job = await claimNextDurableJob({
      jobTypes: ["post_conversation"],
      projectId: input.projectId,
      workerId: input.workerId,
    });

    if (!job) {
      break;
    }

    processed += 1;
    const parsed = postConversationJobPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      await failDurableJob({
        errorMessage: "Post-conversation job has an invalid payload.",
        jobId: job.id,
        permanent: true,
        projectId: input.projectId,
        workerId: input.workerId,
      });
      failed += 1;
      continue;
    }

    await completeDurableJob({
      jobId: job.id,
      projectId: input.projectId,
      result: buildPostConversationJobResult(parsed.data),
      workerId: input.workerId,
    });
    completed += 1;
  }

  return {
    completed,
    failed,
    idle: processed === 0,
    processed,
  };
}
