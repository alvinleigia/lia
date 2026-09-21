import { expect, type Page, test } from "@playwright/test";

type Result = {
  action?: { id: number; versionNumber: number };
  activeFlow?: {
    mode: string;
    stepIndex: number;
    fields: Record<string, string>;
  } | null;
  replies: {
    text: string;
    intent?: string;
    payload?: { inputRequest?: { fieldKey: string } };
  }[];
};

const details =
  "My name is UAT Form Rider, my email is form.rider@example.com, my contact number is +12025550125, quantity is 2, service subject is oil change, colour is blue, preferred date is 25 September 2026, and preferred time is 3:30 pm.";

async function send(page: Page, text: string): Promise<Result> {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/actions/runtime" &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.text === text,
    { timeout: 90_000 },
  );
  await expect(page.locator("textarea")).toBeEnabled();
  await page.locator("textarea").fill(text);
  await page.locator("textarea").press("Enter");
  const response = await pending;
  expect(response.status()).toBe(200);
  const result = (await response.json()) as Result;
  if (result.action) expect(result.action.id).toBe(62);
  await test.info().attach(`turn-${test.info().attachments.length + 1}`, {
    body: JSON.stringify({ text, ...result }, null, 2),
    contentType: "application/json",
  });
  await expect(page.getByRole("log")).toContainText(
    result.replies.at(-1)?.text.split("\n")[0] ?? "Missing runtime reply",
  );
  return result;
}

function review(result: Result, subject = "oil change", colour = true) {
  expect(result.activeFlow?.mode).toBe("confirming");
  const reply = result.replies.find((reply) =>
    reply.text.includes("Please review your enquiry."),
  );
  expect(reply).toBeDefined();
  if (!reply) throw new Error("Expected a review reply");
  expect(reply.text).toContain("UAT Form Rider");
  expect(reply.text).toContain("form.rider@example.com");
  expect(reply.text).toContain("+12025550125");
  expect(reply.text).toMatch(/quantity: 2/i);
  expect(reply.text).toContain(subject);
  expect(reply.text).toMatch(/2026-09-25|25 September 2026/);
  expect(reply.text).toMatch(/15:30|3:30/);
  if (colour) expect(reply.text).toMatch(/Colour: blue/i);
  else expect(reply.text).not.toMatch(/colour:/i);
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
    page.getByRole("button", {
      name: "Ordinary Collection UAT 2026-09-22",
      exact: true,
    }),
  ).toBeEnabled();
});

test("ordinary form extracts all configured fields and submits after confirmation", async ({
  page,
}) => {
  review(await send(page, `I want an ordinary form enquiry. ${details}`));
  const result = await send(page, "Confirm");
  expect(result.replies.map((reply) => reply.text).join("\n")).toMatch(
    /submitted|success|saved/i,
  );
});

test("ordinary form rejects out-of-range quantity and retains other fields", async ({
  page,
}) => {
  const result = await send(
    page,
    `I want an ordinary form enquiry. ${details.replace("quantity is 2", "quantity is 99")}`,
  );
  expect(result.replies.some((reply) => reply.intent === "confirmation")).toBe(
    false,
  );
  expect(result.activeFlow?.mode).toBe("collecting");
  expect(result.replies.at(-1)?.text).toContain("Please provide Quantity.");
  review(await send(page, "2"));
});

test("ordinary form excludes a supplied field when its branch is skipped", async ({
  page,
}) => {
  review(
    await send(
      page,
      `I want an ordinary form enquiry. ${details.replace("oil change", "inspection")}`,
    ),
    "inspection",
    false,
  );
});

test("ordinary form retains early fields and asks only for missing time", async ({
  page,
}) => {
  const result = await send(
    page,
    `I want an ordinary form enquiry. ${details.replace(", and preferred time is 3:30 pm", "")}`,
  );
  expect(result.replies.at(-1)?.text).toContain(
    "Please provide Preferred Time.",
  );
  review(await send(page, "3:30 pm"));
});

test("ordinary form clarifies ambiguous choice and retains clear details", async ({
  page,
}) => {
  const result = await send(
    page,
    `I want an ordinary form enquiry. ${details.replace("colour is blue", "colour could be blue or red, I have not decided")}`,
  );
  expect(result.activeFlow?.mode).not.toBe("confirming");
  expect(result.replies.map((reply) => reply.text).join("\n")).toMatch(
    /blue|red|colour/i,
  );
  review(await send(page, "Blue"));
});

