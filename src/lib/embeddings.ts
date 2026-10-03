// src/lib/embeddings.ts

import { embed, embedMany } from "ai";
import { logChatRequest } from "@/lib/chat-logs";
import {
  getPlatformEmbeddingModel,
  PLATFORM_EMBEDDING_MODEL_ID,
} from "@/lib/model-provider";
import {
  type ModelUsageDetail,
  measureEmbeddingCall,
  tokenLogFields,
} from "@/lib/model-usage";

function embeddingRecorder(projectId: number) {
  const startedAt = performance.now();
  return async (detail: ModelUsageDetail) =>
    logChatRequest({
      route:
        detail.purpose === "embedding_query"
          ? "embedding_query"
          : "embedding_ingest",
      projectId,
      statusCode: detail.status === "completed" ? 200 : 500,
      latencyMs: Math.round(performance.now() - startedAt),
      ...tokenLogFields(detail.usage),
      usageDetails: [detail],
    });
}

export async function generateEmbedding(
  projectId: number,
  text: string,
): Promise<number[]> {
  const input = text.replaceAll("\n", " ");

  const { embedding } = await measureEmbeddingCall(
    PLATFORM_EMBEDDING_MODEL_ID,
    "embedding_query",
    () =>
      embed({
        model: getPlatformEmbeddingModel(),
        value: input,
      }),
    embeddingRecorder(projectId),
  );

  return embedding;
}

export async function generateEmbeddings(
  projectId: number,
  texts: string[],
): Promise<number[][]> {
  const inputs = texts.map((text) => text.replaceAll("\n", " "));
  if (inputs.length === 0) {
    return [];
  }

  const BATCH_SIZE = 64;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE);
    const { embeddings } = await measureEmbeddingCall(
      PLATFORM_EMBEDDING_MODEL_ID,
      "embedding_ingest",
      () =>
        embedMany({
          model: getPlatformEmbeddingModel(),
          values: batch,
        }),
      embeddingRecorder(projectId),
    );
    allEmbeddings.push(...embeddings);
  }

  return allEmbeddings;
}
