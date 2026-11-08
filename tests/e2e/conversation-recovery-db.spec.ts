import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import {
  createActionFlowStep,
  createPublishedActionFlowVersion,
  getActionSubmission,
  getProjectAction,
  listActionFlowBranchRules,
  listActionFlowSteps,
} from "../../src/lib/action-flows";
import { runBrowserFlowText } from "../../src/lib/browser-flow-runtime";
import { processChannelFlowText } from "../../src/lib/channel-flow-runtime";
import { REFERENCE_BOOKING_TASK_DEFINITION } from "../../src/lib/conversation-contract-fixtures";
import { DEFAULT_CONVERSATION_PROJECT_POLICY } from "../../src/lib/conversation-contracts";
import { advanceConversationException } from "../../src/lib/conversation-exception-store";
import { EXCEPTION_METADATA_KEY } from "../../src/lib/conversation-exceptions";
import {
  getConversationQualityEvidence,
  getProjectQualityDashboard,
} from "../../src/lib/conversation-quality-store";
import { recordConversationQualityTurn } from "../../src/lib/conversation-quality-telemetry";
import { StructuredTurnEngine } from "../../src/lib/conversation-turn-engine";
import { executeConfiguredStructuredTurn } from "../../src/lib/conversation-turn-service";
import { db } from "../../src/lib/db-config";
import {
  actionFlowSteps,
  actionFlowVersions,
  actionSubmissionEvents,
  actionSubmissions,
  channelConversations,
  channelMessages,
  companies,
  contactAttributes,
  contacts,
  contactTagAssignments,
  conversationalTaskAuditEvents,
  durableJobs,
  flowRuntimeCommands,
  integrationProviders,
  operationAttempts,
  operations,
  projectActions,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import {
  claimNextDurableJob,
  enqueueDurableJob,
  failDurableJob,
} from "../../src/lib/durable-jobs";
import { compileHybridFlowGraph } from "../../src/lib/hybrid-flow-compiler";
import type { StructuredTurnProvider } from "../../src/lib/model-provider";
import {
  processProjectDurableOperationQueue,
  queueOperationForSubmission,
  replayOperationAttempt,
  runOperationPreview,
} from "../../src/lib/operations";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

const suffix = randomUUID();
let fixture: {
  userId: number;
  companyId: number;
  workspaceId: number;
  projectId: number;
  foreignProjectId: number;
  actionId: number;
  conversationId: number;
  submissionId: number;
  dateStepId: number;
};
let server: Server;
let endpoint: string;
let received = 0;
let behavior: "read_retry" | "write_error" | "network" | "permanent" =
  "read_retry";

test.beforeAll(async () => {
  server = createServer((request, response) => {
    received += 1;
    request.resume();
    if (behavior === "network") {
      request.socket.destroy();
      return;
    }
    response.statusCode =
      behavior === "permanent"
        ? 401
        : behavior === "read_retry" && received > 1
          ? 200
          : 503;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: response.statusCode === 200 }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing mock provider address");
  endpoint = `http://127.0.0.1:${address.port}`;
  fixture = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: `recovery-${suffix}@example.test`,
        name: "Recovery Test",
        passwordHash: "test-only",
      })
      .returning();
    const [company] = await tx
      .insert(companies)
      .values({ ownerUserId: user.id, name: `Recovery ${suffix}` })
      .returning();
    const [workspace] = await tx
      .insert(workspaces)
      .values({
        ownerUserId: user.id,
        companyId: company.id,
        name: `Recovery ${suffix}`,
      })
      .returning();
    const [project, foreign] = await tx
      .insert(projects)
      .values(
        ["A", "B"].map((part) => ({
          ownerUserId: user.id,
          workspaceId: workspace.id,
          name: `Recovery ${part} ${suffix}`,
        })),
      )
      .returning();
    const [action] = await tx
      .insert(projectActions)
      .values({
        projectId: project.id,
        name: "Recovery flow",
        status: "active",
      })
      .returning();
    const [conversation] = await tx
      .insert(channelConversations)
      .values({
        projectId: project.id,
        channelType: "project_chat",
        externalConversationId: suffix,
      })
      .returning();
    const [submission] = await tx
      .insert(actionSubmissions)
      .values({
        projectId: project.id,
        actionId: action.id,
        source: "project_chat",
        conversationId: suffix,
        revision: 2,
        fields: { preferredDate: "2027-01-02" },
      })
      .returning();
    return {
      userId: user.id,
      companyId: company.id,
      workspaceId: workspace.id,
      projectId: project.id,
      foreignProjectId: foreign.id,
      actionId: action.id,
      conversationId: conversation.id,
      submissionId: submission.id,
      dateStepId: 0,
    };
  });
  const step = await createActionFlowStep({
    projectId: fixture.projectId,
    actionId: fixture.actionId,
    sortOrder: 1,
    stepType: "date",
    fieldKey: "preferredDate",
    label: "Preferred Date",
    inputType: "date",
    prompt: "What date would you prefer?",
    isRequired: true,
  });
  fixture.dateStepId = step.id;
  await createActionFlowStep({
    projectId: fixture.projectId,
    actionId: fixture.actionId,
    sortOrder: 2,
    stepType: "handoff",
    label: "Exception Team Review",
    prompt: "Your request has been sent for team review.",
    settings: { handoffNotifyTeam: false, handoffQueue: "Exception UAT" },
  });
  const action = await getProjectAction(fixture.projectId, fixture.actionId);
  const compiled = compileHybridFlowGraph({
    actionSettings: action?.settings ?? {},
    branchRules: await listActionFlowBranchRules(
      fixture.projectId,
      fixture.actionId,
    ),
    steps: await listActionFlowSteps(fixture.projectId, fixture.actionId),
  });
  expect(
    [...compiled.baseIssues, ...compiled.issues].filter(
      (issue) => issue.severity === "error",
    ),
  ).toEqual([]);
  const version = await createPublishedActionFlowVersion({
    projectId: fixture.projectId,
    actionId: fixture.actionId,
    publishedByUserId: fixture.userId,
  });
  await db
    .update(actionSubmissions)
    .set({ actionVersionId: version?.id, currentStepId: step.id })
    .where(eq(actionSubmissions.id, fixture.submissionId));
});

