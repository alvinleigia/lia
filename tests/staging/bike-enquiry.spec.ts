import { expect, type Page, test } from "@playwright/test";

type RuntimeReply = {
  text: string;
  intent?: string;
  payload?: { inputRequest?: { fieldKey: string; label: string } };
};
type RuntimeResult = {
  action?: { id: number; versionNumber: number };
  activeFlow?: { conversationId: string } | null;
  replies: RuntimeReply[];
};

async function send(page: Page, message: string) {
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/actions/runtime" &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.text === message,
    { timeout: 90_000 },
  );
  await expect(page.locator("textarea")).toBeEnabled();
  await page.locator("textarea").fill(message);
  await page.locator("textarea").press("Enter");
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const result = (await response.json()) as RuntimeResult;
  if (result.action) expect(result.action.id).toBe(61);
  await test.info().attach(`turn-${test.info().attachments.length + 1}`, {
    body: JSON.stringify({ message, ...result }, null, 2),
    contentType: "application/json",
  });
  for (const reply of result.replies) {
    for (const line of reply.text.split("\n").filter(Boolean)) {
      await expect(page.getByRole("log")).toContainText(
        line.replace(/^[-*] /, ""),
      );
    }
  }
  return result;
}

async function review(page: Page, result: RuntimeResult) {
  const confirmation = result.replies.find(
    (reply) => reply.intent === "confirmation",
  );
  expect(confirmation).toBeDefined();
  expect(confirmation?.text).toContain("Customer Name: UAT Rider");
  expect(confirmation?.text).toContain("Contact Number: +12025550123");
  expect(confirmation?.text).toContain("Bike Model: Yamaha MT-15");
  expect(confirmation?.text).toMatch(/Service Reason: (?:an? )?oil change/i);
  await expect(
    page.getByRole("button", { name: "Confirm", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("review.png"),
    fullPage: true,
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/projects/chat");
  await expect(
    page.getByRole("button", {
      name: "Selected Project: Bike Service Entity UAT 2026-09-21 (#95)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bike Service Enquiry UAT", exact: true }),
  ).toBeEnabled();
  expect(new URL(page.url()).origin).toBe("https://lia-staging.leigia.com");
});

test("all details in one message reach review and complete after confirmation", async ({
  page,
}) => {
  await review(
    page,
    await send(
      page,
      "I want to enquire about bike service. My name is UAT Rider, my contact number is +12025550123, my bike is a Yamaha MT-15, and the service reason is an oil change.",
    ),
  );
  const result = await send(page, "Confirm");
  expect(result.replies.map((reply) => reply.text).join("\n")).toMatch(
    /completed|successfully/i,
  );
  expect(result.replies.some((reply) => reply.intent === "confirmation")).toBe(
    false,
  );
  await page.screenshot({
    path: test.info().outputPath("completed.png"),
    fullPage: true,
  });
});

test("missing reason asks only for reason and retains other details", async ({
  page,
}) => {
  const result = await send(
    page,
    "I want to enquire about bike service. My name is UAT Rider, my contact number is +12025550123, and my bike is a Yamaha MT-15.",
  );
  expect(result.replies.at(-1)?.payload?.inputRequest?.fieldKey).toBe(
    "serviceReason",
  );
  expect(result.replies.some((reply) => reply.intent === "confirmation")).toBe(
    false,
  );
  await page.screenshot({
    path: test.info().outputPath("missing-reason.png"),
    fullPage: true,
  });
  await review(page, await send(page, "The service reason is an oil change."));
});

test("out-of-order bike model is retained while name remains pending", async ({
  page,
}) => {
  await send(page, "I want to enquire about bike service.");
  const result = await send(page, "My bike is a Yamaha MT-15.");
  expect(result.replies.at(-1)?.payload?.inputRequest?.fieldKey).toBe(
    "customerName",
  );
  await page.screenshot({
    path: test.info().outputPath("out-of-order.png"),
    fullPage: true,
  });
  await review(
    page,
    await send(
      page,
      "My name is UAT Rider, my contact number is +12025550123, and the service reason is an oil change.",
    ),
  );
});

test("uncertain service reason is clarified before confirmation", async ({
  page,
}) => {
  const result = await send(
    page,
    "I want to enquire about bike service. My name is UAT Rider, my contact number is +12025550123, and my bike is a Yamaha MT-15. I am not sure whether the service reason should be an oil change or a brake inspection. Please help me clarify before choosing.",
  );
  expect(result.replies.some((reply) => reply.intent === "confirmation")).toBe(
    false,
  );
  expect(result.replies.at(-1)?.text).toMatch(/\?|clarif|which|reason/i);
  await page.screenshot({
    path: test.info().outputPath("ambiguous-reason.png"),
    fullPage: true,
  });
  await review(page, await send(page, "Oil change"));
});
