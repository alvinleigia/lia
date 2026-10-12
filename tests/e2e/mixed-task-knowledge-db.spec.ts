import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { startChannelFlow } from "../../src/lib/channel-flow-runtime";
import { recordChannelInboundMessage } from "../../src/lib/channels";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import {
  conversationalTaskSnapshotV1Schema,
  DEFAULT_CONVERSATIONAL_TASK_DEFINITION,
} from "../../src/lib/conversation-contracts";
import {
  deleteConversationRuntimeData,
  getConversationalTaskRuntime,
} from "../../src/lib/conversational-task-runtime";
import { getConversationTaskRuntimeSession } from "../../src/lib/conversational-task-runtime-session";
import { db } from "../../src/lib/db-config";
import {
  actionFlowVersions,
  actionSubmissionEvents,
  actionSubmissions,
  channelConversations,
  companies,
  contacts,
  conversationalTasks,
  conversationalTaskVersions,
  projectActions,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import { runHybridChannelFlowBoundary } from "../../src/lib/hybrid-channel-runtime";
import { compileHybridFlowGraph } from "../../src/lib/hybrid-flow-compiler";
import { createRequestedTaskSelectionProposal } from "../../src/lib/hybrid-flow-runtime";
import {
  AiSdkStructuredTurnProvider,
  type StructuredTurnProviderInput,
} from "../../src/lib/model-provider";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";
import { getRuntimeProjectAction } from "../../src/lib/runtime-actions";

test.describe.configure({ mode: "serial" });

for (const [domain, fieldKey, label, question, answer] of [
  [
    "hotel",
    "stayDates",
    "Stay Dates",
    "Is there a pool?",
    "A pool is listed; hours are unconfirmed.",
  ],
  [
    "service",
    "serviceDate",
    "Service Date",
    "Do you offer pickup?",
    "Pickup is available within five kilometres.",
  ],
  [
    "appointment",
    "preferredDate",
    "Preferred Date",
    "Is parking free?",
    "Parking is free; a space is not guaranteed.",
  ],
]) {
  test(`${domain}: mixed turns validate, answer, resume and preserve corrections`, async () => {
    test.setTimeout(90_000);
    const fixture = await db.transaction(async (tx) => {
      const name = `Mixed ${domain} UAT ${randomUUID()}`;
      const [user] = await tx
        .insert(users)
        .values({
          name,
          email: `${randomUUID()}@example.test`,
          passwordHash: "test-only",
        })
        .returning();
      const [company] = await tx
        .insert(companies)
        .values({ name, ownerUserId: user.id })
        .returning();
      const [workspace] = await tx
        .insert(workspaces)
        .values({ name, companyId: company.id, ownerUserId: user.id })
        .returning();
      const [project] = await tx
        .insert(projects)
        .values({ name, workspaceId: workspace.id, ownerUserId: user.id })
        .returning();
      const definition = {
        ...DEFAULT_CONVERSATIONAL_TASK_DEFINITION,
        fields: [
          {
            ...REFERENCE_BOOKING_TASK_DEFINITION.fields[4],
            id: randomUUID(),
            key: fieldKey,
            label,
            type: domain === "hotel" ? "date_range" : "date",
            prompt: `Please provide ${label}.`,
            dependsOn: [],
            normalization: null,
          },
          {
            ...REFERENCE_BOOKING_TASK_DEFINITION.fields[4],
            id: randomUUID(),
            key: "guestName",
            label: "Guest Name",
            type: "text",
            prompt: "What is your name?",
            dependsOn: [],
            normalization: null,
          },
        ],
      };
      const [task] = await tx
        .insert(conversationalTasks)
        .values({
          projectId: project.id,
          name,
          objective: "Collect an enquiry",
          definition,
        })
        .returning();
      const snapshot = conversationalTaskSnapshotV1Schema.parse({
        schemaVersion: 1,
        assistantBehavior: {
          ...DEFAULT_PROJECT_AI_SETTINGS,
          approvedKnowledgeAnswers: [{ question, answer }],
        },
        assistantPolicy: REFERENCE_BOOKING_PROJECT_POLICY.assistant,
        conversationPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
        task: {
          id: task.id,
          schemaVersion: 1,
          name,
          objective: "Collect an enquiry",
          description: null,
          definition,
        },
      });
      const [version] = await tx
        .insert(conversationalTaskVersions)
        .values({
          projectId: project.id,
          taskId: task.id,
          versionNumber: 1,
          snapshot,
        })
        .returning();
      const [action] = await tx
        .insert(projectActions)
        .values({
          projectId: project.id,
          name,
          status: "active",
          triggerPhrases: ["Start enquiry"],
        })
        .returning();
      const steps = [
        {
          id: 1,
          stepType: "conversational_task",
          inputType: null,
          fieldKey: null,
          label: name,
          prompt: null,
          options: [],
          isEnabled: true,
          isRequired: false,
          sortOrder: 1,
          nextStepId: null,
          operationId: null,
          settings: {
            conversationalTask: {
              schemaVersion: 1,
              task: {
                taskId: task.id,
                taskVersionId: version.id,
                versionNumber: 1,
                schemaVersion: 1,
                name,
                outcomes: snapshot.task.definition.outcomes,
              },
              transferFieldKeys: [],
              transferContextKeys: [],
              outcomeRoutes: Object.fromEntries(
                snapshot.task.definition.outcomes.map((o) => [o.key, "end"]),
              ),
            },
          },
        },
      ];
      const graph = compileHybridFlowGraph({ steps, branchRules: [] }).graph;
      const [flowVersion] = await tx
        .insert(actionFlowVersions)
        .values({
          projectId: project.id,
          actionId: action.id,
          versionNumber: 1,
          snapshot: {
            schemaVersion: 1,
            publishedAt: new Date().toISOString(),
            action,
            steps,
            branchRules: [],
            hybridGraph: graph,
          },
        })
        .returning();
      await tx
        .update(projectActions)
        .set({ publishedVersionId: flowVersion.id })
        .where(eq(projectActions.id, action.id));
      return { user, company, workspace, project, action };
    });
    const externalConversationId = `mixed-${randomUUID()}`;
    const scope = {
      projectId: fixture.project.id,
      channelType: "project_chat" as const,
      externalConversationId,
    };
    let conversationId: number | null = null;
    const modelCalls: StructuredTurnProviderInput[] = [];
    const provider = mock.method(
      AiSdkStructuredTurnProvider.prototype,
      "generateTurn",
      async (input: StructuredTurnProviderInput) => {
        modelCalls.push(input);
        const knowledge = input.system.includes("Current stage: knowledge");
        const text = input.messages.at(-1)?.content ?? "";
        const date = text.match(/2026-\d{2}-\d{2}/g)?.at(-1);
        const suppliedName = text.includes("Alex Test");
        const proposal = createRequestedTaskSelectionProposal({
          requestedFieldKey: suppliedName ? "guestName" : fieldKey,
          selectionValue: suppliedName
            ? "Alex Test"
            : domain === "hotel"
              ? `2026-10-25 to ${date ?? "2026-10-26"}`
              : (date ?? "2026-10-26"),
        });
        if (!proposal) throw new Error("Missing fixture");
        return {
          modelId: input.modelId,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          output: knowledge
            ? {
                ...proposal,
                turnKind: "side_question",
                fieldCandidates: [],
                grounding: {
                  status: "grounded",
                  excerptIds: ["project_approved_answer:1"],
                },
                reply: answer,
              }
            : text === "Submit enquiry"
              ? {
                  ...proposal,
                  fieldCandidates: [],
                  turnKind: "ordinary_question",
                  nextAction: "complete",
                  outcomeRecommendation: {
                    outcomeKey: "completed",
                    confidence: 1,
                  },
                }
              : text === "Please proceed with my enquiry"
                ? { ...proposal, turnKind: "field_answer", fieldCandidates: [] }
                : date || suppliedName
                  ? proposal
                  : {
                      ...proposal,
                      turnKind: "side_question",
                      fieldCandidates: [],
                    },
        };
      },
    );
    try {
      const action = await getRuntimeProjectAction(
        scope.projectId,
        fixture.action.id,
      );
      if (!action) throw new Error("Missing fixture action");
      await startChannelFlow({
        action,
        conversationId: externalConversationId,
        projectId: scope.projectId,
        source: "project_chat",
      });
      const send = async (text: string, consumeTriggerMessage = false) => {
        const inbound = await recordChannelInboundMessage({ ...scope, text });
        conversationId = inbound.conversation.id;
        return runHybridChannelFlowBoundary({
          ...scope,
          channelConversationId: inbound.conversation.id,
          inboundMessageId: inbound.message.id,
          boundaryNodeId: "step:1",
          source: "project_chat",
          text,
          consumeTriggerMessage,
        });
      };
      await send("Start enquiry", true);
      for (const date of ["2026-10-26", "2026-10-29"]) {
        const result = await send(`Change ${label} to ${date}. ${question}`);
        expect(result.replies.map((r) => r.text).join("\n")).toContain(answer);
        expect(result.replies.map((r) => r.text).join("\n")).toContain(
          "What is your name?",
        );
        const session = await getConversationTaskRuntimeSession(scope);
        expect(
          session.runtime?.fields.find((f) => f.fieldKey === fieldKey)
            ?.canonicalValue,
        ).toEqual(
          domain === "hotel" ? { start: "2026-10-25", end: date } : date,
        );
        expect(session.runtime?.run.lastRequestedFieldKey).toBe("guestName");
        expect(session.execution?.responseOwner).toBe("task");
        const knowledgeCall = modelCalls
          .filter((c) => c.system.includes("Current stage: knowledge"))
          .at(-1);
        expect(
          knowledgeCall?.system
            .split("Current validated task state:")[1]
            .split("Trusted model-visible context:")[0],
        ).toContain(date);
      }
      const beforeInterruption = await getConversationTaskRuntimeSession(scope);
      const interrupted = await send(question);
      expect(interrupted.replies.map((r) => r.text).join("\n")).toContain(
        answer,
      );
      const afterInterruption = await getConversationTaskRuntimeSession(scope);
      expect(
        afterInterruption.runtime?.audit.filter(
          (event) => event.eventType === "field.requested",
        ).length,
      ).toBe(
        beforeInterruption.runtime?.audit.filter(
          (event) => event.eventType === "field.requested",
        ).length,
      );
      expect(afterInterruption.execution?.responseOwner).toBe("task");
      expect(
        (await getConversationTaskRuntimeSession(scope)).runtime?.fields.find(
          (f) => f.fieldKey === fieldKey,
        )?.canonicalValue,
      ).toEqual(
        domain === "hotel"
          ? { start: "2026-10-25", end: "2026-10-29" }
          : "2026-10-29",
      );
      const invalidated = await send(
        `Change ${label} to 2026-99-99. ${question}`,
      );
      expect(invalidated.replies.map((r) => r.text).join("\n")).toContain(
        answer,
      );
      expect(invalidated.replies.at(-1)?.payload).toMatchObject({
        inputRequest: { fieldKey },
      });
      expect(
        (await getConversationTaskRuntimeSession(scope)).runtime?.run
          .lastRequestedFieldKey,
      ).toBe(fieldKey);
      if (domain === "hotel") {
        await send(`Change ${label} to 2026-10-29.`);
        await send("My name is Alex Test.");
        const ready = await getConversationTaskRuntimeSession(scope);
        if (!ready.runtime) throw new Error("Missing ready task");
        await send("Please proceed with my enquiry");
        expect(
          (await getConversationTaskRuntimeSession(scope)).runtime?.fields.find(
            (field) => field.fieldKey === "guestName",
          )?.canonicalValue,
        ).toBe("Alex Test");
        const completed = await send("Submit enquiry");
        expect(
          completed.replies.map((reply) => reply.text).join("\n"),
        ).toContain(`${ready.snapshot?.task.name} is complete.`);
        expect(
          (
            await getConversationalTaskRuntime({
              projectId: scope.projectId,
              taskRunId: ready.runtime.run.id,
            })
          )?.run.status,
        ).toBe("completed");
        return;
      }
      const cancelled = await send("Cancel");
      expect(cancelled.replies.map((r) => r.text).join("\n")).toMatch(
        /cancel/i,
      );
    } finally {
      provider.mock.restore();
      if (conversationId)
        await deleteConversationRuntimeData({
          conversationId,
          projectId: scope.projectId,
          includeMessages: true,
        });
      await db
        .delete(channelConversations)
        .where(eq(channelConversations.projectId, scope.projectId));
      await db.delete(contacts).where(eq(contacts.projectId, scope.projectId));
      await db
        .delete(actionSubmissionEvents)
        .where(eq(actionSubmissionEvents.projectId, scope.projectId));
      await db
        .delete(actionSubmissions)
        .where(eq(actionSubmissions.projectId, scope.projectId));
      await db
        .delete(actionFlowVersions)
        .where(eq(actionFlowVersions.projectId, scope.projectId));
      await db
        .delete(projectActions)
        .where(eq(projectActions.projectId, scope.projectId));
      await db
        .delete(conversationalTaskVersions)
        .where(eq(conversationalTaskVersions.projectId, scope.projectId));
      await db
        .delete(conversationalTasks)
        .where(eq(conversationalTasks.projectId, scope.projectId));
      await db.delete(projects).where(eq(projects.id, scope.projectId));
      await db
        .delete(workspaces)
        .where(eq(workspaces.id, fixture.workspace.id));
      await db.delete(companies).where(eq(companies.id, fixture.company.id));
      await db.delete(users).where(eq(users.id, fixture.user.id));
    }
  });
}
