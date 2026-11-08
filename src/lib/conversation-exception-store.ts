import { and, eq, sql } from "drizzle-orm";
import {
  EXCEPTION_METADATA_KEY,
  planConversationException,
  readConversationException,
} from "@/lib/conversation-exceptions";
import { db } from "@/lib/db-config";
import {
  channelConversations,
  channelMessages,
  conversationalTaskAuditEvents,
} from "@/lib/db-schema";

export async function getConversationExceptionState(input: {
  projectId: number;
  conversationId: number;
  messageId: number;
}) {
  const [row] = await db
    .select({ metadata: channelConversations.metadata })
    .from(channelConversations)
    .innerJoin(
      channelMessages,
      and(
        eq(channelMessages.conversationId, channelConversations.id),
        eq(channelMessages.projectId, input.projectId),
        eq(channelMessages.id, input.messageId),
        eq(channelMessages.direction, "inbound"),
      ),
    )
    .where(
      and(
        eq(channelConversations.projectId, input.projectId),
        eq(channelConversations.id, input.conversationId),
      ),
    )
    .limit(1);
  return row ? { state: readConversationException(row.metadata) } : null;
}

export async function advanceConversationException(
  input: Omit<Parameters<typeof planConversationException>[0], "previous"> & {
    projectId: number;
    conversationId: number;
  },
) {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({ metadata: channelConversations.metadata })
      .from(channelConversations)
      .where(
        and(
          eq(channelConversations.projectId, input.projectId),
          eq(channelConversations.id, input.conversationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!conversation) return null;
    const [message] = await tx
      .select({ id: channelMessages.id })
      .from(channelMessages)
      .where(
        and(
          eq(channelMessages.projectId, input.projectId),
          eq(channelMessages.conversationId, input.conversationId),
          eq(channelMessages.id, input.messageId),
          eq(channelMessages.direction, "inbound"),
        ),
      )
      .limit(1);
    if (!message) return null;
    const previous = readConversationException(conversation.metadata);
    const state = planConversationException({ ...input, previous });
    if (!state || state === previous) return state;
    await tx
      .update(channelConversations)
      .set({
        metadata: sql`${channelConversations.metadata} || ${JSON.stringify({ [EXCEPTION_METADATA_KEY]: state })}::jsonb`,
      })
      .where(
        and(
          eq(channelConversations.projectId, input.projectId),
          eq(channelConversations.id, input.conversationId),
        ),
      );
    await tx.insert(conversationalTaskAuditEvents).values({
      projectId: input.projectId,
      conversationId: input.conversationId,
      eventType: "exception.decision",
      summary: { exception: state },
    });
    return state;
  });
}
