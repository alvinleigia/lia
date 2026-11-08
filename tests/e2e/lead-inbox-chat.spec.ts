import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  createActionFlowStep,
  createProjectAction,
  createPublishedActionFlowVersion,
} from "../../src/lib/action-flows";
import { REFERENCE_BOOKING_TASK_DEFINITION } from "../../src/lib/conversation-contract-fixtures";
import {
  type ConversationalTaskDefinitionV1,
  conversationalTaskDefinitionV1Schema,
  conversationalTaskSnapshotV1Schema,
  DEFAULT_CONVERSATION_PROJECT_POLICY,
  DEFAULT_CONVERSATIONAL_TASK_DEFINITION,
  normalizeConversationProjectPolicy,
} from "../../src/lib/conversation-contracts";
import { deleteConversationRuntimeData } from "../../src/lib/conversational-task-runtime";
import {
  createProjectConversationalTask,
  publishConversationalTask,
} from "../../src/lib/conversational-tasks";
import { db } from "../../src/lib/db-config";
import {
  actionFlowBranchRules,
  actionFlowSteps,
  actionFlowVersions,
  actionSubmissionEvents,
  actionSubmissions,
  auditLogs,
  channelConversations,
  chatRequestLogs,
  companies,
  companyMemberships,
  contactAttributes,
  contacts,
  contactTagAssignments,
  conversationalTasks,
  conversationalTaskVersions,
  conversationDiagnosticFindings,
  conversationProjectPolicies,
  durableJobs,
  flowRuntimeCommands,
  outboxMessages,
  projectActions,
  projects,
  users,
  workspaces,
} from "../../src/lib/db-schema";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

