import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { deleteProjectAction } from "../../src/lib/action-flows";
import { db } from "../../src/lib/db-config";
import {
  actionFlowVersions,
  channelConversations,
  companies,
  conversationalTaskAuditEvents,
  conversationalTaskRuns,
  conversationalTasks,
  conversationalTaskVersions,
  conversationExecutionStates,
  projectActions,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let fixture:
  | {
      actionId: number;
      actionVersionId: number;
      companyId: number;
      conversationId: number;
      projectId: number;
      taskId: number;
      taskRunId: number;
      taskVersionId: number;
      userId: number;
      workspaceId: number;
    }
  | undefined;

test.beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: `action-delete-${suffix}@example.com`,
      name: "Action Delete Test",
      passwordHash: "test-only",
    })
    .returning();
  const [company] = await db
    .insert(companies)
    .values({
      name: `Action Delete ${suffix}`,
      ownerUserId: user.id,
    })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({
      companyId: company.id,
      name: `Action Delete ${suffix}`,
      ownerUserId: user.id,
    })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      name: `Action Delete ${suffix}`,
      ownerUserId: user.id,
      workspaceId: workspace.id,
    })
    .returning();
  const [task] = await db
    .insert(conversationalTasks)
    .values({
      name: "Preserved Booking Task",
      objective: "Remain reusable after the temporary flow is deleted.",
      projectId: project.id,
    })
    .returning();
  const [taskVersion] = await db
    .insert(conversationalTaskVersions)
    .values({
      projectId: project.id,
      snapshot: { schemaVersion: 1 },
      taskId: task.id,
      versionNumber: 1,
    })
    .returning();
  const [action] = await db
    .insert(projectActions)
    .values({
      name: "Temporary Hybrid Flow",
      projectId: project.id,
      status: "active",
    })
    .returning();
  const [actionVersion] = await db
    .insert(actionFlowVersions)
    .values({
      actionId: action.id,
      projectId: project.id,
      snapshot: { schemaVersion: 1 },
      versionNumber: 1,
    })
    .returning();
  const [conversation] = await db
    .insert(channelConversations)
    .values({
      channelType: "project_chat",
      externalConversationId: `action-delete-${suffix}`,
      projectId: project.id,
    })
    .returning();
  const [taskRun] = await db
    .insert(conversationalTaskRuns)
    .values({
      conversationId: conversation.id,
      projectId: project.id,
      taskId: task.id,
      taskVersionId: taskVersion.id,
    })
    .returning();

  await db.insert(conversationExecutionStates).values({
    activeActionVersionId: actionVersion.id,
    activeNodeId: "business-task-node",
    activeTaskRunId: taskRun.id,
    activeTaskVersionId: taskVersion.id,
    conversationId: conversation.id,
    executionMode: "task",
    projectId: project.id,
    responseOwner: "task",
    sessionId: `action-delete-session-${suffix}`,
  });

  fixture = {
    actionId: action.id,
    actionVersionId: actionVersion.id,
    companyId: company.id,
    conversationId: conversation.id,
    projectId: project.id,
    taskId: task.id,
    taskRunId: taskRun.id,
    taskVersionId: taskVersion.id,
    userId: user.id,
    workspaceId: workspace.id,
  };
});

test.afterAll(async () => {
  if (!fixture) return;

  await db
    .delete(conversationExecutionStates)
    .where(eq(conversationExecutionStates.projectId, fixture.projectId));
  await db
    .delete(conversationalTaskAuditEvents)
    .where(eq(conversationalTaskAuditEvents.projectId, fixture.projectId));
  await db
    .delete(conversationalTaskRuns)
    .where(eq(conversationalTaskRuns.projectId, fixture.projectId));
  await db
    .delete(actionFlowVersions)
    .where(eq(actionFlowVersions.projectId, fixture.projectId));
  await db
    .delete(projectActions)
    .where(eq(projectActions.projectId, fixture.projectId));
  await db
    .delete(channelConversations)
    .where(eq(channelConversations.projectId, fixture.projectId));
  await db
    .delete(conversationalTaskVersions)
    .where(eq(conversationalTaskVersions.projectId, fixture.projectId));
  await db
    .delete(conversationalTasks)
    .where(eq(conversationalTasks.projectId, fixture.projectId));
  await db.delete(projects).where(eq(projects.id, fixture.projectId));
  await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
  await db.delete(companies).where(eq(companies.id, fixture.companyId));
  await db.delete(users).where(eq(users.id, fixture.userId));
});

test("deletes an action referenced by a live task conversation safely", async () => {
  const deleted = await deleteProjectAction(
    fixture?.projectId as number,
    fixture?.actionId as number,
  );

  expect(deleted?.id).toBe(fixture?.actionId);
  expect(
    await db
      .select()
      .from(actionFlowVersions)
      .where(
        and(
          eq(actionFlowVersions.projectId, fixture?.projectId as number),
          eq(actionFlowVersions.id, fixture?.actionVersionId as number),
        ),
      ),
  ).toHaveLength(0);

  const [executionState] = await db
    .select()
    .from(conversationExecutionStates)
    .where(
      and(
        eq(conversationExecutionStates.projectId, fixture?.projectId as number),
        eq(
          conversationExecutionStates.conversationId,
          fixture?.conversationId as number,
        ),
      ),
    );
  expect(executionState).toMatchObject({
    activeActionVersionId: null,
    activeNodeId: null,
    activeTaskRunId: null,
    activeTaskVersionId: null,
    executionMode: "knowledge",
    responseOwner: "knowledge",
  });

  const [taskRun] = await db
    .select()
    .from(conversationalTaskRuns)
    .where(eq(conversationalTaskRuns.id, fixture?.taskRunId as number));
  expect(taskRun).toMatchObject({
    outcomeKey: "cancelled",
    status: "cancelled",
  });
  expect(taskRun.cancelledAt).toBeInstanceOf(Date);

  const [auditEvent] = await db
    .select()
    .from(conversationalTaskAuditEvents)
    .where(
      and(
        eq(
          conversationalTaskAuditEvents.projectId,
          fixture?.projectId as number,
        ),
        eq(conversationalTaskAuditEvents.taskRunId, taskRun.id),
        eq(conversationalTaskAuditEvents.eventType, "task.cancel"),
      ),
    );
  expect(auditEvent.summary).toEqual({
    actionId: fixture?.actionId,
    reason: "action_deleted",
  });

  expect(
    await db
      .select()
      .from(conversationalTaskVersions)
      .where(
        eq(conversationalTaskVersions.id, fixture?.taskVersionId as number),
      ),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(conversationalTasks)
      .where(eq(conversationalTasks.id, fixture?.taskId as number)),
  ).toHaveLength(1);
});
