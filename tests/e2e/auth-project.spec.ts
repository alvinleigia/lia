import { expect, type Page, test } from "@playwright/test";
import {
  createActionFlowBranchRule,
  createActionFlowStep,
  createProjectAction as createChatbotAction,
  listActionSubmissionEvents,
  listActionSubmissions,
} from "../../src/lib/action-flows";
import { writeAuditLog } from "../../src/lib/audit";
import { processChannelFlowText } from "../../src/lib/channel-flow-runtime";
import {
  recordChannelInboundMessage,
  recordChannelMessage,
} from "../../src/lib/channels";
import { logChatRequest } from "../../src/lib/chat-logs";
import { getOrCreateDefaultCompanyForUser } from "../../src/lib/companies";
import { addContactTag, setContactAttribute } from "../../src/lib/contacts";
import { getProjectSourceDocuments } from "../../src/lib/documents";
import { listProjectMediaAssets } from "../../src/lib/media-assets";
import {
  createIntegrationProvider,
  createOperation,
  listProjectOperationAttemptsWithDetails,
} from "../../src/lib/operations";
import {
  listProjectCatalogProducts,
  listProjectCatalogs,
} from "../../src/lib/product-catalogs";
import { getUserByEmail } from "../../src/lib/users";
import { upsertProjectWhatsAppChannel } from "../../src/lib/whatsapp";
import { createOrRotateProjectWidgetToken } from "../../src/lib/widget-keys";
import { getOrCreateDefaultWorkspaceForCompany } from "../../src/lib/workspaces";

const password = "TestPassword123!";
const platformAdminEmail =
  process.env.E2E_PLATFORM_ADMIN_EMAIL ?? "e2e-platform-admin@example.test";

async function signUpOrUseExistingAccount(
  page: Page,
  input: {
    email: string;
    name: string;
    password: string;
  },
) {
  await page.goto("/sign-up");
  await expect(page.getByText("Create Account").first()).toBeVisible();

  await page.getByLabel("Name (optional)").fill(input.name);
  await page.getByLabel("Email").fill(input.email);
  await page.getByLabel("Password", { exact: true }).fill(input.password);
  await page.getByLabel("Confirm Password").fill(input.password);
  await Promise.all([
    page.waitForURL(/\/sign-(in|up)\?/),
    page.getByRole("button", { name: "Create Account" }).click(),
  ]);

  if (page.url().includes("/sign-up")) {
    await expect(page.getByText("Email is already registered.")).toBeVisible();
    return;
  }

  await expect(page).toHaveURL(/\/sign-in\?registered=1/);
  await expect(page.getByText("Account created successfully.")).toBeVisible();
}

async function signInWithEmail(page: Page, email: string) {
  await page.goto("/sign-in");
  await expect(page.getByText("Sign In").first()).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In with Email" }).click();
}

async function finishInviteSignUpFromCurrentPage(
  page: Page,
  input: {
    name: string;
    password: string;
  },
) {
  await expect(page.getByText("Create Account").first()).toBeVisible();
  await page.getByLabel("Name (optional)").fill(input.name);
  await page.getByLabel("Password", { exact: true }).fill(input.password);
  await page.getByLabel("Confirm Password").fill(input.password);
  await Promise.all([
    page.waitForURL(/\/sign-in\?registered=1&inviteAccepted=1/),
    page.getByRole("button", { name: "Create Account" }).click(),
  ]);
  await expect(
    page.getByText("Invitation accepted. Please sign in."),
  ).toBeVisible();
}

async function createProjectFromProjectsPage(page: Page, projectName: string) {
  await expect(page).toHaveURL(/\/projects/);
  await page.getByRole("link", { name: "New Project" }).click();
  await expect(page.getByText("New Project").first()).toBeVisible();

  await page.getByLabel("Project Name").fill(projectName);
  await page.getByRole("button", { name: "Create Project" }).click();

  await expect(page).toHaveURL(/\/projects\/\d+\?created=1/);
  const projectIdMatch = page.url().match(/\/projects\/(\d+)/);
  expect(projectIdMatch).not.toBeNull();
  return Number(projectIdMatch?.[1]);
}

async function seedProjectChatAction(input: {
  actionName: string;
  fieldKey: string;
  projectId: number;
  prompt: string;
  triggerPhrase: string;
}) {
  const action = await createChatbotAction({
    description: "Seeded by Playwright for project chat submission coverage.",
    name: input.actionName,
    projectId: input.projectId,
    status: "active",
    triggerPhrases: [input.triggerPhrase],
  });

  await createActionFlowStep({
    actionId: action.id,
    fieldKey: input.fieldKey,
    inputType: "text",
    isRequired: true,
    label: "Request Details",
    projectId: input.projectId,
    prompt: input.prompt,
    sortOrder: 1,
    stepType: "collect_input",
  });

  await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Submit Request",
    projectId: input.projectId,
    prompt: "Saving your request now.",
    sortOrder: 2,
    stepType: "submit",
  });

  return action;
}

async function seedBranchingProjectChatAction(input: {
  actionName: string;
  projectId: number;
  triggerPhrase: string;
  urgentMessage: string;
}) {
  const action = await createChatbotAction({
    description: "Seeded by Playwright for branch routing smoke coverage.",
    name: input.actionName,
    projectId: input.projectId,
    status: "active",
    triggerPhrases: [input.triggerPhrase],
  });

  const priorityStep = await createActionFlowStep({
    actionId: action.id,
    fieldKey: "priority",
    inputType: "text",
    isRequired: true,
    label: "Priority",
    options: [
      { label: "Urgent", value: "urgent" },
      { label: "Normal", value: "normal" },
    ],
    projectId: input.projectId,
    prompt: "How urgent is this request?",
    sortOrder: 1,
    stepType: "choice",
  });

  await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Normal Route",
    projectId: input.projectId,
    prompt: "This is the normal branch path.",
    sortOrder: 2,
    stepType: "message",
  });

  const submitStep = await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Submit Branch Request",
    projectId: input.projectId,
    prompt: "Submitting the branch request.",
    sortOrder: 3,
    stepType: "submit",
  });

  const urgentStep = await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Urgent Route",
    nextStepId: submitStep.id,
    projectId: input.projectId,
    prompt: input.urgentMessage,
    sortOrder: 4,
    stepType: "message",
  });

  await createActionFlowBranchRule({
    actionId: action.id,
    comparisonValue: "urgent",
    operator: "equals",
    projectId: input.projectId,
    sourceFieldKey: "priority",
    sourceStepId: priorityStep.id,
    sortOrder: 1,
    targetStepId: urgentStep.id,
  });

  return action;
}

