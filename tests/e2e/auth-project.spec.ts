import { expect, type Page, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { getDraftRuntimeChangeSummary } from "../../src/lib/action-flow-version-diff";
import {
  countBlockingActionFlowIssues,
  createActionFlowBranchRule,
  createActionFlowStep,
  createProjectAction as createChatbotAction,
  createPublishedActionFlowVersion,
  getActionSubmission,
  getActiveActionSubmissionForConversation,
  getProjectAction,
  listActionFlowBranchRules,
  listActionFlowSteps,
  listActionSubmissionEvents,
  listActionSubmissions,
  updateActionFlowStep,
  validateActionFlowRoutes,
} from "../../src/lib/action-flows";
import { writeAuditLog } from "../../src/lib/audit";
import { runBrowserFlowMediaCommand } from "../../src/lib/browser-flow-media-command";
import { runBrowserFlowText } from "../../src/lib/browser-flow-runtime";
import {
  getChannelAdapterProfile,
  getChannelReplySupport,
  getRuntimeReplyCapability,
} from "../../src/lib/channel-adapter-contract";
import { processChannelFlowText } from "../../src/lib/channel-flow-runtime";
import {
  recordChannelInboundMessage,
  recordChannelMessage,
} from "../../src/lib/channels";
import { logChatRequest } from "../../src/lib/chat-logs";
import { getOrCreateDefaultCompanyForUser } from "../../src/lib/companies";
import { addContactTag, setContactAttribute } from "../../src/lib/contacts";
import { db } from "../../src/lib/db-config";
import { durableJobs } from "../../src/lib/db-schema";
import { getProjectSourceDocuments } from "../../src/lib/documents";
import { processProjectFlowResponsePolicyQueue } from "../../src/lib/durable-flow-response-policy";
import { processProjectFlowResumeQueue } from "../../src/lib/durable-flow-resume";
import { getFlowStepChannelCapabilityIssues } from "../../src/lib/flow-channel-capabilities";
import { listProjectMediaAssets } from "../../src/lib/media-assets";
import {
  createIntegrationProvider,
  createOperation,
  listProjectOperationAttemptsWithDetails,
  runOperationForSubmission,
} from "../../src/lib/operations";
import {
  listProjectCatalogProducts,
  listProjectCatalogs,
} from "../../src/lib/product-catalogs";
import { getUserByEmail } from "../../src/lib/users";
import {
  createWhatsAppChannelAdapter,
  upsertProjectWhatsAppChannel,
} from "../../src/lib/whatsapp";
import { createOrRotateProjectWidgetToken } from "../../src/lib/widget-keys";
import { getOrCreateDefaultWorkspaceForCompany } from "../../src/lib/workspaces";

const password = "TestPassword123!";

test("shared channel adapter contract describes capability parity", async () => {
  const buttonReply = {
    fallbackText: "Choose one\n\n1. First",
    payload: { options: [{ id: "first", label: "First", value: "first" }] },
    text: "Choose one",
    type: "buttons" as const,
  };
  const singleProductReply = {
    fallbackText: "Product",
    payload: { mode: "single_product", products: [] },
    text: "Product",
    type: "catalog" as const,
  };

  expect(getRuntimeReplyCapability(singleProductReply)).toBe("single_product");
  expect(getChannelReplySupport("project_chat", buttonReply)).toBe("native");
  expect(getChannelReplySupport("widget", buttonReply)).toBe("native");
  expect(getChannelReplySupport("whatsapp", buttonReply)).toBe("conditional");
  expect(getChannelAdapterProfile("whatsapp").limits).toEqual({
    buttonOptions: 3,
    listOptions: 10,
    productItems: 30,
  });

  const whatsappAdapter = createWhatsAppChannelAdapter();
  const nativeButtons = await whatsappAdapter.adaptReply({
    context: { serviceWindowOpen: true, to: "15550001111" },
    reply: buttonReply,
  });
  expect(nativeButtons.mode).toBe("native");
  expect(nativeButtons.delivery.body.type).toBe("interactive");

  const fallbackButtons = await whatsappAdapter.adaptReply({
    context: { serviceWindowOpen: true, to: "15550001111" },
    reply: {
      ...buttonReply,
      payload: {
        options: Array.from({ length: 4 }, (_, index) => ({
          id: `option-${index}`,
          label: `Option ${index}`,
          value: `option-${index}`,
        })),
      },
    },
  });
  expect(fallbackButtons.mode).toBe("fallback");
  expect(fallbackButtons.delivery.body.type).toBe("text");

  const buttonWarnings = getFlowStepChannelCapabilityIssues({
    id: 1,
    options: [],
    settings: {
      contentBlocks: [
        {
          displayMode: "buttons",
          id: "choice-1",
          options: ["One", "Two", "Three", "Four"],
          text: "Choose one",
          type: "choice",
        },
      ],
    },
    sortOrder: 1,
    stepType: "choice",
  });
  expect(buttonWarnings).toHaveLength(1);
  expect(buttonWarnings[0]?.message).toContain("3 native reply buttons");

  const listWarnings = getFlowStepChannelCapabilityIssues({
    id: 2,
    options: Array.from({ length: 11 }, (_, index) => `Option ${index}`),
    settings: { choiceDisplayMode: "list" },
    sortOrder: 2,
    stepType: "choice",
  });
  expect(listWarnings).toHaveLength(1);
  expect(listWarnings[0]?.message).toContain("10 native list rows");
});
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
  await page.getByRole("button", { name: "Create Account" }).click();

  const registeredError = page.getByText("Email is already registered.");
  await expect(
    registeredError.or(
      page.getByRole("button", { name: "Sign In with Email" }),
    ),
  ).toBeVisible();

  if (await registeredError.isVisible()) {
    return;
  }

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByText("Account created successfully. Please sign in."),
  ).toBeVisible();
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
    page.waitForURL(/\/sign-in(?:\?|$)/),
    page.getByRole("button", { name: "Create Account" }).click(),
  ]);
  await expect(page).toHaveURL(/\/sign-in$/);
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

  await expect(page).toHaveURL(/\/projects\/\d+$/);
  await expect(page.getByText("Project created.")).toBeVisible();
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

  await expect
    .poll(
      async () => {
        const processResponse = await page.request.post(
          "/api/upload/process-next",
          {
            headers: { Authorization: `Bearer ${cronSecret}` },
          },
        );
        expect(processResponse.status()).toBe(200);

        const [uploadedDocument] = await getProjectSourceDocuments(
          input.projectId,
          1,
        );
        return uploadedDocument?.title === input.documentName
          ? {
              hasChunks: Number(uploadedDocument.chunkCount) > 0,
              status: uploadedDocument.processingStatus,
            }
          : null;
      },
      { timeout: 30_000 },
    )
    .toEqual({
      hasChunks: true,
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

  const overviewUrl = page.url();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export", exact: true }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.json$/);
  expect(page.url()).toBe(overviewUrl);

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();

  const importConsoleErrors: string[] = [];
  const captureImportConsoleError = (message: {
    text: () => string;
    type: () => string;
  }) => {
    if (
      message.type() === "error" &&
      message.text().includes("Cannot specify a encType or method")
    ) {
      importConsoleErrors.push(message.text());
    }
  };
  page.on("console", captureImportConsoleError);
  await page.goto("/projects/actions/import");
  await expect(
    page.getByText(`Import Action Flow: ${projectName}`, { exact: true }),
  ).toBeVisible();
  expect(importConsoleErrors).toEqual([]);

  await page.getByLabel("Exported Flow JSON").setInputFiles(downloadPath ?? "");
  await page
    .getByLabel("Imported Action Name")
    .fill(`Imported Support Ticket ${runId}`);
  await page.getByRole("button", { name: "Import Flow" }).click();
  await expect(page).toHaveURL(/\/projects\/actions\/\d+\?created=1/);
  await expect(
    page.getByText(`Imported Support Ticket ${runId}`, { exact: true }).first(),
  ).toBeVisible();
  page.off("console", captureImportConsoleError);

  await page.goto("/projects/actions");
  await expect(page.getByText(`Actions: ${projectName}`)).toBeVisible();
  await expect(page.getByText("Create Support Ticket").first()).toBeVisible();
});

