// src/lib/search.ts
import { and, cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
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

async function getCachedQueryEmbedding(query: string) {
  const cacheKey = normalizeQueryForCache(query);
  const now = Date.now();
  const cached = embeddingCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.embedding;
  }

  const embedding = await generateEmbedding(query);
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
  const embedding = await getCachedQueryEmbedding(query);

  // Calculate similarity using Drizzle's cosineDistance function
  // This creates a SQL expression for similarity calculation
  const similarity = sql<number>`1 - (${cosineDistance(
    documents.embedding,
    embedding,
  )})`;

  // Use Drizzle's query builder for the search
  const similarDocuments = await db
    .select({
      id: documents.id,
      content: documents.content,
      similarity,
    })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), gt(similarity, threshold)))
    .orderBy(desc(similarity))
    .limit(limit);

  if (similarDocuments.length > 0) {
    return similarDocuments;
  }

  // Fallback recall path: if threshold is too strict for this query,
  // return top project matches rather than empty context.
  return db
    .select({
      id: documents.id,
      content: documents.content,
      similarity,
    })
    .from(documents)
    .where(eq(documents.projectId, projectId))
    .orderBy(desc(similarity))
    .limit(limit);
}
