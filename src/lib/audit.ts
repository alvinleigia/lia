import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { auditLogs, users } from "@/lib/db-schema";

const REDACTED_AUDIT_METADATA_KEYS = new Set([
  "accesstoken",
  "appsecret",
  "authorization",
  "credential",
  "credentials",
  "email",
  "guestemail",
  "guestname",
  "guestphone",
  "password",
  "payload",
  "phone",
  "phonenumber",
  "privatereasoning",
  "rawpayload",
  "reasoning",
  "recipient",
  "to",
  "verifytoken",
]);

function redactAuditMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
        return [
          key,
          REDACTED_AUDIT_METADATA_KEYS.has(normalizedKey)
            ? "[REDACTED]"
            : visit(entry),
        ];
      }),
    );
  }

  return visit(metadata) as Record<string, unknown>;
}

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
  const rows = await db
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

  return rows.map(({ actor, auditLog }) => ({
    actor,
    auditLog: {
      ...auditLog,
      metadata: redactAuditMetadata(auditLog.metadata),
    },
  }));
}

export async function listAuditLogsForTarget(input: {
  action: string;
  limit?: number;
  projectId: number;
  targetId: number | string;
  targetType: string;
}) {
  const rows = await db
    .select({
      auditLog: auditLogs,
      actor: {
        email: users.email,
        name: users.name,
      },
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(
      and(
        eq(auditLogs.projectId, input.projectId),
        eq(auditLogs.action, input.action),
        eq(auditLogs.targetType, input.targetType),
        eq(auditLogs.targetId, String(input.targetId)),
      ),
    )
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(input.limit ?? 10);

  return rows.map(({ actor, auditLog }) => ({
    actor,
    auditLog: {
      ...auditLog,
      metadata: redactAuditMetadata(auditLog.metadata),
    },
  }));
}
