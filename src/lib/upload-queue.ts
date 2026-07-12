import { and, asc, eq } from "drizzle-orm";
import { chunkContent } from "@/lib/chunking";
import { db } from "@/lib/db-config";
import { documents, sourceDocuments, uploadJobs } from "@/lib/db-schema";
import { generateEmbeddings } from "@/lib/embeddings";

type QueueRunResult = {
  processed: number;
  failed: number;
  idle: boolean;
};

async function claimNextQueuedJob() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [candidate] = await db
      .select()
      .from(uploadJobs)
      .where(eq(uploadJobs.status, "queued"))
      .orderBy(asc(uploadJobs.id))
      .limit(1);

    if (!candidate) {
      return null;
    }

    const [claimed] = await db
      .update(uploadJobs)
      .set({
        status: "processing",
        attempts: candidate.attempts + 1,
        startedAt: new Date(),
        updatedAt: new Date(),
        errorMessage: null,
      })
      .where(
        and(eq(uploadJobs.id, candidate.id), eq(uploadJobs.status, "queued")),
      )
      .returning();

    if (claimed) {
      return claimed;
    }
  }

  return null;
}

async function markJobFailed(
  jobId: number,
  sourceDocumentId: number,
  message: string,
) {
  await db
    .update(uploadJobs)
    .set({
      status: "failed",
      errorMessage: message,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(uploadJobs.id, jobId));

  await db
    .update(sourceDocuments)
    .set({
      processingStatus: "failed",
      processingError: message,
    })
    .where(eq(sourceDocuments.id, sourceDocumentId));
}

export async function processUploadQueue(maxJobs = 2): Promise<QueueRunResult> {
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < maxJobs; i += 1) {
    const job = await claimNextQueuedJob();
    if (!job) {
      break;
    }

    try {
      const chunks = await chunkContent(job.textContent);
      if (chunks.length === 0) {
        await markJobFailed(
          job.id,
          job.sourceDocumentId,
          "No text chunks could be created from this document.",
        );
        failed += 1;
        continue;
      }

      const embeddings = await generateEmbeddings(chunks);
      if (embeddings.length !== chunks.length) {
        await markJobFailed(
          job.id,
          job.sourceDocumentId,
          "Embedding generation did not complete for all chunks.",
        );
        failed += 1;
        continue;
      }

      const records = chunks.map((chunk, index) => ({
        projectId: job.projectId,
        sourceDocumentId: job.sourceDocumentId,
        content: chunk,
        embedding: embeddings[index],
      }));

      await db.transaction(async (tx) => {
        await tx.insert(documents).values(records);

        await tx
          .update(sourceDocuments)
          .set({
            processingStatus: "done",
            processingError: null,
            processedAt: new Date(),
          })
          .where(eq(sourceDocuments.id, job.sourceDocumentId));

        await tx.delete(uploadJobs).where(eq(uploadJobs.id, job.id));
      });

      processed += 1;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown queue processing error.";
      await markJobFailed(job.id, job.sourceDocumentId, message);
      failed += 1;
    }
  }

  return {
    processed,
    failed,
    idle: processed === 0 && failed === 0,
  };
}
