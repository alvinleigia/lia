import { count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { durableJobs, outboxMessages } from "@/lib/db-schema";

export type ExecutionDiagnosticItem = {
  attempts: number;
  availableAt: Date;
  createdAt: Date;
  id: number;
  kind: "job" | "outbox";
  lastError: string | null;
  maxAttempts: number;
  name: string;
  status: string;
  traceId: string;
  updatedAt: Date;
};

function toStatusCounts(rows: Array<{ status: string; total: number }>) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.status] = row.total;
    return counts;
  }, {});
}

export async function getProjectExecutionDiagnostics(
  projectId: number,
  limit = 12,
) {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 25));
  const [jobCounts, outboxCounts, recentJobs, recentOutbox] = await Promise.all(
    [
      db
        .select({ status: durableJobs.status, total: count() })
        .from(durableJobs)
        .where(eq(durableJobs.projectId, projectId))
        .groupBy(durableJobs.status),
      db
        .select({ status: outboxMessages.status, total: count() })
        .from(outboxMessages)
        .where(eq(outboxMessages.projectId, projectId))
        .groupBy(outboxMessages.status),
      db
        .select({
          attempts: durableJobs.attempts,
          availableAt: durableJobs.availableAt,
          createdAt: durableJobs.createdAt,
          id: durableJobs.id,
          lastError: durableJobs.lastError,
          maxAttempts: durableJobs.maxAttempts,
          name: durableJobs.jobType,
          status: durableJobs.status,
          traceId: durableJobs.traceId,
          updatedAt: durableJobs.updatedAt,
        })
        .from(durableJobs)
        .where(eq(durableJobs.projectId, projectId))
        .orderBy(desc(durableJobs.createdAt), desc(durableJobs.id))
        .limit(boundedLimit),
      db
        .select({
          attempts: outboxMessages.attempts,
          availableAt: outboxMessages.availableAt,
          createdAt: outboxMessages.createdAt,
          id: outboxMessages.id,
          lastError: outboxMessages.lastError,
          maxAttempts: outboxMessages.maxAttempts,
          name: outboxMessages.topic,
          status: outboxMessages.status,
          traceId: outboxMessages.traceId,
          updatedAt: outboxMessages.updatedAt,
        })
        .from(outboxMessages)
        .where(eq(outboxMessages.projectId, projectId))
        .orderBy(desc(outboxMessages.createdAt), desc(outboxMessages.id))
        .limit(boundedLimit),
    ],
  );
  const jobStatusCounts = toStatusCounts(jobCounts);
  const outboxStatusCounts = toStatusCounts(outboxCounts);
  const getTotal = (status: string) =>
    (jobStatusCounts[status] ?? 0) + (outboxStatusCounts[status] ?? 0);
  const items: ExecutionDiagnosticItem[] = [
    ...recentJobs.map((item) => ({ ...item, kind: "job" as const })),
    ...recentOutbox.map((item) => ({ ...item, kind: "outbox" as const })),
  ]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, boundedLimit);

  return {
    counts: {
      completed: getTotal("completed") + getTotal("delivered"),
      failed: getTotal("failed"),
      processing: getTotal("processing"),
      queued: getTotal("queued"),
    },
    items,
  };
}
