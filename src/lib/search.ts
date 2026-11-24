// src/lib/search.ts
import { and, cosineDistance, desc, eq, gt, or, sql } from "drizzle-orm";
import { db } from "./db-config";
import { documents, sourceDocuments } from "./db-schema";
import { projectHasIndexedDocuments } from "./documents";
import { generateEmbedding } from "./embeddings";
import { publishedAnswersInChunk } from "./knowledge-import";

const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_SIMILARITY_THRESHOLD = 0.35;
const EMBEDDING_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const EMBEDDING_CACHE_MAX_ENTRIES = 500;

const embeddingCache = new Map<
  string,
  { embedding: number[]; expiresAt: number }
>();

function normalizeQueryForCache(query: string) {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

export function createProjectEmbeddingCacheKey(
  projectId: number,
  query: string,
) {
  return `${projectId}:${normalizeQueryForCache(query)}`;
}

function readCachedEmbedding(projectId: number, query: string) {
  const cached = embeddingCache.get(
    createProjectEmbeddingCacheKey(projectId, query),
  );
  return cached && cached.expiresAt > Date.now() ? cached.embedding : undefined;
}

async function getCachedQueryEmbedding(projectId: number, query: string) {
  const cached = readCachedEmbedding(projectId, query);
  if (cached) return cached;
  const embedding = await generateEmbedding(projectId, query);
  embeddingCache.set(createProjectEmbeddingCacheKey(projectId, query), {
    embedding,
    expiresAt: Date.now() + EMBEDDING_CACHE_TTL_MS,
  });

  // Keep memory bounded.
  if (embeddingCache.size > EMBEDDING_CACHE_MAX_ENTRIES) {
    const oldestKey = embeddingCache.keys().next().value;
    if (typeof oldestKey === "string") {
      embeddingCache.delete(oldestKey);
    }
  }

  return embedding;
}

/**
 * Search for similar documents using Drizzle ORM with cosineDistance
 */
export async function searchDocuments(
  projectId: number,
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
) {
  // Generate embedding for the search query
  const embedding = await getCachedQueryEmbedding(projectId, query);
  return searchDocumentsWithEmbedding(
    projectId,
    query,
    embedding,
    limit,
    threshold,
  );
}

export async function searchDocumentsWithEmbedding(
  projectId: number,
  query: string,
  embedding: number[],
  limit: number = DEFAULT_SEARCH_LIMIT,
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
) {
  const rows = await rankedChunks(
    projectId,
    query,
    embedding,
    limit,
    threshold,
    false,
  );
  return rows.map(({ id, content, similarity }) => ({
    id,
    content,
    similarity,
  }));
}

export async function searchProjectDocumentEvidence(
  projectId: number,
  query: string,
  limit: number,
) {
  const cached = readCachedEmbedding(projectId, query);
  // Avoid paying for an embedding in an empty project. A cached vector needs
  // no preflight: the scoped search itself sees current edits and deletions.
  if (!cached && !(await projectHasIndexedDocuments(projectId))) return [];
  const embedding = cached ?? (await getCachedQueryEmbedding(projectId, query));
  return searchProjectDocumentEvidenceWithEmbedding(
    projectId,
    query,
    embedding,
    limit,
  );
}

export async function searchProjectDocumentEvidenceWithEmbedding(
  projectId: number,
  query: string,
  embedding: number[],
  limit: number,
) {
  const rows = await rankedChunks(
    projectId,
    query,
    embedding,
    limit,
    DEFAULT_SIMILARITY_THRESHOLD,
    true,
  );
  return rows.map((row, index) => ({
    id: `document:${row.id}`,
    content: row.content,
    approvedAnswers:
      index < 12 && row.answers != null
        ? publishedAnswersInChunk(row.id, row.content, row.answers)
        : [],
  }));
}

function rankedChunks(
  projectId: number,
  query: string,
  embedding: number[],
  limit: number,
  threshold: number,
  includePublishedAnswers: boolean,
) {
  // Calculate similarity using Drizzle's cosineDistance function
  // This creates a SQL expression for similarity calculation
  const similarity = sql<number>`1 - (${cosineDistance(
    documents.embedding,
    embedding,
  )})`;
  // Explicit facts in a multi-topic chunk can have low vector similarity.
  // Search non-stopword terms independently so "Is parking available?" can
  // find "Parking is free". Parameterized full-text parsing handles escaping.
  // A match supplies evidence, never an automatic factual answer.
  const lexicalQuery = sql`replace(plainto_tsquery('english', ${query})::text, ' & ', ' | ')::tsquery`;
  const lexicalDocument = sql`to_tsvector('english', ${documents.content})`;
  const lexicalMatch = sql<boolean>`${lexicalDocument} @@ ${lexicalQuery}`;
  // Keep keyword matches eligible while limiting the boost from incidental overlap.
  const keywordWeight = includePublishedAnswers ? 0.25 : 1;
  const rank = sql<number>`${similarity} + least(ts_rank_cd(${lexicalDocument}, ${lexicalQuery}), 0.1) * ${keywordWeight}::float8`;

  // Use Drizzle's query builder for the search
  return db
    .select({
      id: documents.id,
      content: documents.content,
      similarity,
      answers: includePublishedAnswers
        ? sql<unknown>`(select ${sourceDocuments.importReview}->'publishedAnswers'
        from ${sourceDocuments} where ${sourceDocuments.id} = ${documents.sourceDocumentId}
        and ${sourceDocuments.projectId} = ${projectId})`
        : sql<null>`null`,
    })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, projectId),
        or(gt(similarity, threshold), lexicalMatch),
      ),
    )
    .orderBy(desc(rank), desc(similarity), documents.id)
    .limit(limit);
}