test.afterAll(async () => {
  server?.closeAllConnections();
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!fixture) return;
  await db.transaction(async (tx) => {
    for (const projectId of [fixture.projectId, fixture.foreignProjectId]) {
      for (const table of [
        durableJobs,
        operationAttempts,
        operations,
        integrationProviders,
        conversationalTaskAuditEvents,
        flowRuntimeCommands,
        channelMessages,
        channelConversations,
        contactTagAssignments,
        contactAttributes,
        contacts,
        actionSubmissionEvents,
        actionSubmissions,
        actionFlowSteps,
      ])
        await tx.delete(table).where(eq(table.projectId, projectId));
      await tx
        .update(projectActions)
        .set({ publishedVersionId: null })
        .where(eq(projectActions.projectId, projectId));
      await tx
        .delete(actionFlowVersions)
        .where(eq(actionFlowVersions.projectId, projectId));
      await tx
        .delete(projectActions)
        .where(eq(projectActions.projectId, projectId));
      await tx.delete(projects).where(eq(projects.id, projectId));
    }
    await tx.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
    await tx.delete(companies).where(eq(companies.id, fixture.companyId));
    await tx.delete(users).where(eq(users.id, fixture.userId));
  });
});

async function createProvider(method: "GET" | "POST") {
  received = 0;
  const [provider] = await db
    .insert(integrationProviders)
    .values({
      projectId: fixture.projectId,
      providerType: "webhook",
      name: `Recovery ${method}`,
      config: { method, url: endpoint, retryCount: 2, retryDelayMs: 0 },
    })
    .returning();
  const [operation] = await db
    .insert(operations)
    .values({
      projectId: fixture.projectId,
      providerId: provider.id,
      name: `Recovery ${method}`,
      operationType: "api_request",
    })
    .returning();
  return operation;
}

test("a transient GET is retried and accepted only after a successful provider response", async () => {
  behavior = "read_retry";
  const operation = await createProvider("GET");
  const result = await runOperationPreview({
    projectId: fixture.projectId,
    operationId: operation.id,
    fields: {},
  });
  expect(received).toBe(2);
  expect(result?.attempt.status).toBe("completed");
  expect(result?.attempt.responsePayload.recovery).toMatchObject({
    outcome: "recovered",
    validated: true,
    automaticSteps: 1,
  });
});

