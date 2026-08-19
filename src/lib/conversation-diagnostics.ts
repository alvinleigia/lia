import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db-config";
import {
  actionSubmissionEvents,
  actionSubmissions,
  channelConversations,
  channelMessages,
  conversationalTaskFieldValues,
  conversationalTaskRuns,
  conversationalTasks,
  conversationExecutionStates,
  projectActions,
} from "@/lib/db-schema";

type DiagnosticCollectedField = {
  fieldKey: string;
  value: unknown;
};

function diagnosticRedactionLabel(fieldKey: string) {
  const normalizedKey = fieldKey.replace(/[^a-z0-9]/gi, "").toLowerCase();

  if (normalizedKey.includes("email")) {
    return "[redacted email]";
  }

  if (normalizedKey.includes("phone")) {
    return "[redacted phone]";
  }

  if (normalizedKey.includes("address") || normalizedKey.includes("location")) {
    return "[redacted address]";
  }

  if (
    /^(?:(?:customer|guest|contact|visitor|user|requester|person)(?:full)?|full|first|last)?name$/.test(
      normalizedKey,
    )
  ) {
    return "[redacted name]";
  }

  return "[redacted collected value]";
}

function normalizeDiagnosticValue(value: string) {
  return value.trim().toLowerCase();
}

export function collectDiagnosticPublicChoiceValues(
  messages: Array<{
    direction: string;
    messageType: string;
    text: string | null;
  }>,
) {
  const values = new Set<string>();

  for (const message of messages) {
    if (
      message.direction !== "outbound" ||
      message.messageType !== "buttons" ||
      !message.text
    ) {
      continue;
    }

    for (const line of message.text.split(/\r?\n/)) {
      const option = line.match(/^\s*\d+[.)]\s+(.+?)\s*$/)?.[1];
      if (option) {
        values.add(normalizeDiagnosticValue(option));
      }
    }
  }

  return values;
}

export function redactDiagnosticMessage(
  message: {
    direction: string;
    messageType: string;
    text: string | null;
  },
  collectedFields: DiagnosticCollectedField[] = [],
  publicChoiceValues: ReadonlySet<string> = new Set(),
) {
  const fieldsToRedact =
    message.direction === "outbound" && message.messageType === "buttons"
      ? []
      : collectedFields;

  return redactDiagnosticText(message.text, fieldsToRedact, publicChoiceValues);
}

function collectPrimitiveValues(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectPrimitiveValues);
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectPrimitiveValues);
  }

  return [];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactDiagnosticText(
  text: string | null,
  collectedFields: DiagnosticCollectedField[] = [],
  publicChoiceValues: ReadonlySet<string> = new Set(),
) {
  if (!text) {
    return text;
  }

  const redactions = new Map<string, { label: string; value: string }>();

  for (const field of collectedFields) {
    const label = diagnosticRedactionLabel(field.fieldKey);
    for (const value of collectPrimitiveValues(field.value)) {
      const normalizedValue = normalizeDiagnosticValue(value);
      if (
        label === "[redacted collected value]" &&
        publicChoiceValues.has(normalizedValue)
      ) {
        continue;
      }
      const existing = redactions.get(normalizedValue);
      if (!existing || existing.label === "[redacted collected value]") {
        redactions.set(normalizedValue, { label, value });
      }
    }
  }

  let redacted = text;
  for (const { label, value } of [...redactions.values()].sort(
    (left, right) => right.value.length - left.value.length,
  )) {
    if (redacted.trim().toLowerCase() === value.toLowerCase()) {
      return label;
    }

    if (value.length >= 3) {
      redacted = redacted.replace(new RegExp(escapeRegExp(value), "gi"), label);
    }
  }

  return redacted
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/\+\d(?:[\d\s().-]{5,}\d)/g, "[redacted phone]")
    .replace(/\b(?:\d[\s().-]?){9,14}\d\b/g, "[redacted phone]");
}

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

  const [messageRows, submissionRows, taskRuns, executionStates] =
    await Promise.all([
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
          fields: actionSubmissions.fields,
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

  const taskRunIds = taskRuns.map(({ id }) => id);
  const taskFieldRows =
    taskRunIds.length === 0
      ? []
      : await db
          .select({
            fieldKey: conversationalTaskFieldValues.fieldKey,
            naturalValue: conversationalTaskFieldValues.naturalValue,
            canonicalValue: conversationalTaskFieldValues.canonicalValue,
          })
          .from(conversationalTaskFieldValues)
          .where(
            and(
              eq(conversationalTaskFieldValues.projectId, projectId),
              inArray(conversationalTaskFieldValues.taskRunId, taskRunIds),
            ),
          );

  const collectedFields: DiagnosticCollectedField[] = [
    ...submissionRows.flatMap(({ fields }) =>
      Object.entries(fields).map(([fieldKey, value]) => ({ fieldKey, value })),
    ),
    ...taskFieldRows.flatMap(({ canonicalValue, fieldKey, naturalValue }) => [
      { fieldKey, value: naturalValue },
      { fieldKey, value: canonicalValue },
    ]),
  ];
  const publicChoiceValues = collectDiagnosticPublicChoiceValues(messageRows);
  const messages = messageRows.map((message) => ({
    ...message,
    text: redactDiagnosticMessage(message, collectedFields, publicChoiceValues),
  }));
  const submissions = submissionRows.map((submission) => ({
    id: submission.id,
    actionName: submission.actionName,
    status: submission.status,
    traceId: submission.traceId,
    createdAt: submission.createdAt,
    submittedAt: submission.submittedAt,
  }));

  const submissionIds = submissions.map(({ id }) => id);
  const submissionEventRows =
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
  const submissionEvents = submissionEventRows.map((event) => ({
    ...event,
    message: redactDiagnosticText(
      event.message,
      collectedFields,
      publicChoiceValues,
    ),
  }));

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