test("step creation keeps technical fields progressive and input-aware", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-message-step-${runId}@example.test`;
  const projectName = `E2E Message Step Project ${runId}`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Message Step User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  await createProjectFromProjectsPage(page, projectName);

  await page.goto("/projects/actions/new");
  await page.getByLabel("Action Name").fill(`E2E Message Flow ${runId}`);
  await page
    .getByLabel("Description")
    .fill("Checks the progressive step creation form.");
  await page.getByLabel("Trigger Phrases").fill("start message test");
  await page.getByRole("button", { name: "Create Action" }).click();

  await expect(page).toHaveURL(/\/projects\/actions\/\d+\?created=1/);
  await page.getByRole("link", { name: "Canvas", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/actions\/\d+\/canvas/);

  const palette = page.locator("aside").filter({ hasText: "Blocks" });
  await palette
    .getByRole("button", { name: /Message/ })
    .first()
    .click();

  const dialog = page.getByRole("dialog", { name: "Create Step" });
  await expect(dialog.getByLabel("Label")).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Enabled")).toBeVisible();
  await expect(dialog.getByPlaceholder("customerName")).not.toBeVisible();

  await dialog.getByRole("button", { name: /Advanced options/ }).click();
  await expect(dialog.getByPlaceholder("customerName")).toBeVisible();
  await expect(dialog.getByLabel("Input Type")).toBeVisible();
  await expect(dialog.getByText("Validation", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Close" }).click();
  const emailBlock = palette.getByRole("button", { name: /Ask Email/ });
  await emailBlock.scrollIntoViewIfNeeded();
  await emailBlock.click();

  await expect(
    dialog.getByText("Email address", { exact: true }).first(),
  ).toBeVisible();
  await expect(dialog.getByLabel("Email question")).toBeVisible();
  await expect(
    dialog.getByText("Answer format: Email address", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Answer required")).toBeChecked();
  await expect(dialog.getByLabel("Step active")).toBeChecked();
  await expect(dialog.getByLabel("Input Type")).not.toBeVisible();

  await dialog.getByRole("button", { name: /Advanced options/ }).click();
  await expect(dialog.getByLabel("Save answer as")).toBeVisible();
  await expect(dialog.getByLabel("When no answer is provided")).toBeVisible();
  await expect(dialog.getByLabel("When the answer is invalid")).toBeVisible();
  await expect(dialog.getByText(/valid email-address format/)).toBeVisible();
  await expect(dialog.getByLabel("Minimum characters")).toBeVisible();
  await expect(dialog.getByLabel("Minimum value")).not.toBeVisible();
  await expect(dialog.getByLabel("Earliest date")).not.toBeVisible();

  await dialog.getByLabel("Step name").fill("Contact Email");
  await dialog.getByLabel("Email question").fill("Where should we email you?");
  await dialog.getByLabel("Save answer as").fill("contactEmail");
  await dialog
    .getByRole("button", { name: "Create Step", exact: true })
    .click();

  const emailNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "Contact Email" });
  await expect(emailNode).toBeVisible();
  await expect(dialog).toBeHidden();
  await emailNode.getByText("Contact Email", { exact: true }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit Step" });
  await expect(
    editDialog.getByText("Email address", { exact: true }).first(),
  ).toBeVisible();
  await expect(editDialog.getByLabel("Email question").first()).toHaveValue(
    "Where should we email you?",
  );
  await editDialog.getByRole("button", { name: "Close" }).click();

  const mediaBlock = palette.getByRole("button", { name: /Ask Media/ });
  await mediaBlock.scrollIntoViewIfNeeded();
  await mediaBlock.click();
  await dialog.getByRole("button", { name: /Advanced options/ }).click();
  await expect(dialog.getByLabel("Allowed upload types")).toHaveValue("common");
  await dialog.getByLabel("Allowed upload types").selectOption("images");
  await expect(dialog.getByLabel("Allowed upload types")).toHaveValue("images");
});

test("action steps use friendly compact editors and preserve integration settings", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-action-editor-${runId}@example.test`;
  const projectName = `E2E Action Editor Project ${runId}`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Action Editor User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);
  const provider = await createIntegrationProvider({
    name: `E2E Booking API ${runId}`,
    projectId,
    providerType: "manual_review",
  });
  const operation = await createOperation({
    name: `E2E Create Booking ${runId}`,
    operationType: "manual_review",
    projectId,
    providerId: provider.id,
  });
  const action = await createChatbotAction({
    description: "Checks friendly action-family editing.",
    name: `E2E Friendly Actions ${runId}`,
    projectId,
    status: "draft",
    triggerPhrases: [],
  });
  const submitStep = await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Finish request",
    projectId,
    prompt: "Your request is saved.",
    sortOrder: 2,
    stepType: "submit",
  });
  await createActionFlowStep({
    actionId: action.id,
    fieldKey: "booking_status",
    isRequired: false,
    label: "Create booking",
    operationId: operation.id,
    projectId,
    settings: { operationExecutionMode: "post_submit" },
    sortOrder: 1,
    stepType: "operation",
  });

  await page.goto(`/projects/actions/${action.id}/canvas`);
  const palette = page.locator("aside").filter({ hasText: "Blocks" });
  await expect(
    palette.getByRole("button", {
      name: /Knowledge Answer questions from approved project knowledge/,
    }),
  ).toBeEnabled();
  await expect(
    palette.getByRole("button", {
      name: /Business Task Complete a published business task through conversation/,
    }),
  ).toBeEnabled();
  await expect(palette.getByText("Wait", { exact: true })).toBeVisible();
  await expect(
    palette.getByRole("button", {
      name: /Wait Pause the conversation and resume it after a set duration/,
    }),
  ).toBeEnabled();

  const operationNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "Create booking" });
  await operationNode.getByText("Create booking", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Step" });
  await expect(
    dialog.getByText("Run integration", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Integration to run")).toHaveValue(
    String(operation.id),
  );
  await expect(dialog.getByLabel("After submission")).toBeChecked();
  await dialog.getByLabel("During the conversation").check();
  await dialog.getByText("Result and routing", { exact: true }).click();
  await dialog
    .getByLabel("On Success", { exact: true })
    .selectOption(String(submitStep.id));
  await dialog.getByRole("button", { name: "Save action" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("Step updated.", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);

  await operationNode.getByText("Create booking", { exact: true }).click();
  await expect(dialog.getByLabel("During the conversation")).toBeChecked();
  await dialog.getByText("Result and routing", { exact: true }).click();
  await expect(dialog.getByLabel("On Success", { exact: true })).toHaveValue(
    String(submitStep.id),
  );
  await expect(dialog.getByLabel("Integration to run")).toHaveCount(1);
  await expect(
    dialog.getByText("Advanced settings", { exact: true }),
  ).toHaveCount(0);
});

test("first publication keeps the draft aligned with runtime", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-first-publish-${runId}@example.test`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E First Publish User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(
    page,
    `E2E First Publish Project ${runId}`,
  );
  const action = await createChatbotAction({
    description: "Checks first-publication draft comparison.",
    name: `E2E First Publish ${runId}`,
    projectId,
    status: "draft",
    triggerPhrases: [],
  });
  await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Finish request",
    projectId,
    prompt: "Your request is saved.",
    sortOrder: 1,
    stepType: "submit",
  });

  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error("Expected the first-publish test user to exist.");
  }
  const publishedVersion = await createPublishedActionFlowVersion({
    actionId: action.id,
    projectId,
    publishedByUserId: user.id,
  });
  const publishedAction = await getProjectAction(projectId, action.id);
  if (!publishedVersion || !publishedAction) {
    throw new Error("Expected the draft action to publish.");
  }
  const [publishedSteps, publishedBranches] = await Promise.all([
    listActionFlowSteps(projectId, action.id),
    listActionFlowBranchRules(projectId, action.id),
  ]);

  expect(publishedAction.status).toBe("active");
  expect(
    getDraftRuntimeChangeSummary({
      action: publishedAction,
      branchRules: publishedBranches,
      publishedSnapshot: publishedVersion.snapshot,
      steps: publishedSteps,
    }),
  ).toMatchObject({ actionChanged: false, hasChanges: false });
});

test("canvas saves and restores friendly grouped route conditions", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-grouped-route-${runId}@example.test`;
  const projectName = `E2E Grouped Route Project ${runId}`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Grouped Route User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);
  const action = await createChatbotAction({
    description: "Checks grouped route editing and persistence.",
    name: `E2E Grouped Route ${runId}`,
    projectId,
    status: "draft",
    triggerPhrases: [],
  });
  await createActionFlowStep({
    actionId: action.id,
    fieldKey: "customerType",
    inputType: "text",
    isRequired: true,
    label: "Customer Type",
    projectId,
    prompt: "What type of customer are you?",
    sortOrder: 1,
    stepType: "collect_input",
  });
  await createActionFlowStep({
    actionId: action.id,
    fieldKey: "orderValue",
    inputType: "float",
    isRequired: true,
    label: "Order Value",
    projectId,
    prompt: "What is the expected order value?",
    sortOrder: 2,
    stepType: "number",
  });
  const routingStep = await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Choose Customer Route",
    projectId,
    prompt: "Choosing the right service route.",
    sortOrder: 3,
    stepType: "message",
  });
  await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Standard Finish",
    projectId,
    prompt: "Standard route complete.",
    sortOrder: 4,
    stepType: "submit",
  });
  const priorityStep = await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Priority Finish",
    projectId,
    prompt: "Priority route complete.",
    sortOrder: 5,
    stepType: "submit",
  });

  await page.goto(`/projects/actions/${action.id}/canvas`);
  const routingNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "Choose Customer Route" });
  await routingNode.getByText("Choose Customer Route", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Step" });
  await dialog.getByText("Branching", { exact: true }).click();
  const routeForm = dialog
    .getByRole("button", { name: "Add route" })
    .locator("xpath=ancestor::form");
  await routeForm.getByLabel("Route name").fill("Priority customers");
  await routeForm.getByLabel("Answer").selectOption("customerType");
  await routeForm.getByLabel("Comparison").selectOption("equals");
  await routeForm.getByLabel("Value").fill("vip");
  await routeForm.getByRole("button", { name: "Add condition" }).click();
  await routeForm.getByLabel("Condition matching").selectOption("or");
  await routeForm.getByLabel("Answer").nth(1).selectOption("orderValue");
  await routeForm.getByLabel("Comparison").nth(1).selectOption("greater_than");
  await routeForm.getByLabel("Value").nth(1).fill("500");
  await routeForm.getByLabel("Go to").selectOption(String(priorityStep.id));
  await routeForm.getByRole("button", { name: "Add route" }).click();

  await expect
    .poll(async () => {
      const rules = await listActionFlowBranchRules(projectId, action.id);
      return rules.find((rule) => rule.sourceStepId === routingStep.id)
        ?.settings.conditionGroup;
    })
    .toEqual({
      combinator: "or",
      conditions: [
        {
          comparisonValue: "vip",
          fieldKey: "customerType",
          operator: "equals",
        },
        {
          comparisonValue: "500",
          fieldKey: "orderValue",
          operator: "greater_than",
        },
      ],
      schemaVersion: 1,
    });
  const routeIssues = await validateActionFlowRoutes(projectId, action.id);
  expect(countBlockingActionFlowIssues(routeIssues)).toBe(0);

  await page.reload();
  const routeEdge = page
    .locator(".react-flow__edge")
    .filter({ hasText: "Priority customers" });
  await expect(routeEdge).toBeVisible();
  await routeEdge.click();

  const branchDialog = page.getByRole("dialog", { name: "Edit Branch" });
  const editRouteForm = branchDialog
    .getByRole("button", { name: "Save route" })
    .locator("xpath=ancestor::form");
  await expect(editRouteForm.getByLabel("Condition matching")).toHaveValue(
    "or",
  );
  await expect(editRouteForm.getByLabel("Answer").nth(0)).toHaveValue(
    "customerType",
  );
  await expect(editRouteForm.getByLabel("Value").nth(0)).toHaveValue("vip");
  await expect(editRouteForm.getByLabel("Answer").nth(1)).toHaveValue(
    "orderValue",
  );
  await expect(editRouteForm.getByLabel("Value").nth(1)).toHaveValue("500");
});

