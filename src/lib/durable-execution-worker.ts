import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { durableJobs, outboxMessages } from "@/lib/db-schema";
import { processProjectFlowResponsePolicyQueue } from "@/lib/durable-flow-response-policy";
import { processProjectFlowResumeQueue } from "@/lib/durable-flow-resume";
import { processProjectDurableOperationQueue } from "@/lib/operations";
import { processProjectOutboxQueue } from "@/lib/outbox";
import { processProjectPostConversationQueue } from "@/lib/post-conversation-jobs";

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function dueDurableJobCondition(now: Date) {
  return or(
    and(eq(durableJobs.status, "queued"), lte(durableJobs.availableAt, now)),
    and(
      eq(durableJobs.status, "processing"),
      lte(durableJobs.leaseExpiresAt, now),
    ),
  );
}

function dueOutboxMessageCondition(now: Date) {
  return or(
    and(
      eq(outboxMessages.status, "queued"),
      lte(outboxMessages.availableAt, now),
    ),
    and(
      eq(outboxMessages.status, "processing"),
      lte(outboxMessages.leaseExpiresAt, now),
    ),
  );
}

async function listDueProjectIds(maxProjects: number) {
  const now = new Date();
  const [jobProjects, outboxProjects] = await Promise.all([
    db
      .selectDistinct({ projectId: durableJobs.projectId })
      .from(durableJobs)
      .where(
        and(
          inArray(durableJobs.status, ["queued", "processing"]),
          dueDurableJobCondition(now),
        ),
      )
      .orderBy(asc(durableJobs.projectId))
      .limit(maxProjects),
    db
      .selectDistinct({ projectId: outboxMessages.projectId })
      .from(outboxMessages)
      .where(
        and(
          inArray(outboxMessages.status, ["queued", "processing"]),
          dueOutboxMessageCondition(now),
        ),
      )
      .orderBy(asc(outboxMessages.projectId))
      .limit(maxProjects),
  ]);

  return Array.from(
    new Set([
      ...jobProjects.map(({ projectId }) => projectId),
      ...outboxProjects.map(({ projectId }) => projectId),
    ]),
  )
    .sort((left, right) => left - right)
    .slice(0, maxProjects);
}

export async function processDurableExecutionQueue(input?: {
  maxItemsPerQueue?: number;
  maxProjects?: number;
  workerId?: string;
}) {
  const maxItemsPerQueue = clampInteger(input?.maxItemsPerQueue ?? 10, 1, 25);
  const maxProjects = clampInteger(input?.maxProjects ?? 10, 1, 50);
  const workerId =
    input?.workerId?.trim() || `durable-worker:${crypto.randomUUID()}`;
  const projectIds = await listDueProjectIds(maxProjects);
  const projects = [];

  for (const projectId of projectIds) {
    const projectWorkerId = `${workerId}:project:${projectId}`.slice(0, 160);
    const operations = await processProjectDurableOperationQueue({
      maxJobs: maxItemsPerQueue,
      projectId,
      workerId: projectWorkerId,
    });
    const resumes = await processProjectFlowResumeQueue({
      maxJobs: maxItemsPerQueue,
      projectId,
      workerId: projectWorkerId,
    });
    const responsePolicies = await processProjectFlowResponsePolicyQueue({
      maxJobs: maxItemsPerQueue,
      projectId,
      workerId: projectWorkerId,
    });
    const postConversation = await processProjectPostConversationQueue({
      maxJobs: maxItemsPerQueue,
      projectId,
      workerId: projectWorkerId,
    });
    const outbox = await processProjectOutboxQueue({
      maxMessages: maxItemsPerQueue,
      projectId,
      workerId: projectWorkerId,
    });

    projects.push({
      operations,
      outbox,
      postConversation,
      projectId,
      responsePolicies,
      resumes,
    });
  }

  return {
    idle: projectIds.length === 0,
    processedProjects: projectIds.length,
    projects,
    workerId,
  };
}
