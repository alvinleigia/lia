import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { embedMany } from "ai";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../src/lib/db-config";
import { ProjectDocumentTurnRetriever } from "../../src/lib/conversation-turn-retrieval";
import {
  companies,
  chatRequestLogs,
  documents,
  projects,
  sourceDocuments,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import { createKnowledgeImportReview } from "../../src/lib/knowledge-import";
import { deleteSourceDocumentFromProject } from "../../src/lib/documents";
import {
  getPlatformEmbeddingModel,
  PLATFORM_EMBEDDING_MODEL_ID,
} from "../../src/lib/model-provider";
import {
  searchProjectDocumentEvidenceWithEmbedding,
  searchDocumentsWithEmbedding,
} from "../../src/lib/search";
import { retrievalCases } from "../fixtures/retrieval-benchmark";

const queryVector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
// Below the general cutoff, above the grounded candidate cutoff.
const lowSimilarity = Array.from({ length: 1536 }, (_, i) =>
  i === 0 ? 0.25 : i === 1 ? Math.sqrt(1 - 0.25 ** 2) : 0,
);
let scopes: Array<{
  userId: number;
  companyId: number;
  workspaceId: number;
  projectId: number;
}> = [];

test.beforeAll(async () => {
  scopes = await db.transaction(async (tx) => {
    const result = [];
    for (let i = 0; i < 2; i++) {
      const name = `Retrieval UAT ${randomUUID()}`;
      const [user] = await tx
        .insert(users)
        .values({
          email: `${randomUUID()}@example.test`,
          name,
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
      result.push({
        userId: user.id,
        companyId: company.id,
        workspaceId: workspace.id,
        projectId: project.id,
      });
    }
    await tx.insert(documents).values([
      {
        projectId: result[0].projectId,
        content:
          "Facilities: Wi-Fi, front desk, swimming pool. Pool hours and charges are not supplied.",
        embedding: lowSimilarity,
      },
      {
        projectId: result[0].projectId,
        content:
          "Bike service pickup is available within five kilometres. Call for eligibility.",
        embedding: lowSimilarity,
      },
      {
        projectId: result[0].projectId,
        content:
          "Appointment visitors can use free parking. Spaces are not guaranteed.",
        embedding: lowSimilarity,
      },
      {
        projectId: result[1].projectId,
        content:
          "Swimming pool, bike service pickup and free parking: OTHER TENANT ONLY.",
        embedding: queryVector,
      },
    ]);
    return result;
  });
});

test.afterAll(async () => {
  if (!scopes.length) return;
  await db.delete(documents).where(
    inArray(
      documents.projectId,
      scopes.map((s) => s.projectId),
    ),
  );
  for (const s of scopes) {
    await db
      .delete(sourceDocuments)
      .where(eq(sourceDocuments.projectId, s.projectId));
    await db
      .delete(chatRequestLogs)
      .where(eq(chatRequestLogs.projectId, s.projectId));
    await db.delete(projects).where(eq(projects.id, s.projectId));
    await db.delete(workspaces).where(eq(workspaces.id, s.workspaceId));
    await db.delete(companies).where(eq(companies.id, s.companyId));
    await db.delete(users).where(eq(users.id, s.userId));
  }
});

for (const [domain, question, evidence] of [
  [
    "hotel",
    "Do you have a swimming pool?",
    "hours and charges are not supplied",
  ],
  ["service", "Is bike service pickup available?", "within five kilometres"],
  ["appointment", "Is free parking available?", "Spaces are not guaranteed"],
]) {
  test(`${domain}: low-similarity explicit evidence remains scoped`, async () => {
    const found = await searchDocumentsWithEmbedding(
      scopes[0].projectId,
      question,
      queryVector,
      8,
    );
    expect(found.map((x) => x.content).join(" ")).toContain(evidence);
    expect(found.every((x) => x.similarity < 0.35)).toBe(true);
    expect(found.map((x) => x.content).join(" ")).not.toContain("OTHER TENANT");
  });
}

test("unmatched and injection-like questions do not bypass relevance or scope", async () => {
  for (const question of [
    "Do you have helicopter transfers?",
    "' OR 1=1; -- helicopter",
  ]) {
    expect(
      await searchDocumentsWithEmbedding(
        scopes[0].projectId,
        question,
        queryVector,
      ),
    ).toEqual([]);
  }
});

test("ranks supporting passages for cross-domain paraphrases @live-openai", async () => {
  const testInfo = test.info();
  test.skip(
    testInfo.project.name !== "rag-benchmark",
    "Explicit benchmark command only.",
  );
  const questions = retrievalCases.flatMap(([domain, passage, ...queries]) =>
    queries.map((query) => ({ domain, passage, query })),
  );
  const passages = retrievalCases.map(([, passage]) => passage);
  const start = performance.now();
  const batch = await embedMany({
    model: getPlatformEmbeddingModel(),
    values: [...passages, ...questions.map((q) => q.query)],
    maxRetries: 0,
  });
  const embeddingMs = Math.round(performance.now() - start);

  // Identical evidence in a second tenant makes accidental leakage detectable.
  const reviewedText = passages.join("\n\n");
  const sources = await db
    .insert(sourceDocuments)
    .values(
      scopes.map((scope) => ({
        projectId: scope.projectId,
        title: "Retrieval benchmark",
        processingStatus: "done",
        importReview: {
          ...createKnowledgeImportReview(reviewedText),
          publishedText: reviewedText,
        },
      })),
    )
    .returning({
      id: sourceDocuments.id,
      projectId: sourceDocuments.projectId,
    });
  const seeded = await db
    .insert(documents)
    .values(
      sources.flatMap((source) =>
        passages.map((content, i) => ({
          projectId: source.projectId,
          sourceDocumentId: source.id,
          content,
          embedding: batch.embeddings[i],
        })),
      ),
    )
    .returning({
      id: documents.id,
      projectId: documents.projectId,
      content: documents.content,
    });
  const own = seeded.filter((row) => row.projectId === scopes[0].projectId);
  const allowed = new Set(
    (
      await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.projectId, scopes[0].projectId))
    ).map((row) => row.id),
  );
  const results: Array<
    (typeof questions)[number] & {
      rank: number | null;
      lookupMs: number;
      firstPassage: string | null;
    }
  > = [];
  for (const [i, q] of questions.entries()) {
    const started = performance.now();
    const hits = await searchProjectDocumentEvidenceWithEmbedding(
      scopes[0].projectId,
      q.query,
      batch.embeddings[passages.length + i],
      5,
    );
    const lookupMs = Math.round(performance.now() - started);
    expect(
      hits.every((hit) => allowed.has(Number(hit.id.replace("document:", "")))),
      q.query,
    ).toBe(true);
    const expected = own.find((row) => row.content === q.passage);
    const position = hits.findIndex(
      (hit) => hit.id === `document:${expected?.id}`,
    );
    results.push({
      ...q,
      rank: position < 0 ? null : position + 1,
      lookupMs,
      firstPassage: hits[0]?.content ?? null,
    });
  }
  const times = results.map((row) => row.lookupMs).sort((a, b) => a - b);
  // A project reuses query embeddings in-process but reads current evidence on every request.
  const retriever = new ProjectDocumentTurnRetriever();
  const retrievalSamples = [];
  const sampleQuestions = [...new Set(questions.map((q) => q.domain))].map(
    (domain) => questions.find((q) => q.domain === domain)!,
  );
  for (let round = 0; round < 6; round++) {
    for (const sample of sampleQuestions) {
      const started = performance.now();
      const evidence = await retriever.retrieve({
        projectId: scopes[0].projectId,
        limit: 5,
        query: sample.query,
      });
      const ms = Math.round(performance.now() - started);
      expect(evidence.some((hit) => hit.content === sample.passage)).toBe(true);
      retrievalSamples.push({ query: sample.query, cached: round > 0, ms });
    }
  }
  const warmTimes = retrievalSamples
    .filter((row) => row.cached)
    .map((row) => row.ms)
    .sort((a, b) => a - b);
  const summary = {
    model: PLATFORM_EMBEDDING_MODEL_ID,
    questions: results.length,
    byDomain: sampleQuestions.map(({ domain }) => {
      const rows = results.filter((q) => q.domain === domain);
      return {
        domain,
        questions: rows.length,
        top1: rows.filter((q) => q.rank === 1).length,
      };
    }),
    top1: results.filter((row) => row.rank === 1).length,
    top5: results.filter((row) => row.rank !== null).length,
    embeddingRequests: batch.responses?.length,
    embeddingTokens: batch.usage.tokens,
    embeddingMs,
    lookupP95Ms: times[Math.ceil(times.length * 0.95) - 1],
    cachedRetrievalMedianMs:
      (warmTimes[Math.floor((warmTimes.length - 1) / 2)] +
        warmTimes[Math.floor(warmTimes.length / 2)]) /
      2,
    cachedRetrievalP95Ms: warmTimes[Math.ceil(warmTimes.length * 0.95) - 1],
    coldRetrievalMs: retrievalSamples
      .filter((row) => !row.cached)
      .map((row) => row.ms),
  };
  console.log("Retrieval benchmark", JSON.stringify(summary));
  await writeFile(
    testInfo.outputPath("retrieval-results.json"),
    JSON.stringify({ summary, results, retrievalSamples }, null, 2),
  );
  const firstSource = sources.find(
    (source) => source.projectId === scopes[0].projectId,
  )!;
  await deleteSourceDocumentFromProject(scopes[0].projectId, firstSource.id);
  const afterDelete = await retriever.retrieve({
    projectId: scopes[0].projectId,
    query: sampleQuestions[0].query,
    limit: 5,
  });
  const seededIds = new Set(seeded.map((row) => `document:${row.id}`));
  expect(
    afterDelete.some((hit) => seededIds.has(hit.id)),
    "A cached query must not revive deleted or foreign evidence",
  ).toBe(false);
  expect(
    results.filter((row) => row.rank === null),
    "Supporting passage missing from the first five",
  ).toEqual([]);
  expect(
    results
      .filter((row) => row.rank !== 1)
      .map(({ query, rank }) => ({ query, rank })),
    "Each labelled question in this fixture has one preferred passage",
  ).toEqual([]);
});
