import { sql } from "drizzle-orm";
import {
  type RecoveryReport,
  recoveryReportSchema,
} from "@/lib/conversation-recovery";
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
  const recovery = recoveryReportSchema.safeParse(execution.recovery);
  const summary = {
    source: execution.source,
    stage: input.stage,
    model: execution.proposal.validation.providerModelId,
    attempts: execution.attempts,
    latencyMs: Math.round(input.latencyMs),
    totalTokens: execution.usage.totalTokens,
    groundingStatus: execution.proposal.grounding.status,
    referenceIds: execution.proposal.grounding.excerptIds,
    ...(recovery.success ? { recovery: recovery.data } : {}),
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

export async function recordConversationRecovery(input: {
  projectId: number;
  conversationId: number;
  stage: "state" | "operation";
  report: RecoveryReport;
  revision?: number;
}) {
  try {
    const summary = {
      stage: input.stage,
      recovery: recoveryReportSchema.parse(input.report),
      revision: input.revision ?? null,
    };
    await db.execute(sql`
      insert into ${conversationalTaskAuditEvents}
        (project_id, conversation_id, event_type, summary)
      select ${input.projectId}, c.id, 'recovery.decision', ${JSON.stringify(summary)}::jsonb
      from ${channelConversations} c
      where c.project_id = ${input.projectId} and c.id = ${input.conversationId}
    `);
  } catch {
    console.error("Could not record conversation recovery telemetry.");
  }
}