async function seedInlineOperationRouteAction(input: {
  actionName: string;
  failureMessage: string;
  projectId: number;
  providerType: "email" | "manual_review";
  successMessage: string;
  triggerPhrase: string;
}) {
  const provider = await createIntegrationProvider({
    projectId: input.projectId,
    name: `${input.actionName} Provider`,
    providerType: input.providerType,
  });
  const operation = await createOperation({
    projectId: input.projectId,
    providerId: provider.id,
    name: `${input.actionName} Operation`,
    operationType: input.providerType,
  });
  const action = await createChatbotAction({
    description:
      "Seeded by Playwright for inline operation route smoke coverage.",
    name: input.actionName,
    projectId: input.projectId,
    status: "active",
    triggerPhrases: [input.triggerPhrase],
  });
  const submitStep = await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Submit Operation Route",
    projectId: input.projectId,
    prompt: "Saving the operation route request.",
    sortOrder: 4,
    stepType: "submit",
  });
  const operationStep = await createActionFlowStep({
    actionId: action.id,
    fieldKey: "operation_status",
    isRequired: false,
    label: "Run Inline Operation",
    operationId: operation.id,
    projectId: input.projectId,
    prompt: "Running the inline operation.",
    settings: {
      operationExecutionMode: "inline",
    },
    sortOrder: 1,
    stepType: "operation",
  });
  const successStep = await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Operation Success Route",
    nextStepId: submitStep.id,
    projectId: input.projectId,
    prompt: input.successMessage,
    sortOrder: 2,
    stepType: "message",
  });
  const failureStep = await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Operation Failure Route",
    nextStepId: submitStep.id,
    projectId: input.projectId,
    prompt: input.failureMessage,
    sortOrder: 3,
    stepType: "message",
  });

  await createActionFlowBranchRule({
    actionId: action.id,
    comparisonValue: "completed",
    operator: "equals",
    projectId: input.projectId,
    sourceFieldKey: "operation_status",
    sourceStepId: operationStep.id,
    sortOrder: 1,
    targetStepId: successStep.id,
  });
  await createActionFlowBranchRule({
    actionId: action.id,
    comparisonValue: "failed",
    operator: "equals",
    projectId: input.projectId,
    sourceFieldKey: "operation_status",
    sourceStepId: operationStep.id,
    sortOrder: 2,
    targetStepId: failureStep.id,
  });

  return { action, operation };
}

async function sendProjectChatMessage(page: Page, message: string) {
  await page.locator("textarea").fill(message);
  await page.locator("textarea").press("Enter");
}

async function sendWidgetMessage(page: Page, message: string) {
  await page.getByPlaceholder("Ask a question...").fill(message);
  await page.getByRole("button", { name: "Send" }).click();
}

