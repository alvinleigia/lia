import { eq } from "drizzle-orm";
import {
  type ConversationProjectPolicyV1,
  DEFAULT_CONVERSATION_PROJECT_POLICY,
  normalizeConversationProjectPolicy,
} from "@/lib/conversation-contracts";
import { db } from "@/lib/db-config";
import { conversationProjectPolicies } from "@/lib/db-schema";

export async function getConversationProjectPolicy(projectId: number) {
  const [row] = await db
    .select()
    .from(conversationProjectPolicies)
    .where(eq(conversationProjectPolicies.projectId, projectId))
    .limit(1);

  return row
    ? normalizeConversationProjectPolicy(row.definition)
    : DEFAULT_CONVERSATION_PROJECT_POLICY;
}

export async function saveConversationProjectPolicy(
  projectId: number,
  definition: ConversationProjectPolicyV1,
) {
  const [row] = await db
    .insert(conversationProjectPolicies)
    .values({
      projectId,
      schemaVersion: definition.schemaVersion,
      definition,
    })
    .onConflictDoUpdate({
      target: conversationProjectPolicies.projectId,
      set: {
        definition,
        schemaVersion: definition.schemaVersion,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row;
}
