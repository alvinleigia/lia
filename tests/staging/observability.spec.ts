import { expect, test } from "@playwright/test";

test("runtime turns populate Diagnostics request, latency and token metrics", async ({
  page,
}) => {
  await page.goto("/projects/diagnostics");
  await expect(
    page.getByRole("button", {
      name: /Selected Project: Bike Service Entity UAT.*95/,
    }),
  ).toBeVisible();
  const metric = async (label: string) => {
    const text = await page
      .getByText(label, { exact: true })
      .locator("..")
      .innerText();
    return Number(text.match(/\n\s*([\d.]+)/)?.[1]);
  };
  const before = {
    requests: await metric("Requests - 24h"),
    tokens: await metric("Model tokens"),
  };
  await page.goto("/projects/chat");
  const send = async (text: string) => {
    await expect(page.locator("textarea")).toBeEnabled();
    const pending = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/actions/runtime" &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.text === text,
      { timeout: 90_000 },
    );
    await page.locator("textarea").fill(text);
    await page.locator("textarea").press("Enter");
    expect((await pending).status()).toBe(200);
  };
  await send(
    "I want an ordinary form enquiry. My name is UAT Metrics Rider, email metrics.rider@example.com, contact +12025550126, quantity 2, service subject inspection, preferred date 25 September 2026 and preferred time 3:30 pm.",
  );
  await expect(page.getByRole("log")).toContainText(
    "Please review your enquiry.",
  );
  await send("Cancel");
  await expect(page.getByRole("log")).toContainText(/cancel/i);
  await page.goto("/projects/diagnostics");
  await expect
    .poll(
      async () => {
        await page.reload();
        return metric("Requests - 24h");
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(before.requests + 2);
  expect(await metric("Average latency")).toBeGreaterThan(0);
  expect(await metric("Model tokens")).toBeGreaterThan(before.tokens);
  await test.info().attach("metrics", {
    body: JSON.stringify({
      before,
      after: {
        requests: await metric("Requests - 24h"),
        tokens: await metric("Model tokens"),
        latencyMs: await metric("Average latency"),
      },
    }),
    contentType: "application/json",
  });
  await page.screenshot({
    path: test.info().outputPath("runtime-metrics.png"),
    fullPage: true,
  });
});