async function uploadAndProcessTextDocument(
  page: Page,
  input: {
    content: string;
    documentName: string;
    projectId: number;
    projectName: string;
  },
) {
  const cronSecret = process.env.CRON_SECRET;
  expect(
    cronSecret,
    "CRON_SECRET must be set for document processing smoke coverage.",
  ).toMatch(/.+/);

  await page.goto("/projects/documents");
  await expect(page.getByText(`Documents: ${input.projectName}`)).toBeVisible();

  await page.setInputFiles("#document-upload", {
    buffer: Buffer.from(input.content),
    mimeType: "text/plain",
    name: input.documentName,
  });

  await expect(page.getByText("Success!")).toBeVisible();
  await expect(
    page.getByText("Document queued for background processing."),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const [uploadedDocument] = await getProjectSourceDocuments(
        input.projectId,
        1,
      );
      return uploadedDocument?.title === input.documentName
        ? uploadedDocument.processingStatus
        : null;
    })
    .toBe("queued");

  const processResponse = await page.request.post("/api/upload/process-next", {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  expect(processResponse.status()).toBe(200);
  const processResult = (await processResponse.json()) as {
    failed: number;
    processed: number;
  };
  expect(processResult.processed).toBeGreaterThanOrEqual(1);

  await expect
    .poll(async () => {
      const [uploadedDocument] = await getProjectSourceDocuments(
        input.projectId,
        1,
      );
      return uploadedDocument?.title === input.documentName
        ? {
            chunkCount: Number(uploadedDocument.chunkCount),
            status: uploadedDocument.processingStatus,
          }
        : null;
    })
    .toEqual({
      chunkCount: expect.any(Number),
      status: "done",
    });

  const [processedDocument] = await getProjectSourceDocuments(
    input.projectId,
    1,
  );
  expect(Number(processedDocument?.chunkCount ?? 0)).toBeGreaterThan(0);
}

test("user can sign up, sign in, and create a project", async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-${runId}@example.test`;
  const projectName = `E2E Project ${runId}`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);

  await expect(page.getByText("Projects").first()).toBeVisible();
  await createProjectFromProjectsPage(page, projectName);
  await expect(
    page.getByText(`Project: ${projectName}`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Project created.")).toBeVisible();
});

test("company owner can apply a bundled action template", async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-template-${runId}@example.test`;
  const projectName = `E2E Template Project ${runId}`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Template User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  await createProjectFromProjectsPage(page, projectName);

  await page.goto("/projects/actions/new");
  await expect(
    page.getByText(`New Action: ${projectName}`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Support Ticket", { exact: true })).toBeVisible();

  const supportTemplateForm = page
    .locator('input[name="templateKey"][value="support_ticket"]')
    .locator("xpath=..");
  await supportTemplateForm
    .getByRole("button", { name: "Apply Template" })
    .click();

  await expect(page).toHaveURL(/\/projects\/actions\/\d+\?created=1/);
  await expect(
    page.getByText("Create Support Ticket", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expect(page.getByText("Flow Steps").first()).toBeVisible();
  await expect(page.getByText("7/7")).toBeVisible();
  await expect(page.getByText("Issue Category").first()).toBeVisible();
  await expect(page.getByText("Submit Ticket").first()).toBeVisible();

  await page.goto("/projects/actions");
  await expect(page.getByText(`Actions: ${projectName}`)).toBeVisible();
  await expect(page.getByText("Create Support Ticket").first()).toBeVisible();
});

test("platform admin email lands on the platform dashboard", async ({
  page,
}) => {
  await signUpOrUseExistingAccount(page, {
    email: platformAdminEmail,
    name: "E2E Platform Admin",
    password,
  });
  await signInWithEmail(page, platformAdminEmail);

  await expect(page).toHaveURL(/\/platform/);
  await expect(page.getByText("Platform").first()).toBeVisible();
  await expect(page.getByText("Tenants").first()).toBeVisible();
  await expect(page.getByText(platformAdminEmail)).toBeVisible();
});

test("non platform admin cannot open platform admin routes", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-non-platform-${runId}@example.test`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Non Platform Admin ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  await expect(page).toHaveURL(/\/projects/);

  await page.goto("/platform");
  await expect(
    page.getByText("This page could not be found.").first(),
  ).toBeVisible();

  await page.goto("/platform/companies/1");
  await expect(
    page.getByText("This page could not be found.").first(),
  ).toBeVisible();
});

test("disabled tenant owner lands on the disabled account page", async ({
  browser,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantName = `E2E Disabled Tenant ${runId}`;
  const tenantEmail = `e2e-disabled-${runId}@example.test`;
  const projectName = `E2E Disabled Widget Project ${runId}`;
  const whatsappPhoneNumberId = `e2e-disabled-phone-${runId}`;
  const whatsappVerifyToken = `e2e-disabled-verify-${runId}`;

  const tenantContext = await browser.newContext();
  const tenantPage = await tenantContext.newPage();
  await signUpOrUseExistingAccount(tenantPage, {
    email: tenantEmail,
    name: tenantName,
    password,
  });
  await signInWithEmail(tenantPage, tenantEmail);
  await expect(tenantPage).toHaveURL(/\/projects/);
  const projectId = await createProjectFromProjectsPage(
    tenantPage,
    projectName,
  );
  const widgetToken = await createOrRotateProjectWidgetToken(projectId);
  await upsertProjectWhatsAppChannel({
    projectId,
    name: `E2E Disabled WhatsApp ${runId}`,
    status: "active",
    config: {
      appSecret: "disabled-e2e-secret",
      businessAccountId: `disabled-business-${runId}`,
      businessName: tenantName,
      displayPhoneNumber: "+15550000000",
      phoneNumberId: whatsappPhoneNumberId,
      verifyToken: whatsappVerifyToken,
    },
  });
  await tenantContext.close();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUpOrUseExistingAccount(adminPage, {
    email: platformAdminEmail,
    name: "E2E Platform Admin",
    password,
  });
  await signInWithEmail(adminPage, platformAdminEmail);
  await expect(adminPage).toHaveURL(/\/platform/);

  const tenantRow = adminPage.locator("tr").filter({ hasText: tenantName });
  await expect(tenantRow).toBeVisible();
  await tenantRow.getByRole("button", { name: "Disable" }).click();
  await expect(adminPage).toHaveURL(/\/platform\?updated=1/);
  await expect(
    adminPage
      .locator("tr")
      .filter({ hasText: tenantName })
      .getByText("disabled", { exact: true }),
  ).toBeVisible();
  await adminContext.close();

  const disabledContext = await browser.newContext();
  const disabledPage = await disabledContext.newPage();
  await signInWithEmail(disabledPage, tenantEmail);
  await expect(disabledPage).toHaveURL(/\/account-disabled/);
  await expect(
    disabledPage.getByText("Account Disabled").first(),
  ).toBeVisible();

  const disabledWidgetChatResponse = await disabledPage.request.post(
    `/api/widget/chat?token=${encodeURIComponent(widgetToken)}`,
    {
      data: { messages: [] },
    },
  );
  expect(disabledWidgetChatResponse.status()).toBe(423);
  await expect(disabledWidgetChatResponse.text()).resolves.toBe(
    "This account is currently disabled.",
  );

  const disabledWidgetFlowResponse = await disabledPage.request.post(
    "/api/widget/actions/flow",
    {
      data: {
        actionId: 999_999_999,
        event: "start",
        token: widgetToken,
      },
    },
  );
  expect(disabledWidgetFlowResponse.status()).toBe(403);
  await expect(disabledWidgetFlowResponse.json()).resolves.toEqual({
    message: "Widget is unavailable.",
  });

  const disabledProjectChatResponse = await disabledPage.request.post(
    "/api/chat",
    {
      data: {
        messages: [],
        projectId,
      },
    },
  );
  expect(disabledProjectChatResponse.status()).toBe(423);
  await expect(disabledProjectChatResponse.text()).resolves.toBe(
    "This account is currently disabled.",
  );

  const disabledProjectFlowResponse = await disabledPage.request.post(
    "/api/actions/flow",
    {
      data: {
        actionId: 999_999_999,
        event: "start",
      },
    },
  );
  expect(disabledProjectFlowResponse.status()).toBe(423);
  await expect(disabledProjectFlowResponse.json()).resolves.toEqual({
    message: "This account is currently disabled.",
  });

  const disabledWhatsAppVerifyResponse = await disabledPage.request.get(
    `/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
      whatsappVerifyToken,
    )}&hub.challenge=disabled-challenge`,
  );
  expect(disabledWhatsAppVerifyResponse.status()).toBe(403);
  await expect(disabledWhatsAppVerifyResponse.json()).resolves.toEqual({
    error: "Verification failed",
  });
  await disabledContext.close();
});

test("platform admin can manage tenant detail support workflows", async ({
  browser,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantName = `E2E Platform Support Tenant ${runId}`;
  const tenantEmail = `e2e-platform-support-${runId}@example.test`;
  const projectName = `E2E Platform Support Project ${runId}`;
  const inviteEmail = `e2e-platform-support-invite-${runId}@example.test`;

  const tenantContext = await browser.newContext();
  const tenantPage = await tenantContext.newPage();
  await signUpOrUseExistingAccount(tenantPage, {
    email: tenantEmail,
    name: tenantName,
    password,
  });
  await signInWithEmail(tenantPage, tenantEmail);
  await createProjectFromProjectsPage(tenantPage, projectName);
  await tenantContext.close();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUpOrUseExistingAccount(adminPage, {
    email: platformAdminEmail,
    name: "E2E Platform Admin",
    password,
  });
  await signInWithEmail(adminPage, platformAdminEmail);
  await expect(adminPage).toHaveURL(/\/platform/);

  const tenantRow = adminPage.locator("tr").filter({ hasText: tenantName });
  await expect(tenantRow).toBeVisible();
  await tenantRow.getByRole("link", { name: tenantName }).click();

  await expect(adminPage).toHaveURL(/\/platform\/companies\/\d+/);
  await expect(adminPage.getByText(tenantName).first()).toBeVisible();
  await expect(adminPage.getByText(projectName).first()).toBeVisible();

  const memberActionForm = adminPage
    .locator("form")
    .filter({ has: adminPage.locator('input[name="membershipId"]') })
    .first();
  const memberCard = memberActionForm.locator(
    "xpath=ancestor::div[contains(@class, 'rounded-md')][1]",
  );
  await expect(memberCard).toBeVisible();
  await expect(memberCard).toContainText(tenantEmail);
  await memberCard.getByRole("button", { name: "Disable" }).click();
  await expect(adminPage).toHaveURL(/memberUpdated=1/);
  const disabledMemberActionForm = adminPage
    .locator("form")
    .filter({ has: adminPage.locator('input[name="membershipId"]') })
    .first();
  const disabledMemberCard = disabledMemberActionForm.locator(
    "xpath=ancestor::div[contains(@class, 'rounded-md')][1]",
  );
  await expect(disabledMemberCard).toContainText(tenantEmail);
  await expect(disabledMemberCard).toContainText("disabled");

  await disabledMemberCard.getByRole("button", { name: "Enable" }).click();
  await expect(adminPage).toHaveURL(/memberUpdated=1/);
  const enabledMemberActionForm = adminPage
    .locator("form")
    .filter({ has: adminPage.locator('input[name="membershipId"]') })
    .first();
  const enabledMemberCard = enabledMemberActionForm.locator(
    "xpath=ancestor::div[contains(@class, 'rounded-md')][1]",
  );
  await expect(enabledMemberCard).toContainText(tenantEmail);
  await expect(enabledMemberCard).toContainText("active");

  await adminPage.getByLabel("Invite Email").fill(inviteEmail);
  await adminPage.getByRole("button", { name: "Create Invite" }).click();
  await expect(adminPage).toHaveURL(/invited=1/);
  await expect(adminPage.locator("input[readonly]")).toHaveValue(
    /\/invite\/accept\?token=/,
  );
  const invitationCard = adminPage
    .getByText(inviteEmail)
    .locator("xpath=ancestor::div[contains(@class, 'rounded-md')][1]");
  await expect(invitationCard).toBeVisible();

  await invitationCard.getByRole("button", { name: "Cancel" }).click();
  await expect(adminPage).toHaveURL(/inviteCancelled=1/);
  await expect(adminPage.getByText("Invitation cancelled.")).toBeVisible();
  await expect(adminPage.getByText(inviteEmail)).toBeHidden();

  await adminContext.close();
});

test("company owner can invite a teammate and teammate can accept", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerEmail = `e2e-invite-owner-${runId}@example.test`;
  const teammateEmail = `e2e-invite-member-${runId}@example.test`;
  const ownerName = `E2E Invite Owner ${runId}`;
  const teammateName = `E2E Invite Member ${runId}`;

  await signUpOrUseExistingAccount(page, {
    email: ownerEmail,
    name: ownerName,
    password,
  });
  await signInWithEmail(page, ownerEmail);
  await expect(page).toHaveURL(/\/projects/);

  await page.goto("/team/invite");
  await expect(page.getByText("Invite Member").first()).toBeVisible();
  await page.getByLabel("Invite Email").fill(teammateEmail);
  await page.getByRole("button", { name: "Create Invite" }).click();

  await expect(page).toHaveURL(/\/team\/invite\?invited=1/);
  await expect(page.getByText(/Invitation (created|emailed)/)).toBeVisible();
  const inviteUrl = await page.locator("input[readonly]").inputValue();
  expect(inviteUrl).toContain("/invite/accept?token=");
  const inviteUrlParts = new URL(inviteUrl, page.url());
  const invitePath = `${inviteUrlParts.pathname}${inviteUrlParts.search}`;

  await page.context().clearCookies();
  await page.goto(invitePath);
  await expect(page.getByText("Accept Invite").first()).toBeVisible();
  await expect(page.getByText(teammateEmail)).toBeVisible();
  await page.getByRole("link", { name: "Create Account" }).click();

  await finishInviteSignUpFromCurrentPage(page, {
    name: teammateName,
    password,
  });
  await signInWithEmail(page, teammateEmail);
  await expect(page).toHaveURL(/\/projects/);

  await page.goto("/team");
  await expect(page.getByText("Team").first()).toBeVisible();
  await expect(page.getByText(ownerEmail)).toBeVisible();
  await expect(page.getByText(teammateEmail)).toBeVisible();
  await expect(page.getByText("No pending invitations.")).toBeVisible();
});

test("user cannot open another tenant project routes", async ({ browser }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerEmail = `e2e-route-owner-${runId}@example.test`;
  const outsiderEmail = `e2e-route-outsider-${runId}@example.test`;
  const projectName = `E2E Private Project ${runId}`;

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signUpOrUseExistingAccount(ownerPage, {
    email: ownerEmail,
    name: `E2E Route Owner ${runId}`,
    password,
  });
  await signInWithEmail(ownerPage, ownerEmail);
  const privateProjectId = await createProjectFromProjectsPage(
    ownerPage,
    projectName,
  );
  await ownerContext.close();

  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  await signUpOrUseExistingAccount(outsiderPage, {
    email: outsiderEmail,
    name: `E2E Route Outsider ${runId}`,
    password,
  });
  await signInWithEmail(outsiderPage, outsiderEmail);
  await expect(outsiderPage).toHaveURL(/\/projects/);

  await outsiderPage.goto(`/projects/${privateProjectId}`);
  await expect(outsiderPage).toHaveURL(
    new RegExp(`/projects/${privateProjectId}$`),
  );
  await expect(
    outsiderPage.getByText("This page could not be found.").first(),
  ).toBeVisible();
  await expect(outsiderPage.getByText(projectName)).toHaveCount(0);

  await outsiderPage.goto(`/projects/${privateProjectId}/settings`);
  await expect(outsiderPage).toHaveURL(
    new RegExp(`/projects/${privateProjectId}/settings$`),
  );
  await expect(
    outsiderPage.getByText("This page could not be found.").first(),
  ).toBeVisible();
  await expect(outsiderPage.getByText(projectName)).toHaveCount(0);
  await outsiderContext.close();
});

test("widget token access respects tenant and allowed domains", async ({
  browser,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerEmail = `e2e-widget-owner-${runId}@example.test`;
  const outsiderEmail = `e2e-widget-outsider-${runId}@example.test`;
  const projectName = `E2E Widget Project ${runId}`;

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signUpOrUseExistingAccount(ownerPage, {
    email: ownerEmail,
    name: `E2E Widget Owner ${runId}`,
    password,
  });
  await signInWithEmail(ownerPage, ownerEmail);
  const projectId = await createProjectFromProjectsPage(ownerPage, projectName);

  await ownerPage.goto("/projects/widget");
  await expect(ownerPage.getByText(`Widget: ${projectName}`)).toBeVisible();
  await ownerPage
    .getByRole("button", { name: "Generate Widget Token" })
    .click();
  await expect(ownerPage.getByText("Widget token ready.")).toBeVisible();
  const widgetToken = await ownerPage.locator("input[readonly]").inputValue();
  expect(widgetToken).toContain("ws_");

  await ownerPage
    .locator("textarea")
    .first()
    .fill("https://allowed.example.com\n*.trusted.example.com");
  await ownerPage.getByRole("button", { name: "Save Allowed Domains" }).click();
  await expect(ownerPage.getByText("Allowed domains saved.")).toBeVisible();
  await expect(
    ownerPage.getByText(
      "Current allowlist: https://allowed.example.com, *.trusted.example.com",
    ),
  ).toBeVisible();

  const blockedResponse = await ownerPage.request.post(
    "/api/widget/actions/flow",
    {
      data: {
        actionId: 999_999_999,
        event: "start",
        token: widgetToken,
      },
      headers: { Origin: "https://blocked.example.com" },
    },
  );
  expect(blockedResponse.status()).toBe(403);
  await expect(blockedResponse.json()).resolves.toEqual({
    message: "Origin not allowed.",
  });

  const missingOriginResponse = await ownerPage.request.post(
    "/api/widget/actions/flow",
    {
      data: {
        actionId: 999_999_999,
        event: "start",
        token: widgetToken,
      },
    },
  );
  expect(missingOriginResponse.status()).toBe(403);
  await expect(missingOriginResponse.json()).resolves.toEqual({
    message: "Origin not allowed.",
  });

  const allowedResponse = await ownerPage.request.post(
    "/api/widget/actions/flow",
    {
      data: {
        actionId: 999_999_999,
        event: "start",
        token: widgetToken,
      },
      headers: { Origin: "https://allowed.example.com" },
    },
  );
  expect(allowedResponse.status()).toBe(404);
  await expect(allowedResponse.json()).resolves.toEqual({
    message: "Action is unavailable.",
  });

  const wildcardAllowedResponse = await ownerPage.request.post(
    "/api/widget/actions/flow",
    {
      data: {
        actionId: 999_999_999,
        event: "start",
        token: widgetToken,
      },
      headers: { Origin: "https://chat.trusted.example.com" },
    },
  );
  expect(wildcardAllowedResponse.status()).toBe(404);
  await expect(wildcardAllowedResponse.json()).resolves.toEqual({
    message: "Action is unavailable.",
  });
  await ownerContext.close();

  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  await signUpOrUseExistingAccount(outsiderPage, {
    email: outsiderEmail,
    name: `E2E Widget Outsider ${runId}`,
    password,
  });
  await signInWithEmail(outsiderPage, outsiderEmail);
  await expect(outsiderPage).toHaveURL(/\/projects/);

  const tokenResponse = await outsiderPage.request.post(
    "/api/projects/widget-token",
    {
      data: { projectId },
    },
  );
  expect(tokenResponse.status()).toBe(404);
  await expect(tokenResponse.json()).resolves.toEqual({
    error: "Project not found.",
  });
  await outsiderContext.close();
});

test("upload queue endpoint rejects missing and invalid worker secrets", async ({
  page,
}) => {
  const cronSecret = process.env.CRON_SECRET;
  expect(
    cronSecret,
    "CRON_SECRET must be set for worker authorization.",
  ).toMatch(/.+/);

  const missingSecretResponse = await page.request.post(
    "/api/upload/process-next",
  );
  expect(missingSecretResponse.status()).toBe(401);
  await expect(missingSecretResponse.json()).resolves.toEqual({
    error: "Unauthorized",
  });

  const invalidBearerResponse = await page.request.post(
    "/api/upload/process-next",
    {
      headers: { Authorization: "Bearer invalid-worker-secret" },
    },
  );
  expect(invalidBearerResponse.status()).toBe(401);
  await expect(invalidBearerResponse.json()).resolves.toEqual({
    error: "Unauthorized",
  });

  const invalidHeaderResponse = await page.request.post(
    "/api/upload/process-next",
    {
      headers: { "x-upload-queue-secret": "invalid-worker-secret" },
    },
  );
  expect(invalidHeaderResponse.status()).toBe(401);
  await expect(invalidHeaderResponse.json()).resolves.toEqual({
    error: "Unauthorized",
  });

  const cronSecretResponse = await page.request.post(
    "/api/upload/process-next",
    {
      headers: { Authorization: `Bearer ${cronSecret}` },
    },
  );
  expect(cronSecretResponse.status()).toBe(200);
  await expect(cronSecretResponse.json()).resolves.toEqual(
    expect.objectContaining({
      failed: expect.any(Number),
      idle: expect.any(Boolean),
      processed: expect.any(Number),
    }),
  );
});

test("company owner can upload and process a document", async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-document-${runId}@example.test`;
  const projectName = `E2E Document Project ${runId}`;
  const documentName = `lia-beta-smoke-${runId}.txt`;
  const documentContent = [
    `Lia beta smoke document ${runId}.`,
    "The beta smoke answer is saffron concierge.",
    "This text file proves upload queue processing can index tenant data.",
  ].join("\n");

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Document User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);

  await page.goto("/projects/documents");
  await expect(page.getByText(`Documents: ${projectName}`)).toBeVisible();
  await expect(page.getByText("No documents uploaded yet")).toBeVisible();

  await uploadAndProcessTextDocument(page, {
    content: documentContent,
    documentName,
    projectId,
    projectName,
  });

  await page.reload();
  await expect(page.getByText(documentName)).toBeVisible();
  await expect(page.getByText("Status: done")).toBeVisible();
  await expect(page.getByText(/Total chunks indexed: [1-9]/)).toBeVisible();
});