for (const failure of ["write_error", "network"] as const)
  test(`${failure}: an uncertain POST is sent once and cannot be replayed`, async () => {
    behavior = failure;
    const operation = await createProvider("POST");
    const result = await runOperationPreview({
      projectId: fixture.projectId,
      operationId: operation.id,
      fields: {},
    });
    expect(received).toBe(1);
    expect(result?.attempt.status).toBe("outcome_unknown");
    expect(result?.attempt.responsePayload.recovery).toMatchObject({
      outcome: "review_required",
      validated: false,
    });
    if (!result) throw new Error("Missing operation result");
    expect(
      await replayOperationAttempt({
        projectId: fixture.projectId,
        attemptId: result.attempt.id,
        mode: "auto_retry",
      }),
    ).toBeNull();
    expect(received).toBe(1);
  });

test("credential rejection is not retried even when provider retries are configured", async () => {
  behavior = "permanent";
  const operation = await createProvider("GET");
  const result = await runOperationPreview({
    projectId: fixture.projectId,
    operationId: operation.id,
    fields: {},
  });
  expect(received).toBe(1);
  expect(result?.attempt.status).toBe("failed");
});

test("reclaimed delivery holds an interrupted write instead of repeating it", async () => {
  behavior = "write_error";
  const operation = await createProvider("POST");
  const queued = await queueOperationForSubmission({
    projectId: fixture.projectId,
    actionId: fixture.actionId,
    submissionId: fixture.submissionId,
    operationId: operation.id,
    fields: {},
    idempotencyKey: `recovery:${suffix}`,
  });
  if (!queued) throw new Error("Missing queued operation");
  await db
    .update(operationAttempts)
    .set({ startedAt: new Date(Date.now() - 60000) })
    .where(eq(operationAttempts.id, queued.attempt.id));
  await db
    .update(durableJobs)
    .set({ attempts: 1, maxAttempts: 2 })
    .where(eq(durableJobs.id, queued.job.id));
  await processProjectDurableOperationQueue({
    projectId: fixture.projectId,
    workerId: "recovery-test-worker",
    maxJobs: 1,
  });
  expect(received).toBe(0);
  const [attempt] = await db
    .select()
    .from(operationAttempts)
    .where(eq(operationAttempts.id, queued.attempt.id));
  expect(attempt.status).toBe("outcome_unknown");
});

test("job exhaustion is persisted without exceeding its configured attempt limit", async () => {
  const queued = await enqueueDurableJob({
    projectId: fixture.projectId,
    jobType: "post_conversation",
    dedupeKey: suffix,
    payload: {},
    maxAttempts: 1,
  });
  const job = await claimNextDurableJob({
    projectId: fixture.projectId,
    jobTypes: ["post_conversation"],
    workerId: "recovery-test-worker",
  });
  expect(job?.id).toBe(queued.job.id);
  const result = await failDurableJob({
    projectId: fixture.projectId,
    workerId: "recovery-test-worker",
    jobId: queued.job.id,
    errorMessage: "Synthetic failure",
  });
  expect(result?.status).toBe("failed");
  expect(result?.attempts).toBe(1);
  expect(result?.result.recovery).toMatchObject({
    outcome: "review_required",
    automaticSteps: 0,
  });
});

test("stale visitor updates reload saved state without applying their old value", async () => {
  await expect(
    runBrowserFlowText({
      projectId: fixture.projectId,
      channelType: "project_chat",
      conversationId: suffix,
      source: "project_chat",
      commandId: `recovery-command-${suffix}`,
      text: "2027-02-01",
      expectedRevision: 1,
    }),
  ).rejects.toMatchObject({ code: "stale" });
  const [submission] = await db
    .select()
    .from(actionSubmissions)
    .where(eq(actionSubmissions.id, fixture.submissionId));
  expect(submission.fields.preferredDate).toBe("2027-01-02");
  expect(submission.revision).toBe(2);
  const events = await getConversationQualityEvidence(
    fixture.projectId,
    fixture.conversationId,
  );
  expect(
    events.events.some((event) =>
      event.recovery?.decisions.some(
        (decision) => decision.action === "reload_state",
      ),
    ),
  ).toBe(true);
});

