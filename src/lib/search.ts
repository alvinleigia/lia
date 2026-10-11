// src/lib/search.ts
import { and, cosineDistance, desc, eq, gt, or, sql } from "drizzle-orm";
import { db } from "./db-config";
import { documents } from "./db-schema";
import { generateEmbedding } from "./embeddings";

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

async function getCachedQueryEmbedding(projectId: number, query: string) {
  const cacheKey = createProjectEmbeddingCacheKey(projectId, query);
  const now = Date.now();
  const cached = embeddingCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.embedding;
  }

  const embedding = await generateEmbedding(projectId, query);
  embeddingCache.set(cacheKey, {
    embedding,
    expiresAt: now + EMBEDDING_CACHE_TTL_MS,
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
  const rank = sql<number>`${similarity} + least(ts_rank_cd(${lexicalDocument}, ${lexicalQuery}), 0.1)`;

  // Use Drizzle's query builder for the search
  const similarDocuments = await db
    .select({
      id: documents.id,
      content: documents.content,
      similarity,
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

  return similarDocuments;
}
