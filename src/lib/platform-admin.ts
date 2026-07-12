import { count, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db-config";
import {
  companies,
  companyMemberships,
  projects,
  users,
  workspaces,
} from "@/lib/db-schema";
import { getUserByEmail } from "@/lib/users";

export const COMPANY_STATUSES = ["active", "disabled"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

function getPlatformAdminEmails() {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function isCurrentUserPlatformAdmin() {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();

  if (!email) {
    return false;
  }

  return getPlatformAdminEmails().includes(email);
}

export async function resolvePlatformAdmin() {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();

  if (!email || !getPlatformAdminEmails().includes(email)) {
    throw new Error("Forbidden");
  }

  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error("User not found");
  }

  return user;
}

export async function listTenantCompanies() {
  const rows = await db
    .select({
      company: companies,
      owner: {
        id: users.id,
        email: users.email,
        name: users.name,
      },
      memberCount: count(companyMemberships.id),
      projectCount: sql<number>`count(distinct ${projects.id})`,
    })
    .from(companies)
    .leftJoin(users, eq(users.id, companies.ownerUserId))
    .leftJoin(
      companyMemberships,
      eq(companyMemberships.companyId, companies.id),
    )
    .leftJoin(workspaces, eq(workspaces.companyId, companies.id))
    .leftJoin(projects, eq(projects.workspaceId, workspaces.id))
    .groupBy(companies.id, users.id)
    .orderBy(companies.id);

  return rows.map((row) => ({
    ...row,
    memberCount: Number(row.memberCount ?? 0),
    projectCount: Number(row.projectCount ?? 0),
  }));
}

export async function getTenantCompanyById(companyId: number) {
  const [row] = await db
    .select({
      company: companies,
      owner: {
        id: users.id,
        email: users.email,
        name: users.name,
      },
    })
    .from(companies)
    .leftJoin(users, eq(users.id, companies.ownerUserId))
    .where(eq(companies.id, companyId))
    .limit(1);

  return row ?? null;
}

export async function listTenantProjectsForCompany(companyId: number) {
  return db
    .select({
      project: projects,
      workspace: workspaces,
    })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .where(eq(workspaces.companyId, companyId))
    .orderBy(projects.id);
}

export async function updateCompanyStatus(input: {
  companyId: number;
  status: CompanyStatus;
}) {
  const [company] = await db
    .update(companies)
    .set({
      status: input.status,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, input.companyId))
    .returning();

  return company ?? null;
}
