import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import type { RuntimeActionStep } from "../../src/lib/action-runtime";
import {
  processChannelFlowText,
  startChannelFlow,
} from "../../src/lib/channel-flow-runtime";
import { StructuredTurnEngine } from "../../src/lib/conversation-turn-engine";
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
import { readFlowFieldCandidates } from "../../src/lib/flow-field-collection";
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

async function collectionAction(skipEmail = false) {
  const [row] = await db
    .insert(projectActions)
    .values({
      projectId: fixture.projectId,
      name: "Service collection",
      status: "active",
      triggerPhrases: ["service collection"],
    })
    .returning();
  const specs = [
    ["customerName", "Customer Name", "collect_input"],
    ["customerEmail", "Customer Email", "email"],
    ["quantity", "Quantity", "number"],
    ["serviceSubject", "Service Subject", "collect_input"],
    ["colour", "Colour", "choice"],
    [null, "Review", "confirmation"],
  ] as const;
  const steps = specs.map(([fieldKey, label, stepType], index) => ({
    ...step(index + 1, stepType),
    fieldKey,
    label,
    prompt: `Please provide ${label}.`,
    inputType: stepType === "collect_input" ? "text" : null,
    options:
      stepType === "choice"
        ? [
            { label: "Blue", value: "blue" },
            { label: "Red", value: "red" },
          ]
        : [],
    settings: stepType === "number" ? { validationMaxNumber: 10 } : {},
  }));
  const [version] = await db
    .insert(actionFlowVersions)
    .values({
      actionId: row.id,
      projectId: fixture.projectId,
      status: "published",
      versionNumber: 1,
      snapshot: {
        schemaVersion: 1,
        action: row,
        branchRules: skipEmail
          ? [
              {
                id: 1,
                sourceStepId: 1,
                sourceFieldKey: "customerName",
                comparisonValue: "Alex Test",
                operator: "equals",
                targetStepId: 3,
                isEnabled: true,
                sortOrder: 1,
                settings: {},
              },
            ]
          : [],
        steps,
      },
    })
    .returning();
  await db
    .update(projectActions)
    .set({ publishedVersionId: version.id })
    .where(eq(projectActions.id, row.id));
  const action = await getRuntimeProjectAction(fixture.projectId, row.id);
  if (!action) throw new Error("Collection action missing");
  return action;
}

for (const source of [
  "project_chat",
  "widget_chat",
  "whatsapp_chat",
  "telnyx_voice",
]) {
  test(`${source}: generic flow retains later named fields and follows validation before review`, async () => {
    test.setTimeout(120_000);
    const action = await collectionAction();
    const conversationId = `${suffix}-collection-${source}`;
    await startChannelFlow({
      action,
      conversationId,
      projectId: fixture.projectId,
      source,
    });
    const read = async () =>
      (
        await db
          .select()
          .from(actionSubmissions)
          .where(
            and(
              eq(actionSubmissions.projectId, fixture.projectId),
              eq(actionSubmissions.conversationId, conversationId),
            ),
          )
      )[0];
    const send = async (text: string) =>
      processChannelFlowText({
        activeSubmission: await read(),
        conversationId,
        projectId: fixture.projectId,
        source,
        text,
      });
    const original = StructuredTurnEngine.prototype.execute;
    StructuredTurnEngine.prototype.execute = async () => {
      throw new Error("Explicit labels must not spend model calls");
    };
    try {
      const first = await send(
        "Customer Email: alex@example.com; Quantity: 99; Service Subject: oil change; Colour: blue",
      );
      expect(first.replies.map(({ text }) => text).join(" ")).toContain(
        "Customer Name",
      );
      let saved = await read();
      expect(saved.currentStepId).toBe(1);
      expect(saved.fields.customerEmail).toBeUndefined();
      expect(saved.metadata.flowFieldCandidates).toMatchObject({
        actionVersionId: action.versionId,
        answers: {
          "2": "alex@example.com",
          "3": "99",
          "4": "oil change",
          "5": "blue",
        },
      });
      await send("Alex Test");
      saved = await read();
      expect(saved.currentStepId).toBe(3);
      expect(saved.fields).toMatchObject({
        customerName: "Alex Test",
        customerEmail: "alex@example.com",
      });
      expect(saved.fields.quantity).toBeUndefined();
      expect(saved.fields.serviceSubject).toBeUndefined();
      const review = await send("2");
      saved = await read();
      expect(saved.fields).toMatchObject({
        customerName: "Alex Test",
        customerEmail: "alex@example.com",
        quantity: "2",
        serviceSubject: "oil change",
        colour: "blue",
      });
      expect(saved.status).not.toBe("submitted");
      expect(saved.currentStepId).toBe(6);
      expect(review.replies.map(({ text }) => text).join(" ")).toContain(
        "Reply Confirm",
      );
      expect(
        (saved.metadata.flowFieldCandidates as { answers: unknown }).answers,
      ).toEqual({});
    } finally {
      StructuredTurnEngine.prototype.execute = original;
    }
  });
}

