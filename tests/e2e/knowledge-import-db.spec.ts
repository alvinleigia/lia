import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { REFERENCE_BOOKING_PROJECT_POLICY } from "../../src/lib/conversation-contract-fixtures";
import { executeConfiguredStructuredTurn } from "../../src/lib/conversation-turn-service";
import { db } from "../../src/lib/db-config";
import {
  companies,
  documents,
  projects,
  sourceDocuments,
  uploadJobs,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import {
  deleteAllDocumentsFromProject,
  deleteSourceDocumentFromProject,
} from "../../src/lib/documents";
import { createKnowledgeImportReview } from "../../src/lib/knowledge-import";
import {
  approveKnowledgeImport,
  getImportedKnowledgeAnswers,
  getKnowledgeImport,
  getPublishedKnowledgeAnswersForChunks,
  saveKnowledgeDraft,
} from "../../src/lib/knowledge-import-store";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";
import { processUploadQueue } from "../../src/lib/upload-queue";

let scope: {
  userId: number;
  companyId: number;
  workspaceId: number;
  projectId: number;
  otherProjectId: number;
};
const embed = async (_projectId: number, chunks: string[]) =>
  chunks.map(() => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)));
test.beforeAll(async () => {
  scope = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({
        email: `${randomUUID()}@example.test`,
        name: "Import review test",
        passwordHash: "test-only",
      })
      .returning();
    const [c] = await tx
      .insert(companies)
      .values({ name: "Import review test", ownerUserId: u.id })
      .returning();
    const [w] = await tx
      .insert(workspaces)
      .values({
        name: "Import review test",
        companyId: c.id,
        ownerUserId: u.id,
      })
      .returning();
    const ps = await tx
      .insert(projects)
      .values(
        ["First", "Other"].map((name) => ({
          name,
          workspaceId: w.id,
          ownerUserId: u.id,
        })),
      )
      .returning();
    return {
      userId: u.id,
      companyId: c.id,
      workspaceId: w.id,
      projectId: ps[0].id,
      otherProjectId: ps[1].id,
    };
  });
});
test.afterAll(async () => {
  if (!scope) return;
  for (const projectId of [scope.projectId, scope.otherProjectId]) {
    await deleteAllDocumentsFromProject(projectId);
    await db.delete(projects).where(eq(projects.id, projectId));
  }
  await db.delete(workspaces).where(eq(workspaces.id, scope.workspaceId));
  await db.delete(companies).where(eq(companies.id, scope.companyId));
  await db.delete(users).where(eq(users.id, scope.userId));
});
async function upload(text: string, projectId = scope.projectId) {
  const [doc] = await db
    .insert(sourceDocuments)
    .values({
      projectId,
      title: `Review ${randomUUID()}`,
      processingStatus: "review",
      importReview: createKnowledgeImportReview(text),
    })
    .returning();
  return doc;
}
async function approve(documentId: number, revision = 1) {
  await approveKnowledgeImport({
    projectId: scope.projectId,
    documentId,
    revision,
    userId: scope.userId,
  });
}

test("retrieved FAQ references use full published answers and remain project scoped", async () => {
  const doc = await upload(
    "Q: Is collection available? A: Yes, within 5 km.\nOutside this area, collection costs INR 200.",
  );
  await approve(doc.id);
  await processUploadQueue(1, scope.projectId, embed);
  const [chunk] = await db
    .select()
    .from(documents)
    .where(eq(documents.sourceDocumentId, doc.id));
  // Simulate a retrieval chunk ending before a material condition.
  await db
    .update(documents)
    .set({ content: "Q: Is collection available? A: Yes, within 5 km." })
    .where(eq(documents.id, chunk.id));
  const published = await getPublishedKnowledgeAnswersForChunks(
    scope.projectId,
    [chunk.id],
  );
  expect(published).toHaveLength(1);
  expect(published[0].answer).toContain("INR 200");
  expect(
    await getPublishedKnowledgeAnswersForChunks(scope.otherProjectId, [
      chunk.id,
    ]),
  ).toEqual([]);
  await saveKnowledgeDraft({
    projectId: scope.projectId,
    documentId: doc.id,
    revision: 1,
    text: "Q: Is collection available? A: Free everywhere.",
  });
  expect(
    await getPublishedKnowledgeAnswersForChunks(scope.projectId, [chunk.id]),
  ).toEqual(published);
  await deleteSourceDocumentFromProject(scope.projectId, doc.id);
  expect(
    await getPublishedKnowledgeAnswersForChunks(scope.projectId, [chunk.id]),
  ).toEqual([]);
});

