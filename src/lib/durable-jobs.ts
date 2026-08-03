import { createHash } from "node:crypto";
import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { durableJobs, type SelectDurableJob } from "@/lib/db-schema";
import { resolveTraceId } from "@/lib/execution-trace";

export const DURABLE_JOB_TYPES = [
  "operation_delivery",
  "outbox_delivery",
  "flow_resume",
  "flow_response_policy",
] as const;
export const DURABLE_JOB_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;

export type DurableJobType = (typeof DURABLE_JOB_TYPES)[number];
export type DurableJobStatus = (typeof DURABLE_JOB_STATUSES)[number];

type EnqueueDurableJobInput = {
  availableAt?: Date;
  dedupeKey: string;
  jobType: DurableJobType;
  maxAttempts?: number;
  operationAttemptId?: number | null;
  payload?: Record<string, unknown>;
  projectId: number;
  submissionId?: number | null;
  traceId?: string | null;
};

type ClaimDurableJobInput = {
  jobTypes?: DurableJobType[];
  leaseMs?: number;
  now?: Date;
  projectId: number;
  workerId: string;
};

const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS = 15 * 60_000;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_JOB_ATTEMPTS = 25;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_CAP_MS = 15 * 60_000;

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeDedupeKey(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 240) {
    throw new Error(
      "Durable job dedupe keys must contain 1 to 240 characters.",
    );
  }

  return normalized;
}

function normalizeWorkerId(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new Error("Durable job worker ids must contain 1 to 160 characters.");
  }

  return normalized;
}