test("ordinary flows consume opening details and keep missing required fields pending", async () => {
  const action = await collectionAction();
  const conversationId = `${suffix}-opening`;
  const result = await startChannelFlow({
    action,
    conversationId,
    projectId: fixture.projectId,
    source: "project_chat",
    openingMessage:
      "Customer Name: Alex Test; Customer Email: alex@example.com; Quantity: 2; Colour: blue",
  });
  const [saved] = await db
    .select()
    .from(actionSubmissions)
    .where(
      and(
        eq(actionSubmissions.projectId, fixture.projectId),
        eq(actionSubmissions.conversationId, conversationId),
      ),
    );
  expect(saved.currentStepId).toBe(4);
  expect(saved.fields).toMatchObject({
    customerName: "Alex Test",
    customerEmail: "alex@example.com",
    quantity: "2",
  });
  expect(saved.fields.serviceSubject).toBeUndefined();
  expect(saved.fields.colour).toBeUndefined();
  expect(result.replies.map(({ text }) => text).join(" ")).toContain(
    "Service Subject",
  );
  expect(result.replies.map(({ text }) => text).join(" ")).not.toContain(
    "Please provide Customer Name",
  );
  expect(saved.status).not.toBe("submitted");
});

test("ordinary flow model interpretation clarifies ambiguity without losing context, then applies a compound answer", async () => {
  const action = await collectionAction();
  const conversationId = `${suffix}-model-collection`;
  await startChannelFlow({
    action,
    conversationId,
    projectId: fixture.projectId,
    source: "project_chat",
  });
  const read = async () =>
    (
      await db
        .select()
        .from(actionSubmissions)
        .where(
          and(
            eq(actionSubmissions.projectId, fixture.projectId),
            eq(actionSubmissions.conversationId, conversationId),
          ),
        )
    )[0];
  const original = StructuredTurnEngine.prototype.execute;
  let calls = 0;
  StructuredTurnEngine.prototype.execute = async (input) =>
    original.call(
      new StructuredTurnEngine({
        provider: {
          async generateTurn(request) {
            calls++;
            expect(request.system).toContain("Service Subject");
            const ambiguous = calls === 1;
            return {
              modelId: request.modelId,
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              output: {
                schemaVersion: 1,
                turnKind: "field_answer",
                reply: ambiguous
                  ? "Which colour did you mean?"
                  : "I noted your details.",
                grounding: { status: "not_needed", excerptIds: [] },
                fieldCandidates: Object.entries(
                  ambiguous
                    ? {
                        colour: ["blue", "red"],
                        customerName: "Alex Test",
                        customerEmail: "alex@example.com",
                        quantity: "2",
                        serviceSubject: "oil change",
                      }
                    : { colour: "blue" },
                ).map(([fieldKey, naturalValue]) => ({
                  fieldKey,
                  naturalValue,
                  confidence: 1,
                  source: "visitor",
                })),
                taskRecommendation: null,
                toolRequest: null,
                routeRecommendation: null,
                outcomeRecommendation: null,
                nextAction: ambiguous ? "clarify" : "ask",
                ambiguity: {
                  requiresClarification: ambiguous,
                  fieldKeys: ambiguous ? ["colour"] : null,
                  question: ambiguous ? "Which colour did you mean?" : null,
                },
                safety: { decision: "allow", reasonCode: null },
                decisionSummary: "Interpreted configured service fields.",
              },
            };
          },
        },
      }),
      input,
    );
  try {
    const before = await read();
    const unclear = await processChannelFlowText({
      activeSubmission: before,
      conversationId,
      projectId: fixture.projectId,
      source: "project_chat",
      text: "My name is Alex Test, my email is alex@example.com. I need two oil changes, but I am unsure whether to choose blue or red.",
    });
    expect(unclear.replies[0].text).toContain("Which colour");
    expect((await read()).fields).toEqual(before.fields);
    expect((await read()).currentStepId).toBe(1);
    expect(
      readFlowFieldCandidates((await read()).metadata, action),
    ).toMatchObject({
      "1": "Alex Test",
      "2": "alex@example.com",
    });
    await processChannelFlowText({
      activeSubmission: await read(),
      conversationId,
      projectId: fixture.projectId,
      source: "project_chat",
      text: "Quantity: 3",
    });
    expect((await read()).currentStepId).toBe(1);
    await processChannelFlowText({
      activeSubmission: await read(),
      conversationId,
      projectId: fixture.projectId,
      source: "project_chat",
      text: "blue",
    });
    const saved = await read();
    expect(calls).toBe(1);
    expect(saved.fields).toMatchObject({
      customerName: "Alex Test",
      customerEmail: "alex@example.com",
      quantity: "3",
      serviceSubject: "oil change",
      colour: "blue",
    });
    expect(saved.currentStepId).toBe(6);
    expect(saved.status).not.toBe("submitted");
  } finally {
    StructuredTurnEngine.prototype.execute = original;
  }
});

