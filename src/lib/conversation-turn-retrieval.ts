import type { TurnKnowledgeRetriever } from "@/lib/conversation-turn-engine";
import { searchProjectDocumentEvidence } from "@/lib/search";

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
      result = this.source.retrieve(input).catch((error) => {
        this.pending.delete(key);
        throw error;
      });
      this.pending.set(key, result);
    }
    return result;
  }
}

export class ProjectDocumentTurnRetriever implements TurnKnowledgeRetriever {
  async retrieve(input: { limit: number; projectId: number; query: string }) {
    return searchProjectDocumentEvidence(
      input.projectId,
      input.query,
      input.limit,
    );
  }
}