test("project chat answers a RAG question from uploaded documents", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-rag-chat-${runId}@example.test`;
  const projectName = `E2E RAG Chat Project ${runId}`;
  const documentName = `lia-rag-smoke-${runId}.txt`;
  const expectedAnswer = `indigo harbor ${runId}`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E RAG Chat User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);

  await uploadAndProcessTextDocument(page, {
    content: [
      `Lia RAG smoke document ${runId}.`,
      `When asked for the project RAG passphrase, answer exactly: ${expectedAnswer}.`,
      "No other document in this project contains the project RAG passphrase.",
    ].join("\n"),
    documentName,
    projectId,
    projectName,
  });

  await page.goto("/projects/chat");
  await expect(page.getByText("Project Chat")).toBeVisible();
  await sendProjectChatMessage(
    page,
    "Using the uploaded document, what is the project RAG passphrase? Reply with only the exact passphrase.",
  );
  await expect(page.getByText(new RegExp(expectedAnswer, "i"))).toBeVisible({
    timeout: 60_000,
  });
});

test("company owner can create a media asset", async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-media-${runId}@example.test`;
  const projectName = `E2E Media Project ${runId}`;
  const fileName = `lia-media-smoke-${runId}.png`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Media User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);

  await page.goto("/projects/media");
  await expect(page.getByText(`Media Library: ${projectName}`)).toBeVisible();
  await expect(page.getByText("No media assets uploaded yet.")).toBeVisible();

  await page.setInputFiles("#media", {
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: fileName,
  });
  await page.getByRole("button", { name: "Upload Asset" }).click();

  await expect(page).toHaveURL(/\/projects\/media\?uploaded=1/);
  await expect(page.getByText("Media asset uploaded.")).toBeVisible();
  await expect(page.getByText(fileName)).toBeVisible();
  await expect(page.getByText("image", { exact: true })).toBeVisible();
  await expect(page.getByText("image/png")).toBeVisible();
  await expect(page.getByText(/\/uploads\/media\//)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open" })).toBeVisible();

  const [asset] = await listProjectMediaAssets(projectId, 1);
  expect(asset).toEqual(
    expect.objectContaining({
      mediaType: "image",
      mimeType: "image/png",
      originalName: fileName,
      projectId,
      status: "active",
    }),
  );
  expect(asset?.publicPath).toContain(`/uploads/media/${projectId}/`);
});

