import { expect, test } from "@playwright/test";

test("redirecting action forms preserve scroll and show toast feedback", async ({
  page,
}) => {
  await page.goto("/forgot-password");
  await page.addStyleTag({
    content:
      "div.min-h-screen { padding-top: 1800px !important; padding-bottom: 1800px !important; }",
  });

  await page
    .getByLabel("Email")
    .fill(`scroll-check-${Date.now()}@example.test`);
  const scrollBeforeSubmit = await page.evaluate(() => window.scrollY);
  expect(scrollBeforeSubmit).toBeGreaterThan(800);

  await page.getByRole("button", { name: "Send Reset Link" }).click();

  await expect(
    page.getByText("If that email exists, a reset link has been sent."),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(scrollBeforeSubmit - 200);
});

test("flash toasts observe URL events outside router search state", async ({
  page,
}) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("observer-ready@example.test");

  await page.evaluate(() => {
    History.prototype.pushState.call(
      window.history,
      window.history.state,
      "",
      "/forgot-password?sent=1",
    );
    document.body.append(document.createElement("span"));
  });

  await expect(
    page.getByText("If that email exists, a reset link has been sent."),
  ).toBeVisible();
  await expect(page).toHaveURL("/forgot-password");
});
