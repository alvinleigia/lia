import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getChannelTypeForFlowSource } from "@/lib/channels";
import { db } from "@/lib/db-config";
import {
  actionFlowVersions,
  actionSubmissionEvents,
  actionSubmissions,
  auditLogs,
  channelConversations,
  companyMemberships,
  contacts,
  conversationalTaskVersions,
  conversationProjectPolicies,
  projectActions,
  projects,
  users,
  workspaces,
} from "@/lib/db-schema";
import {
  buildLeadFields,
  LEAD_STATUSES,
  leadUpdateSchema,
  readLeadManagement,
  readLeadWorkflowSnapshot,
} from "@/lib/lead-inbox";

export type LeadScope = { companyId: number; workspaceId: number };
export const leadFiltersSchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.string().trim().max(80).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export type LeadFilters = z.input<typeof leadFiltersSchema>;
const PAGE_SIZE = 30;
const exportAllowed = sql<boolean>`coalesce(${conversationProjectPolicies.definition}->'dataHandling'->>'exportAllowed', 'true') <> 'false'`;
const eligible = or(
  isNotNull(actionSubmissions.submittedAt),
  inArray(actionSubmissions.status, [
    "submitted",
    "under_review",
    "completed",
    "rejected",
  ]),
);

function scopeFilter(scope: LeadScope) {
  return and(
    eq(workspaces.companyId, scope.companyId),
    eq(projects.workspaceId, scope.workspaceId),
    eligible,
  );
}

function getPinnedTaskVersionIds(snapshot: unknown) {
  return (readLeadWorkflowSnapshot(snapshot)?.steps ?? []).flatMap((step) => {
    const reference = z
      .object({
        task: z.object({ taskVersionId: z.number().int().positive() }),
      })
      .safeParse(step.settings.conversationalTask);
    return reference.success ? [reference.data.task.taskVersionId] : [];
  });
}

async function loadPinnedTaskSnapshots(
  rows: { projectId: number; snapshot: unknown }[],
) {
  const ids = rows.flatMap((row) => getPinnedTaskVersionIds(row.snapshot));
  if (!ids.length) return new Map<string, unknown>();
  const versions = await db
    .select({
      id: conversationalTaskVersions.id,
      projectId: conversationalTaskVersions.projectId,
      snapshot: conversationalTaskVersions.snapshot,
    })
    .from(conversationalTaskVersions)
    .where(
      and(
        inArray(conversationalTaskVersions.id, ids),
        inArray(
          conversationalTaskVersions.projectId,
          rows.map((row) => row.projectId),
        ),
      ),
    );
  return new Map(
    versions.map((version) => [
      `${version.projectId}:${version.id}`,
      version.snapshot,
    ]),
  );
}