test("live chat collects an enquiry, handles a FAQ interruption and saves it in the inbox @live-openai", async ({
  page,
}) => {
  test.skip(
    process.env.LIA_LEAD_CHAT_UAT !== "1",
    "Enable explicitly for a real chat on the configured environment.",
  );
  test.setTimeout(360_000);
  const suffix = randomUUID();
  const password = randomBytes(24).toString("base64url");
  const email = `chat-inbox-${suffix}@example.test`;
  const behavior = {
    ...DEFAULT_PROJECT_AI_SETTINGS,
    assistantName: "Lia",
    businessName: "Chat Inbox Test Hotel",
    approvedKnowledgeAnswers: [
      { question: "Do you have Wi-Fi?", answer: "Yes, we offer Wi-Fi." },
    ],
  };
  const fixture = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email,
        name: "Chat Inbox Test",
        passwordHash: await hash(password, 10),
      })
      .returning();
    const [company] = await tx
      .insert(companies)
      .values({
        ownerUserId: user.id,
        name: `Chat Inbox ${suffix}`,
        timeZone: "Asia/Kolkata",
      })
      .returning();
    await tx.insert(companyMemberships).values({
      userId: user.id,
      companyId: company.id,
      role: "COMPANY_OWNER",
    });
    const [workspace] = await tx
      .insert(workspaces)
      .values({
        ownerUserId: user.id,
        companyId: company.id,
        name: `Chat Inbox ${suffix}`,
      })
      .returning();
    const [project] = await tx
      .insert(projects)
      .values({
        ownerUserId: user.id,
        workspaceId: workspace.id,
        name: `Chat to Inbox UAT ${suffix}`,
        aiSettings: behavior,
      })
      .returning();
    return { user, company, workspace, project };
  });
  const projectId = fixture.project.id;
  const transcript: {
    visitor: string;
    replies: string[];
    elapsedMs: number;
  }[] = [];
  const artifacts = "tmp/lead-inbox-chat";
  mkdirSync(artifacts, { recursive: true });
  const actionName = "Hotel Enquiry to Inbox UAT";

  try {
    const field = (
      key: string,
      label: string,
      type: ConversationalTaskDefinitionV1["fields"][number]["type"],
      prompt: string,
    ) => ({
      ...REFERENCE_BOOKING_TASK_DEFINITION.fields[4],
      id: randomUUID(),
      key,
      label,
      type,
      prompt,
      dependsOn: [],
      sensitivity: "standard" as const,
      optionSource: null,
      normalization: null,
    });
    const definition: ConversationalTaskDefinitionV1 = {
      ...DEFAULT_CONVERSATIONAL_TASK_DEFINITION,
      fields: [
        field(
          "stayDates",
          "Stay Dates",
          "date_range",
          "What are your check-in and checkout dates?",
        ),
        field(
          "adults",
          "Number of Adults",
          "integer",
          "How many adults will be staying?",
        ),
        {
          ...field(
            "roomCategory",
            "Room Category",
            "enum",
            "Which room category would you prefer?",
          ),
          optionSource: {
            kind: "static",
            options: [
              { value: "Premium", label: "Premium" },
              { value: "Deluxe", label: "Deluxe" },
            ],
          },
        },
        {
          ...field(
            "guestName",
            "Guest Name",
            "text",
            "What name should we use for your enquiry?",
          ),
          sensitivity: "personal",
        },
        {
          ...field(
            "contactEmail",
            "Contact Email",
            "email",
            "What email can our team use to follow up?",
          ),
          sensitivity: "personal",
        },
      ],
      taskPolicy: {
        ...DEFAULT_CONVERSATIONAL_TASK_DEFINITION.taskPolicy,
        instructions:
          "Collect a hotel stay enquiry. Answer knowledge questions and resume collecting only missing details, retaining previously validated values. This is an enquiry for team review, not a confirmed booking. Do not invent availability or pricing. Require confirmation before saving.",
      },
    };
    conversationalTaskDefinitionV1Schema.parse(definition);
    const task = await createProjectConversationalTask(
      projectId,
      {
        name: "Hotel Stay Enquiry",
        objective:
          "Collect stay dates, adults, room category, name and contact email for team review.",
      },
      definition,
    );
    const taskVersion = await publishConversationalTask({
      projectId,
      taskId: task.id,
      userId: fixture.user.id,
      assistantBehavior: behavior,
      projectPolicy: DEFAULT_CONVERSATION_PROJECT_POLICY,
    });
    if (!taskVersion) throw new Error("Task publication failed.");
    expect(
      conversationalTaskSnapshotV1Schema.parse(taskVersion.snapshot).task
        .definition.fields,
    ).toHaveLength(5);
    const action = await createProjectAction({
      projectId,
      name: actionName,
      triggerPhrases: ["start hotel enquiry"],
      status: "draft",
    });
    const handoff = await createActionFlowStep({
      projectId,
      actionId: action.id,
      sortOrder: 2,
      stepType: "handoff",
      label: "Reservations Review",
      prompt:
        "Your enquiry has been saved for our reservations team to review. Your stay is not booked yet.",
      isRequired: false,
      settings: {
        handoffNotifyTeam: false,
        handoffPriority: "normal",
        handoffQueue: "Reservations",
      },
    });
    await createActionFlowStep({
      projectId,
      actionId: action.id,
      sortOrder: 1,
      stepType: "conversational_task",
      label: "Collect Stay Enquiry",
      isRequired: true,
      settings: {
        conversationalTask: {
          schemaVersion: 1,
          task: {
            schemaVersion: 1,
            taskId: task.id,
            taskVersionId: taskVersion.id,
            versionNumber: taskVersion.versionNumber,
            name: task.name,
            outcomes: definition.outcomes,
          },
          transferContextKeys: [],
          transferFieldKeys: [],
          outcomeRoutes: { completed: handoff.id, cancelled: "end" },
        },
      },
    });
    await createPublishedActionFlowVersion({
      projectId,
      actionId: action.id,
      publishedByUserId: fixture.user.id,
    });

    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign In with Email" }).click();
    await page.waitForURL(
      (url) => url.pathname === "/post-login" || url.pathname === "/projects",
      { timeout: 60_000 },
    );
    await page.goto(`/projects/tasks/${task.id}/configure/knowledge`);
    const limitInput = page.getByLabel("Clarifications before assistance", {
      exact: true,
    });
    await expect(limitInput).toHaveAttribute("min", "0");
    await expect(limitInput).toHaveAttribute("max", "3");
    for (const limit of [2, 1]) {
      await limitInput.fill(String(limit));
      await page
        .getByRole("button", { name: "Save Knowledge Settings", exact: true })
        .click();
      await expect
        .poll(async () => {
          const [policy] = await db
            .select()
            .from(conversationProjectPolicies)
            .where(eq(conversationProjectPolicies.projectId, projectId));
          return policy
            ? normalizeConversationProjectPolicy(policy.definition).knowledge
                .noAnswerPolicy.clarificationAttempts
            : undefined;
        })
        .toBe(limit);
      await expect(
        page.getByRole("button", {
          name: "Save Knowledge Settings",
          exact: true,
        }),
      ).toBeEnabled();
    }
    await page.goto("/projects/chat");
    await expect(page.getByText("Project Chat", { exact: true })).toBeVisible();

    async function send(text: string) {
      const composer = page.locator("textarea").last();
      await expect(composer).toBeEnabled({ timeout: 45_000 });
      await composer.fill(text);
      const started = Date.now();
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/actions/runtime") &&
          response.request().method() === "POST" &&
          response.request().postDataJSON()?.text === text,
        { timeout: 90_000 },
      );
      await composer.press("Enter");
      const response = await responsePromise;
      expect(response.ok()).toBe(true);
      const body = await response.json();
      const replies = (body.replies ?? []).map(
        (reply: { text: string }) => reply.text,
      );
      transcript.push({
        visitor: text,
        replies,
        elapsedMs: Date.now() - started,
      });
      await expect(composer).toBeEnabled({ timeout: 45_000 });
      console.log(JSON.stringify(transcript.at(-1)));
      return replies.join("\n");
    }

    expect(await send("Do you have Wi-Fi?")).toMatch(/offer Wi-Fi/i);
    expect(await send("start hotel enquiry")).toMatch(
      /check.?in|checkout|dates/i,
    );
    expect(
      await send(
        "We would like to arrive on 8 January 2027 and leave on 10 January 2027.",
      ),
    ).toMatch(/adults/i);
    const faq = await send("Do you have Wi-Fi?");
    expect(faq).toMatch(/offer Wi-Fi/i);
    expect(faq).toMatch(/adults/i);
    await send("Two adults, please.");
    await send("Premium");
    await send("My name is Alex Inbox Test.");
    const review = await send("alex.inbox@example.test");
    expect(review).toMatch(/review|confirm/i);
    expect(review).toContain("2027");
    const before = await page.request.get("/api/leads");
    expect(before.status()).toBe(200);
    expect((await before.json()).leads).toHaveLength(0);
    await page.screenshot({
      path: `${artifacts}/confirmation-review.png`,
      fullPage: true,
    });

    const confirm = page.getByRole("button", {
      name: /^(Confirm|Confirm Request)$/i,
    });
    await expect(confirm).toBeVisible();
    const confirmedPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/actions/runtime") &&
        response.request().method() === "POST",
      { timeout: 90_000 },
    );
    await confirm.click();
    const confirmed = await confirmedPromise;
    expect(confirmed.ok()).toBe(true);
    const confirmation = await confirmed.json();
    const confirmationText = (confirmation.replies ?? [])
      .map((reply: { text: string }) => reply.text)
      .join("\n");
    transcript.push({
      visitor: "[Clicked Confirm]",
      replies: [confirmationText],
      elapsedMs: 0,
    });
    expect(confirmationText).toMatch(/saved.*reservations team/i);
    await expect(
      page.getByText(/Your enquiry has been saved for our reservations team/),
    ).toBeVisible();
    await page.screenshot({
      path: `${artifacts}/chat-saved.png`,
      fullPage: true,
    });

    const [submission] = await db
      .select()
      .from(actionSubmissions)
      .where(eq(actionSubmissions.projectId, projectId));
    expect(submission.status).toBe("under_review");
    expect(JSON.stringify(submission.fields.stayDates)).toContain("2027-01-08");
    expect(JSON.stringify(submission.fields.stayDates)).toContain("2027-01-10");
    expect(submission.fields).toMatchObject({
      adults: 2,
      roomCategory: "Premium",
      guestName: "Alex Inbox Test",
      contactEmail: "alex.inbox@example.test",
    });
    await page.goto("/projects/leads");
    await page.getByRole("link", { name: "Open enquiry" }).click();
    await expect(page.getByText("Stay Dates", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Number of Adults", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Alex Inbox Test", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("definition")
        .filter({ hasText: /^alex\.inbox@example\.test$/ }),
    ).toBeVisible();
    await expect(
      page.getByText("Do you have Wi-Fi?", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `${artifacts}/inbox-enquiry.png`,
      fullPage: true,
    });
    const exported = await page.request.get(`/api/leads/${submission.id}`);
    expect(exported.status()).toBe(200);
    expect((await exported.json()).fields).toEqual(submission.fields);
    const list = await page.request.get("/api/leads");
    expect(
      (await list.json()).leads.map((lead: { id: number }) => lead.id),
    ).toEqual([submission.id]);
    console.log(
      JSON.stringify({
        result: "chat_to_inbox_passed",
        projectId,
        submissionId: submission.id,
        fields: submission.fields,
      }),
    );
    const assistanceAction = await createProjectAction({
      projectId,
      name: "Exception Assistance UAT",
      triggerPhrases: ["start assistance test"],
      status: "draft",
    });
    await createActionFlowStep({
      projectId,
      actionId: assistanceAction.id,
      sortOrder: 1,
      stepType: "email",
      label: "Contact Email",
      fieldKey: "contactEmail",
      inputType: "email",
      prompt: "What email should we include?",
      isRequired: true,
    });
    await createActionFlowStep({
      projectId,
      actionId: assistanceAction.id,
      sortOrder: 2,
      stepType: "date",
      label: "Preferred Date",
      fieldKey: "preferredDate",
      inputType: "date",
      prompt: "What date would you prefer?",
      isRequired: true,
    });
    await createActionFlowStep({
      projectId,
      actionId: assistanceAction.id,
      sortOrder: 3,
      stepType: "handoff",
      label: "Exception Review",
      prompt: "Your request has been sent for team review.",
      settings: { handoffNotifyTeam: false, handoffQueue: "Exception Review" },
    });
    await createPublishedActionFlowVersion({
      projectId,
      actionId: assistanceAction.id,
      publishedByUserId: fixture.user.id,
    });
    let assistanceRevision: number | undefined;
    async function sendAssistance(text: string) {
      const response = await page.request.post("/api/actions/runtime", {
        data: {
          projectId,
          conversationId: `exception-${suffix}`,
          commandId: randomUUID(),
          expectedRevision: assistanceRevision,
          text,
        },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      assistanceRevision = body.activeFlow?.revision;
      const replies = body.replies
        .map((reply: { text: string }) => reply.text)
        .join("\n");
      transcript.push({ visitor: text, replies: [replies], elapsedMs: 0 });
      return replies;
    }
    expect(await sendAssistance("start assistance test")).toMatch(/email/i);
    expect(await sendAssistance("alex.exception@example.test")).toMatch(
      /date/i,
    );
    const uncertain =
      "Either 10 January 2027 or 11 January 2027. I haven't decided.";
    expect(await sendAssistance(uncertain)).toMatch(
      /date|which|choose|prefer/i,
    );
    expect(await sendAssistance(uncertain)).toMatch(/our team to help/i);
    expect(await sendAssistance("Yes please")).toMatch(/team review/i);
    const [assistanceSubmission] = await db
      .select()
      .from(actionSubmissions)
      .where(eq(actionSubmissions.actionId, assistanceAction.id));
    expect(assistanceSubmission.status).toBe("under_review");
    expect(assistanceSubmission.fields.contactEmail).toBe(
      "alex.exception@example.test",
    );
    expect(assistanceSubmission.fields.preferredDate).toBeUndefined();
    await page.goto("/projects/diagnostics");
    await expect(page.getByText(/exception review/i).first()).toBeVisible();
    await page.screenshot({
      path: `${artifacts}/exception-review-queue.png`,
      fullPage: true,
    });
    await page.goto("/projects/handoffs");
    await expect(
      page.getByText("Exception Review", { exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: `${artifacts}/exception-handoff.png`,
      fullPage: true,
    });
    console.log(
      JSON.stringify({
        result: "exception_handoff_passed",
        projectId,
        submissionId: assistanceSubmission.id,
      }),
    );
  } finally {
    writeFileSync(
      `${artifacts}/transcript.json`,
      JSON.stringify(transcript, null, 2),
    );
    const conversations = await db
      .select({ id: channelConversations.id })
      .from(channelConversations)
      .where(eq(channelConversations.projectId, projectId));
    for (const conversation of conversations)
      await deleteConversationRuntimeData({
        projectId,
        conversationId: conversation.id,
        includeMessages: true,
      });
    await db.transaction(async (tx) => {
      for (const table of [
        outboxMessages,
        durableJobs,
        conversationDiagnosticFindings,
        flowRuntimeCommands,
        chatRequestLogs,
        auditLogs,
        channelConversations,
        contactTagAssignments,
        contactAttributes,
        contacts,
        actionSubmissionEvents,
        actionSubmissions,
        actionFlowBranchRules,
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
      await tx
        .delete(conversationalTaskVersions)
        .where(eq(conversationalTaskVersions.projectId, projectId));
      await tx
        .delete(conversationalTasks)
        .where(eq(conversationalTasks.projectId, projectId));
      await tx
        .delete(conversationProjectPolicies)
        .where(eq(conversationProjectPolicies.projectId, projectId));
      await tx.delete(projects).where(eq(projects.id, projectId));
      await tx
        .delete(workspaces)
        .where(eq(workspaces.id, fixture.workspace.id));
      await tx
        .delete(companyMemberships)
        .where(eq(companyMemberships.companyId, fixture.company.id));
      await tx.delete(companies).where(eq(companies.id, fixture.company.id));
      await tx.delete(users).where(eq(users.id, fixture.user.id));
    });
  }
});