test("universal Add Content menu explains availability in both canvas editors", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-content-menu-${runId}@example.test`;
  const projectName = `E2E Content Menu Project ${runId}`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Content Menu User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);
  const action = await createChatbotAction({
    description: "Checks universal Add Content availability and persistence.",
    name: `E2E Content Menu ${runId}`,
    projectId,
    status: "draft",
    triggerPhrases: [],
  });

  const welcomeStep = await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Universal Welcome",
    projectId,
    prompt: "Welcome to the content menu test.",
    sortOrder: 1,
    stepType: "message",
  });
  await createActionFlowStep({
    actionId: action.id,
    fieldKey: "universalChoice",
    inputType: "text",
    isRequired: true,
    label: "Universal Question",
    projectId,
    prompt: "Which option would you like?",
    sortOrder: 2,
    stepType: "collect_input",
  });

  await page.goto(`/projects/actions/${action.id}/canvas`);
  const welcomeNode = page.locator(
    `.react-flow__node[data-id="${welcomeStep.id}"]`,
  );
  await welcomeNode.getByTitle("Quick edit text").click();
  await expect(welcomeNode.getByText("Quick edit step 1")).toBeVisible();
  await expect(welcomeNode).toHaveCSS("z-index", "10000");
  await welcomeNode.getByTitle("Cancel quick edit").click();
  await expect(welcomeNode.getByText("Quick edit step 1")).not.toBeVisible();

  await welcomeNode.getByRole("button", { name: "Add content" }).click();

  let contentMenu = page
    .locator('[data-slot="popover-content"]:visible')
    .last();
  await expect(contentMenu).toBeVisible();
  for (const label of [
    "Text message",
    "Text + buttons",
    "List message",
    "Media",
    "Catalogue message",
    "Single product",
    "Multiple products",
    "Template",
    "Request intervention",
  ]) {
    await expect(contentMenu.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(
    contentMenu.getByRole("button", { name: /Text message/i }),
  ).toBeEnabled();
  await expect(
    contentMenu.getByRole("button", { name: /Text \+ buttons/i }),
  ).toBeDisabled();
  await expect(
    contentMenu.getByText(
      "Response collectors can only be added to steps that collect a visitor answer.",
      { exact: true },
    ),
  ).toHaveCount(2);
  await expect(
    contentMenu.getByText("Upload an active asset in the Media Library first."),
  ).toBeVisible();
  await expect(
    contentMenu.getByText(/Template is a standalone message block/),
  ).toBeVisible();
  await expect(
    contentMenu.getByText(/Request intervention is a standalone action block/),
  ).toBeVisible();
  await welcomeNode.getByRole("button", { name: "Add content" }).click();
  await expect(contentMenu).not.toBeVisible();

  const questionNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "Universal Question" });
  await questionNode.getByRole("button", { name: "Add content" }).click();
  contentMenu = page.locator('[data-slot="popover-content"]:visible').last();
  const listOption = contentMenu.getByRole("button", {
    name: /List message/i,
  });
  await expect(listOption).toBeEnabled();
  await listOption.click();

  const inlineListPresentation = questionNode.getByRole("button", {
    name: "List",
    exact: true,
  });
  await expect(
    questionNode.getByLabel("Question or introduction"),
  ).toBeVisible();
  await expect(inlineListPresentation).toHaveAttribute("aria-pressed", "true");
  await expect(questionNode.getByLabel("Option 1")).toBeVisible();
  await questionNode.getByLabel("List header").fill("Available teams");
  await questionNode.getByLabel("List footer").fill("Choose one team");
  await questionNode.getByLabel("Stored value 1").fill("team_sales");
  await questionNode.getByLabel("Description 1").fill("Talk to sales");
  await questionNode.getByLabel("Section 1").fill("Teams");
  await expect(
    questionNode.getByRole("button", { name: "Add option" }),
  ).toBeVisible();
  await questionNode.getByRole("button", { name: "Save", exact: true }).click();
  await expect(inlineListPresentation).not.toBeVisible();

  await page.reload();
  await expect(questionNode.getByTitle("Edit list message")).toBeVisible();
  await questionNode.getByText("Universal Question", { exact: true }).click();

  const editDialog = page.getByRole("dialog", { name: "Edit Step" });
  await expect(editDialog.getByLabel("Question or introduction")).toBeVisible();
  await expect(
    editDialog.getByRole("button", { name: "List", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(editDialog.getByLabel("List header")).toHaveValue(
    "Available teams",
  );
  await expect(editDialog.getByLabel("List footer")).toHaveValue(
    "Choose one team",
  );
  await expect(editDialog.getByLabel("Stored value 1")).toHaveValue(
    "team_sales",
  );
  await expect(editDialog.getByLabel("Description 1")).toHaveValue(
    "Talk to sales",
  );
  await expect(editDialog.getByLabel("Section 1")).toHaveValue("Teams");
  await editDialog.getByRole("button", { name: "Add content" }).click();
  contentMenu = page.locator('[data-slot="popover-content"]:visible').last();
  await expect(
    contentMenu.getByRole("button", { name: /List message/i }),
  ).toBeDisabled();
  await expect(
    contentMenu.getByText(
      "This step already has a response collector (buttons or list).",
      { exact: true },
    ),
  ).toHaveCount(2);
  await expect(
    contentMenu.getByRole("button", { name: /Template/i }),
  ).toBeDisabled();
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

test("disabled tenant owner is blocked at sign in", async ({ browser }) => {
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
  const tenantStatusResponse = adminPage.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/platform",
  );
  await tenantRow.getByRole("button", { name: "Disable" }).click();
  await tenantStatusResponse;
  await adminPage.goto("/platform");
  await expect(adminPage).toHaveURL(/\/platform$/);
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
  await expect(disabledPage).toHaveURL(/\/sign-in$/);
  await expect(
    disabledPage
      .getByText(
        "This account is currently disabled. Contact the platform administrator to restore access.",
      )
      .first(),
  ).toBeVisible();
  await disabledPage.goto("/projects");
  await expect(disabledPage).toHaveURL(/\/$/);
  await expect(disabledPage.getByText("SaaS chatbot platform")).toBeVisible();

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
    "/api/widget/actions/runtime",
    {
      data: {
        actionId: 999_999_999,
        commandId: `disabled-widget-command-${runId}`,
        conversationId: `disabled-widget-${runId}`,
        token: widgetToken,
      },
    },
  );
  expect(disabledWidgetFlowResponse.status()).toBe(403);
  await expect(disabledWidgetFlowResponse.json()).resolves.toEqual({
    message: "Widget is unavailable.",
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
  const memberEmail = `e2e-platform-support-member-${runId}@example.test`;
  const pendingInviteEmail = `e2e-platform-support-invite-${runId}@example.test`;

  const tenantContext = await browser.newContext();
  const tenantPage = await tenantContext.newPage();
  await signUpOrUseExistingAccount(tenantPage, {
    email: tenantEmail,
    name: tenantName,
    password,
  });
  await signInWithEmail(tenantPage, tenantEmail);
  await createProjectFromProjectsPage(tenantPage, projectName);
  await tenantPage.goto("/team/invite");
  await expect(tenantPage.getByText("Invite Member").first()).toBeVisible();
  await tenantPage.getByLabel("Invite Email").fill(memberEmail);
  await tenantPage.getByRole("button", { name: "Create Invite" }).click();
  await expect(tenantPage).toHaveURL(/invited=1/);
  await expect(
    tenantPage.getByText(/Invitation (created|emailed)/),
  ).toBeVisible();
  const memberInviteUrl = await tenantPage
    .locator("input[readonly]")
    .inputValue();
  const memberInviteUrlParts = new URL(memberInviteUrl, tenantPage.url());
  const memberInvitePath = `${memberInviteUrlParts.pathname}${memberInviteUrlParts.search}`;

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.goto(memberInvitePath);
  await expect(memberPage.getByText("Accept Invite").first()).toBeVisible();
  await memberPage.getByRole("link", { name: "Create Account" }).click();
  await finishInviteSignUpFromCurrentPage(memberPage, {
    name: `E2E Platform Support Member ${runId}`,
    password,
  });
  await memberContext.close();

  await tenantPage.goto("/team/invite");
  await tenantPage.getByLabel("Invite Email").fill(pendingInviteEmail);
  await tenantPage.getByRole("button", { name: "Create Invite" }).click();
  await expect(tenantPage).toHaveURL(/invited=1/);
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

  const memberCard = adminPage
    .getByText(memberEmail)
    .locator("xpath=ancestor::div[contains(@class, 'rounded-md')][1]");
  await expect(memberCard).toBeVisible();
  await expect(memberCard).toContainText(memberEmail);
  await memberCard.getByRole("button", { name: "Disable" }).click();
  await expect(adminPage).toHaveURL(/memberUpdated=1/);
  const disabledMemberCard = adminPage
    .getByText(memberEmail)
    .locator("xpath=ancestor::div[contains(@class, 'rounded-md')][1]");
  await expect(disabledMemberCard).toContainText(memberEmail);
  await expect(disabledMemberCard).toContainText("disabled");

  await disabledMemberCard.getByRole("button", { name: "Enable" }).click();
  await expect(adminPage).toHaveURL(/memberUpdated=1/);
  const enabledMemberCard = adminPage
    .getByText(memberEmail)
    .locator("xpath=ancestor::div[contains(@class, 'rounded-md')][1]");
  await expect(enabledMemberCard).toContainText(memberEmail);
  await expect(enabledMemberCard).toContainText("active");

  const invitationCard = adminPage
    .getByText(pendingInviteEmail)
    .locator("xpath=ancestor::div[contains(@class, 'rounded-md')][1]");
  await expect(invitationCard).toBeVisible();
  await expect(
    adminPage.getByText(
      "Company owners manage invitations from the Team area.",
    ),
  ).toBeVisible();
  await expect(
    adminPage.getByRole("button", { name: "Create Invite" }),
  ).toHaveCount(0);
  await expect(
    invitationCard.getByRole("button", { name: "Cancel" }),
  ).toHaveCount(0);

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
  await expect(page.getByText("COMPANY MEMBER")).toBeVisible();
  await expect(page.getByRole("link", { name: "Invite Member" })).toHaveCount(
    0,
  );
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

  const malformedProjectRuntimeResponse = await ownerPage.request.post(
    "/api/actions/runtime",
    {
      data: "{",
      headers: { "Content-Type": "application/json" },
    },
  );
  expect(malformedProjectRuntimeResponse.status()).toBe(400);
  await expect(malformedProjectRuntimeResponse.json()).resolves.toEqual({
    message: "A flow action or message is required.",
  });

  const strictProjectRuntimeResponse = await ownerPage.request.post(
    "/api/actions/runtime",
    {
      data: {
        conversationId: `strict-project-${runId}`,
        projectId,
        text: "hello",
        unexpected: true,
      },
    },
  );
  expect(strictProjectRuntimeResponse.status()).toBe(400);

  const missingProjectActionResponse = await ownerPage.request.post(
    "/api/actions/runtime",
    {
      data: {
        actionId: 999_999_999,
        commandId: `missing-project-command-${runId}`,
        conversationId: `missing-project-action-${runId}`,
        projectId,
      },
    },
  );
  expect(missingProjectActionResponse.status()).toBe(404);
  await expect(missingProjectActionResponse.json()).resolves.toEqual({
    message: "Action is unavailable.",
  });

  const staleProjectEditResponse = await ownerPage.request.post(
    "/api/actions/runtime",
    {
      data: {
        commandId: `stale-project-command-${runId}`,
        conversationId: `stale-project-edit-${runId}`,
        editSection: "name",
        projectId,
      },
    },
  );
  expect(staleProjectEditResponse.status()).toBe(409);
  await expect(staleProjectEditResponse.json()).resolves.toEqual({
    message: "No active flow is available to edit.",
  });

  const malformedWidgetRuntimeResponse = await ownerPage.request.post(
    "/api/widget/actions/runtime",
    {
      data: "{",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://allowed.example.com",
      },
    },
  );
  expect(malformedWidgetRuntimeResponse.status()).toBe(400);

  const oversizedWidgetTokenResponse = await ownerPage.request.post(
    "/api/widget/actions/runtime",
    {
      data: {
        conversationId: `oversized-token-${runId}`,
        text: "hello",
        token: "x".repeat(257),
      },
      headers: { Origin: "https://allowed.example.com" },
    },
  );
  expect(oversizedWidgetTokenResponse.status()).toBe(400);

  const staleWidgetEditResponse = await ownerPage.request.post(
    "/api/widget/actions/runtime",
    {
      data: {
        commandId: `stale-widget-command-${runId}`,
        conversationId: `stale-widget-edit-${runId}`,
        editSection: "name",
        token: widgetToken,
      },
      headers: { Origin: "https://allowed.example.com" },
    },
  );
  expect(staleWidgetEditResponse.status()).toBe(409);
  await expect(staleWidgetEditResponse.json()).resolves.toEqual({
    message: "No active flow is available to edit.",
  });

  const blockedResponse = await ownerPage.request.post(
    "/api/widget/actions/runtime",
    {
      data: {
        actionId: 999_999_999,
        commandId: `blocked-widget-command-${runId}`,
        conversationId: `blocked-widget-${runId}`,
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
    "/api/widget/actions/runtime",
    {
      data: {
        actionId: 999_999_999,
        commandId: `missing-origin-command-${runId}`,
        conversationId: `missing-origin-widget-${runId}`,
        token: widgetToken,
      },
    },
  );
  expect(missingOriginResponse.status()).toBe(403);
  await expect(missingOriginResponse.json()).resolves.toEqual({
    message: "Origin not allowed.",
  });

  const allowedResponse = await ownerPage.request.post(
    "/api/widget/actions/runtime",
    {
      data: {
        actionId: 999_999_999,
        commandId: `allowed-widget-command-${runId}`,
        conversationId: `allowed-widget-${runId}`,
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
    "/api/widget/actions/runtime",
    {
      data: {
        actionId: 999_999_999,
        commandId: `wildcard-widget-command-${runId}`,
        conversationId: `wildcard-widget-${runId}`,
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
});

test("@live-openai company owner can upload and process a document", async ({
  page,
}) => {
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

test("@live-openai project chat answers a RAG question from uploaded documents", async ({
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

  await expect(page).toHaveURL(/\/projects\/media$/);
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

test("company owner can manage a product catalog and product lifecycle", async ({
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

  await expect(page).toHaveURL(/\/projects\/catalog$/);
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

  await expect(page).toHaveURL(/\/projects\/catalog$/);
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

  const updatedCatalogName = `${catalogName} Updated`;
  await page.locator(`a[href="/projects/catalog/${catalog?.id}"]`).click();
  await expect(page).toHaveURL(`/projects/catalog/${catalog?.id}`);
  await page.getByLabel("Catalog Name").fill(updatedCatalogName);
  await page.getByLabel("Description").fill("Updated catalog coverage.");
  await page.getByRole("button", { name: "Save Catalog" }).click();

  await expect(page).toHaveURL(/\/projects\/catalog\/\d+\?updated=1/);
  await expect(page.getByText("Catalog updated.")).toBeVisible();
  await expect(page.getByText(updatedCatalogName)).toBeVisible();

  await page.getByRole("link", { name: "Back to catalog" }).click();
  await page
    .locator(
      `a[href="/projects/catalog/${catalog?.id}/products/${product.id}"]`,
    )
    .click();
  await expect(page).toHaveURL(
    `/projects/catalog/${catalog?.id}/products/${product.id}`,
  );
  await page.getByLabel("Product Name").fill(`${productName} Updated`);
  await page.getByLabel("Price").fill("95.00");
  await page.getByRole("button", { name: "Save Product" }).click();

  await expect(page).toHaveURL(
    /\/projects\/catalog\/\d+\/products\/\d+\?updated=1/,
  );
  await expect(page.getByText("Product updated.")).toBeVisible();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(
    page.getByRole("button", { name: "Restore Product" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore Product" }).click();
  await expect(page.getByText("Product restored.")).toBeVisible();

  await page.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Delete Permanently" }).click();
  await expect(page.getByText("Product permanently deleted.")).toBeVisible();

  await page.getByRole("button", { name: "Archive" }).click();
  await expect(
    page.getByRole("button", { name: "Restore Catalog" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore Catalog" }).click();
  await expect(page.getByText("Catalog restored.")).toBeVisible();

  await page.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Delete Permanently" }).click();
  await expect(page).toHaveURL(/\/projects\/catalog$/);
  await expect(page.getByText("Catalog permanently deleted.")).toBeVisible();
});

test("project chat action flow follows a branch route", async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-branch-action-${runId}@example.test`;
  const projectName = `E2E Branch Action Project ${runId}`;
  const actionName = `E2E Branch Intake ${runId}`;
  const triggerPhrase = `branch start ${runId}`;
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
    triggerPhrase,
    urgentMessage,
  });

  await page.goto("/projects/chat");
  await expect(page.getByText("Project Chat")).toBeVisible();
  await expect(page.getByRole("button", { name: actionName })).toBeVisible();

  await sendProjectChatMessage(page, triggerPhrase);
  await expect(page.getByText(triggerPhrase, { exact: true })).toBeVisible();
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

