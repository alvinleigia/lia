import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { createConversationDiagnosticFinding } from "../../src/lib/conversation-diagnostic-findings";
import { getProjectConversationDiagnostics } from "../../src/lib/conversation-diagnostics";
import {
  getConversationQualityEvidence,
  getProjectQualityDashboard,
} from "../../src/lib/conversation-quality-store";
import { recordConversationQualityTurn } from "../../src/lib/conversation-quality-telemetry";
import type { StructuredTurnExecution } from "../../src/lib/conversation-turn-engine";
import { db } from "../../src/lib/db-config";
import {
  auditLogs,
  channelConversations,
  channelMessages,
  chatRequestLogs,
  companies,
  companyMemberships,
  conversationalTaskAuditEvents,
  conversationDiagnosticFindings,
  conversationRegressionCases,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";

const email = `quality-${randomUUID()}@example.test`;
const password = randomUUID();
let scope: {
  userId: number;
  companyId: number;
  workspaceId: number;
  projectId: number;
  otherId: number;
  conversationId: number;
  otherConversationId: number;
  replyId: number;
  foreignReplyId: number;
};
test.beforeAll(async () => {
  const passwordHash = await hash(password, 10);
  scope = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ email, passwordHash, name: "Quality Browser UAT" })
      .returning();
    const [c] = await tx
      .insert(companies)
      .values({ name: "Quality Browser UAT", ownerUserId: u.id })
      .returning();
    await tx
      .insert(companyMemberships)
      .values({ companyId: c.id, userId: u.id, role: "COMPANY_OWNER" });
    const [w] = await tx
      .insert(workspaces)
      .values({ name: c.name, companyId: c.id, ownerUserId: u.id })
      .returning();
    const [p, other] = await tx
      .insert(projects)
      .values(
        ["Quality Browser UAT", "Other scope"].map((name) => ({
          name,
          workspaceId: w.id,
          ownerUserId: u.id,
        })),
      )
      .returning();
    const [conversation, foreign] = await tx
      .insert(channelConversations)
      .values(
        [p.id, other.id].map((projectId) => ({
          projectId,
          channelType: "whatsapp",
          externalConversationId: randomUUID(),
          lastMessageAt: new Date(),
        })),
      )
      .returning();
    const old = new Date(Date.now() - 300_000);
    await tx.insert(channelMessages).values(
      Array.from({ length: 201 }, (_, i) => ({
        projectId: p.id,
        conversationId: conversation.id,
        direction: "outbound",
        text: `Old response ${i}`,
        createdAt: old,
      })),
    );
    await tx.insert(channelMessages).values({
      projectId: p.id,
      conversationId: conversation.id,
      direction: "inbound",
      text: "Can you help? Contact test@example.test.",
      createdAt: new Date(Date.now() - 12_000),
    });
    const [reply] = await tx
      .insert(channelMessages)
      .values({
        projectId: p.id,
        conversationId: conversation.id,
        direction: "outbound",
        text: "I could not prepare a reliable answer. Please try again.",
      })
      .returning();
    const [foreignReply] = await tx
      .insert(channelMessages)
      .values({
        projectId: other.id,
        conversationId: foreign.id,
        direction: "outbound",
        text: "Other project's private reply.",
      })
      .returning();
    return {
      userId: u.id,
      companyId: c.id,
      workspaceId: w.id,
      projectId: p.id,
      otherId: other.id,
      conversationId: conversation.id,
      otherConversationId: foreign.id,
      replyId: reply.id,
      foreignReplyId: foreignReply.id,
    };
  });
});
test.afterAll(async () => {
  if (!scope) return;
  for (const projectId of [scope.projectId, scope.otherId]) {
    await db
      .delete(conversationalTaskAuditEvents)
      .where(eq(conversationalTaskAuditEvents.projectId, projectId));
    await db
      .delete(conversationRegressionCases)
      .where(eq(conversationRegressionCases.projectId, projectId));
    await db
      .delete(conversationDiagnosticFindings)
      .where(eq(conversationDiagnosticFindings.projectId, projectId));
    await db
      .delete(channelMessages)
      .where(eq(channelMessages.projectId, projectId));
    await db
      .delete(channelConversations)
      .where(eq(channelConversations.projectId, projectId));
    await db
      .delete(chatRequestLogs)
      .where(eq(chatRequestLogs.projectId, projectId));
    await db.delete(auditLogs).where(eq(auditLogs.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  }
  await db.delete(auditLogs).where(eq(auditLogs.companyId, scope.companyId));
  await db.delete(workspaces).where(eq(workspaces.id, scope.workspaceId));
  await db
    .delete(companyMemberships)
    .where(eq(companyMemberships.companyId, scope.companyId));
  await db.delete(companies).where(eq(companies.id, scope.companyId));
  await db.delete(users).where(eq(users.id, scope.userId));
});

test("quality review scopes evidence, retains recent transcript, saves feedback and creates a reviewed regression case", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const execution: StructuredTurnExecution = {
    attempts: 1,
    modelEscalationReason: null,
    source: "model",
    usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
    proposal: {
      schemaVersion: 1,
      turnKind: "ordinary_question",
      reply: "Private reply test@example.test",
      grounding: { status: "grounded", excerptIds: ["document:12"] },
      fieldCandidates: [],
      taskRecommendation: null,
      toolRequest: null,
      routeRecommendation: null,
      outcomeRecommendation: null,
      nextAction: "ask",
      ambiguity: { requiresClarification: false, question: null },
      safety: { decision: "allow", reasonCode: null },
      decisionSummary: "Private internal detail",
      validation: {
        accepted: true,
        modelAttemptCount: 1,
        providerModelId: "gpt-4.1-mini",
      },
    },
  };
  for (const conversationId of [
    scope.conversationId,
    scope.otherConversationId,
  ]) {
    await recordConversationQualityTurn({
      projectId: scope.projectId,
      conversationId,
      stage: "knowledge",
      latencyMs: 1200,
      execution,
    });
  }
  const evidence = await getConversationQualityEvidence(
    scope.projectId,
    scope.conversationId,
  );
  expect(evidence.events[0].turn).toMatchObject({
    totalTokens: 100,
    latencyMs: 1200,
    referenceIds: ["document:12"],
  });
  const storedTelemetry = await db
    .select()
    .from(conversationalTaskAuditEvents)
    .where(eq(conversationalTaskAuditEvents.projectId, scope.projectId));
  expect(storedTelemetry).toHaveLength(1);
  expect(JSON.stringify(storedTelemetry)).not.toContain("Private");
  expect(JSON.stringify(storedTelemetry)).not.toContain("test@example.test");
  const rows = await getProjectQualityDashboard(scope.projectId);
  expect(rows.map((r) => r.id)).toEqual([scope.conversationId]);
  expect(rows[0].flags.map((f) => f.code)).toContain("fallback");
  expect(
    await getProjectConversationDiagnostics(
      scope.projectId,
      scope.otherConversationId,
    ),
  ).toBeNull();
  expect(
    await getConversationQualityEvidence(
      scope.projectId,
      scope.otherConversationId,
    ),
  ).toEqual({ events: [], timings: [] });
  await expect(
    createConversationDiagnosticFinding({
      projectId: scope.projectId,
      conversationId: scope.conversationId,
      messageId: scope.foreignReplyId,
      authorUserId: scope.userId,
      category: "wrong_answer",
      note: "A cross-project reply must not be accepted.",
    }),
  ).rejects.toThrow("Select a bot reply");
  const details = await getProjectConversationDiagnostics(
    scope.projectId,
    scope.conversationId,
  );
  expect(details?.messages).toHaveLength(200);
  expect(details?.messages.at(-1)?.id).toBe(scope.replyId);
  expect(details?.messages.at(-2)?.text).not.toContain("test@example.test");
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign In with Email", exact: true })
    .click();
  await page.waitForURL(/\/projects/);
  await page.goto(
    `/projects/diagnostics?conversationId=${scope.conversationId}`,
  );
  await expect(
    page.getByText("Quality review queue", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Other project's private reply.", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Review note or expected behaviour (optional)")
    .fill("The knowledge should answer the customer's service question.");
  await page.getByRole("button", { name: "Wrong answer", exact: true }).click();
  await expect(
    page.getByText("Feedback saved. Live bot behaviour has not changed.", {
      exact: true,
    }),
  ).toBeVisible();
  const [finding] = await db
    .select()
    .from(conversationDiagnosticFindings)
    .where(
      and(
        eq(conversationDiagnosticFindings.projectId, scope.projectId),
        eq(conversationDiagnosticFindings.messageId, scope.replyId),
      ),
    );
  expect(finding.category).toBe("wrong_answer");
  await page
    .locator(`#regression-title-${finding.id}`)
    .fill("Answer a service question");
  await page
    .locator(`#regression-input-${finding.id}`)
    .fill("Do you offer collection?");
  await page
    .locator(`#regression-expected-${finding.id}`)
    .fill(
      "Use the approved collection policy and preserve the pending enquiry step.",
    );
  const form = page
    .locator(`#regression-title-${finding.id}`)
    .locator("xpath=ancestor::form");
  await form.getByRole("button", { name: /Promote/ }).click();
  await expect(
    page.getByText("Regression case promoted with synthetic test data.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await db
      .select()
      .from(conversationRegressionCases)
      .where(eq(conversationRegressionCases.projectId, scope.projectId)),
  ).toHaveLength(1);
  if (process.env.LIA_LIVE_QUALITY_UAT === "1") {
    await page
      .getByRole("button", { name: "Prepare AI review draft", exact: true })
      .click();
    await expect(
      page.getByText("AI review draft saved below.", { exact: false }),
    ).toBeVisible({ timeout: 35_000 });
    const reviews = await db
      .select()
      .from(conversationDiagnosticFindings)
      .where(
        and(
          eq(conversationDiagnosticFindings.projectId, scope.projectId),
          eq(conversationDiagnosticFindings.category, "ai_review"),
        ),
      );
    expect(reviews).toHaveLength(1);
    expect(reviews[0].note).not.toContain("test@example.test");
  }
  await page.screenshot({
    path: "tmp/conversation-quality-browser.png",
    fullPage: false,
  });
});
