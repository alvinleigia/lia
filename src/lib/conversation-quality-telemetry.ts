import { sql } from "drizzle-orm";
import type { StructuredTurnExecution } from "@/lib/conversation-turn-engine";
import { db } from "@/lib/db-config";
import {
  channelConversations,
  conversationalTaskAuditEvents,
} from "@/lib/db-schema";

export async function recordConversationQualityTurn(input: {
  projectId: number;
  conversationId: number;
  stage: string;
  latencyMs: number;
  execution: StructuredTurnExecution;
}) {
  const { execution } = input;
  const summary = {
    source: execution.source,
    stage: input.stage,
    model: execution.proposal.validation.providerModelId,
    attempts: execution.attempts,
    latencyMs: Math.round(input.latencyMs),
    totalTokens: execution.usage.totalTokens,
    groundingStatus: execution.proposal.grounding.status,
    referenceIds: execution.proposal.grounding.excerptIds,
  };
  try {
    // Scope is verified again at the write boundary. No transcript, prompt,
    // field values or reasoning is copied into operational telemetry.
    await db.execute(sql`
      insert into ${conversationalTaskAuditEvents}
        (project_id, conversation_id, event_type, summary)
      select ${input.projectId}, c.id, 'quality.turn', ${JSON.stringify(summary)}::jsonb
      from ${channelConversations} c
      where c.project_id = ${input.projectId} and c.id = ${input.conversationId}
    `);
  } catch {
    console.error("Could not record conversation quality telemetry.");
  }
}