test("recovery review is scoped, persisted and redacted in quality evidence", async () => {
  const execution = await new StructuredTurnEngine({
    provider: {
      async generateTurn() {
        throw Object.assign(new Error("private error detail"), {
          statusCode: 401,
        });
      },
    },
  }).execute({
    activeTask: null,
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    assistantIntroduced: true,
    channel: "project_chat",
    companyName: "Recovery",
    context: [],
    fieldState: [],
    history: [],
    projectId: fixture.projectId,
    projectPolicy: DEFAULT_CONVERSATION_PROJECT_POLICY,
    projectName: "Recovery",
    publishedTasks: [],
    stage: "knowledge",
    visitorMessage: "What services do you offer?",
  });
  await recordConversationQualityTurn({
    projectId: fixture.foreignProjectId,
    conversationId: fixture.conversationId,
    stage: "knowledge",
    latencyMs: 1,
    execution,
  });
  expect(
    (
      await getConversationQualityEvidence(
        fixture.foreignProjectId,
        fixture.conversationId,
      )
    ).events,
  ).toEqual([]);
  await recordConversationQualityTurn({
    projectId: fixture.projectId,
    conversationId: fixture.conversationId,
    stage: "knowledge",
    latencyMs: 1,
    execution,
  });
  const evidence = await getConversationQualityEvidence(
    fixture.projectId,
    fixture.conversationId,
  );
  expect(evidence.events[0].recovery?.outcome).toBe("review_required");
  expect(JSON.stringify(evidence)).not.toContain("private error");
  const dashboard = await getProjectQualityDashboard(fixture.projectId);
  expect(
    dashboard[0].flags.some((flag) => flag.code === "recovery_review"),
  ).toBe(true);
});

const ambiguousProvider: StructuredTurnProvider = {
  async generateTurn() {
    return {
      modelId: "test",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      output: {
        schemaVersion: 1,
        turnKind: "field_answer",
        reply: "Which date would you prefer?",
        grounding: { status: "not_needed", excerptIds: [] },
        fieldCandidates: [],
        taskRecommendation: null,
        toolRequest: null,
        routeRecommendation: null,
        outcomeRecommendation: null,
        nextAction: "clarify",
        ambiguity: {
          requiresClarification: true,
          question: "Which date would you prefer?",
          fieldKeys: ["preferredDate"],
        },
        safety: { decision: "allow", reasonCode: null },
        decisionSummary: "Clarify the date.",
      },
    };
  },
};

async function exceptionMessage(text: string) {
  const [message] = await db
    .insert(channelMessages)
    .values({
      projectId: fixture.projectId,
      conversationId: fixture.conversationId,
      direction: "inbound",
      messageType: "text",
      text,
    })
    .returning();
  return message.id;
}

async function resetException() {
  await db
    .update(channelConversations)
    .set({
      metadata: sql`${channelConversations.metadata} - ${EXCEPTION_METADATA_KEY}`,
    })
    .where(eq(channelConversations.id, fixture.conversationId));
}

function exceptionInput(
  messageId: number,
  visitorMessage = "Either 2 January 2027 or 3 January 2027",
) {
  const dateField = REFERENCE_BOOKING_TASK_DEFINITION.fields.find(
    (field) => field.key === "preferredDate",
  );
  if (!dateField) throw new Error("Missing date fixture");
  return {
    activeTask: null,
    collection: { name: "Recovery flow", fields: [dateField] },
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    assistantIntroduced: true,
    channel: "project_chat" as const,
    companyName: "Recovery",
    context: [],
    fieldState: [],
    history: [],
    projectId: fixture.projectId,
    projectName: "Recovery",
    publishedTasks: [],
    projectPolicy: {
      ...DEFAULT_CONVERSATION_PROJECT_POLICY,
      knowledge: {
        ...DEFAULT_CONVERSATION_PROJECT_POLICY.knowledge,
        sourceSelection: {
          ...DEFAULT_CONVERSATION_PROJECT_POLICY.knowledge.sourceSelection,
          allowedSources: [],
        },
      },
    },
    stage: "extraction" as const,
    requestedFieldKey: "preferredDate",
    visitorMessage,
    conversationId: fixture.conversationId,
    inboundMessageId: messageId,
    exceptionScope: `flow:${fixture.submissionId}:step:${fixture.dateStepId}`,
    handoffAvailable: true,
  };
}

async function offerAssistance() {
  const first = await exceptionMessage("Either 2 January or 3 January");
  const second = await exceptionMessage(
    "I am still undecided between those dates",
  );
  const a = await executeConfiguredStructuredTurn(
    exceptionInput(first),
    undefined,
    ambiguousProvider,
  );
  const b = await executeConfiguredStructuredTurn(
    exceptionInput(second),
    undefined,
    ambiguousProvider,
  );
  expect(a.exception?.action).toBe("clarify");
  expect(b.exception?.action).toBe("offer_assistance");
  return b;
}

