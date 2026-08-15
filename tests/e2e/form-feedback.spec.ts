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

  let postIntercepted = false;
  await page.route("**/*", async (route) => {
    if (route.request().method() === "POST") {
      postIntercepted = true;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    await route.continue();
  });
  const submitButton = page.getByRole("button", { name: "Send Reset Link" });
  await submitButton.evaluate((button) => {
    const windowWithPendingState = window as typeof window & {
      pendingSubmitObserved?: boolean;
    };
    const recordPendingState = () => {
      if (
        button.hasAttribute("disabled") &&
        button.getAttribute("aria-busy") === "true" &&
        button.textContent?.includes("Sending...")
      ) {
        windowWithPendingState.pendingSubmitObserved = true;
      }
    };
    new MutationObserver(recordPendingState).observe(button, {
      attributes: true,
    });
    recordPendingState();
  });
  await submitButton.evaluate((button) =>
    (button as HTMLButtonElement).click(),
  );

  await expect.poll(() => postIntercepted).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { pendingSubmitObserved?: boolean })
            .pendingSubmitObserved === true,
      ),
    )
    .toBe(true);

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