test("browser runtime edits collected fields on the pinned submission", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-runtime-edit-${runId}@example.test`;
  const projectName = `E2E Runtime Edit Project ${runId}`;
  const conversationId = `runtime-edit-${runId}`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Runtime Edit User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);
  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error("Expected the runtime-edit test user to exist.");
  }

  const action = await createChatbotAction({
    description: "Verifies server-owned answer editing.",
    name: `E2E Runtime Edit ${runId}`,
    projectId,
    status: "active",
    triggerPhrases: [`runtime edit ${runId}`],
  });
  await createActionFlowStep({
    actionId: action.id,
    fieldKey: "guestName",
    inputType: "text",
    isRequired: true,
    label: "Guest Name",
    projectId,
    prompt: "What name should we use?",
    sortOrder: 1,
    stepType: "collect_input",
  });
  await createActionFlowStep({
    actionId: action.id,
    fieldKey: "guestEmail",
    inputType: "email",
    isRequired: true,
    label: "Guest Email",
    projectId,
    prompt: "What email should we use?",
    sortOrder: 2,
    stepType: "email",
  });
  await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Confirm Request",
    projectId,
    prompt: "Please review your request.",
    sortOrder: 3,
    stepType: "confirmation",
  });
  await createPublishedActionFlowVersion({
    actionId: action.id,
    projectId,
    publishedByUserId: user.id,
  });

  await runBrowserFlowText({
    actionId: action.id,
    channelType: "project_chat",
    conversationId,
    projectId,
    source: "project_chat",
  });
  await runBrowserFlowText({
    channelType: "project_chat",
    conversationId,
    projectId,
    source: "project_chat",
    text: "Original Name",
  });
  const reviewResult = await runBrowserFlowText({
    channelType: "project_chat",
    conversationId,
    projectId,
    source: "project_chat",
    text: `original-${runId}@example.test`,
  });
  expect(reviewResult.activeFlow?.mode).toBe("confirming");

  const editResult = await runBrowserFlowText({
    channelType: "project_chat",
    conversationId,
    editSection: "name",
    projectId,
    source: "project_chat",
  });
  expect(
    editResult.replies.map((reply) => reply.fallbackText).join("\n"),
  ).toContain("What name should we use?");
  expect(editResult.activeFlow?.fields).toEqual(
    expect.objectContaining({ guestEmail: `original-${runId}@example.test` }),
  );
  expect(editResult.activeFlow?.fields).not.toHaveProperty("guestName");

  const editedReview = await runBrowserFlowText({
    channelType: "project_chat",
    conversationId,
    projectId,
    source: "project_chat",
    text: "Updated Name",
  });
  expect(editedReview.activeFlow).toEqual(
    expect.objectContaining({
      fields: expect.objectContaining({
        guestEmail: `original-${runId}@example.test`,
        guestName: "Updated Name",
      }),
      mode: "confirming",
    }),
  );

  const submittedResult = await runBrowserFlowText({
    channelType: "project_chat",
    conversationId,
    projectId,
    source: "project_chat",
    text: "confirm",
  });
  expect(submittedResult.activeFlow).toBeNull();

  const [submission] = await listActionSubmissions(projectId, action.id);
  expect(submission).toEqual(
    expect.objectContaining({
      fields: expect.objectContaining({ guestName: "Updated Name" }),
      status: "submitted",
    }),
  );
  const events = await listActionSubmissionEvents(projectId, submission.id);
  expect(events.map((event) => event.eventType)).toContain("flow.edit_started");
});

test("project chat resumes an active flow after refresh without duplicate writes", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-runtime-resume-${runId}@example.test`;
  const projectName = `E2E Runtime Resume Project ${runId}`;
  const actionName = `E2E Runtime Resume ${runId}`;
  const firstPrompt = `What name should we use for ${runId}?`;
  const secondPrompt = `What email should we use for ${runId}?`;
  const thirdPrompt = `What phone should we use for ${runId}?`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Runtime Resume User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);
  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error("Expected the runtime-resume test user to exist.");
  }

  const action = await createChatbotAction({
    description: "Verifies browser recovery without duplicate runtime writes.",
    name: actionName,
    projectId,
    status: "active",
    triggerPhrases: [`resume ${runId}`],
  });
  await createActionFlowStep({
    actionId: action.id,
    fieldKey: "guestName",
    inputType: "text",
    isRequired: true,
    label: "Guest Name",
    projectId,
    prompt: firstPrompt,
    sortOrder: 1,
    stepType: "collect_input",
  });
  await createActionFlowStep({
    actionId: action.id,
    fieldKey: "guestEmail",
    inputType: "email",
    isRequired: true,
    label: "Guest Email",
    projectId,
    prompt: secondPrompt,
    sortOrder: 2,
    stepType: "email",
  });
  await createActionFlowStep({
    actionId: action.id,
    fieldKey: "guestPhone",
    inputType: "phone",
    isRequired: true,
    label: "Guest Phone",
    projectId,
    prompt: thirdPrompt,
    sortOrder: 3,
    stepType: "phone",
  });
  await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Submit Request",
    projectId,
    prompt: "Saving the resumed request.",
    sortOrder: 4,
    stepType: "submit",
  });
  await createPublishedActionFlowVersion({
    actionId: action.id,
    projectId,
    publishedByUserId: user.id,
  });

  await page.goto("/projects/chat");
  await page.getByRole("button", { name: actionName }).click();
  await expect(page.getByText(firstPrompt)).toBeVisible();

  await sendProjectChatMessage(page, "Recovery Guest");
  await expect(page.getByText(secondPrompt)).toBeVisible();

  const storageKey = `lia:project-chat:${projectId}`;
  const conversationId = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    storageKey,
  );
  expect(conversationId).toBeTruthy();

  const [submissionBeforeRefresh] = await listActionSubmissions(
    projectId,
    action.id,
  );
  const eventsBeforeRefresh = await listActionSubmissionEvents(
    projectId,
    submissionBeforeRefresh.id,
  );

  await page.reload();
  await expect(page.getByText(secondPrompt)).toBeVisible();
  expect(
    await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      storageKey,
    ),
  ).toBe(conversationId);

  const submissionsAfterRefresh = await listActionSubmissions(
    projectId,
    action.id,
  );
  expect(submissionsAfterRefresh).toHaveLength(1);
  expect(submissionsAfterRefresh[0]).toEqual(
    expect.objectContaining({
      fields: expect.objectContaining({ guestName: "Recovery Guest" }),
      id: submissionBeforeRefresh.id,
      status: "in_progress",
    }),
  );
  expect(
    await listActionSubmissionEvents(projectId, submissionBeforeRefresh.id),
  ).toHaveLength(eventsBeforeRefresh.length);

  const refreshedSubmission = await getActiveActionSubmissionForConversation({
    conversationId: conversationId ?? "",
    projectId,
    source: "project_chat",
  });
  if (!refreshedSubmission || !conversationId) {
    throw new Error("Expected the refreshed flow submission to remain active.");
  }
  await runBrowserFlowText({
    channelType: "project_chat",
    commandId: `external-tab-${runId}`,
    conversationId,
    expectedRevision: refreshedSubmission.revision,
    projectId,
    source: "project_chat",
    text: `resume-${runId}@example.test`,
  });

  await sendProjectChatMessage(page, `stale-${runId}@example.test`);
  await expect(page.getByText(thirdPrompt)).toBeVisible();
  await expect(
    page.getByText(
      "This request changed in another tab, so I refreshed it. Please send your answer again.",
    ),
  ).toBeVisible();

  await sendProjectChatMessage(page, "+919988776655");
  await expect(page.getByText("Thanks. I saved this request.")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Recovery Guest", { exact: true })).toBeVisible();
  await expect(page.getByText("Thanks. I saved this request.")).toBeVisible();

  const duplicateConversationId = `duplicate-${runId}`;
  const duplicateCommandId = `duplicate-command-${runId}`;
  const firstResult = await runBrowserFlowText({
    actionId: action.id,
    channelType: "project_chat",
    commandId: duplicateCommandId,
    conversationId: duplicateConversationId,
    projectId,
    source: "project_chat",
  });
  const duplicateSubmission = await getActiveActionSubmissionForConversation({
    conversationId: duplicateConversationId,
    projectId,
    source: "project_chat",
  });
  expect(duplicateSubmission).not.toBeNull();
  const duplicateEventsBeforeReplay = await listActionSubmissionEvents(
    projectId,
    duplicateSubmission?.id ?? 0,
  );

  const replayedResult = await runBrowserFlowText({
    actionId: action.id,
    channelType: "project_chat",
    commandId: duplicateCommandId,
    conversationId: duplicateConversationId,
    projectId,
    source: "project_chat",
  });
  expect(replayedResult).toEqual(firstResult);
  expect(
    await listActionSubmissionEvents(projectId, duplicateSubmission?.id ?? 0),
  ).toHaveLength(duplicateEventsBeforeReplay.length);
  expect(
    (await listActionSubmissions(projectId, action.id)).filter(
      (submission) =>
        submission.conversationId === duplicateConversationId &&
        submission.status === "in_progress",
    ),
  ).toHaveLength(1);

  await expect(
    runBrowserFlowText({
      channelType: "project_chat",
      commandId: duplicateCommandId,
      conversationId: duplicateConversationId,
      projectId,
      source: "project_chat",
      text: "different request",
    }),
  ).rejects.toThrow("already used for another request");

  const expectedRevision = firstResult.activeFlow?.revision;
  expect(expectedRevision).toBeDefined();
  const concurrentResults = await Promise.allSettled([
    runBrowserFlowText({
      channelType: "project_chat",
      commandId: `concurrent-a-${runId}`,
      conversationId: duplicateConversationId,
      expectedRevision,
      projectId,
      source: "project_chat",
      text: "Concurrent Guest A",
    }),
    runBrowserFlowText({
      channelType: "project_chat",
      commandId: `concurrent-b-${runId}`,
      conversationId: duplicateConversationId,
      expectedRevision,
      projectId,
      source: "project_chat",
      text: "Concurrent Guest B",
    }),
  ]);
  expect(
    concurrentResults.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const rejectedResult = concurrentResults.find(
    (result) => result.status === "rejected",
  );
  expect(rejectedResult).toEqual(
    expect.objectContaining({
      reason: expect.objectContaining({ code: "stale" }),
    }),
  );

  const submissionAfterConcurrentCommands =
    await getActiveActionSubmissionForConversation({
      conversationId: duplicateConversationId,
      projectId,
      source: "project_chat",
    });
  expect(submissionAfterConcurrentCommands?.fields.guestName).toMatch(
    /^Concurrent Guest [AB]$/,
  );
  expect(
    (
      await listActionSubmissionEvents(
        projectId,
        submissionAfterConcurrentCommands?.id ?? 0,
      )
    ).filter((event) => event.eventType === "field.collected"),
  ).toHaveLength(1);
});

