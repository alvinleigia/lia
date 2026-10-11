import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../src/lib/db-config";
import {
  companies,
  documents,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import { searchDocumentsWithEmbedding } from "../../src/lib/search";

const queryVector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
// Similarity 0.2: explicit facts must survive the semantic cutoff of 0.35.
const lowSimilarity = Array.from({ length: 1536 }, (_, i) =>
  i === 0 ? 0.2 : i === 1 ? Math.sqrt(0.96) : 0,
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