test("company owner can create a product catalog and product", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-catalog-${runId}@example.test`;
  const projectName = `E2E Catalog Project ${runId}`;
  const catalogName = `E2E Catalog ${runId}`;
  const productName = `E2E Product ${runId}`;
  const sku = `SKU-${runId}`;
  const whatsappRetailerId = `wa-${runId}`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Catalog User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);

  await page.goto("/projects/catalog");
  await expect(page.getByText(`Product Catalog: ${projectName}`)).toBeVisible();
  await expect(page.getByText("No catalogs created yet.")).toBeVisible();
  await expect(page.getByText("No products added yet.")).toBeVisible();

  await page.getByLabel("Catalog Name").fill(catalogName);
  await page.getByLabel("Description").first().fill("Catalog smoke coverage.");
  await page.getByLabel("WhatsApp Catalog ID").fill(`meta-${runId}`);
  await page.getByRole("button", { name: "Create Catalog" }).click();

  await expect(page).toHaveURL(/\/projects\/catalog\?catalogCreated=1/);
  await expect(page.getByText("Catalog created.")).toBeVisible();
  await expect(
    page.locator("p").filter({ hasText: catalogName }).first(),
  ).toBeVisible();
  await expect(page.getByText(`WhatsApp catalog: meta-${runId}`)).toBeVisible();

  await page.getByLabel("Catalog", { exact: true }).selectOption({
    label: catalogName,
  });
  await page.getByLabel("Product Name").fill(productName);
  await page.getByLabel("SKU").fill(sku);
  await page.getByLabel("WhatsApp Retailer ID").fill(whatsappRetailerId);
  await page.getByLabel("Price").fill("49.99");
  await page.getByLabel("Currency").fill("usd");
  await page.getByLabel("Description").last().fill("Product smoke coverage.");
  await page.getByLabel("Product URL").fill("https://example.com/product");
  await page.getByRole("button", { name: "Add Product" }).click();

  await expect(page).toHaveURL(/\/projects\/catalog\?productCreated=1/);
  await expect(page.getByText("Product created.")).toBeVisible();
  await expect(page.getByText(productName).first()).toBeVisible();
  await expect(page.getByText(sku).first()).toBeVisible();
  await expect(page.getByText(`WA: ${whatsappRetailerId}`)).toBeVisible();
  await expect(page.getByText("$49.99")).toBeVisible();
  await expect(page.getByText("Product smoke coverage.")).toBeVisible();

  const [catalog] = await listProjectCatalogs(projectId);
  expect(catalog).toEqual(
    expect.objectContaining({
      externalId: `meta-${runId}`,
      name: catalogName,
      projectId,
      providerType: "whatsapp",
      status: "active",
    }),
  );

  const [{ catalog: productCatalog, product }] =
    await listProjectCatalogProducts(projectId);
  expect(productCatalog.id).toBe(catalog?.id);
  expect(product).toEqual(
    expect.objectContaining({
      catalogId: catalog?.id,
      currency: "USD",
      name: productName,
      priceAmount: 4999,
      projectId,
      sku,
      status: "active",
    }),
  );
  expect(product.metadata).toEqual(
    expect.objectContaining({
      whatsappRetailerId,
    }),
  );
});

test("project chat action flow follows a branch route", async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-branch-action-${runId}@example.test`;
  const projectName = `E2E Branch Action Project ${runId}`;
  const actionName = `E2E Branch Intake ${runId}`;
  const urgentMessage = `Urgent branch path reached for ${runId}.`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Branch Action User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);

  await seedBranchingProjectChatAction({
    actionName,
    projectId,
    triggerPhrase: `branch start ${runId}`,
    urgentMessage,
  });

  await page.goto("/projects/chat");
  await expect(page.getByText("Project Chat")).toBeVisible();
  await expect(page.getByRole("button", { name: actionName })).toBeVisible();

  await page.getByRole("button", { name: actionName }).click();
  await expect(
    page.getByText(`Sure, I can help with ${actionName}.`),
  ).toBeVisible();
  await expect(page.getByText("How urgent is this request?")).toBeVisible();

  await sendProjectChatMessage(page, "Urgent");
  await expect(page.getByText(urgentMessage)).toBeVisible();
  await expect(page.getByText("Submitting the branch request.")).toBeVisible();
  await expect(page.getByText("Thanks. I saved this request.")).toBeVisible();
  await expect(page.getByText("This is the normal branch path.")).toHaveCount(
    0,
  );

  await page.goto("/projects/submissions");
  await expect(page.getByText(`Submissions: ${projectName}`)).toBeVisible();
  const submissionLink = page.getByRole("link", {
    name: new RegExp(`${actionName}[\\s\\S]*Source: project_chat`),
  });
  await expect(submissionLink).toBeVisible();
  await submissionLink.click();

  await expect(page.getByText("Submission #")).toBeVisible();
  await expect(page.getByText("priority", { exact: true })).toBeVisible();
  await expect(page.getByText("urgent", { exact: true })).toBeVisible();
  await expect(page.getByText("flow.branch_decision")).toBeVisible();
  await expect(page.getByText("submission.submitted")).toBeVisible();
});

