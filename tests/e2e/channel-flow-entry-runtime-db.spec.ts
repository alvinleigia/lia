import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import type { RuntimeActionStep } from "../../src/lib/action-runtime";
import {
  processChannelFlowText,
  startChannelFlow,
} from "../../src/lib/channel-flow-runtime";
import { db } from "../../src/lib/db-config";
import {
  actionFlowVersions,
  actionSubmissionEvents,
  actionSubmissions,
  companies,
  projectActions,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import { compileHybridFlowGraph } from "../../src/lib/hybrid-flow-compiler";
import { getRuntimeProjectAction } from "../../src/lib/runtime-actions";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let fixture: {
  actionId: number;
  companyId: number;
  projectId: number;
  userId: number;
  workspaceId: number;
};

function step(id: number, stepType: string): RuntimeActionStep {
  return {
    fieldKey: stepType === "date" ? "preferredDate" : null,
    id,
    inputType: stepType === "date" ? "date" : null,
    isEnabled: true,
    isRequired: true,
    label: id === 1 ? "Booking Date" : "Appointment Intent Router",
    nextStepId: null,
    operationId: null,
    options: [],
    prompt: id === 1 ? "What date would you prefer for the appointment?" : null,
    settings:
      stepType === "knowledge_conversation"
        ? {
            knowledgeConversation: {
              answeredRoute: "end",
              handoffRoute: "end",
              noAnswerRoute: "end",
              recommendationTargetStepIds: [],
              remainActiveAfterAnswer: true,
              schemaVersion: 1,
              stageMode: "goal_driven",
            },
          }
        : {},
    sortOrder: id,
    stepType,
  };
}

test.beforeAll(async () => {
  fixture = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: `flow-entry-${suffix}@example.com`,
        name: "Flow Entry Test",
        passwordHash: "test-only",
      })
      .returning();
    const [company] = await tx
      .insert(companies)
      .values({
        name: `Flow Entry ${suffix}`,
        ownerUserId: user.id,
      })
      .returning();
    const [workspace] = await tx
      .insert(workspaces)
      .values({
        companyId: company.id,
        name: `Flow Entry ${suffix}`,
        ownerUserId: user.id,
      })
      .returning();
    const [project] = await tx
      .insert(projects)
      .values({
        name: `Flow Entry ${suffix}`,
        ownerUserId: user.id,
        workspaceId: workspace.id,
      })
      .returning();
    const settings = {
      hybridEntryPolicy: {
        campaignRoutes: {},
        channelRoutes: { whatsapp: 2 },
        deepLinkRoutes: {},
        normalStepId: 3,
        schemaVersion: 1,
      },
    };
    const [action] = await tx
      .insert(projectActions)
      .values({
        name: "Appointment Lifecycle UAT",
        projectId: project.id,
        status: "active",
        triggerPhrases: ["appointment"],
        settings,
      })
      .returning();
    const steps = [
      step(1, "date"),
      step(2, "knowledge_conversation"),
      step(3, "knowledge_conversation"),
    ];
    const [version] = await tx
      .insert(actionFlowVersions)
      .values({
        actionId: action.id,
        projectId: project.id,
        status: "published",
        versionNumber: 1,
        snapshot: {
          schemaVersion: 1,
          action,
          branchRules: [],
          steps,
          hybridGraph: compileHybridFlowGraph({
            actionSettings: settings,
            branchRules: [],
            steps,
          }).graph,
        },
      })
      .returning();
    await tx
      .update(projectActions)
      .set({ publishedVersionId: version.id })
      .where(eq(projectActions.id, action.id));
    return {
      actionId: action.id,
      companyId: company.id,
      projectId: project.id,
      userId: user.id,
      workspaceId: workspace.id,
    };
  });
});

test.afterAll(async () => {
  if (!fixture) return;
  await db
    .delete(actionSubmissionEvents)
    .where(eq(actionSubmissionEvents.projectId, fixture.projectId));
  await db
    .delete(actionSubmissions)
    .where(eq(actionSubmissions.projectId, fixture.projectId));
  await db
    .delete(actionFlowVersions)
    .where(eq(actionFlowVersions.projectId, fixture.projectId));
  await db
    .delete(projectActions)
    .where(eq(projectActions.projectId, fixture.projectId));
  await db.delete(projects).where(eq(projects.id, fixture.projectId));
  await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
  await db.delete(companies).where(eq(companies.id, fixture.companyId));
  await db.delete(users).where(eq(users.id, fixture.userId));
});

for (const [source, expectedStep] of [
  ["project_chat", 3],
  ["widget_chat", 3],
  ["telnyx_voice", 3],
  ["whatsapp_chat", 2],
] as const) {
  test(`${source} starts at its published entry rather than the first stored step`, async () => {
    const action = await getRuntimeProjectAction(
      fixture.projectId,
      fixture.actionId,
    );
    if (!action) throw new Error("Published action missing.");
    const conversationId = `${suffix}-${source}`;
    const result = await startChannelFlow({
      action,
      conversationId,
      projectId: fixture.projectId,
      source,
    });
    expect(result.boundaryNodeId).toBe(`step:${expectedStep}`);
    expect(result.replies.map((reply) => reply.text).join(" ")).not.toContain(
      "What date",
    );
    const [submission] = await db
      .select()
      .from(actionSubmissions)
      .where(
        and(
          eq(actionSubmissions.projectId, fixture.projectId),
          eq(actionSubmissions.conversationId, conversationId),
        ),
      );
    expect(submission.currentStepId).toBe(expectedStep);
    const [started] = await db
      .select()
      .from(actionSubmissionEvents)
      .where(
        and(
          eq(actionSubmissionEvents.submissionId, submission.id),
          eq(actionSubmissionEvents.eventType, "flow.started"),
        ),
      );
    expect(started.payload.firstStepId).toBe(expectedStep);
  });
}

test("reschedule after a submitted booking reaches the router without collecting another booking date", async () => {
  const conversationId = `${suffix}-reschedule`;
  await db.insert(actionSubmissions).values({
    actionId: fixture.actionId,
    conversationId,
    projectId: fixture.projectId,
    source: "project_chat",
    status: "submitted",
    fields: { preferredDate: "2026-09-21" },
  });
  const result = await processChannelFlowText({
    activeSubmission: null,
    conversationId,
    projectId: fixture.projectId,
    source: "project_chat",
    text: "I want to reschedule my appointment.",
  });
  expect(result.boundaryNodeId).toBe("step:3");
  expect(result.consumeTriggerMessage).toBe(false);
  expect(result.replies.map((reply) => reply.text).join(" ")).not.toContain(
    "What date",
  );
});

test("explicit start steps and legacy flows retain their entry behavior", async () => {
  const action = await getRuntimeProjectAction(
    fixture.projectId,
    fixture.actionId,
  );
  if (!action) throw new Error("Published action missing.");
  const explicit = await startChannelFlow({
    action,
    conversationId: `${suffix}-explicit`,
    projectId: fixture.projectId,
    source: "project_chat",
    startStepId: 2,
  });
  expect(explicit.boundaryNodeId).toBe("step:2");
  const legacy = await startChannelFlow({
    action: { ...action, hybridGraph: undefined },
    conversationId: `${suffix}-legacy`,
    projectId: fixture.projectId,
    source: "project_chat",
  });
  expect(legacy.replies.map((reply) => reply.text)).toContain(
    "What date would you prefer for the appointment?",
  );
});
