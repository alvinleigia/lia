// src/lib/chunking.ts
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

export const textSplitter = new RecursiveCharacterTextSplitter({
  // Larger, structure-aware chunks reduce embedding cost and improve context quality.
  chunkSize: 900,
  chunkOverlap: 120,
  separators: ["\n\n", "\n", ". ", " ", ""],
});

export async function chunkContent(content: string) {
  return await textSplitter.splitText(content.trim());
}
