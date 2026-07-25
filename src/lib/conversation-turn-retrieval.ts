import type { TurnKnowledgeRetriever } from "@/lib/conversation-turn-engine";
import { projectHasIndexedDocuments } from "@/lib/documents";
import { searchDocuments } from "@/lib/search";

export class ProjectDocumentTurnRetriever implements TurnKnowledgeRetriever {
  async retrieve(input: { projectId: number; query: string }) {
    if (!(await projectHasIndexedDocuments(input.projectId))) {
      return [];
    }

    const results = await searchDocuments(input.projectId, input.query);
    return results.map((result) => ({
      id: `document:${result.id}`,
      content: result.content,
    }));
  }
}