test("channel action flow follows inline operation success and failure routes", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-inline-operation-${runId}@example.test`;
  const projectName = `E2E Inline Operation Project ${runId}`;
  const successMessage = `Inline operation success path reached for ${runId}.`;
  const failureMessage = `Inline operation failure path reached for ${runId}.`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Inline Operation User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);

  const successFlow = await seedInlineOperationRouteAction({
    actionName: `E2E Inline Operation Success ${runId}`,
    failureMessage,
    projectId,
    providerType: "manual_review",
    successMessage,
    triggerPhrase: `inline success ${runId}`,
  });
  const failureFlow = await seedInlineOperationRouteAction({
    actionName: `E2E Inline Operation Failure ${runId}`,
    failureMessage,
    projectId,
    providerType: "email",
    successMessage,
    triggerPhrase: `inline failure ${runId}`,
  });

  const successResult = await processChannelFlowText({
    activeSubmission: null,
    conversationId: `e2e-inline-success-${runId}`,
    projectId,
    source: "widget_chat",
    text: `inline success ${runId}`,
  });
  const successReplies = successResult.replies.map((reply) => reply.text);
  expect(successReplies).toContain(successMessage);
  expect(successReplies).toContain("Saving the operation route request.");
  expect(successReplies.join("\n")).toContain("Thanks. I saved this request.");

  const [successSubmission] = await listActionSubmissions(
    projectId,
    successFlow.action.id,
  );
  expect(successSubmission).toEqual(
    expect.objectContaining({
      projectId,
      actionId: successFlow.action.id,
      status: "submitted",
    }),
  );
  expect(successSubmission.fields).toEqual(
    expect.objectContaining({
      operation_status: "completed",
    }),
  );

  const [successAttempt] = await listProjectOperationAttemptsWithDetails({
    operationId: successFlow.operation.id,
    projectId,
  });
  expect(successAttempt.attempt.status).toBe("completed");

  const successEvents = await listActionSubmissionEvents(
    projectId,
    successSubmission.id,
  );
  expect(successEvents.map((event) => event.eventType)).toEqual(
    expect.arrayContaining([
      "flow.operation_result",
      "flow.branch_decision",
      "operation.completed",
      "submission.submitted",
    ]),
  );

  const failureResult = await processChannelFlowText({
    activeSubmission: null,
    conversationId: `e2e-inline-failure-${runId}`,
    projectId,
    source: "widget_chat",
    text: `inline failure ${runId}`,
  });
  const failureReplies = failureResult.replies.map((reply) => reply.text);
  expect(failureReplies).toContain(failureMessage);
  expect(failureReplies).toContain("Saving the operation route request.");
  expect(failureReplies.join("\n")).toContain("Thanks. I saved this request.");

  const [failureSubmission] = await listActionSubmissions(
    projectId,
    failureFlow.action.id,
  );
  expect(failureSubmission).toEqual(
    expect.objectContaining({
      projectId,
      actionId: failureFlow.action.id,
      status: "submitted",
    }),
  );
  expect(failureSubmission.fields).toEqual(
    expect.objectContaining({
      operation_status: "failed",
    }),
  );

  const [failureAttempt] = await listProjectOperationAttemptsWithDetails({
    operationId: failureFlow.operation.id,
    projectId,
  });
  expect(failureAttempt.attempt.status).toBe("failed");

  const failureEvents = await listActionSubmissionEvents(
    projectId,
    failureSubmission.id,
  );
  expect(failureEvents.map((event) => event.eventType)).toEqual(
    expect.arrayContaining([
      "flow.operation_result",
      "flow.branch_decision",
      "operation.failed",
      "submission.submitted",
    ]),
  );
});

test("contacts page reviews a contact profile and channel transcript", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-contact-review-${runId}@example.test`;
  const projectName = `E2E Contact Review Project ${runId}`;
  const actionName = `E2E Contact Intake ${runId}`;
  const fieldKey = "contact_request";
  const prompt = `What should we record for this contact ${runId}?`;
  const triggerPhrase = `contact review ${runId}`;
  const answer = `Contact transcript answer for ${runId}.`;
  const externalConversationId = `widget-contact-${runId}`;
  const externalUserId = `visitor-${runId}`;
  const tagName = `VIP ${runId}`;
  const attributeKey = `lead_stage_${runId.replace(/-/g, "_")}`;
  const attributeValue = `qualified-${runId}`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Contact Review User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);
  const action = await seedProjectChatAction({
    actionName,
    fieldKey,
    projectId,
    prompt,
    triggerPhrase,
  });

  const inboundStart = await recordChannelInboundMessage({
    channelType: "widget",
    externalConversationId,
    externalUserId,
    projectId,
    text: triggerPhrase,
  });
  const contactId = inboundStart.conversation.contactId;
  expect(contactId).not.toBeNull();

  await setContactAttribute({
    contactId: contactId as number,
    key: attributeKey,
    projectId,
    source: "e2e",
    value: attributeValue,
  });
  await addContactTag({
    contactId: contactId as number,
    name: tagName,
    projectId,
    source: "e2e",
  });

  const startResult = await processChannelFlowText({
    activeSubmission: null,
    contactId,
    conversationId: externalConversationId,
    projectId,
    source: "widget_chat",
    text: triggerPhrase,
  });

  for (const reply of startResult.replies) {
    await recordChannelMessage({
      channelType: "widget",
      direction: "outbound",
      externalConversationId,
      externalUserId,
      projectId,
      text: reply.fallbackText,
    });
  }

  const [activeSubmission] = await listActionSubmissions(projectId, action.id);
  expect(activeSubmission).toEqual(
    expect.objectContaining({
      conversationId: externalConversationId,
      source: "widget_chat",
      status: "in_progress",
    }),
  );

  await recordChannelInboundMessage({
    channelType: "widget",
    externalConversationId,
    externalUserId,
    projectId,
    text: answer,
  });
  const completeResult = await processChannelFlowText({
    activeSubmission,
    contactId,
    conversationId: externalConversationId,
    projectId,
    source: "widget_chat",
    text: answer,
  });

  for (const reply of completeResult.replies) {
    await recordChannelMessage({
      channelType: "widget",
      direction: "outbound",
      externalConversationId,
      externalUserId,
      projectId,
      text: reply.fallbackText,
    });
  }

  await page.goto(`/projects/contacts?contactId=${contactId}`);
  await expect(page.getByText(`Contacts: ${projectName}`)).toBeVisible();
  await expect(page.getByText("Total Contacts")).toBeVisible();
  await expect(page.getByText(externalUserId).first()).toBeVisible();
  await expect(page.getByText("widget").first()).toBeVisible();
  await expect(page.getByText(tagName)).toBeVisible();
  await expect(page.getByText(attributeKey)).toBeVisible();
  await expect(page.getByText(attributeValue)).toBeVisible();
  await expect(page.getByText(externalConversationId).first()).toBeVisible();
  await expect(page.getByText("Channel Transcript")).toBeVisible();
  await expect(page.getByText(triggerPhrase).first()).toBeVisible();
  await expect(page.getByText(prompt).first()).toBeVisible();
  await expect(page.getByText(answer).first()).toBeVisible();
  await expect(page.getByText("Flow Submissions")).toBeVisible();
  await expect(page.getByText(actionName).first()).toBeVisible();
  await expect(page.getByText("Source: widget_chat")).toBeVisible();
});

