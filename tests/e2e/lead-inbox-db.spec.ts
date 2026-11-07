import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../src/lib/db-config";
import {
  actionFlowVersions,
  actionSubmissionEvents,
  actionSubmissions,
  auditLogs,
  companies,
  companyMemberships,
  conversationProjectPolicies,
  projectActions,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import {
  getInboxLead,
  listInboxLeads,
  updateInboxLead,
} from "../../src/lib/lead-inbox-data";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const password = randomBytes(24).toString("base64url");
type Fixture = {
  companyId: number;
  workspaceId: number;
  userId: number;
  membershipId: number;
  projectIds: number[];
  leadId: number;
  versionId: number;
  email: string;
  excludedIds: number[];
};
const fixtures: Fixture[] = [];

test.beforeAll(async () => {
  const passwordHash = await hash(password, 10);
  for (const tenant of ["A", "B"])
    fixtures.push(
      await db.transaction(async (tx) => {
        const email =
          `lead-inbox-${tenant}-${suffix}@example.test`.toLowerCase();
        const [user] = await tx
          .insert(users)
          .values({ email, name: `Inbox ${tenant}`, passwordHash })
          .returning();
        const [company] = await tx
          .insert(companies)
          .values({ name: `Inbox ${tenant} ${suffix}`, ownerUserId: user.id })
          .returning();
        const [membership] = await tx
          .insert(companyMemberships)
          .values({
            companyId: company.id,
            userId: user.id,
            role: "COMPANY_OWNER",
          })
          .returning();
        const [workspace] = await tx
          .insert(workspaces)
          .values({
            companyId: company.id,
            ownerUserId: user.id,
            name: `Inbox ${tenant} ${suffix}`,
          })
          .returning();
        const ownedProjects = await tx
          .insert(projects)
          .values(
            ["Hotel", "Service"].map((name) => ({
              name: `${name} ${tenant} ${suffix}`,
              workspaceId: workspace.id,
              ownerUserId: user.id,
            })),
          )
          .returning();
        await tx.insert(conversationProjectPolicies).values({
          projectId: ownedProjects[1].id,
          definition: { dataHandling: { exportAllowed: false } },
        });
        const actions = await tx
          .insert(projectActions)
          .values(
            ownedProjects.map((project) => ({
              projectId: project.id,
              name: "Changed draft name",
              status: "active",
            })),
          )
          .returning();
        const [version] = await tx
          .insert(actionFlowVersions)
          .values({
            projectId: ownedProjects[0].id,
            actionId: actions[0].id,
            versionNumber: 1,
            snapshot: {
              schemaVersion: 1,
              action: { name: "Original reservation" },
              steps: [
                {
                  fieldKey: "arrival",
                  label: "Original check-in date",
                  inputType: "date",
                  stepType: "date",
                  isRequired: true,
                  settings: {},
                },
              ],
            },
          })
          .returning();
        const [lead] = await tx
          .insert(actionSubmissions)
          .values({
            projectId: ownedProjects[0].id,
            actionId: actions[0].id,
            actionVersionId: version.id,
            status: "submitted",
            source: "whatsapp_chat",
            fields: {
              arrival: "2027-01-08",
              adults: 4,
              children: 0,
              visitor: "Inbox Visitor",
            },
            metadata: {
              untouched: "preserve",
              handoff: { queue: "Reservations" },
            },
          })
          .returning();
        const excluded = await tx
          .insert(actionSubmissions)
          .values(
            ["in_progress", "cancelled"].map((status) => ({
              projectId: ownedProjects[0].id,
              actionId: actions[0].id,
              status,
              fields: { visitor: "Never a lead" },
            })),
          )
          .returning();
        await tx.insert(actionSubmissions).values(
          Array.from({ length: 31 }, (_, index) => ({
            projectId: ownedProjects[1].id,
            actionId: actions[1].id,
            status: "under_review",
            source: "widget_chat",
            fields: { bikeModel: `Bike ${index}` },
          })),
        );
        return {
          companyId: company.id,
          workspaceId: workspace.id,
          userId: user.id,
          membershipId: membership.id,
          projectIds: ownedProjects.map((project) => project.id),
          leadId: lead.id,
          versionId: version.id,
          email,
          excludedIds: excluded.map((submission) => submission.id),
        };
      }),
    );
});

test.afterAll(async () => {
  for (const fixture of fixtures)
    await db.transaction(async (tx) => {
      await tx
        .delete(auditLogs)
        .where(eq(auditLogs.companyId, fixture.companyId));
      await tx
        .delete(actionSubmissionEvents)
        .where(inArray(actionSubmissionEvents.projectId, fixture.projectIds));
      await tx
        .delete(actionSubmissions)
        .where(inArray(actionSubmissions.projectId, fixture.projectIds));
      await tx
        .delete(actionFlowVersions)
        .where(inArray(actionFlowVersions.projectId, fixture.projectIds));
      await tx
        .delete(projectActions)
        .where(inArray(projectActions.projectId, fixture.projectIds));
      await tx
        .delete(conversationProjectPolicies)
        .where(
          inArray(conversationProjectPolicies.projectId, fixture.projectIds),
        );
      await tx.delete(projects).where(inArray(projects.id, fixture.projectIds));
      await tx.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
      await tx
        .delete(companyMemberships)
        .where(eq(companyMemberships.companyId, fixture.companyId));
      await tx.delete(companies).where(eq(companies.id, fixture.companyId));
      await tx.delete(users).where(eq(users.id, fixture.userId));
    });
});

test("the tenant inbox combines projects, paginates, filters and excludes drafts", async () => {
  const [a, b] = fixtures;
  const first = await listInboxLeads(a);
  expect(first.leads).toHaveLength(30);
  expect(first.hasMore).toBe(true);
  const second = await listInboxLeads(a, { page: 2 });
  expect(second.leads).toHaveLength(2);
  expect(second.hasMore).toBe(false);
  const ids = [...first.leads, ...second.leads].map(
    ({ submission }) => submission.id,
  );
  expect(new Set(ids).size).toBe(32);
  expect(ids).not.toContain(b.leadId);
  for (const id of a.excludedIds) expect(ids).not.toContain(id);
  const byProject = await listInboxLeads(a, { projectId: a.projectIds[0] });
  expect(byProject.leads.map(({ submission }) => submission.id)).toEqual([
    a.leadId,
  ]);
  expect(
    (await listInboxLeads(a, { projectId: b.projectIds[0] })).leads,
  ).toEqual([]);
  expect(
    (
      await listInboxLeads(a, { source: "whatsapp_chat", q: "Inbox Visitor" })
    ).leads.map(({ submission }) => submission.id),
  ).toEqual([a.leadId]);
});

test("detail access and pinned field definitions remain scoped when a draft changes", async () => {
  const [a, b] = fixtures;
  const lead = await getInboxLead(a, a.leadId);
  expect(lead?.action.name).toBe("Original reservation");
  expect(lead?.fields[0]).toMatchObject({
    key: "arrival",
    label: "Original check-in date",
    type: "date",
    value: "2027-01-08",
  });
  expect(await getInboxLead(a, b.leadId)).toBeNull();
  expect(
    await getInboxLead(
      { companyId: b.companyId, workspaceId: a.workspaceId },
      a.leadId,
    ),
  ).toBeNull();
  expect(await getInboxLead(a, a.excludedIds[0])).toBeNull();
  expect(
    (await listInboxLeads(a, { q: "Original reservation" })).leads.map(
      ({ submission }) => submission.id,
    ),
  ).toEqual([a.leadId]);
  expect(
    (await listInboxLeads(a, {}, { forExport: true })).leads.map(
      ({ submission }) => submission.id,
    ),
  ).toEqual([a.leadId]);
  expect(
    (
      await getInboxLead(
        a,
        (
          await listInboxLeads(a, { projectId: a.projectIds[1] })
        ).leads[0].submission.id,
      )
    )?.exportAllowed,
  ).toBe(false);
});

test("staff updates retain workflow data, audit notes and reject stale or foreign changes", async () => {
  const [a, b] = fixtures;
  const actor = { userId: a.userId, membershipId: a.membershipId };
  const input = {
    submissionId: a.leadId,
    expectedRevision: 0,
    status: "assigned" as const,
    assignedUserId: a.userId,
    nextFollowUpDate: "2027-01-02",
    note: "Call after lunch",
  };
  await expect(
    updateInboxLead(a, { ...input, submissionId: b.leadId }, actor),
  ).rejects.toThrow("Lead not found");
  await expect(
    updateInboxLead(a, { ...input, assignedUserId: b.userId }, actor),
  ).rejects.toThrow("active team member");
  const saved = await updateInboxLead(a, input, actor);
  expect(saved.status).toBe("submitted");
  expect(saved.fields.adults).toBe(4);
  expect(saved.fields.children).toBe(0);
  expect(saved.metadata.untouched).toBe("preserve");
  expect(saved.metadata.handoff).toEqual({ queue: "Reservations" });
  expect(saved.metadata.leadInbox).toMatchObject({
    assignedUserId: a.userId,
    status: "assigned",
  });
  await expect(updateInboxLead(a, input, actor)).rejects.toThrow(
    "This lead changed",
  );
  expect(
    (await listInboxLeads(a, { status: "assigned" })).leads.map(
      ({ submission }) => submission.id,
    ),
  ).toEqual([a.leadId]);
  const events = await db
    .select()
    .from(actionSubmissionEvents)
    .where(
      and(
        eq(actionSubmissionEvents.projectId, a.projectIds[0]),
        eq(actionSubmissionEvents.submissionId, a.leadId),
      ),
    );
  expect(events).toHaveLength(1);
  expect(events[0].message).toBe("Call after lunch");
  const audits = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.companyId, a.companyId));
  expect(audits).toHaveLength(1);
  expect(JSON.stringify(audits[0].metadata)).not.toContain("Call after lunch");
});

