import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db-config";
import {
  actionSubmissionEvents,
  actionSubmissions,
  channelConversations,
  channelMessages,
  conversationalTaskRuns,
  conversationalTasks,
  conversationExecutionStates,
  projectActions,
} from "@/lib/db-schema";

export function getDiagnosticSubmissionSource(channelType: string) {
  if (channelType === "widget") {
    return "widget_chat";
  }

  if (channelType === "whatsapp") {
    return "whatsapp_chat";
  }

  return channelType;
}

export function summarizeDiagnosticEvents(
  events: Array<{ eventType: string }>,
) {
  return {
    cancellations: events.filter(({ eventType }) =>
      eventType.includes("cancel"),
    ).length,
    handoffs: events.filter(({ eventType }) => eventType.includes("handoff"))
      .length,
    validationFailures: events.filter(
      ({ eventType }) => eventType === "flow.validation_failed",
    ).length,
  };
}

export async function listProjectDiagnosticConversations(
  projectId: number,
  limit = 50,
) {
  return db
    .select({
      conversation: channelConversations,
    })
    .from(channelConversations)
    .where(eq(channelConversations.projectId, projectId))
    .orderBy(
      desc(channelConversations.lastMessageAt),
      desc(channelConversations.updatedAt),
      desc(channelConversations.id),
    )
    .limit(limit);
}

export async function getProjectConversationDiagnostics(
  projectId: number,
  conversationId: number,
) {
  const [selected] = await db
    .select({
      conversation: channelConversations,
    })
    .from(channelConversations)
    .where(
      and(
        eq(channelConversations.projectId, projectId),
        eq(channelConversations.id, conversationId),
      ),
    )
    .limit(1);

  if (!selected) {
    return null;
  }

  const submissionSource = getDiagnosticSubmissionSource(
    selected.conversation.channelType,
  );

  const [messages, submissions, taskRuns, executionStates] = await Promise.all([
    db
      .select({
        id: channelMessages.id,
        direction: channelMessages.direction,
        messageType: channelMessages.messageType,
        text: channelMessages.text,
        createdAt: channelMessages.createdAt,
      })
      .from(channelMessages)
      .where(
        and(
          eq(channelMessages.projectId, projectId),
          eq(channelMessages.conversationId, conversationId),
        ),
      )
      .orderBy(asc(channelMessages.createdAt), asc(channelMessages.id))
      .limit(200),
    db
      .select({
        id: actionSubmissions.id,
        actionName: projectActions.name,
        status: actionSubmissions.status,
        traceId: actionSubmissions.traceId,
        createdAt: actionSubmissions.createdAt,
        submittedAt: actionSubmissions.submittedAt,
      })
      .from(actionSubmissions)
      .innerJoin(
        projectActions,
        and(
          eq(projectActions.id, actionSubmissions.actionId),
          eq(projectActions.projectId, projectId),
        ),
      )
      .where(
        and(
          eq(actionSubmissions.projectId, projectId),
          eq(
            actionSubmissions.conversationId,
            selected.conversation.externalConversationId,
          ),
          eq(actionSubmissions.source, submissionSource),
        ),
      )
      .orderBy(desc(actionSubmissions.createdAt), desc(actionSubmissions.id)),
    db
      .select({
        id: conversationalTaskRuns.id,
        taskName: conversationalTasks.name,
        status: conversationalTaskRuns.status,
        currentStage: conversationalTaskRuns.currentStage,
        outcomeKey: conversationalTaskRuns.outcomeKey,
        lastRequestedFieldKey: conversationalTaskRuns.lastRequestedFieldKey,
        startedAt: conversationalTaskRuns.startedAt,
        completedAt: conversationalTaskRuns.completedAt,
        cancelledAt: conversationalTaskRuns.cancelledAt,
      })
      .from(conversationalTaskRuns)
      .innerJoin(
        conversationalTasks,
        and(
          eq(conversationalTasks.id, conversationalTaskRuns.taskId),
          eq(conversationalTasks.projectId, projectId),
        ),
      )
      .where(
        and(
          eq(conversationalTaskRuns.projectId, projectId),
          eq(conversationalTaskRuns.conversationId, conversationId),
        ),
      )
      .orderBy(
        desc(conversationalTaskRuns.startedAt),
        desc(conversationalTaskRuns.id),
      ),
    db
      .select({
        responseOwner: conversationExecutionStates.responseOwner,
        executionMode: conversationExecutionStates.executionMode,
        activeNodeId: conversationExecutionStates.activeNodeId,
        status: conversationExecutionStates.status,
        revision: conversationExecutionStates.revision,
        updatedAt: conversationExecutionStates.updatedAt,
      })
      .from(conversationExecutionStates)
      .where(
        and(
          eq(conversationExecutionStates.projectId, projectId),
          eq(conversationExecutionStates.conversationId, conversationId),
        ),
      )
      .orderBy(desc(conversationExecutionStates.updatedAt))
      .limit(1),
  ]);

  const submissionIds = submissions.map(({ id }) => id);
  const submissionEvents =
    submissionIds.length === 0
      ? []
      : await db
          .select({
            id: actionSubmissionEvents.id,
            submissionId: actionSubmissionEvents.submissionId,
            eventType: actionSubmissionEvents.eventType,
            message: actionSubmissionEvents.message,
            createdAt: actionSubmissionEvents.createdAt,
          })
          .from(actionSubmissionEvents)
          .where(
            and(
              eq(actionSubmissionEvents.projectId, projectId),
              inArray(actionSubmissionEvents.submissionId, submissionIds),
            ),
          )
          .orderBy(
            asc(actionSubmissionEvents.createdAt),
            asc(actionSubmissionEvents.id),
          );

  return {
    ...selected,
    messages,
    submissions,
    submissionEvents,
    eventSummary: summarizeDiagnosticEvents(submissionEvents),
    taskRuns,
    executionState: executionStates[0] ?? null,
  };
}