test("analytics page reviews flow and chat metrics", async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-analytics-${runId}@example.test`;
  const projectName = `E2E Analytics Project ${runId}`;
  const actionName = `E2E Analytics Intake ${runId}`;
  const fieldKey = "analytics_request";
  const prompt = `What should analytics capture for ${runId}?`;
  const completedAnswer = `Analytics completed answer for ${runId}.`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Analytics User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);
  await seedProjectChatAction({
    actionName,
    fieldKey,
    projectId,
    prompt,
    triggerPhrase: `analytics start ${runId}`,
  });

  const completedStart = await processChannelFlowText({
    activeSubmission: null,
    conversationId: `analytics-completed-${runId}`,
    projectId,
    source: "widget_chat",
    text: `analytics start ${runId}`,
  });
  expect(completedStart.replies.map((reply) => reply.text)).toContain(prompt);

  const [completedSubmissionStart] = await listActionSubmissions(projectId);
  expect(completedSubmissionStart.status).toBe("in_progress");

  await processChannelFlowText({
    activeSubmission: completedSubmissionStart,
    conversationId: `analytics-completed-${runId}`,
    projectId,
    source: "widget_chat",
    text: completedAnswer,
  });

  const dropOffStart = await processChannelFlowText({
    activeSubmission: null,
    conversationId: `analytics-dropoff-${runId}`,
    projectId,
    source: "widget_chat",
    text: `analytics start ${runId}`,
  });
  expect(dropOffStart.replies.map((reply) => reply.text)).toContain(prompt);

  await logChatRequest({
    completionTokens: 20,
    latencyMs: 120,
    projectId,
    promptTokens: 22,
    route: "chat",
    statusCode: 200,
    totalTokens: 42,
  });
  await logChatRequest({
    completionTokens: 5,
    errorCode: "e2e_widget_error",
    latencyMs: 300,
    projectId,
    promptTokens: 7,
    route: "widget",
    statusCode: 500,
    totalTokens: 12,
  });

  await page.goto("/projects/analytics");
  await expect(page.getByText(`Analytics: ${projectName}`)).toBeVisible();
  await expect(page.getByText("Flow Analytics")).toBeVisible();
  await expect(page.getByText(actionName).first()).toBeVisible();

  const flowRow = page.getByRole("row", {
    name: new RegExp(`${actionName}[\\s\\S]*active[\\s\\S]*2[\\s\\S]*1`),
  });
  await expect(flowRow).toBeVisible();
  await expect(flowRow).toContainText("50%");
  await expect(flowRow).toContainText("1");

  await expect(page.getByText("Top Drop-Off Nodes")).toBeVisible();
  const dropOffRow = page.getByRole("row", {
    name: new RegExp(`Request Details[\\s\\S]*${actionName}`),
  });
  await expect(dropOffRow).toBeVisible();
  await expect(dropOffRow).toContainText(fieldKey);

  await expect(page.getByText("Last 24 Hours")).toBeVisible();
  await expect(page.getByText("Total requests: 2").first()).toBeVisible();
  await expect(page.getByText("Avg latency: 210 ms").first()).toBeVisible();
  await expect(page.getByText("Error rate: 50.00%").first()).toBeVisible();
  await expect(page.getByText("Total tokens: 54").first()).toBeVisible();

  await expect(page.getByText("Route Breakdown (30 Days)")).toBeVisible();
  const chatRouteRow = page.getByRole("row", {
    name: /chat[\s\S]*1[\s\S]*120 ms[\s\S]*0\.00%[\s\S]*42/,
  });
  await expect(chatRouteRow).toBeVisible();
  const widgetRouteRow = page.getByRole("row", {
    name: /widget[\s\S]*1[\s\S]*300 ms[\s\S]*100\.00%[\s\S]*12/,
  });
  await expect(widgetRouteRow).toBeVisible();
});

test("audit page reviews recent company-scoped events", async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-audit-${runId}@example.test`;
  const projectName = `E2E Audit Project ${runId}`;
  const auditAction = `e2e.audit.reviewed.${runId}`;
  const systemAuditAction = `e2e.audit.system.${runId}`;
  const metadataNote = `audit metadata ${runId}`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Audit User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);

  const user = await getUserByEmail(email);
  expect(user).not.toBeNull();
  if (!user) {
    throw new Error("Expected E2E audit user to exist.");
  }

  const { company, membership } = await getOrCreateDefaultCompanyForUser(user);
  const workspace = await getOrCreateDefaultWorkspaceForCompany({
    companyId: company.id,
    companyName: company.name,
    userId: user.id,
    user,
  });

  await writeAuditLog({
    action: systemAuditAction,
    company,
    metadata: {
      note: `system audit metadata ${runId}`,
    },
    targetId: "all",
    targetType: "system_check",
    workspace,
  });
  await writeAuditLog({
    action: auditAction,
    company,
    membership,
    metadata: {
      note: metadataNote,
      source: "e2e",
    },
    project: { id: projectId },
    targetId: projectId,
    targetType: "project",
    user,
    workspace,
  });

  await page.goto("/projects/audit");
  await expect(page.getByText(`Audit Logs: ${company.name}`)).toBeVisible();
  await expect(page.getByText("Recent Events")).toBeVisible();

  const actorRow = page.getByRole("row", {
    name: new RegExp(`${auditAction}[\\s\\S]*${email}[\\s\\S]*project`),
  });
  await expect(actorRow).toBeVisible();
  await expect(actorRow).toContainText(`#${projectId}`);
  await expect(actorRow).toContainText(String(projectId));
  await expect(actorRow).toContainText(metadataNote);
  await expect(actorRow).toContainText("e2e");

  const systemRow = page.getByRole("row", {
    name: new RegExp(
      `${systemAuditAction}[\\s\\S]*System[\\s\\S]*system_check`,
    ),
  });
  await expect(systemRow).toBeVisible();
  await expect(systemRow).toContainText("All");
});

