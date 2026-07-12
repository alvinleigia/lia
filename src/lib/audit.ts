import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { auditLogs, users } from "@/lib/db-schema";

type AuditScope = {
  user?: { id: number };
  membership?: { id: number };
  company?: { id: number };
  workspace?: { id: number };
  project?: { id: number };
};

type WriteAuditLogInput = AuditScope & {
  action: string;
  targetId?: number | string | null;
  targetType?: string | null;
  metadata?: Record<string, unknown>;
};

export async function writeAuditLog(input: WriteAuditLogInput) {
  await db.insert(auditLogs).values({
    actorUserId: input.user?.id ?? null,
    actorMembershipId: input.membership?.id ?? null,
    companyId: input.company?.id ?? null,
    workspaceId: input.workspace?.id ?? null,
    projectId: input.project?.id ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId:
      input.targetId === undefined || input.targetId === null
        ? null
        : String(input.targetId),
    metadata: input.metadata ?? {},
  });
}

export async function listCompanyAuditLogs(companyId: number, limit = 100) {
  return db
    .select({
      auditLog: auditLogs,
      actor: {
        email: users.email,
        name: users.name,
      },
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(eq(auditLogs.companyId, companyId))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit);
}