test("inbox UI and authenticated JSON retain fields and save staff follow-up", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.LIA_LEAD_UI_UAT !== "1",
    "Enable against the configured app for browser verification.",
  );
  test.setTimeout(180_000);
  const [a, b] = fixtures;
  expect((await request.get("/api/leads")).status()).toBe(401);
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(a.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In with Email" }).click();
  await page.waitForURL((url) => !url.pathname.includes("sign-in"), {
    timeout: 60_000,
  });
  await page.goto("/projects/leads");
  await expect(page.getByText("Leads inbox", { exact: true })).toBeVisible();
  await page.getByLabel("Search collected details").fill("Inbox Visitor");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("link", { name: "Open enquiry" }).click();
  await expect(
    page.getByText("Original check-in date", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("2027-01-08", { exact: true })).toBeVisible();
  await page
    .getByLabel("Add an internal note")
    .fill("Browser verified follow-up");
  await page.getByLabel("Lead status", { exact: true }).click();
  await page.getByRole("option", { name: "Assigned", exact: true }).click();
  await page.getByLabel("Team member", { exact: true }).click();
  await page.getByRole("option", { name: "Unassigned", exact: true }).click();
  await page.getByRole("button", { name: "Save follow-up" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Choose a team member" }),
  ).toBeVisible();
  await expect(page.getByLabel("Add an internal note")).toHaveValue(
    "Browser verified follow-up",
  );
  await page.getByLabel("Team member", { exact: true }).click();
  await page.getByRole("option", { name: "Inbox A", exact: true }).click();
  await page.getByRole("button", { name: "Save follow-up" }).click();
  await expect(
    page.getByText("Browser verified follow-up", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const exported = await page.request.get(`/api/leads/${a.leadId}`);
  expect(exported.status()).toBe(200);
  expect(exported.headers()["cache-control"]).toContain("no-store");
  expect((await exported.json()).fields.adults).toBe(4);
  expect((await page.request.get(`/api/leads/${b.leadId}`)).status()).toBe(404);
  const exportBlocked = (
    await listInboxLeads(a, { projectId: a.projectIds[1] })
  ).leads[0].submission.id;
  expect((await page.request.get(`/api/leads/${exportBlocked}`)).status()).toBe(
    403,
  );
  expect(
    (await (await page.request.get("/api/leads")).json()).leads.map(
      (lead: { id: number }) => lead.id,
    ),
  ).toEqual([a.leadId]);
  expect(
    (
      await page.request.get(`/api/leads?projectId=${b.projectIds[0]}`)
    ).status(),
  ).toBe(200);
  expect(
    (
      await (
        await page.request.get(`/api/leads?projectId=${b.projectIds[0]}`)
      ).json()
    ).leads,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "tmp/lead-inbox-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
