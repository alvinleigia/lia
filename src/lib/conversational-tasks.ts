import { and, asc, desc, eq } from "drizzle-orm";
import type { ConversationalTaskDetails } from "@/lib/conversational-task-schema";
import { db } from "@/lib/db-config";
import { conversationalTasks } from "@/lib/db-schema";

export async function listProjectConversationalTasks(projectId: number) {
  return db
    .select()
    .from(conversationalTasks)
    .where(eq(conversationalTasks.projectId, projectId))
    .orderBy(
      asc(conversationalTasks.isArchived),
      desc(conversationalTasks.updatedAt),
    );
}

export async function getProjectConversationalTask(
  projectId: number,
  taskId: number,
) {
  const [task] = await db
    .select()
    .from(conversationalTasks)
    .where(
      and(
        eq(conversationalTasks.id, taskId),
        eq(conversationalTasks.projectId, projectId),
      ),
    )
    .limit(1);

  return task ?? null;
}

export async function createProjectConversationalTask(
  projectId: number,
  details: ConversationalTaskDetails,
) {
  const [task] = await db
    .insert(conversationalTasks)
    .values({
      projectId,
      name: details.name,
      objective: details.objective,
      description: details.description || null,
    })
    .returning();

  return task;
}

export async function updateProjectConversationalTask(
  projectId: number,
  taskId: number,
  details: ConversationalTaskDetails,
) {
  const [task] = await db
    .update(conversationalTasks)
    .set({
      name: details.name,
      objective: details.objective,
      description: details.description || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(conversationalTasks.id, taskId),
        eq(conversationalTasks.projectId, projectId),
      ),
    )
    .returning();

  return task ?? null;
}

export async function setProjectConversationalTaskArchived(
  projectId: number,
  taskId: number,
  isArchived: boolean,
) {
  const [task] = await db
    .update(conversationalTasks)
    .set({
      archivedAt: isArchived ? new Date() : null,
      isArchived,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(conversationalTasks.id, taskId),
        eq(conversationalTasks.projectId, projectId),
      ),
    )
    .returning();

  return task ?? null;
}
