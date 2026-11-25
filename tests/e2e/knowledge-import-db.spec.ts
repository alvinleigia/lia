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
  inspectProjectPriceAndAnswerConflicts,
  getImportedKnowledgeAnswers,
  getKnowledgeImport,
  saveKnowledgeDraft,
} from "../../src/lib/knowledge-import-store";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";
import { searchProjectDocumentEvidenceWithEmbedding } from "../../src/lib/search";
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
async function upload(
  text: string,
  projectId = scope.projectId,
  preserveHeadings = false,
) {
  const [doc] = await db
    .insert(sourceDocuments)
    .values({
      projectId,
      title: `Review ${randomUUID()}`,
      processingStatus: "review",
      importReview: createKnowledgeImportReview(text, preserveHeadings),
    })
    .returning();
  return doc;
}
async function findKnowledgeAnswerConflicts(...args: Parameters<typeof inspectProjectPriceAndAnswerConflicts>) {
  return (await inspectProjectPriceAndAnswerConflicts(...args)).conflicts;
}
async function approve(documentId: number, revision = 1) {
  await approveKnowledgeImport({
    projectId: scope.projectId,
    documentId,
    revision,
    userId: scope.userId,
  });
}

test("approval rejects conflicting prose prices and queues a corrected draft", async () => {
  const text = "## Price guide\nWheel hire costs GBP 25 per day.\n\n## Staff handbook\nWheel hire costs £40 per day.";
  const document = await upload(text, scope.projectId, true);
  await expect(approve(document.id)).rejects.toThrow("Resolve conflicting answers");
  const jobs = () => db.select({ id: uploadJobs.id }).from(uploadJobs)
    .where(and(eq(uploadJobs.projectId, scope.projectId), eq(uploadJobs.sourceDocumentId, document.id)));
  expect(await jobs()).toHaveLength(0);
  await saveKnowledgeDraft({ projectId: scope.projectId, documentId: document.id, revision: 1, text: text.replace("£40", "£25") });
  await approve(document.id, 2);
  expect(await jobs()).toHaveLength(1);
  await deleteSourceDocumentFromProject(scope.projectId, document.id);
});

test("cross-upload prose review compares published and approved rates within the project", async () => {
  const rate = (amount: number, heading = "Visitor guide") =>
    "## " + heading + "\nSpindle repair costs INR " + amount + " per visit.";
  const original = await upload(rate(650), scope.projectId, true);
  const revision = await upload(rate(950), scope.projectId, true);
  const conflicts = (text: string) =>
    findKnowledgeAnswerConflicts(scope.projectId, revision.id, text, true);
  expect(await conflicts(rate(950))).toEqual([]); // another unapproved draft
  await approve(original.id);
  const queued = await conflicts(rate(950));
  expect(queued.join(" ")).toContain(original.title);
  await expect(approve(revision.id)).rejects.toThrow("Resolve conflicting answers");
  await processUploadQueue(1, scope.projectId, embed);
  await saveKnowledgeDraft({ projectId: scope.projectId, documentId: original.id, revision: 1, text: rate(950) });
  expect((await conflicts(rate(950))).join(" ")).toContain("650");
  expect((await conflicts(rate(950, "Weekend plan"))).join(" ")).toContain("Save and check draft");
  expect(await findKnowledgeAnswerConflicts(scope.otherProjectId, revision.id, rate(950), true)).toEqual([]);
  await approve(original.id, 2);
  expect(await conflicts(rate(650))).not.toEqual([]); // approved replacement
  expect(await conflicts(rate(950))).not.toEqual([]); // still-published predecessor
  await processUploadQueue(1, scope.projectId, embed);
  expect(await conflicts(rate(950))).toEqual([]);
  await approve(revision.id);
  await deleteSourceDocumentFromProject(scope.projectId, original.id);
  await deleteSourceDocumentFromProject(scope.projectId, revision.id);
});

test("rate cards share the approval gate across uploads without mixing terms or projects", async () => {
  const original = await upload("Service | Plan | Fee\n--- | --- | ---\nDelivery | Standard | INR 650", scope.projectId, true);
  await approve(original.id);
  const header = "Plan | Fee | Service\n--- | --- | ---\n";
  const revised = await upload(header + "Standard | ₹950 | Delivery", scope.projectId, true);
  await expect(approve(revised.id)).rejects.toThrow(original.title);
  expect(await findKnowledgeAnswerConflicts(scope.otherProjectId, revised.id, revised.importReview!.draftText, true)).toEqual([]);
  await saveKnowledgeDraft({projectId: scope.projectId, documentId: revised.id, revision: 1, text: header + "Premium | ₹950 | Delivery"});
  await approve(revised.id, 2);
  await deleteSourceDocumentFromProject(scope.projectId, original.id);
  await deleteSourceDocumentFromProject(scope.projectId, revised.id);
});

