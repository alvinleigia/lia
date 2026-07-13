import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { projects } from "@/lib/db-schema";
import { createDefaultManualReviewOperation } from "@/lib/operations";
import { getUserById } from "@/lib/users";
import { getOrCreateDefaultWorkspaceForUser } from "@/lib/workspaces";

async function resolveWorkspaceForUser(userId: number) {
  const user = await getUserById(userId);
  if (!user) {
    throw new Error("User not found");
  }

  return getOrCreateDefaultWorkspaceForUser(user);
}

export async function getFirstProjectForUser(userId: number) {
  const workspace = await resolveWorkspaceForUser(userId);
  return getFirstProjectForWorkspace(workspace.id);
}

export async function getFirstProjectForWorkspace(workspaceId: number) {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.isArchived, false),
      ),
    )
    .orderBy(asc(projects.id))
    .limit(1);

  return project ?? null;
}

export async function getProjectForUserById(
  projectId: number,
  userId: number,
  includeArchived = false,
) {
  const workspace = await resolveWorkspaceForUser(userId);
  return getProjectForWorkspaceById(projectId, workspace.id, includeArchived);
}

export async function getProjectForWorkspaceById(
  projectId: number,
  workspaceId: number,
  includeArchived = false,
) {
  const visibilityFilter = includeArchived
    ? and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))
    : and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId),
        eq(projects.isArchived, false),
      );

  const [project] = await db
    .select()
    .from(projects)
    .where(visibilityFilter)
    .limit(1);

  return project ?? null;
}

export async function listProjectsForUser(userId: number) {
  const workspace = await resolveWorkspaceForUser(userId);
  return listProjectsForWorkspace(workspace.id);
}

export async function listProjectsForWorkspace(workspaceId: number) {
  return db
    .select()
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(asc(projects.id));
}

export async function listActiveProjectsForUser(userId: number) {
  const workspace = await resolveWorkspaceForUser(userId);
  return listActiveProjectsForWorkspace(workspace.id);
}

export async function listActiveProjectsForWorkspace(workspaceId: number) {
  return db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.isArchived, false),
      ),
    )
    .orderBy(asc(projects.id));
}

export async function createProjectForUser(userId: number, name: string) {
  const workspace = await resolveWorkspaceForUser(userId);
  return createProjectForWorkspace(workspace.id, userId, name);
}

export async function createProjectForWorkspace(
  workspaceId: number,
  userId: number,
  name: string,
) {
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId,
      ownerUserId: userId,
      name,
    })
    .returning();

  await createDefaultManualReviewOperation(project.id);

  return project;
}

export async function updateProjectName(
  projectId: number,
  userId: number,
  name: string,
) {
  const workspace = await resolveWorkspaceForUser(userId);
  return updateProjectNameForWorkspace(projectId, workspace.id, name);
}

export async function updateProjectNameForWorkspace(
  projectId: number,
  workspaceId: number,
  name: string,
) {
  const [project] = await db
    .update(projects)
    .set({ name })
    .where(
      and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)),
    )
    .returning();

  return project ?? null;
}

export async function updateProjectAiSettingsForWorkspace(
  projectId: number,
  workspaceId: number,
  aiSettings: Record<string, unknown>,
) {
  const [project] = await db
    .update(projects)
    .set({ aiSettings })
    .where(
      and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)),
    )
    .returning();

  return project ?? null;
}

export async function setProjectArchived(projectId: number, userId: number) {
  const workspace = await resolveWorkspaceForUser(userId);
  return setProjectArchivedForWorkspace(projectId, workspace.id);
}

export async function setProjectArchivedForWorkspace(
  projectId: number,
  workspaceId: number,
) {
  const [project] = await db
    .update(projects)
    .set({
      isArchived: true,
      archivedAt: new Date(),
    })
    .where(
      and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)),
    )
    .returning();

  return project ?? null;
}

export async function setProjectUnarchived(projectId: number, userId: number) {
  const workspace = await resolveWorkspaceForUser(userId);
  return setProjectUnarchivedForWorkspace(projectId, workspace.id);
}

export async function setProjectUnarchivedForWorkspace(
  projectId: number,
  workspaceId: number,
) {
  const [project] = await db
    .update(projects)
    .set({
      isArchived: false,
      archivedAt: null,
    })
    .where(
      and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)),
    )
    .returning();

  return project ?? null;
}