test("drafts stay private, tenant scope is enforced, approval blocks wording and stale revisions", async () => {
  const doc = await upload("Q: Is delivery available? A: Delivery is listed.");
  expect(
    await getImportedKnowledgeAnswers(
      scope.projectId,
      "Is delivery available?",
    ),
  ).toEqual([]);
  expect(await getKnowledgeImport(scope.otherProjectId, doc.id)).toBeNull();
  await expect(
    saveKnowledgeDraft({
      projectId: scope.otherProjectId,
      documentId: doc.id,
      revision: 1,
      text: "wrong scope",
    }),
  ).rejects.toThrow("not found");
  await expect(approve(doc.id)).rejects.toThrow("wording");
  await saveKnowledgeDraft({
    projectId: scope.projectId,
    documentId: doc.id,
    revision: 1,
    text: "Q: Is delivery available? A: Yes, we offer delivery.",
  });
  await expect(approve(doc.id)).rejects.toThrow("changed");
  await approve(doc.id, 2);
  await approve(doc.id, 2);
  expect(
    await db
      .select()
      .from(uploadJobs)
      .where(
        and(
          eq(uploadJobs.projectId, scope.projectId),
          eq(uploadJobs.sourceDocumentId, doc.id),
        ),
      ),
  ).toHaveLength(1);
  expect(
    await getImportedKnowledgeAnswers(
      scope.projectId,
      "Is delivery available?",
    ),
  ).toEqual([]);
  expect((await processUploadQueue(1, scope.projectId, embed)).processed).toBe(
    1,
  );
  expect(
    await getImportedKnowledgeAnswers(
      scope.projectId,
      "Before that, is delivery available?",
    ),
  ).toEqual([
    { question: "Is delivery available?", answer: "Yes, we offer delivery." },
  ]);
  expect(
    await getImportedKnowledgeAnswers(
      scope.otherProjectId,
      "Is delivery available?",
    ),
  ).toEqual([]);
  const stored = await getKnowledgeImport(scope.projectId, doc.id);
  expect(stored?.importReview?.originalText).toContain("is listed");
  await deleteSourceDocumentFromProject(scope.projectId, doc.id);
  expect(
    await getImportedKnowledgeAnswers(
      scope.projectId,
      "Is delivery available?",
    ),
  ).toEqual([]);
});

test("same source-owned answer path supports hotel, service and appointment", async () => {
  for (const [question, answer] of [
    ["Is there Wi-Fi?", "Yes, we offer Wi-Fi."],
    [
      "Is bike pickup available?",
      "Yes, we offer pickup within five kilometres.",
    ],
    ["Is parking free?", "Yes, we offer free parking, subject to space."],
  ]) {
    const doc = await upload(`Q: ${question} A: ${answer}`);
    await approve(doc.id);
    await processUploadQueue(1, scope.projectId, embed);
    expect(
      await getImportedKnowledgeAnswers(scope.projectId, question),
    ).toEqual([{ question, answer }]);
    for (const channel of [
      "project_chat",
      "whatsapp",
      "telnyx_voice",
      "widget",
    ] as const) {
      const reply = await executeConfiguredStructuredTurn(
        {
          activeTask: null,
          assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
          assistantIntroduced: true,
          channel,
          companyName: "Review test",
          projectName: "Review test",
          context: [],
          fieldState: [],
          history: [],
          projectId: scope.projectId,
          projectPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
          publishedTasks: [],
          stage: "knowledge",
          visitorMessage: question,
        },
        {
          retrieve: async () => {
            throw new Error("Approved FAQ should not retrieve");
          },
        },
      );
      expect(reply.source).toBe("deterministic");
      expect(reply.usage.totalTokens).toBe(0);
      expect(reply.proposal.reply).toBe(answer);
    }
    await deleteSourceDocumentFromProject(scope.projectId, doc.id);
  }
});

