import { asc, eq } from "drizzle-orm";
import { getOrCreateDefaultCompanyForUser } from "@/lib/companies";
import { db } from "@/lib/db-config";
import { workspaces } from "@/lib/db-schema";

function buildDefaultWorkspaceName(user: {
  email: string;
  name: string | null;
}) {
  if (user.name?.trim()) {
    return `${user.name.trim()}'s Workspace`;
  }

  const emailPrefix = user.email.split("@")[0]?.trim();
  return emailPrefix ? `${emailPrefix}'s Workspace` : "My Workspace";
}

export async function getFirstWorkspaceForCompany(companyId: number) {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.companyId, companyId))
    .orderBy(asc(workspaces.id))
    .limit(1);

  return workspace ?? null;
}

export async function createWorkspaceForUser(input: {
  companyId: number;
  userId: number;
  name: string;
}) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      companyId: input.companyId,
      ownerUserId: input.userId,
      name: input.name,
      updatedAt: new Date(),
    })
    .returning();

  return workspace;
}

export async function getOrCreateDefaultWorkspaceForUser(user: {
  id: number;
  email: string;
  name: string | null;
}) {
  const { company } = await getOrCreateDefaultCompanyForUser(user);
  return getOrCreateDefaultWorkspaceForCompany({
    companyId: company.id,
    companyName: company.name,
    userId: user.id,
    user,
  });
}

export async function getOrCreateDefaultWorkspaceForCompany(input: {
  companyId: number;
  companyName: string;
  userId: number;
  user?: {
    email: string;
    name: string | null;
  };
}) {
  const existingWorkspace = await getFirstWorkspaceForCompany(input.companyId);
  if (existingWorkspace) {
    return existingWorkspace;
  }

  return createWorkspaceForUser({
    companyId: input.companyId,
    userId: input.userId,
    name: input.user
      ? buildDefaultWorkspaceName(input.user)
      : `${input.companyName} Workspace`,
  });
}