test("global exception state is scoped, deduplicated and visible in the review queue", async () => {
  await resetException();
  const offered = await offerAssistance();
  if (!offered.exception) throw new Error("Missing exception decision");
  const duplicate = await executeConfiguredStructuredTurn(
    exceptionInput(offered.exception.messageId),
    undefined,
    ambiguousProvider,
  );
  expect(duplicate.exception?.failures).toBe(2);
  const wrongScope = await advanceConversationException({
    projectId: fixture.foreignProjectId,
    conversationId: fixture.conversationId,
    messageId: offered.exception.messageId,
    scope: offered.exception.scope,
    reason: "ambiguity",
    limit: 1,
    canHandoff: true,
  });
  expect(wrongScope).toBeNull();
  const dashboard = await getProjectQualityDashboard(fixture.projectId);
  expect(
    dashboard[0].flags.some((flag) => flag.code === "exception_review"),
  ).toBe(true);
  const evidence = await getConversationQualityEvidence(
    fixture.projectId,
    fixture.conversationId,
  );
  expect(
    evidence.events.some(
      (event) => event.exception?.action === "offer_assistance",
    ),
  ).toBe(true);
  expect(
    JSON.stringify(
      evidence.events
        .filter((event) => event.exception)
        .map((event) => event.exception),
    ),
  ).not.toContain("January");
});

test("declining assistance never fills the requested field and valid progress resets the exception", async () => {
  await resetException();
  await offerAssistance();
  const declineId = await exceptionMessage("No thanks");
  const noCalls: StructuredTurnProvider = {
    async generateTurn() {
      throw new Error("No model call expected");
    },
  };
  const declined = await executeConfiguredStructuredTurn(
    exceptionInput(declineId, "No thanks"),
    undefined,
    noCalls,
  );
  expect(declined.exception?.action).toBe("resume");
  expect(declined.proposal.fieldCandidates).toEqual([]);
  const validId = await exceptionMessage("2027-01-04");
  const continued = await executeConfiguredStructuredTurn(
    exceptionInput(validId, "2027-01-04"),
    undefined,
    noCalls,
  );
  expect(continued.exception?.action).toBe("resolved");
  expect(
    (await getProjectQualityDashboard(fixture.projectId))
      .find((row) => row.id === fixture.conversationId)
      ?.flags.some((flag) => flag.code === "exception_review"),
  ).toBe(false);
  expect(
    (await getProjectQualityDashboard(fixture.projectId))[0].flags.some(
      (flag) => flag.code === "exception_review",
    ),
  ).toBe(false);
  expect(continued.proposal.fieldCandidates[0]?.naturalValue).toBe(
    "2027-01-04",
  );
});

test("contextual assistance requests use the shared semantic interpreter and remain metered", async () => {
  await resetException();
  await offerAssistance();
  const id = await exceptionMessage(
    "Could someone take over and sort this out for me?",
  );
  let reviewed = 0;
  const result = await executeConfiguredStructuredTurn(
    exceptionInput(id, "Could someone take over and sort this out for me?"),
    undefined,
    {
      async generateTurn() {
        throw new Error("Consent must not become a business field");
      },
      async reviewInterpretation(input) {
        expect(input.kind).toBe("exception_assistance");
        reviewed++;
        return {
          matches: true,
          query: "Visitor requests team assistance",
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        };
      },
    },
  );
  expect(reviewed).toBe(1);
  expect(result.proposal.nextAction).toBe("handoff");
  expect(result.proposal.fieldCandidates).toEqual([]);
  expect(result.usage.totalTokens).toBe(5);
});

test("invalid generated values also reach the clarification limit without changing saved fields", async () => {
  await resetException();
  const invalid: StructuredTurnProvider = {
    async generateTurn(input) {
      const result = await ambiguousProvider.generateTurn(input);
      return {
        ...result,
        output: {
          ...(result.output as Record<string, unknown>),
          nextAction: "ask",
          reply: "Thanks",
          fieldCandidates: [
            {
              fieldKey: "preferredDate",
              naturalValue: "2027-99-50",
              source: "visitor",
              confidence: 0.9,
            },
          ],
          ambiguity: {
            requiresClarification: false,
            question: null,
            fieldKeys: null,
          },
        },
      };
    },
  };
  const first = await exceptionMessage("not a valid date");
  const second = await exceptionMessage("still not a valid date");
  expect(
    (
      await executeConfiguredStructuredTurn(
        exceptionInput(first, "not a valid date"),
        undefined,
        invalid,
      )
    ).exception?.action,
  ).toBe("clarify");
  expect(
    (
      await executeConfiguredStructuredTurn(
        exceptionInput(second, "still not a valid date"),
        undefined,
        invalid,
      )
    ).exception?.action,
  ).toBe("offer_assistance");
  expect(
    (await getActionSubmission(fixture.projectId, fixture.submissionId))?.fields
      .preferredDate,
  ).toBe("2027-01-02");
});

