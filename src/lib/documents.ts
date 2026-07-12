import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { documents, sourceDocuments } from "@/lib/db-schema";

export async function projectHasIndexedDocuments(projectId: number) {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.projectId, projectId))
    .limit(1);

  return Boolean(row?.id);
}

export async function getSourceDocumentByFileHash(
  projectId: number,
  fileHash: string,
) {
  const [document] = await db
    .select({
      id: sourceDocuments.id,
      title: sourceDocuments.title,
    })
    .from(sourceDocuments)
    .where(
      and(
        eq(sourceDocuments.projectId, projectId),
        eq(sourceDocuments.fileHash, fileHash),
      ),
    )
    .limit(1);

  return document ?? null;
}

export async function getProjectDocumentStats(projectId: number) {
  const [chunkRow] = await db
    .select({
      totalChunks: count(documents.id),
    })
    .from(documents)
    .where(eq(documents.projectId, projectId));

  const [documentRow] = await db
    .select({
      totalDocuments: count(sourceDocuments.id),
    })
    .from(sourceDocuments)
    .where(eq(sourceDocuments.projectId, projectId));

  const [legacyRow] = await db
    .select({
      legacyChunks: count(documents.id),
    })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, projectId),
        isNull(documents.sourceDocumentId),
      ),
    );

  return {
    totalChunks: Number(chunkRow?.totalChunks ?? 0),
    totalDocuments: Number(documentRow?.totalDocuments ?? 0),
    legacyChunks: Number(legacyRow?.legacyChunks ?? 0),
  };
}

export async function getProjectSourceDocuments(projectId: number, limit = 50) {
  return db
    .select({
      id: sourceDocuments.id,
      title: sourceDocuments.title,
      createdAt: sourceDocuments.createdAt,
      processingStatus: sourceDocuments.processingStatus,
      processingError: sourceDocuments.processingError,
      chunkCount: count(documents.id),
    })
    .from(sourceDocuments)
    .leftJoin(documents, eq(documents.sourceDocumentId, sourceDocuments.id))
    .where(eq(sourceDocuments.projectId, projectId))
    .groupBy(sourceDocuments.id)
    .orderBy(desc(sourceDocuments.id))
    .limit(limit);
}

export async function deleteSourceDocumentFromProject(
  projectId: number,
  sourceDocumentId: number,
) {
  await db
    .delete(documents)
    .where(
      and(
        eq(documents.projectId, projectId),
        eq(documents.sourceDocumentId, sourceDocumentId),
      ),
    );

  await db
    .delete(sourceDocuments)
    .where(
      and(
        eq(sourceDocuments.id, sourceDocumentId),
        eq(sourceDocuments.projectId, projectId),
      ),
    );
}

export async function deleteAllDocumentsFromProject(projectId: number) {
  await db.delete(documents).where(eq(documents.projectId, projectId));
  await db
    .delete(sourceDocuments)
    .where(eq(sourceDocuments.projectId, projectId));
}