test("staged fields cannot bypass published branches or cross into another action version", async () => {
  const action = await collectionAction(true);
  const conversationId = `${suffix}-branch`;
  await startChannelFlow({
    action,
    conversationId,
    projectId: fixture.projectId,
    source: "project_chat",
    openingMessage:
      "Customer Name: Alex Test; Customer Email: alex@example.com; Quantity: 2; Service Subject: oil change; Colour: blue",
  });
  const [saved] = await db
    .select()
    .from(actionSubmissions)
    .where(
      and(
        eq(actionSubmissions.projectId, fixture.projectId),
        eq(actionSubmissions.conversationId, conversationId),
      ),
    );
  expect(saved.currentStepId).toBe(6);
  expect(saved.fields.customerEmail).toBeUndefined();
  expect(saved.fields.serviceSubject).toBe("oil change");
  expect(
    readFlowFieldCandidates(saved.metadata, { ...action, versionId: -1 }),
  ).toEqual({});
  expect(saved.status).not.toBe("submitted");
});

test("a labelled field value cannot become a cancel command during later consumption", async () => {
  const action = await collectionAction();
  const conversationId = `${suffix}-literal-cancel`;
  await startChannelFlow({
    action,
    conversationId,
    projectId: fixture.projectId,
    source: "project_chat",
    openingMessage:
      "Customer Name: Alex Test; Customer Email: alex@example.com; Quantity: 2; Service Subject: cancel; Colour: blue",
  });
  const [saved] = await db
    .select()
    .from(actionSubmissions)
    .where(
      and(
        eq(actionSubmissions.projectId, fixture.projectId),
        eq(actionSubmissions.conversationId, conversationId),
      ),
    );
  expect(saved.currentStepId).toBe(6);
  expect(saved.fields.serviceSubject).toBe("cancel");
  expect(saved.status).not.toBe("cancelled");
  expect(
    readFlowFieldCandidates(saved.metadata, { ...action, id: action.id + 1 }),
  ).toEqual({});
  await processChannelFlowText({
    activeSubmission: saved,
    conversationId,
    projectId: fixture.projectId,
    source: "project_chat",
    text: "cancel",
  });
  const [cancelled] = await db
    .select()
    .from(actionSubmissions)
    .where(eq(actionSubmissions.id, saved.id));
  expect(cancelled.status).toBe("cancelled");
});
