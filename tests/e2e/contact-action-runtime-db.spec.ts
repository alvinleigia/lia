import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { executeContactMutationStep } from "../../src/lib/contact-flow-mutations";
import { listContactTags } from "../../src/lib/contacts";
import { db } from "../../src/lib/db-config";
import {
  actionSubmissionEvents,
  actionSubmissions,
  companies,
  companyMemberships,
  contacts,
  contactTagAssignments,
  contactTags,
  projectActions,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let fixture:
  | {
      actionId: number;
      agentEmail: string;
      companyId: number;
      contactId: number;
      otherContactId: number;
      otherProjectId: number;
      projectId: number;
      submissionId: number;
      userIds: number[];
      workspaceId: number;
    }
  | undefined;

function mutationStep(
  id: number,
  stepType: string,
  settings: Record<string, unknown> = {},
) {
  return {
    fieldKey: null,
    id,
    inputType: null,
    isEnabled: true,
    isRequired: false,
    label: stepType,
    nextStepId: null,
    operationId: null,
    options: [],
    prompt: null,
    settings,
    sortOrder: id,
    stepType,
  };
}

test.beforeAll(async () => {
  const agentEmail = `phase11-agent-${suffix}@example.com`;
  const [owner, agent] = await db
    .insert(users)
    .values([
      {
        email: `phase11-owner-${suffix}@example.com`,
        name: "Phase 11 Owner",
        passwordHash: "test-only",
      },
      {
        email: agentEmail,
        name: "Phase 11 Agent",
        passwordHash: "test-only",
      },
    ])
    .returning();
  const [company] = await db
    .insert(companies)
    .values({ name: `Phase 11 ${suffix}`, ownerUserId: owner.id })
    .returning();
  await db.insert(companyMemberships).values([
    { companyId: company.id, role: "COMPANY_OWNER", userId: owner.id },
    { companyId: company.id, role: "COMPANY_MEMBER", userId: agent.id },
  ]);
  const [workspace] = await db
    .insert(workspaces)
    .values({
      companyId: company.id,
      name: `Phase 11 ${suffix}`,
      ownerUserId: owner.id,
    })
    .returning();
  const [project, otherProject] = await db
    .insert(projects)
    .values([
      {
        name: `Phase 11 ${suffix}`,
        ownerUserId: owner.id,
        workspaceId: workspace.id,
      },
      {
        name: `Other Phase 11 ${suffix}`,
        ownerUserId: owner.id,
        workspaceId: workspace.id,
      },
    ])
    .returning();
  const [contact, otherContact] = await db
    .insert(contacts)
    .values([
      {
        primaryChannelType: "project_chat",
        primaryExternalId: `phase11-${suffix}`,
        projectId: project.id,
      },
      {
        primaryChannelType: "project_chat",
        primaryExternalId: `phase11-other-${suffix}`,
        projectId: otherProject.id,
      },
    ])
    .returning();
  const [action] = await db
    .insert(projectActions)
    .values({ name: `Phase 11 ${suffix}`, projectId: project.id })
    .returning();
  const [submission] = await db
    .insert(actionSubmissions)
    .values({ actionId: action.id, projectId: project.id })
    .returning();

  fixture = {
    actionId: action.id,
    agentEmail,
    companyId: company.id,
    contactId: contact.id,
    otherContactId: otherContact.id,
    otherProjectId: otherProject.id,
    projectId: project.id,
    submissionId: submission.id,
    userIds: [owner.id, agent.id],
    workspaceId: workspace.id,
  };
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
    .delete(projectActions)
    .where(eq(projectActions.projectId, fixture.projectId));
  await db
    .delete(contactTagAssignments)
    .where(eq(contactTagAssignments.projectId, fixture.projectId));
  await db
    .delete(contactTags)
    .where(eq(contactTags.projectId, fixture.projectId));
  await db.delete(contacts).where(eq(contacts.projectId, fixture.projectId));
  await db
    .delete(contacts)
    .where(eq(contacts.projectId, fixture.otherProjectId));
  await db.delete(projects).where(eq(projects.id, fixture.projectId));
  await db.delete(projects).where(eq(projects.id, fixture.otherProjectId));
  await db
    .delete(companyMemberships)
    .where(eq(companyMemberships.companyId, fixture.companyId));
  await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
  await db.delete(companies).where(eq(companies.id, fixture.companyId));
  for (const userId of fixture.userIds) {
    await db.delete(users).where(eq(users.id, userId));
  }
});

test("contact actions mutate only the scoped contact", async () => {
  if (!fixture) throw new Error("Contact action fixture was not created.");
  const base = {
    contactId: fixture.contactId,
    fields: {},
    projectId: fixture.projectId,
    submissionId: fixture.submissionId,
  };

  await executeContactMutationStep({
    ...base,
    step: mutationStep(1, "add_tag", { contactTagNames: "Qualified" }),
  });
  expect(
    await listContactTags(fixture.projectId, fixture.contactId),
  ).toHaveLength(1);
  await executeContactMutationStep({
    ...base,
    step: mutationStep(2, "remove_tag", { contactTagNames: "Qualified" }),
  });
  expect(
    await listContactTags(fixture.projectId, fixture.contactId),
  ).toHaveLength(0);

  await executeContactMutationStep({
    ...base,
    step: mutationStep(3, "subscribe"),
  });
  await executeContactMutationStep({
    ...base,
    step: mutationStep(4, "unsubscribe"),
  });
  await executeContactMutationStep({
    ...base,
    step: mutationStep(5, "assign_agent", {
      contactAgentEmail: fixture.agentEmail,
    }),
  });
  await executeContactMutationStep({
    ...base,
    step: mutationStep(6, "assign_team", { contactTeamName: "Sales" }),
  });

  const [updated] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, fixture.contactId));
  expect(updated.metadata.workflowState).toMatchObject({
    assignedAgent: {
      email: fixture.agentEmail,
      name: "Phase 11 Agent",
    },
    assignedTeam: "Sales",
    subscriptionStatus: "unsubscribed",
  });

  const crossProject = await executeContactMutationStep({
    ...base,
    contactId: fixture.otherContactId,
    step: mutationStep(7, "add_tag", { contactTagNames: "Must Not Apply" }),
  });
  expect(crossProject.ok).toBe(false);
  expect(
    await listContactTags(fixture.otherProjectId, fixture.otherContactId),
  ).toHaveLength(0);
});