test("conflicting publications cannot race; failed replacement retains the old answers and chunks", async () => {
  const one = await upload(
    "Q: What does delivery cost? A: Delivery costs INR 100.",
  );
  const two = await upload(
    "Q: What does delivery cost? A: Delivery costs INR 200.",
  );
  const results = await Promise.allSettled([approve(one.id), approve(two.id)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const winner = results[0].status === "fulfilled" ? one : two;
  const loser = winner.id === one.id ? two : one;
  await deleteSourceDocumentFromProject(scope.projectId, loser.id);
  await processUploadQueue(1, scope.projectId, embed);
  const before = await getImportedKnowledgeAnswers(
    scope.projectId,
    "What does delivery cost?",
  );
  await saveKnowledgeDraft({
    projectId: scope.projectId,
    documentId: winner.id,
    revision: 1,
    text: "Q: What does delivery cost? A: Delivery costs INR 300.",
  });
  await approve(winner.id, 2);
  expect(
    (
      await processUploadQueue(1, scope.projectId, async () => {
        throw new Error("Simulated embedding outage");
      })
    ).failed,
  ).toBe(1);
  expect(
    await getImportedKnowledgeAnswers(
      scope.projectId,
      "What does delivery cost?",
    ),
  ).toEqual(before);
  expect(
    await db
      .select()
      .from(documents)
      .where(eq(documents.sourceDocumentId, winner.id)),
  ).not.toHaveLength(0);
  await approve(winner.id, 2);
  await processUploadQueue(1, scope.projectId, embed);
  expect(
    (
      await getImportedKnowledgeAnswers(
        scope.projectId,
        "What does delivery cost?",
      )
    )[0].answer,
  ).toContain("300");
  await deleteSourceDocumentFromProject(scope.projectId, winner.id);
});

test("a forged queued draft cannot bypass review and processing stays project scoped", async () => {
  const doc = await upload("Q: Is support available? A: We offer support.");
  const other = await upload(
    "Q: Is support available? A: Other project.",
    scope.otherProjectId,
  );
  await db.insert(uploadJobs).values(
    [doc, other].map((d) => ({
      projectId: d.projectId,
      sourceDocumentId: d.id,
      textContent: d.importReview?.draftText ?? "",
    })),
  );
  let calls = 0;
  const result = await processUploadQueue(10, scope.projectId, async () => {
    calls++;
    return [];
  });
  expect(result.failed).toBe(1);
  expect(calls).toBe(0);
  expect(
    (
      await db
        .select()
        .from(uploadJobs)
        .where(eq(uploadJobs.sourceDocumentId, other.id))
    )[0].status,
  ).toBe("queued");
  await deleteSourceDocumentFromProject(scope.projectId, doc.id);
  await deleteSourceDocumentFromProject(scope.otherProjectId, other.id);
});

test("deleting a source during indexing cannot recreate its answers", async () => {
  const doc = await upload(
    "Q: Is delivery tracked? A: Yes, we provide tracking.",
  );
  await approve(doc.id);
  const result = await processUploadQueue(
    1,
    scope.projectId,
    async (projectId, chunks) => {
      await deleteSourceDocumentFromProject(projectId, doc.id);
      return embed(projectId, chunks);
    },
  );
  expect(result.failed).toBe(1);
  expect(await getKnowledgeImport(scope.projectId, doc.id)).toBeNull();
  expect(
    await getImportedKnowledgeAnswers(scope.projectId, "Is delivery tracked?"),
  ).toEqual([]);
});
