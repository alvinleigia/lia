import type { TurnKnowledgeRetriever } from "@/lib/conversation-turn-engine";
import { projectHasIndexedDocuments } from "@/lib/documents";
import { searchDocuments } from "@/lib/search";

// One instance per inbound message. Reuse evidence only for the identical scoped
// query; never cache conversation state or an answer across visitor turns.
export class RequestTurnKnowledgeRetriever implements TurnKnowledgeRetriever {
  private readonly pending = new Map<
    string,
    ReturnType<TurnKnowledgeRetriever["retrieve"]>
  >();

  constructor(
    private readonly source: TurnKnowledgeRetriever = new ProjectDocumentTurnRetriever(),
  ) {}

  retrieve(input: Parameters<TurnKnowledgeRetriever["retrieve"]>[0]) {
    const key = JSON.stringify([input.projectId, input.limit, input.query]);
    let result = this.pending.get(key);
    if (!result) {
      result = this.source.retrieve(input);
      this.pending.set(key, result);
    }
    return result;
  }
}

export class ProjectDocumentTurnRetriever implements TurnKnowledgeRetriever {
  async retrieve(input: { limit: number; projectId: number; query: string }) {
    if (!(await projectHasIndexedDocuments(input.projectId))) {
      return [];
    }

    const results = await searchDocuments(
      input.projectId,
      input.query,
      input.limit,
    );
    return results.map((result) => ({
      id: `document:${result.id}`,
      content: result.content,
    }));
  }
}