test("browser media upload advances the canonical pinned flow", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-runtime-media-${runId}@example.test`;
  const projectName = `E2E Runtime Media Project ${runId}`;
  const conversationId = `runtime-media-${runId}`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Runtime Media User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);
  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error("Expected the runtime-media test user to exist.");
  }

  const action = await createChatbotAction({
    description: "Verifies canonical browser media progression.",
    name: `E2E Runtime Media ${runId}`,
    projectId,
    status: "active",
    triggerPhrases: [`runtime media ${runId}`],
  });
  const uploadStep = await createActionFlowStep({
    actionId: action.id,
    fieldKey: "attachment",
    isRequired: true,
    label: "Attachment",
    projectId,
    prompt: "Please upload the supporting file.",
    sortOrder: 1,
    stepType: "file_upload",
  });
  await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Submit Upload",
    projectId,
    prompt: "Saving the uploaded request.",
    sortOrder: 2,
    stepType: "submit",
  });
  await createPublishedActionFlowVersion({
    actionId: action.id,
    projectId,
    publishedByUserId: user.id,
  });

  await runBrowserFlowText({
    actionId: action.id,
    channelType: "widget",
    conversationId,
    projectId,
    source: "widget_chat",
  });
  const activeSubmission = await getActiveActionSubmissionForConversation({
    conversationId,
    projectId,
    source: "widget_chat",
  });
  if (!activeSubmission) {
    throw new Error("Expected an active runtime-media submission.");
  }

  const mediaAssetCountBefore = (await listProjectMediaAssets(projectId))
    .length;
  const commandId = `e2e-media-command-${runId}`;
  const createMediaFormData = () => {
    const formData = new FormData();
    formData.append(
      "file",
      new File([`runtime media ${runId}`], `runtime-media-${runId}.txt`, {
        type: "text/plain",
      }),
    );
    formData.append("commandId", commandId);
    formData.append("expectedRevision", String(activeSubmission.revision));
    formData.append("stepId", String(uploadStep.id));
    formData.append("submissionId", String(activeSubmission.id));
    return formData;
  };
  const mediaResult = await runBrowserFlowMediaCommand({
    channelType: "widget",
    formData: createMediaFormData(),
    projectId,
    source: "widget_chat",
  });
  const replayedMediaResult = await runBrowserFlowMediaCommand({
    channelType: "widget",
    formData: createMediaFormData(),
    projectId,
    source: "widget_chat",
  });
  expect(replayedMediaResult).toEqual(mediaResult);
  expect((await listProjectMediaAssets(projectId)).length).toBe(
    mediaAssetCountBefore + 1,
  );
  expect(mediaResult.activeFlow).toBeNull();
  expect(
    mediaResult.replies.map((reply) => reply.fallbackText).join("\n"),
  ).toContain("Thanks. I saved this request.");

  const submission = await getActionSubmission(projectId, activeSubmission.id);
  expect(submission).toEqual(
    expect.objectContaining({
      fields: expect.objectContaining({
        attachment: expect.objectContaining({
          originalName: `runtime-media-${runId}.txt`,
        }),
      }),
      status: "submitted",
    }),
  );
  const events = await listActionSubmissionEvents(
    projectId,
    activeSubmission.id,
  );
  expect(
    events.filter((event) => event.eventType === "flow.media_uploaded"),
  ).toHaveLength(1);
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
  if (!successAttempt.attempt.idempotencyKey) {
    throw new Error("Expected an idempotency key for the operation attempt.");
  }
  const replayedAttempt = await runOperationForSubmission({
    actionId: successFlow.action.id,
    fields: successSubmission.fields,
    idempotencyKey: successAttempt.attempt.idempotencyKey,
    operationId: successFlow.operation.id,
    projectId,
    submissionId: successSubmission.id,
  });
  expect(replayedAttempt?.attempt.id).toBe(successAttempt.attempt.id);
  expect(
    await listProjectOperationAttemptsWithDetails({
      operationId: successFlow.operation.id,
      projectId,
    }),
  ).toHaveLength(1);

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

test("active flow stays pinned to the published version it started with", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-version-pin-${runId}@example.test`;
  const projectName = `E2E Version Pin Project ${runId}`;
  const triggerPhrase = `version pin ${runId}`;
  const conversationId = `version-pin-conversation-${runId}`;
  const inputPrompt = `What should version one collect ${runId}?`;
  const versionOnePrompt = `Version one completion ${runId}.`;
  const versionTwoPrompt = `Version two completion ${runId}.`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Version Pin User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);
  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error("Expected the version-pin test user to exist.");
  }

  const action = await createChatbotAction({
    description: "Verifies immutable runtime version pinning.",
    name: `E2E Version Pin Action ${runId}`,
    projectId,
    status: "active",
    triggerPhrases: [triggerPhrase],
  });
  await createActionFlowStep({
    actionId: action.id,
    fieldKey: "versionPinAnswer",
    inputType: "text",
    isRequired: true,
    label: "Version Pin Answer",
    projectId,
    prompt: inputPrompt,
    sortOrder: 1,
    stepType: "collect_input",
  });
  const submitStep = await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Submit Version Pin Request",
    projectId,
    prompt: versionOnePrompt,
    sortOrder: 2,
    stepType: "submit",
  });
  const versionOne = await createPublishedActionFlowVersion({
    actionId: action.id,
    projectId,
    publishedByUserId: user.id,
  });
  if (!versionOne) {
    throw new Error("Expected version one to be published.");
  }

  const startResult = await processChannelFlowText({
    activeSubmission: null,
    conversationId,
    projectId,
    source: "widget_chat",
    text: triggerPhrase,
  });
  expect(
    startResult.replies.map((reply) => reply.fallbackText).join("\n"),
  ).toContain(inputPrompt);

  const activeSubmission = await getActiveActionSubmissionForConversation({
    conversationId,
    projectId,
    source: "widget_chat",
  });
  if (!activeSubmission) {
    throw new Error("Expected an active version-pin submission.");
  }
  expect(activeSubmission).toEqual(
    expect.objectContaining({
      actionId: action.id,
      actionVersionId: versionOne.id,
      status: "in_progress",
    }),
  );

  await updateActionFlowStep({
    actionId: action.id,
    fieldKey: submitStep.fieldKey,
    inputType: submitStep.inputType,
    isEnabled: submitStep.isEnabled,
    isRequired: submitStep.isRequired,
    label: submitStep.label,
    nextStepId: submitStep.nextStepId,
    operationId: submitStep.operationId,
    options: submitStep.options,
    projectId,
    prompt: versionTwoPrompt,
    settings: submitStep.settings,
    sortOrder: submitStep.sortOrder,
    stepId: submitStep.id,
    stepType: submitStep.stepType,
  });
  const versionTwo = await createPublishedActionFlowVersion({
    actionId: action.id,
    projectId,
    publishedByUserId: user.id,
  });
  expect(versionTwo?.id).not.toBe(versionOne.id);

  const completionResult = await processChannelFlowText({
    activeSubmission,
    conversationId,
    projectId,
    source: "widget_chat",
    text: `Pinned answer ${runId}`,
  });
  const completionText = completionResult.replies
    .map((reply) => reply.fallbackText)
    .join("\n");
  expect(completionText).toContain(versionOnePrompt);
  expect(completionText).not.toContain(versionTwoPrompt);

  const [completedSubmission] = await listActionSubmissions(
    projectId,
    action.id,
  );
  expect(completedSubmission).toEqual(
    expect.objectContaining({
      actionVersionId: versionOne.id,
      status: "submitted",
    }),
  );
});