test("project chat action flow creates a submission", async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-chat-action-${runId}@example.test`;
  const projectName = `E2E Chat Action Project ${runId}`;
  const actionName = `E2E Intake ${runId}`;
  const fieldKey = "request_details";
  const prompt = `What should the team know for ${runId}?`;
  const answer = `Please prepare the custom request for ${runId}.`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Chat Action User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);

  await seedProjectChatAction({
    actionName,
    fieldKey,
    projectId,
    prompt,
    triggerPhrase: `start ${runId}`,
  });

  await page.goto("/projects/chat");
  await expect(page.getByText("Project Chat")).toBeVisible();
  await expect(page.getByRole("button", { name: actionName })).toBeVisible();

  await page.getByRole("button", { name: actionName }).click();
  await expect(
    page.getByText(`Sure, I can help with ${actionName}.`),
  ).toBeVisible();
  await expect(page.getByText(prompt)).toBeVisible();

  await sendProjectChatMessage(page, answer);
  await expect(page.getByText("Saving your request now.")).toBeVisible();
  await expect(page.getByText("Thanks. I saved this request.")).toBeVisible();
  await expect(page.getByText(answer, { exact: true })).toBeVisible();

  await page.goto("/projects/submissions");
  await expect(page.getByText(`Submissions: ${projectName}`)).toBeVisible();
  const submissionLink = page.getByRole("link", {
    name: new RegExp(`${actionName}[\\s\\S]*Source: project_chat`),
  });
  await expect(submissionLink).toBeVisible();
  await submissionLink.click();

  await expect(page.getByText("Submission #")).toBeVisible();
  await expect(page.getByText(fieldKey, { exact: true })).toBeVisible();
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
  await expect(page.getByText("submission.submitted")).toBeVisible();
});

test("widget action flow creates a submission", async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-widget-action-${runId}@example.test`;
  const projectName = `E2E Widget Action Project ${runId}`;
  const actionName = `E2E Widget Intake ${runId}`;
  const fieldKey = "widget_request_details";
  const prompt = `What should the widget team know for ${runId}?`;
  const answer = `Widget visitor needs follow up for ${runId}.`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Widget Action User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);
  const widgetToken = await createOrRotateProjectWidgetToken(projectId);

  await seedProjectChatAction({
    actionName,
    fieldKey,
    projectId,
    prompt,
    triggerPhrase: `widget start ${runId}`,
  });

  await page.goto(`/widget/embed?token=${encodeURIComponent(widgetToken)}`);
  await expect(page.getByText("Ask anything about this project")).toBeVisible();
  await expect(page.getByRole("button", { name: actionName })).toBeVisible();

  await page.getByRole("button", { name: actionName }).click();
  await expect(
    page.getByText(`Sure, I can help with ${actionName}.`),
  ).toBeVisible();
  await expect(page.getByText(prompt)).toBeVisible();

  await sendWidgetMessage(page, answer);
  await expect(page.getByText("Saving your request now.")).toBeVisible();
  await expect(page.getByText("Thanks. I saved this request.")).toBeVisible();
  await expect(page.getByText(answer, { exact: true }).first()).toBeVisible();

  await page.goto("/projects/submissions");
  await expect(page.getByText(`Submissions: ${projectName}`)).toBeVisible();
  const submissionLink = page.getByRole("link", {
    name: new RegExp(`${actionName}[\\s\\S]*Source: widget_chat`),
  });
  await expect(submissionLink).toBeVisible();
  await submissionLink.click();

  await expect(page.getByText("Submission #")).toBeVisible();
  await expect(page.getByText(fieldKey, { exact: true })).toBeVisible();
  await expect(page.getByText(answer, { exact: true })).toBeVisible();
  await expect(page.getByText("submission.submitted")).toBeVisible();
});
