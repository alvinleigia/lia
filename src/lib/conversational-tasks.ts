import { and, asc, desc, eq, max } from "drizzle-orm";
import type { ConversationProjectPolicyV1 } from "@/lib/conversation-contracts";
import {
  type ConversationalTaskDefinitionV1,
  conversationalTaskSnapshotV1Schema,
  DEFAULT_CONVERSATIONAL_TASK_DEFINITION,
  normalizeConversationalTaskDefinition,
} from "@/lib/conversation-contracts";
import type { ConversationalTaskDetails } from "@/lib/conversational-task-schema";
import { resolveProjectTaskToolDefinitions } from "@/lib/conversational-task-tools";
import { db } from "@/lib/db-config";
import {
  conversationalTasks,
  conversationalTaskVersions,
} from "@/lib/db-schema";
import type { ProjectAiSettings } from "@/lib/project-ai-settings";

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
      definition: DEFAULT_CONVERSATIONAL_TASK_DEFINITION,
    })
    .returning();

  return task;
}

export async function updateProjectConversationalTaskDefinition(
  projectId: number,
  taskId: number,
  definition: ConversationalTaskDefinitionV1,
) {
  const [task] = await db
    .update(conversationalTasks)
    .set({ definition, updatedAt: new Date() })
    .where(
      and(
        eq(conversationalTasks.id, taskId),
        eq(conversationalTasks.projectId, projectId),
      ),
    )
    .returning();

  return task ?? null;
}

export function readConversationalTaskDefinition(value: unknown) {
  return normalizeConversationalTaskDefinition(value);
}

export async function listConversationalTaskVersions(
  projectId: number,
  taskId: number,
) {
  return db
    .select()
    .from(conversationalTaskVersions)
    .where(
      and(
        eq(conversationalTaskVersions.projectId, projectId),
        eq(conversationalTaskVersions.taskId, taskId),
      ),
    )
    .orderBy(desc(conversationalTaskVersions.versionNumber));
}

export async function publishConversationalTask(input: {
  assistantBehavior: ProjectAiSettings;
  projectId: number;
  taskId: number;
  userId: number;
  projectPolicy: ConversationProjectPolicyV1;
}) {
  return db.transaction(async (transaction) => {
    const [task] = await transaction
      .select()
      .from(conversationalTasks)
      .where(
        and(
          eq(conversationalTasks.id, input.taskId),
          eq(conversationalTasks.projectId, input.projectId),
        ),
      )
      .limit(1);

    if (!task || task.isArchived) {
      return null;
    }

    const [latest] = await transaction
      .select({ value: max(conversationalTaskVersions.versionNumber) })
      .from(conversationalTaskVersions)
      .where(
        and(
          eq(conversationalTaskVersions.projectId, input.projectId),
          eq(conversationalTaskVersions.taskId, input.taskId),
        ),
      );

    const versionNumber = (latest?.value ?? 0) + 1;
    const definition = normalizeConversationalTaskDefinition(task.definition);
    const toolDefinitions = await resolveProjectTaskToolDefinitions({
      definition,
      projectId: input.projectId,
    });
    const snapshot = conversationalTaskSnapshotV1Schema.parse({
      schemaVersion: 1,
      assistantBehavior: input.assistantBehavior,
      assistantPolicy: input.projectPolicy.assistant,
      conversationPolicy: input.projectPolicy,
      toolDefinitions,
      task: {
        id: task.id,
        schemaVersion: task.schemaVersion,
        name: task.name,
        objective: task.objective,
        description: task.description,
        definition,
      },
    });
    const [version] = await transaction
      .insert(conversationalTaskVersions)
      .values({
        projectId: input.projectId,
        taskId: input.taskId,
        versionNumber,
        publishedByUserId: input.userId,
        snapshot,
      })
      .returning();

    return version;
  });
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