test("durable wait resumes and completes its pinned flow version", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-durable-resume-${runId}@example.test`;
  const projectName = `E2E Durable Resume Project ${runId}`;
  const triggerPhrase = `durable resume ${runId}`;
  const conversationId = `durable-resume-conversation-${runId}`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Durable Resume User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);
  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error("Expected the durable-resume test user to exist.");
  }

  const action = await createChatbotAction({
    description: "Certifies queued wait and resume execution.",
    name: `E2E Durable Resume Action ${runId}`,
    projectId,
    status: "active",
    triggerPhrases: [triggerPhrase],
  });
  await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Brief Pause",
    projectId,
    prompt: "Please wait while this request continues.",
    settings: { waitAmount: 1, waitUnit: "seconds" },
    sortOrder: 1,
    stepType: "wait",
  });
  await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Complete After Pause",
    projectId,
    prompt: "The scheduled request is complete.",
    sortOrder: 2,
    stepType: "submit",
  });
  const publishedVersion = await createPublishedActionFlowVersion({
    actionId: action.id,
    projectId,
    publishedByUserId: user.id,
  });
  if (!publishedVersion) {
    throw new Error("Expected the durable flow to be published.");
  }

  const startResult = await processChannelFlowText({
    activeSubmission: null,
    conversationId,
    projectId,
    source: "widget_chat",
    text: triggerPhrase,
  });
  expect(
    startResult.replies.map((reply) => reply.fallbackText).join("\n"),
  ).toContain("Please wait while this request continues.");

  const [pausedSubmission] = await listActionSubmissions(projectId, action.id);
  expect(pausedSubmission).toEqual(
    expect.objectContaining({
      actionVersionId: publishedVersion.id,
      status: "in_progress",
    }),
  );

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const queueResult = await processProjectFlowResumeQueue({
    maxJobs: 1,
    projectId,
    workerId: `e2e-worker-${runId}`,
  });
  expect(queueResult).toEqual({
    completed: 1,
    failed: 0,
    idle: false,
    processed: 1,
    rescheduled: 0,
  });

  const [completedSubmission] = await listActionSubmissions(
    projectId,
    action.id,
  );
  expect(completedSubmission).toEqual(
    expect.objectContaining({
      actionVersionId: publishedVersion.id,
      status: "submitted",
    }),
  );
  const events = await listActionSubmissionEvents(
    projectId,
    completedSubmission.id,
  );
  expect(events.map((event) => event.eventType)).toEqual(
    expect.arrayContaining([
      "flow.paused",
      "flow.resumed",
      "submission.submitted",
    ]),
  );
});

test("durable response policies retry, route, cancel, and time out on the pinned version", async ({
  page,
}) => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-response-policy-${runId}@example.test`;
  const projectName = `E2E Response Policy Project ${runId}`;
  const triggerPhrase = `response policy ${runId}`;

  await signUpOrUseExistingAccount(page, {
    email,
    name: `E2E Response Policy User ${runId}`,
    password,
  });
  await signInWithEmail(page, email);
  const projectId = await createProjectFromProjectsPage(page, projectName);
  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error("Expected the response-policy test user to exist.");
  }

  const action = await createChatbotAction({
    description: "Certifies deterministic response policies.",
    name: `E2E Response Policy Action ${runId}`,
    projectId,
    status: "active",
    triggerPhrases: [triggerPhrase],
  });
  const failureStep = await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Response Policy Outcome",
    projectId,
    prompt: "The response policy output was followed.",
    sortOrder: 2,
    stepType: "message",
  });
  await createActionFlowStep({
    actionId: action.id,
    isRequired: false,
    label: "Submit Response Policy Request",
    projectId,
    prompt: "The response policy request is complete.",
    sortOrder: 3,
    stepType: "submit",
  });
  await createActionFlowStep({
    actionId: action.id,
    fieldKey: "policyEmail",
    inputType: "email",
    isRequired: true,
    label: "Policy Email",
    projectId,
    prompt: "What is your email address?",
    settings: {
      responsePolicy: {
        cancellationStepId: failureStep.id,
        noReplyReminderMessage: "Please reply when ready.",
        noReplyReminderMinutes: null,
        noReplyTimeoutMessage: "The response window expired.",
        noReplyTimeoutMinutes: 1,
        noReplyTimeoutStepId: failureStep.id,
        retryCount: 1,
        retryExhaustedStepId: failureStep.id,
        retryMessage: "Enter a valid email and try again.",
        schemaVersion: 1,
        validationFailureStepId: null,
      },
    },
    sortOrder: 1,
    stepType: "email",
  });
  const publishedVersion = await createPublishedActionFlowVersion({
    actionId: action.id,
    projectId,
    publishedByUserId: user.id,
  });
  if (!publishedVersion) {
    throw new Error("Expected the response-policy flow to be published.");
  }

  const start = async (conversationId: string) => {
    await recordChannelInboundMessage({
      channelType: "widget",
      externalConversationId: conversationId,
      externalUserId: conversationId,
      projectId,
      text: triggerPhrase,
    });
    await processChannelFlowText({
      activeSubmission: null,
      conversationId,
      projectId,
      source: "widget_chat",
      text: triggerPhrase,
    });
    const submission = await getActiveActionSubmissionForConversation({
      conversationId,
      projectId,
      source: "widget_chat",
    });
    if (!submission) {
      throw new Error("Expected an active response-policy submission.");
    }
    expect(submission.actionVersionId).toBe(publishedVersion.id);
    return submission;
  };

  const retryConversationId = `response-policy-retry-${runId}`;
  let retrySubmission = await start(retryConversationId);
  const firstInvalid = await processChannelFlowText({
    activeSubmission: retrySubmission,
    conversationId: retryConversationId,
    projectId,
    source: "widget_chat",
    text: "not-an-email",
  });
  expect(firstInvalid.replies[0]?.fallbackText).toContain(
    "Enter a valid email and try again.",
  );
  retrySubmission =
    (await getActiveActionSubmissionForConversation({
      conversationId: retryConversationId,
      projectId,
      source: "widget_chat",
    })) ?? retrySubmission;
  const exhausted = await processChannelFlowText({
    activeSubmission: retrySubmission,
    conversationId: retryConversationId,
    projectId,
    source: "widget_chat",
    text: "still-not-an-email",
  });
  expect(
    exhausted.replies.map((reply) => reply.fallbackText).join("\n"),
  ).toContain("The response policy output was followed.");

  const cancelConversationId = `response-policy-cancel-${runId}`;
  const cancelSubmission = await start(cancelConversationId);
  const cancelled = await processChannelFlowText({
    activeSubmission: cancelSubmission,
    conversationId: cancelConversationId,
    projectId,
    source: "widget_chat",
    text: "cancel",
  });
  expect(
    cancelled.replies.map((reply) => reply.fallbackText).join("\n"),
  ).toContain("The response policy output was followed.");

  const timeoutConversationId = `response-policy-timeout-${runId}`;
  const timeoutSubmission = await start(timeoutConversationId);
  await db
    .update(durableJobs)
    .set({ availableAt: new Date(0) })
    .where(
      and(
        eq(durableJobs.projectId, projectId),
        eq(durableJobs.submissionId, timeoutSubmission.id),
        eq(durableJobs.jobType, "flow_response_policy"),
      ),
    );
  const queue = await processProjectFlowResponsePolicyQueue({
    maxJobs: 1,
    projectId,
    workerId: `response-policy-worker-${runId}`,
  });
  expect(queue).toMatchObject({
    completed: 1,
    failed: 0,
    processed: 1,
    rescheduled: 0,
    skipped: 0,
  });

  const submissions = await listActionSubmissions(projectId, action.id);
  const completedTimeout = submissions.find(
    (submission) => submission.id === timeoutSubmission.id,
  );
  expect(completedTimeout).toMatchObject({
    actionVersionId: publishedVersion.id,
    status: "submitted",
  });
  const timeoutEvents = await listActionSubmissionEvents(
    projectId,
    timeoutSubmission.id,
  );
  expect(timeoutEvents.map((event) => event.eventType)).toEqual(
    expect.arrayContaining([
      "flow.awaiting_response",
      "flow.no_reply_timeout",
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
