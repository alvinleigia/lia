import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  createActionFlowStep,
  createProjectAction,
  listActionFlowBranchRulesForStep,
  syncOperationStepRoutePresets,
} from "../../src/lib/action-flows";
import { db } from "../../src/lib/db-config";
import {
  actionFlowBranchRules,
  actionFlowSteps,
  companies,
  projectActions,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let fixture:
  | {
      actionId: number;
      companyId: number;
      operationStepId: number;
      projectId: number;
      successStepId: number;
      timeoutStepId: number;
      userId: number;
      workspaceId: number;
    }
  | undefined;

test.beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: `operation-routes-${suffix}@example.com`,
      name: "Operation Route Test",
      passwordHash: "test-only",
    })
    .returning();
  const [company] = await db
    .insert(companies)
    .values({ name: `Operation Routes ${suffix}`, ownerUserId: user.id })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({
      companyId: company.id,
      name: `Operation Routes ${suffix}`,
      ownerUserId: user.id,
    })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      name: `Operation Routes ${suffix}`,
      ownerUserId: user.id,
      workspaceId: workspace.id,
    })
    .returning();
  const action = await createProjectAction({
    name: "Operation outcome routing",
    projectId: project.id,
  });
  const operationStep = await createActionFlowStep({
    actionId: action.id,
    fieldKey: "booking_status",
    projectId: project.id,
    sortOrder: 1,
    stepType: "operation",
  });
  const successStep = await createActionFlowStep({
    actionId: action.id,
    projectId: project.id,
    sortOrder: 2,
    stepType: "submit",
  });
  const timeoutStep = await createActionFlowStep({
    actionId: action.id,
    projectId: project.id,
    sortOrder: 3,
    stepType: "submit",
  });

  fixture = {
    actionId: action.id,
    companyId: company.id,
    operationStepId: operationStep.id,
    projectId: project.id,
    successStepId: successStep.id,
    timeoutStepId: timeoutStep.id,
    userId: user.id,
    workspaceId: workspace.id,
  };
});

test.afterAll(async () => {
  if (!fixture) return;
  await db
    .delete(actionFlowBranchRules)
    .where(eq(actionFlowBranchRules.actionId, fixture.actionId));
  await db
    .delete(actionFlowSteps)
    .where(eq(actionFlowSteps.actionId, fixture.actionId));
  await db
    .delete(projectActions)
    .where(eq(projectActions.id, fixture.actionId));
  await db.delete(projects).where(eq(projects.id, fixture.projectId));
  await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
  await db.delete(companies).where(eq(companies.id, fixture.companyId));
  await db.delete(users).where(eq(users.id, fixture.userId));
});

test("syncs and removes granular operation routes without changing legacy routes", async () => {
  if (!fixture) throw new Error("Operation route fixture was not created.");

  await syncOperationStepRoutePresets({
    actionId: fixture.actionId,
    fieldKey: "booking_status",
    outcomeStepIds: {
      status_409: fixture.timeoutStepId,
      success: fixture.successStepId,
      timeout: fixture.timeoutStepId,
    },
    projectId: fixture.projectId,
    sourceStepId: fixture.operationStepId,
    stepType: "operation",
  });

  const initialRules = await listActionFlowBranchRulesForStep(
    fixture.projectId,
    fixture.actionId,
    fixture.operationStepId,
  );
  expect(
    initialRules.map((rule) => ({
      field: rule.sourceFieldKey,
      outcome: rule.settings.operationOutcomeRoute,
      target: rule.targetStepId,
    })),
  ).toEqual([
    {
      field: "booking_status_outcome",
      outcome: "status_409",
      target: fixture.timeoutStepId,
    },
    {
      field: "booking_status_outcome",
      outcome: "success",
      target: fixture.successStepId,
    },
    {
      field: "booking_status_outcome",
      outcome: "timeout",
      target: fixture.timeoutStepId,
    },
  ]);

  await syncOperationStepRoutePresets({
    actionId: fixture.actionId,
    fieldKey: "booking_status",
    outcomeStepIds: { success: fixture.successStepId },
    projectId: fixture.projectId,
    sourceStepId: fixture.operationStepId,
    stepType: "operation",
  });
  const remainingRules = await listActionFlowBranchRulesForStep(
    fixture.projectId,
    fixture.actionId,
    fixture.operationStepId,
  );
  expect(remainingRules).toHaveLength(1);
  expect(remainingRules[0].settings.operationOutcomeRoute).toBe("success");
});