function retryJitterUnit(key: string, attempt: number) {
  const digest = createHash("sha256").update(`${key}:${attempt}`).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

export function getDurableRetryDelayMs(input: {
  attempt: number;
  baseDelayMs?: number;
  jitterKey?: string;
  maxDelayMs?: number;
}) {
  const attempt = Math.max(1, Math.trunc(input.attempt));
  const baseDelayMs = Math.max(1, input.baseDelayMs ?? DEFAULT_RETRY_BASE_MS);
  const maxDelayMs = Math.max(
    baseDelayMs,
    input.maxDelayMs ?? DEFAULT_RETRY_CAP_MS,
  );
  const exponentialDelay = Math.min(
    maxDelayMs,
    baseDelayMs * 2 ** Math.min(attempt - 1, 20),
  );
  const jitter = 0.8 + retryJitterUnit(input.jitterKey ?? "job", attempt) * 0.4;

  return Math.max(1, Math.round(exponentialDelay * jitter));
}

export async function enqueueDurableJob(input: EnqueueDurableJobInput) {
  const dedupeKey = normalizeDedupeKey(input.dedupeKey);
  const [created] = await db
    .insert(durableJobs)
    .values({
      availableAt: input.availableAt ?? new Date(),
      dedupeKey,
      jobType: input.jobType,
      maxAttempts: clampInteger(
        input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        1,
        MAX_JOB_ATTEMPTS,
      ),
      operationAttemptId: input.operationAttemptId ?? null,
      payload: input.payload ?? {},
      projectId: input.projectId,
      submissionId: input.submissionId ?? null,
      traceId: resolveTraceId(input.traceId),
    })
    .onConflictDoNothing()
    .returning();

  if (created) {
    return { created: true, job: created } as const;
  }

  const [existing] = await db
    .select()
    .from(durableJobs)
    .where(
      and(
        eq(durableJobs.projectId, input.projectId),
        eq(durableJobs.jobType, input.jobType),
        eq(durableJobs.dedupeKey, dedupeKey),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error("Could not reserve the durable job.");
  }

  return { created: false, job: existing } as const;
}

function claimableJobCondition(now: Date) {
  return and(
    lt(durableJobs.attempts, durableJobs.maxAttempts),
    or(
      and(eq(durableJobs.status, "queued"), lte(durableJobs.availableAt, now)),
      and(
        eq(durableJobs.status, "processing"),
        lte(durableJobs.leaseExpiresAt, now),
      ),
    ),
  );
}

export async function claimNextDurableJob(
  input: ClaimDurableJobInput,
): Promise<SelectDurableJob | null> {
  const now = input.now ?? new Date();
  const workerId = normalizeWorkerId(input.workerId);
  const leaseMs = clampInteger(
    input.leaseMs ?? DEFAULT_LEASE_MS,
    MIN_LEASE_MS,
    MAX_LEASE_MS,
  );
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  for (let claimAttempt = 0; claimAttempt < 5; claimAttempt += 1) {
    const jobTypeFilter =
      input.jobTypes && input.jobTypes.length > 0
        ? inArray(durableJobs.jobType, input.jobTypes)
        : undefined;
    const [candidate] = await db
      .select()
      .from(durableJobs)
      .where(
        and(
          eq(durableJobs.projectId, input.projectId),
          jobTypeFilter,
          claimableJobCondition(now),
        ),
      )
      .orderBy(asc(durableJobs.availableAt), asc(durableJobs.id))
      .limit(1);

    if (!candidate) {
      return null;
    }

    const [claimed] = await db
      .update(durableJobs)
      .set({
        attempts: sql`${durableJobs.attempts} + 1`,
        lastError: null,
        leaseExpiresAt,
        leaseOwner: workerId,
        status: "processing",
        updatedAt: now,
      })
      .where(
        and(
          eq(durableJobs.projectId, input.projectId),
          eq(durableJobs.id, candidate.id),
          claimableJobCondition(now),
        ),
      )
      .returning();

    if (claimed) {
      return claimed;
    }
  }

  return null;
}

export async function completeDurableJob(input: {
  jobId: number;
  projectId: number;
  result?: Record<string, unknown>;
  workerId: string;
}) {
  const now = new Date();
  const [completed] = await db
    .update(durableJobs)
    .set({
      completedAt: now,
      lastError: null,
      leaseExpiresAt: null,
      leaseOwner: null,
      result: input.result ?? {},
      status: "completed",
      updatedAt: now,
    })
    .where(
      and(
        eq(durableJobs.projectId, input.projectId),
        eq(durableJobs.id, input.jobId),
        eq(durableJobs.status, "processing"),
        eq(durableJobs.leaseOwner, normalizeWorkerId(input.workerId)),
      ),
    )
    .returning();

  return completed ?? null;
}

export async function failDurableJob(input: {
  errorMessage: string;
  jobId: number;
  now?: Date;
  permanent?: boolean;
  projectId: number;
  workerId: string;
}) {
  const now = input.now ?? new Date();
  const workerId = normalizeWorkerId(input.workerId);
  const [job] = await db
    .select()
    .from(durableJobs)
    .where(
      and(
        eq(durableJobs.projectId, input.projectId),
        eq(durableJobs.id, input.jobId),
        eq(durableJobs.status, "processing"),
        eq(durableJobs.leaseOwner, workerId),
      ),
    )
    .limit(1);

  if (!job) {
    return null;
  }

  const exhausted = input.permanent === true || job.attempts >= job.maxAttempts;
  const availableAt = exhausted
    ? job.availableAt
    : new Date(
        now.getTime() +
          getDurableRetryDelayMs({
            attempt: job.attempts,
            jitterKey: `${job.projectId}:${job.jobType}:${job.dedupeKey}`,
          }),
      );
  const [failed] = await db
    .update(durableJobs)
    .set({
      availableAt,
      lastError: input.errorMessage.slice(0, 4_000),
      leaseExpiresAt: null,
      leaseOwner: null,
      status: exhausted ? "failed" : "queued",
      updatedAt: now,
    })
    .where(
      and(
        eq(durableJobs.projectId, input.projectId),
        eq(durableJobs.id, input.jobId),
        eq(durableJobs.status, "processing"),
        eq(durableJobs.leaseOwner, workerId),
      ),
    )
    .returning();

  return failed ?? null;
}

export async function cancelDurableJob(input: {
  jobId: number;
  projectId: number;
}) {
  const now = new Date();
  const [cancelled] = await db
    .update(durableJobs)
    .set({
      cancelledAt: now,
      leaseExpiresAt: null,
      leaseOwner: null,
      status: "cancelled",
      updatedAt: now,
    })
    .where(
      and(
        eq(durableJobs.projectId, input.projectId),
        eq(durableJobs.id, input.jobId),
        inArray(durableJobs.status, ["queued", "processing"]),
      ),
    )
    .returning();

  return cancelled ?? null;
}