test("a paraphrased refusal declines assistance without cancelling the enquiry", async () => {
  await resetException();
  await offerAssistance();
  const text =
    "Please don't get anyone else involved; I'd rather finish this here.";
  const id = await exceptionMessage(text);
  const result = await executeConfiguredStructuredTurn(
    exceptionInput(id, text),
    undefined,
    {
      async generateTurn() {
        throw new Error(
          "A refusal must not become a business field or cancellation",
        );
      },
      async reviewInterpretation() {
        return {
          matches: false,
          assistanceDecision: "decline",
          query: "Visitor declines team assistance",
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        };
      },
    },
  );
  expect(result.exception?.action).toBe("resume");
  expect(result.proposal.nextAction).toBe("clarify");
  expect(result.proposal.fieldCandidates).toEqual([]);
  expect(
    (await getActionSubmission(fixture.projectId, fixture.submissionId))
      ?.status,
  ).not.toBe("cancelled");
});

test("accepting an exception offer runs the published handoff with existing fields retained", async () => {
  await resetException();
  await offerAssistance();
  const id = await exceptionMessage("Yes please");
  const submission = await getActionSubmission(
    fixture.projectId,
    fixture.submissionId,
  );
  if (!submission) throw new Error("Missing submission");
  const result = await processChannelFlowText({
    activeSubmission: submission,
    channelConversationId: fixture.conversationId,
    conversationId: suffix,
    inboundMessageId: id,
    projectId: fixture.projectId,
    source: "project_chat",
    text: "Yes please",
  });
  expect(JSON.stringify(result.replies)).toMatch(/team|review/);
  const saved = await getActionSubmission(
    fixture.projectId,
    fixture.submissionId,
  );
  expect(saved?.status).toBe("under_review");
  expect(saved?.fields.preferredDate).toBe("2027-01-02");
  expect(JSON.stringify(saved?.metadata)).toContain("Exception UAT");
});

test("browser knowledge outside a workflow shares persistent exception handling", async () => {
  await db
    .update(projects)
    .set({
      aiSettings: {
        ...DEFAULT_PROJECT_AI_SETTINGS,
        approvedKnowledgeAnswers: [
          {
            question: "Do you provide transport?",
            answer: "Yes, we provide transport.",
          },
          {
            question: "Can you guarantee transport for every date?",
            answer: null,
          },
        ],
      },
    })
    .where(eq(projects.id, fixture.projectId));
  const conversationId = `knowledge-${suffix}`;
  const send = (text: string) =>
    runBrowserFlowText({
      projectId: fixture.projectId,
      conversationId,
      channelType: "project_chat",
      source: "project_chat",
      commandId: randomUUID(),
      text,
    });
  const answer = await send("Do you provide transport?");
  expect(answer.handled).toBe(true);
  expect(answer.activeFlow).toBeNull();
  expect(JSON.stringify(answer.replies)).toContain(
    "Yes, we provide transport.",
  );
  await send("Can you guarantee transport for every date?");
  const repeated = await send("Can you guarantee transport for every date?");
  expect(JSON.stringify(repeated.replies)).toContain("contact our team");
  const [conversation] = await db
    .select()
    .from(channelConversations)
    .where(
      and(
        eq(channelConversations.projectId, fixture.projectId),
        eq(channelConversations.externalConversationId, conversationId),
      ),
    );
  expect(
    (await getProjectQualityDashboard(fixture.projectId))
      .find((row) => row.id === conversation.id)
      ?.flags.some((flag) => flag.code === "exception_review"),
  ).toBe(true);
  const submissions = await db
    .select({ id: actionSubmissions.id })
    .from(actionSubmissions)
    .where(eq(actionSubmissions.projectId, fixture.projectId));
  expect(submissions.map((row) => row.id)).toEqual([fixture.submissionId]);
});
