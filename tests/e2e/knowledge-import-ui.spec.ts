import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../../src/lib/db-config";
import {
  auditLogs,
  chatRequestLogs,
  companies,
  companyMemberships,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import { deleteAllDocumentsFromProject } from "../../src/lib/documents";
import { getImportedKnowledgeAnswers } from "../../src/lib/knowledge-import-store";

const password = randomUUID();
const email = `knowledge-import-${randomUUID()}@example.test`;
let scope: {
  userId: number;
  companyId: number;
  workspaceId: number;
  projectId: number;
};
test.beforeAll(async () => {
  const passwordHash = await hash(password, 10);
  scope = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ email, passwordHash, name: "Knowledge Import Browser UAT" })
      .returning();
    const [c] = await tx
      .insert(companies)
      .values({ name: "Knowledge Import Browser UAT", ownerUserId: u.id })
      .returning();
    await tx
      .insert(companyMemberships)
      .values({ companyId: c.id, userId: u.id, role: "COMPANY_OWNER" });
    const [w] = await tx
      .insert(workspaces)
      .values({ name: c.name, companyId: c.id, ownerUserId: u.id })
      .returning();
    const [p] = await tx
      .insert(projects)
      .values({ name: c.name, workspaceId: w.id, ownerUserId: u.id })
      .returning();
    return {
      userId: u.id,
      companyId: c.id,
      workspaceId: w.id,
      projectId: p.id,
    };
  });
});
test.afterAll(async () => {
  if (!scope) return;
  await deleteAllDocumentsFromProject(scope.projectId);
  await db
    .delete(chatRequestLogs)
    .where(eq(chatRequestLogs.projectId, scope.projectId));
  await db.delete(auditLogs).where(eq(auditLogs.companyId, scope.companyId));
  await db.delete(projects).where(eq(projects.id, scope.projectId));
  await db.delete(workspaces).where(eq(workspaces.id, scope.workspaceId));
  await db
    .delete(companyMemberships)
    .where(eq(companyMemberships.companyId, scope.companyId));
  await db.delete(companies).where(eq(companies.id, scope.companyId));
  await db.delete(users).where(eq(users.id, scope.userId));
});

test("uploaded knowledge must be reviewed before it becomes a source-owned FAQ", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign In with Email", exact: true })
    .click();
  await page.waitForURL(/\/projects/);
  await page.goto("/projects/documents");
  const original =
    "Q: Is internet available? A: Internet is listed. Speed is not supplied.\nQ: Do you offer pickup? A: Bike pickup is listed. Charges are not supplied.\nQ: Can appointment visitors park? A: Parking is listed. Space is not guaranteed.";
  await page.getByLabel("Upload PDF, Markdown, or Text File").setInputFiles({
    name: "cross-domain-review.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(original),
  });
  await page.waitForURL(/\/review\?projectId=/);
  await expect(
    page.getByRole("button", { name: "Approve and queue indexing" }),
  ).toBeDisabled();
  expect(
    await getImportedKnowledgeAnswers(
      scope.projectId,
      "Is internet available?",
    ),
  ).toEqual([]);
  if (process.env.LIA_LIVE_IMPORT_UAT === "1") {
    await page.getByRole("button", { name: "Suggest wording with AI" }).click();
    await expect(page.getByLabel("Reviewed text")).not.toHaveValue(original, {
      timeout: 35_000,
    });
    expect(
      await getImportedKnowledgeAnswers(
        scope.projectId,
        "Is internet available?",
      ),
    ).toEqual([]);
  }
  const reviewed =
    "Q: Is internet available? A: Yes, we offer internet access. I can't confirm a specific speed.\nQ: Do you offer pickup? A: Yes, we offer bike pickup. Our team can confirm the charges.\nQ: Can appointment visitors park? A: Yes, we have parking. Spaces are not guaranteed.";
  await page.getByLabel("Reviewed text").fill(reviewed);
  await page.getByRole("button", { name: "Save and check draft" }).click();
  await expect(
    page.getByRole("button", { name: "Approve and queue indexing" }),
  ).toBeEnabled();
  await page
    .getByLabel("I reviewed this saved draft", { exact: false })
    .check();
  await page
    .getByRole("button", { name: "Approve and queue indexing" })
    .click();
  await expect(page.getByText("Status: queued", { exact: true })).toBeVisible();
  expect(
    await getImportedKnowledgeAnswers(
      scope.projectId,
      "Is internet available?",
    ),
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Process approved documents" })
    .click();
  await page.waitForURL(/\/projects\/documents\?processed=1/, {
    timeout: 35_000,
  });
  expect(
    await getImportedKnowledgeAnswers(
      scope.projectId,
      "Is internet available?",
    ),
  ).toEqual([
    {
      question: "Is internet available?",
      answer:
        "Yes, we offer internet access. I can't confirm a specific speed.",
    },
  ]);
});
