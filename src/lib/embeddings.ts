// src/lib/embeddings.ts

import { embed, embedMany } from "ai";
import { getPlatformEmbeddingModel } from "@/lib/model-provider";

export async function generateEmbedding(text: string): Promise<number[]> {
  const input = text.replaceAll("\n", " ");

  const { embedding } = await embed({
    model: getPlatformEmbeddingModel(),
    value: input,
  });

  return embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const inputs = texts.map((text) => text.replaceAll("\n", " "));
  if (inputs.length === 0) {
    return [];
  }

  const BATCH_SIZE = 64;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE);
    const { embeddings } = await embedMany({
      model: getPlatformEmbeddingModel(),
      values: batch,
    });
    allEmbeddings.push(...embeddings);
  }

  return allEmbeddings;
}
