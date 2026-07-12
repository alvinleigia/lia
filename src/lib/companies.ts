import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { companies, companyMemberships } from "@/lib/db-schema";

export const COMPANY_ROLES = ["COMPANY_OWNER"] as const;
export const COMPANY_MEMBERSHIP_STATUSES = ["active", "disabled"] as const;

export type CompanyRole = (typeof COMPANY_ROLES)[number];
export type CompanyMembershipStatus =
  (typeof COMPANY_MEMBERSHIP_STATUSES)[number];

export const INACTIVE_ACCOUNT_ERROR_MESSAGE =
  "Your account is not active. Contact support.";

function buildDefaultCompanyName(user: { email: string; name: string | null }) {
  if (user.name?.trim()) {
    return user.name.trim();
  }

  return user.email.split("@")[0]?.trim() || "My Company";
}

export async function getFirstActiveCompanyForUser(userId: number) {
  const [row] = await db
    .select({
      company: companies,
      membership: companyMemberships,
    })
    .from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(
      and(
        eq(companyMemberships.userId, userId),
        eq(companyMemberships.status, "active"),
        eq(companies.status, "active"),
      ),
    )
    .orderBy(asc(companyMemberships.id))
    .limit(1);

  return row ?? null;
}

export async function listActiveCompaniesForUser(userId: number) {
  return db
    .select({
      company: companies,
      membership: companyMemberships,
    })
    .from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(
      and(
        eq(companyMemberships.userId, userId),
        eq(companyMemberships.status, "active"),
        eq(companies.status, "active"),
      ),
    )
    .orderBy(asc(companies.name), asc(companies.id));
}

export async function getActiveCompanyForUserById(
  companyId: number,
  userId: number,
) {
  const [row] = await db
    .select({
      company: companies,
      membership: companyMemberships,
    })
    .from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(
      and(
        eq(companies.id, companyId),
        eq(companyMemberships.userId, userId),
        eq(companyMemberships.status, "active"),
        eq(companies.status, "active"),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function getFirstCompanyForUser(userId: number) {
  const [row] = await db
    .select({
      company: companies,
      membership: companyMemberships,
    })
    .from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(eq(companyMemberships.userId, userId))
    .orderBy(asc(companyMemberships.id))
    .limit(1);

  return row ?? null;
}

export async function createCompanyForUser(user: {
  id: number;
  email: string;
  name: string | null;
}) {
  const now = new Date();

  return db.transaction(async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({
        ownerUserId: user.id,
        name: buildDefaultCompanyName(user),
        status: "active",
        updatedAt: now,
      })
      .returning();

    const [membership] = await tx
      .insert(companyMemberships)
      .values({
        companyId: company.id,
        userId: user.id,
        role: "COMPANY_OWNER",
        status: "active",
        updatedAt: now,
      })
      .returning();

    return { company, membership };
  });
}

export async function updateCompanyName(input: {
  companyId: number;
  name: string;
}) {
  const [company] = await db
    .update(companies)
    .set({
      name: input.name,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, input.companyId))
    .returning();

  return company ?? null;
}

export async function getOrCreateDefaultCompanyForUser(user: {
  id: number;
  email: string;
  name: string | null;
}) {
  const existing = await getFirstActiveCompanyForUser(user.id);
  if (existing) {
    return existing;
  }

  const inactiveExisting = await getFirstCompanyForUser(user.id);
  if (inactiveExisting) {
    throw new Error(INACTIVE_ACCOUNT_ERROR_MESSAGE);
  }

  return createCompanyForUser(user);
}
