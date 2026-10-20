import { and, asc, eq } from "drizzle-orm";
import { chunkContent } from "@/lib/chunking";
import { db } from "@/lib/db-config";
import { documents, sourceDocuments, uploadJobs } from "@/lib/db-schema";
import { generateEmbeddings } from "@/lib/embeddings";
import {
  extractKnowledgeAnswers,
  knowledgeImportReviewSchema,
} from "@/lib/knowledge-import";

type QueueRunResult = {
  processed: number;
  failed: number;
  idle: boolean;
};

async function claimNextQueuedJob(projectId?: number) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [candidate] = await db
      .select()
      .from(uploadJobs)
      .where(
        and(
          eq(uploadJobs.status, "queued"),
          projectId ? eq(uploadJobs.projectId, projectId) : undefined,
        ),
      )
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
  projectId: number,
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
    .where(and(eq(uploadJobs.id, jobId), eq(uploadJobs.projectId, projectId)));

  await db
    .update(sourceDocuments)
    .set({
      processingStatus: "failed",
      processingError: message,
    })
    .where(
      and(
        eq(sourceDocuments.id, sourceDocumentId),
        eq(sourceDocuments.projectId, projectId),
      ),
    );
}

export async function processUploadQueue(
  maxJobs = 2,
  projectId?: number,
  embed: typeof generateEmbeddings = generateEmbeddings,
): Promise<QueueRunResult> {
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < maxJobs; i += 1) {
    const job = await claimNextQueuedJob(projectId);
    if (!job) {
      break;
    }

    try {
      const [source] = await db
        .select()
        .from(sourceDocuments)
        .where(
          and(
            eq(sourceDocuments.id, job.sourceDocumentId),
            eq(sourceDocuments.projectId, job.projectId),
          ),
        );
      if (!source) throw new Error("Source document not found.");
      const review = source.importReview
        ? knowledgeImportReviewSchema.parse(source.importReview)
        : null;
      if (
        review &&
        (!review.approvedAt ||
          !review.approvedByUserId ||
          review.draftText !== job.textContent)
      )
        throw new Error("This document needs approval before indexing.");
      const chunks = await chunkContent(job.textContent);
      if (chunks.length === 0) {
        await markJobFailed(
          job.id,
          job.sourceDocumentId,
          job.projectId,
          "No text chunks could be created from this document.",
        );
        failed += 1;
        continue;
      }

      const embeddings = await embed(job.projectId, chunks);
      if (embeddings.length !== chunks.length) {
        await markJobFailed(
          job.id,
          job.sourceDocumentId,
          job.projectId,
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
        const [current] = await tx
          .select({ id: sourceDocuments.id })
          .from(sourceDocuments)
          .where(
            and(
              eq(sourceDocuments.id, job.sourceDocumentId),
              eq(sourceDocuments.projectId, job.projectId),
            ),
          )
          .for("update");
        if (!current)
          throw new Error("Source document was removed during indexing.");
        // Replace only this source's published content once all embeddings exist.
        // Failed processing leaves its previous published content available.
        await tx
          .delete(documents)
          .where(
            and(
              eq(documents.projectId, job.projectId),
              eq(documents.sourceDocumentId, job.sourceDocumentId),
            ),
          );
        await tx.insert(documents).values(records);

        await tx
          .update(sourceDocuments)
          .set({
            processingStatus: "done",
            processingError: null,
            processedAt: new Date(),
            ...(review
              ? {
                  importReview: {
                    ...review,
                    publishedText: job.textContent,
                    publishedAnswers: extractKnowledgeAnswers(job.textContent),
                  },
                }
              : {}),
          })
          .where(
            and(
              eq(sourceDocuments.id, job.sourceDocumentId),
              eq(sourceDocuments.projectId, job.projectId),
            ),
          );

        await tx
          .delete(uploadJobs)
          .where(
            and(
              eq(uploadJobs.id, job.id),
              eq(uploadJobs.projectId, job.projectId),
            ),
          );
      });

      processed += 1;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown queue processing error.";
      await markJobFailed(job.id, job.sourceDocumentId, job.projectId, message);
      failed += 1;
    }
  }

  return {
    processed,
    failed,
    idle: processed === 0 && failed === 0,
  };
}