test("ordinary form validates email then phone without losing later values", async ({
  page,
}) => {
  const result = await send(
    page,
    `I want an ordinary form enquiry. ${details.replace("form.rider@example.com", "not-an-email").replace("+12025550125", "123")}`,
  );
  expect(result.activeFlow?.mode).toBe("collecting");
  expect(result.replies.at(-1)?.text).toMatch(/email/i);
  const phone = await send(page, "form.rider@example.com");
  expect(phone.activeFlow?.mode).toBe("collecting");
  expect(phone.replies.at(-1)?.text).toMatch(/phone|contact number/i);
  review(await send(page, "+12025550125"));
});

test("ordinary form resumes after reload with previously supplied fields", async ({
  page,
}) => {
  await send(
    page,
    `I want an ordinary form enquiry. ${details.replace(", and preferred time is 3:30 pm", "")}`,
  );
  await page.reload();
  await expect(page.getByRole("log")).toContainText(
    "Please provide Preferred Time.",
  );
  review(await send(page, "3:30 pm"));
});

test("ordinary form edits email at review while preserving the other fields", async ({
  page,
}) => {
  review(await send(page, `I want an ordinary form enquiry. ${details}`));
  await page.getByRole("button", { name: "Edit Email", exact: true }).click();
  await expect(page.getByRole("log")).toContainText(
    "Please provide Customer Email.",
  );
  const changed = await send(page, "updated.rider@example.com");
  expect(changed.activeFlow?.mode).toBe("confirming");
  expect(changed.activeFlow?.fields).toMatchObject({
    customerName: "UAT Form Rider",
    customerEmail: "updated.rider@example.com",
    contactNumber: "+12025550125",
    quantity: "2",
    preferredDate: "2026-09-25",
    preferredTime: "15:30",
  });
  expect(changed.replies.at(-1)?.text).not.toContain("form.rider@example.com");
});

test("ordinary form supports the configured time control on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await send(
    page,
    `I want an ordinary form enquiry. ${details.replace(", and preferred time is 3:30 pm", "")}`,
  );
  const time = page.getByRole("textbox", {
    name: "Preferred Time",
    exact: true,
  });
  await time.fill("15:30");
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/actions/runtime" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Use time", exact: true }).click();
  review(await (await pending).json());
  await expect(
    page.getByRole("button", { name: "Confirm Request", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("mobile-review.png"),
    fullPage: true,
  });
});

test("ordinary form publishes draft changes only for new conversations", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const original = "Please provide Customer Name.";
  const changed = "What is your customer name for this enquiry?";
  expect(
    (await send(page, "ordinary collection uat")).replies.at(-1)?.text,
  ).toBe(original);
  const editor = await context.newPage();
  const savePrompt = async (prompt: string) => {
    await editor.goto("/projects/actions/62/steps/182");
    await editor.getByLabel("Prompt", { exact: true }).fill(prompt);
    await editor
      .getByRole("button", { name: "Save Step", exact: true })
      .click();
    await expect(editor).toHaveURL(/\/actions\/62\?/);
  };
  const publish = async () => {
    await editor
      .getByRole("button", { name: "Publish changes", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Publish Action", exact: true })
      .click();
    await expect(
      editor.getByText("Draft matches runtime", { exact: true }),
    ).toBeVisible();
  };
  try {
    await savePrompt(changed);
    const draftChat = await context.newPage();
    await draftChat.goto("/projects/chat");
    expect(
      (await send(draftChat, "ordinary collection uat")).replies.at(-1)?.text,
    ).toBe(original);
    await draftChat.close();
    await publish();
    const publishedChat = await context.newPage();
    await publishedChat.goto("/projects/chat");
    expect(
      (await send(publishedChat, "ordinary collection uat")).replies.at(-1)
        ?.text,
    ).toBe(changed);
    await publishedChat.close();
    await page.reload();
    await expect(page.getByRole("log")).toContainText(original);
    await expect(page.getByRole("log")).not.toContainText(changed);
    review(await send(page, details));
  } finally {
    await savePrompt(original);
    if (
      await editor
        .getByRole("button", { name: "Publish changes", exact: true })
        .count()
    )
      await publish();
    await editor.close();
  }
});