export async function listInboxLeads(
  scope: LeadScope,
  filters: LeadFilters = {},
  options: { forExport?: boolean } = {},
) {
  const parsed = leadFiltersSchema.parse(filters);
  const status = sql<string>`coalesce(${actionSubmissions.metadata}->'leadInbox'->>'status', 'new')`;
  const rows = await db
    .select({
      submission: actionSubmissions,
      project: { id: projects.id, name: projects.name },
      action: { id: projectActions.id, name: projectActions.name },
      snapshot: actionFlowVersions.snapshot,
    })
    .from(actionSubmissions)
    .innerJoin(projects, eq(projects.id, actionSubmissions.projectId))
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .leftJoin(
      conversationProjectPolicies,
      eq(conversationProjectPolicies.projectId, projects.id),
    )
    .innerJoin(
      projectActions,
      and(
        eq(projectActions.id, actionSubmissions.actionId),
        eq(projectActions.projectId, projects.id),
      ),
    )
    .leftJoin(
      actionFlowVersions,
      and(
        eq(actionFlowVersions.id, actionSubmissions.actionVersionId),
        eq(actionFlowVersions.projectId, projects.id),
        eq(actionFlowVersions.actionId, projectActions.id),
      ),
    )
    .where(
      and(
        scopeFilter(scope),
        options.forExport ? exportAllowed : undefined,
        parsed.projectId ? eq(projects.id, parsed.projectId) : undefined,
        parsed.status ? eq(status, parsed.status) : undefined,
        parsed.source === "widget_chat"
          ? inArray(actionSubmissions.source, ["widget_chat", "chat_widget"])
          : parsed.source
            ? eq(actionSubmissions.source, parsed.source)
            : undefined,
        parsed.q
          ? or(
              ilike(projectActions.name, `%${parsed.q}%`),
              ilike(
                sql<string>`${actionFlowVersions.snapshot}->'action'->>'name'`,
                `%${parsed.q}%`,
              ),
              ilike(
                sql<string>`${actionSubmissions.fields}::text`,
                `%${parsed.q}%`,
              ),
              ilike(
                sql<string>`${actionSubmissions.id}::text`,
                `%${parsed.q}%`,
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(actionSubmissions.createdAt), desc(actionSubmissions.id))
    .limit(PAGE_SIZE + 1)
    .offset((parsed.page - 1) * PAGE_SIZE);
  const visible = rows.slice(0, PAGE_SIZE);
  const taskSnapshots = await loadPinnedTaskSnapshots(
    visible.map((row) => ({
      projectId: row.project.id,
      snapshot: row.snapshot,
    })),
  );
  return {
    page: parsed.page,
    hasMore: rows.length > PAGE_SIZE,
    leads: visible.map((row) => ({
      ...row,
      action: {
        ...row.action,
        name:
          readLeadWorkflowSnapshot(row.snapshot)?.action.name ??
          (typeof row.submission.metadata.actionName === "string"
            ? row.submission.metadata.actionName
            : row.action.name),
      },
      fields: buildLeadFields({
        fields: row.submission.fields,
        workflowSnapshot: row.snapshot,
        taskSnapshots: getPinnedTaskVersionIds(row.snapshot).map((id) =>
          taskSnapshots.get(`${row.project.id}:${id}`),
        ),
      }),
      management: readLeadManagement(row.submission.metadata),
    })),
  };
}

export async function getInboxLead(scope: LeadScope, submissionId: number) {
  const [row] = await db
    .select({
      submission: actionSubmissions,
      project: { id: projects.id, name: projects.name },
      action: { id: projectActions.id, name: projectActions.name },
      exportAllowed,
      version: {
        id: actionFlowVersions.id,
        number: actionFlowVersions.versionNumber,
        snapshot: actionFlowVersions.snapshot,
      },
    })
    .from(actionSubmissions)
    .innerJoin(projects, eq(projects.id, actionSubmissions.projectId))
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .leftJoin(
      conversationProjectPolicies,
      eq(conversationProjectPolicies.projectId, projects.id),
    )
    .innerJoin(
      projectActions,
      and(
        eq(projectActions.id, actionSubmissions.actionId),
        eq(projectActions.projectId, projects.id),
      ),
    )
    .leftJoin(
      actionFlowVersions,
      and(
        eq(actionFlowVersions.id, actionSubmissions.actionVersionId),
        eq(actionFlowVersions.projectId, projects.id),
        eq(actionFlowVersions.actionId, projectActions.id),
      ),
    )
    .where(and(scopeFilter(scope), eq(actionSubmissions.id, submissionId)))
    .limit(1);
  if (!row) return null;
  const snapshot = readLeadWorkflowSnapshot(row.version?.snapshot);
  const taskSnapshots = await loadPinnedTaskSnapshots([
    { projectId: row.project.id, snapshot: row.version?.snapshot },
  ]);
  const fields = buildLeadFields({
    fields: row.submission.fields,
    workflowSnapshot: row.version?.snapshot,
    taskSnapshots: getPinnedTaskVersionIds(row.version?.snapshot).map((id) =>
      taskSnapshots.get(`${row.project.id}:${id}`),
    ),
  });
  return {
    ...row,
    action: { ...row.action, name: snapshot?.action.name ?? row.action.name },
    fields,
    management: readLeadManagement(row.submission.metadata),
  };
}

export async function getInboxLeadConversation(
  projectId: number,
  submission: { conversationId: string | null; source: string },
) {
  if (!submission.conversationId) return null;
  const source = submission.source;
  const channelType = getChannelTypeForFlowSource(
    source === "chat_widget" ? "widget_chat" : source,
  );
  const [row] = await db
    .select({
      conversation: channelConversations,
      contact: {
        id: contacts.id,
        name: contacts.displayName,
        phone: contacts.phone,
        email: contacts.email,
      },
    })
    .from(channelConversations)
    .leftJoin(
      contacts,
      and(
        eq(contacts.id, channelConversations.contactId),
        eq(contacts.projectId, projectId),
      ),
    )
    .where(
      and(
        eq(channelConversations.projectId, projectId),
        eq(channelConversations.channelType, channelType),
        eq(
          channelConversations.externalConversationId,
          submission.conversationId,
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function updateInboxLead(
  scope: LeadScope,
  input: z.input<typeof leadUpdateSchema>,
  actor: { userId: number; membershipId: number },
) {
  const data = leadUpdateSchema.parse(input);
  return db.transaction(async (tx) => {
    // Resolve the record through the tenant boundary; never trust a posted project ID.
    const [row] = await tx
      .select({ submission: actionSubmissions })
      .from(actionSubmissions)
      .innerJoin(projects, eq(projects.id, actionSubmissions.projectId))
      .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
      .where(
        and(scopeFilter(scope), eq(actionSubmissions.id, data.submissionId)),
      )
      .limit(1);
    if (!row) throw new Error("Lead not found.");
    if (data.assignedUserId !== null) {
      const [assignee] = await tx
        .select({ id: users.id })
        .from(companyMemberships)
        .innerJoin(users, eq(users.id, companyMemberships.userId))
        .where(
          and(
            eq(companyMemberships.companyId, scope.companyId),
            eq(companyMemberships.userId, data.assignedUserId),
            eq(companyMemberships.status, "active"),
          ),
        )
        .limit(1);
      if (!assignee)
        throw new Error("Choose an active team member from this company.");
    }
    const management = {
      status: data.status,
      assignedUserId: data.assignedUserId,
      nextFollowUpDate: data.nextFollowUpDate,
    };
    const [saved] = await tx
      .update(actionSubmissions)
      .set({
        metadata: { ...row.submission.metadata, leadInbox: management },
        revision: sql`${actionSubmissions.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(actionSubmissions.id, data.submissionId),
          eq(actionSubmissions.projectId, row.submission.projectId),
          eq(actionSubmissions.revision, data.expectedRevision),
        ),
      )
      .returning();
    if (!saved)
      throw new Error(
        "This lead changed. Refresh the page before saving again.",
      );
    await tx.insert(actionSubmissionEvents).values({
      projectId: saved.projectId,
      submissionId: saved.id,
      eventType: "lead.updated",
      message: data.note || "Lead follow-up updated.",
      payload: { ...management, actorUserId: actor.userId },
    });
    await tx.insert(auditLogs).values({
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      companyId: scope.companyId,
      workspaceId: scope.workspaceId,
      projectId: saved.projectId,
      action: "lead.updated",
      targetType: "action_submission",
      targetId: String(saved.id),
      metadata: { ...management, noteAdded: Boolean(data.note) },
    });
    return saved;
  });
}