test("a saved semantic finding blocks approval and clears on a corrected revision", async () => {
  const text = "Checking a frame costs INR 650.\nEach frame inspection is 950 rupees.";
  const doc = await upload(text, scope.projectId, true);
  await saveKnowledgeDraft({ projectId: scope.projectId, documentId: doc.id, revision: 1, text, priceReview: [{ first: 1, second: 2 }] });
  await expect(approve(doc.id, 2)).rejects.toThrow("Resolve conflicting answers");
  await saveKnowledgeDraft({ projectId: scope.projectId, documentId: doc.id, revision: 2, text: text.replace("650", "950") });
  await approve(doc.id, 3);
  await deleteSourceDocumentFromProject(scope.projectId, doc.id);
});

test("concurrent single-paragraph prices cannot both queue", async () => {
  const first = await upload("Frame repair costs GBP 25 per visit.", scope.projectId, true);
  const second = await upload("Frame repair is priced at £40 per visit.", scope.projectId, true);
  const results = await Promise.allSettled([approve(first.id), approve(second.id)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(result => result.status === "rejected");
  expect(String(rejected?.reason)).toContain("Price differs from");
  await deleteSourceDocumentFromProject(scope.projectId, first.id);
  await deleteSourceDocumentFromProject(scope.projectId, second.id);
});

test("approved sections keep their labels through indexing and FAQ publication", async () => {
  const doc = await upload(
    [
      "## Copper Service",
      "Q: How far is pickup available? A: Up to 3 kilometres.",
      "Only on weekdays.",
      "## Silver Service",
      "Pickup is available within 12 kilometres.",
    ].join("\n"),
    scope.projectId,
    true,
  );
  await approve(doc.id);
  await processUploadQueue(1, scope.projectId, embed);
  const chunks = await db
    .select({ content: documents.content })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, scope.projectId),
        eq(documents.sourceDocumentId, doc.id),
      ),
    );
  expect(chunks.map((row) => row.content).sort()).toEqual([
    "## Copper Service\nQ: How far is pickup available? A: Up to 3 kilometres.\nOnly on weekdays.",
    "## Silver Service\nPickup is available within 12 kilometres.",
  ]);
  const hits = await searchProjectDocumentEvidenceWithEmbedding(
    scope.projectId,
    "Copper Service pickup",
    (await embed(scope.projectId, ["query"]))[0],
    8,
  );
  for (const { content } of chunks) {
    expect(
      hits.find((hit) => hit.content === content)?.sectionHeadings,
    ).toEqual([content.split("\n")[0].slice(3)]);
  }
  const answers = await getImportedKnowledgeAnswers(
    scope.projectId,
    "How far is pickup available?",
  );
  expect(answers.map((entry) => entry.answer)).toEqual([
    "Up to 3 kilometres. Only on weekdays.",
  ]);
  await deleteSourceDocumentFromProject(scope.projectId, doc.id);
});

test("a review without the pilot setting keeps its original indexing rules", async () => {
  const text =
    "## Copper Service\nQ: How far is pickup available? A: Up to 3 kilometres.\n## Silver Service\nPickup is available within 12 kilometres.";
  const doc = await upload(text);
  await approve(doc.id);
  await processUploadQueue(1, scope.projectId, embed);
  const chunks = await db
    .select({ content: documents.content })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, scope.projectId),
        eq(documents.sourceDocumentId, doc.id),
      ),
    );
  expect(chunks).toEqual([{ content: text }]);
  const answers = await getImportedKnowledgeAnswers(
    scope.projectId,
    "How far is pickup available?",
  );
  expect(answers.map((entry) => entry.answer)).toEqual([
    "Up to 3 kilometres. ## Silver Service Pickup is available within 12 kilometres.",
  ]);
  await deleteSourceDocumentFromProject(scope.projectId, doc.id);
});

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
  const query = "Is collection available?";
  async function publishedAnswers(projectId: number) {
    const hits = await searchProjectDocumentEvidenceWithEmbedding(
      projectId,
      query,
      chunk.embedding!,
      5,
    );
    return hits.flatMap((hit) => hit.approvedAnswers);
  }
  const published = await publishedAnswers(scope.projectId);
  expect(published).toHaveLength(1);
  expect(published[0].answer).toContain("INR 200");
  expect(await publishedAnswers(scope.otherProjectId)).toEqual([]);
  await saveKnowledgeDraft({
    projectId: scope.projectId,
    documentId: doc.id,
    revision: 1,
    text: "Q: Is collection available? A: Free everywhere.",
  });
  expect(await publishedAnswers(scope.projectId)).toEqual(published);
  await deleteSourceDocumentFromProject(scope.projectId, doc.id);
  expect(await publishedAnswers(scope.projectId)).toEqual([]);
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
test("a newly approved paraphrased price requires a fresh cross-document check", async () => {
  const first = await upload("Wheel inspection costs INR 650 per visit.", scope.projectId, true);
  const other = await upload("Each time we check a wheel the visitor pays 950 rupees.", scope.projectId, true);
  try {
    await approve(first.id);
    await expect(approve(other.id)).rejects.toThrow("Save and check draft");
    await deleteSourceDocumentFromProject(scope.projectId, first.id);
    await approve(other.id);
  } finally {
    await deleteSourceDocumentFromProject(scope.projectId, first.id);
    await deleteSourceDocumentFromProject(scope.projectId, other.id);
  }
});
