import { readFileSync } from "node:fs";
import { expect, type FrameLocator, type Page, test } from "@playwright/test";

async function send(page: Page, widget: FrameLocator, text: string) {
  const composer = widget.getByRole("textbox", {
    name: "Ask a question...",
    exact: true,
  });
  await expect(composer).toBeEnabled();
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/widget/actions/runtime" &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.text === text,
    { timeout: 90_000 },
  );
  await composer.fill(text);
  await widget.getByRole("button", { name: "Send", exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const result = await response.json();
  if (result.action) expect(result.action.id).toBe(62);
  await test.info().attach(`turn-${test.info().attachments.length + 1}`, {
    body: JSON.stringify(
      { text, activeFlow: result.activeFlow, replies: result.replies },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await expect(widget.getByRole("log")).toContainText(
    result.replies.at(-1).text.split("\n")[0],
  );
  return result;
}

for (const mobile of [false, true]) {
  test(`embedded widget ${mobile ? "mobile" : "desktop"} retains configured fields through validation and reload`, async ({
    page,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    );
    const { token } = JSON.parse(
      readFileSync(".playwright-auth/widget-95.json", "utf8"),
    );
    await page.goto("/");
    // Exercise the actual widget document inside an iframe on the staging host.
    await page.evaluate((token) => {
      const frame = document.createElement("iframe");
      frame.title = "UAT embedded widget";
      frame.src = `/widget/embed?token=${encodeURIComponent(token)}`;
      frame.style.cssText =
        "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:99999;background:white";
      document.body.appendChild(frame);
    }, token);
    const widget = page.frameLocator('iframe[title="UAT embedded widget"]');
    await expect(
      widget.getByRole("button", {
        name: "Ordinary Collection UAT 2026-09-22",
        exact: true,
      }),
    ).toBeEnabled();
    const first = await send(
      page,
      widget,
      "I want an ordinary form enquiry. My name is UAT Widget Rider, my email is widget.rider@example.com, my contact number is +12025550126, quantity is 99, service subject is inspection, preferred date is 25 September 2026, and preferred time is 3:30 pm.",
    );
    expect(first.activeFlow?.mode).toBe("collecting");
    expect(first.replies.at(-1).text).toContain("Quantity");
    const result = await send(page, widget, "2");
    expect(result.activeFlow?.mode).toBe("confirming");
    expect(result.activeFlow.fields).toMatchObject({
      customerName: "UAT Widget Rider",
      quantity: "2",
      preferredTime: "15:30",
      serviceSubject: "inspection",
    });
    expect(result.replies.at(-1).text).toContain(
      "Customer Name: UAT Widget Rider",
    );
    expect(result.replies.at(-1).text).not.toMatch(/colour:/i);
    await Promise.all([
      page.waitForEvent("framenavigated", {
        predicate: (frame) => new URL(frame.url()).pathname === "/widget/embed",
      }),
      widget.locator("body").evaluate(() => window.location.reload()),
    ]);
    await expect(widget.getByRole("log")).toContainText(
      "Customer Name: UAT Widget Rider",
    );
    expect(
      await widget
        .locator("html")
        .evaluate((root) => root.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await send(page, widget, "Confirm");
    await expect(widget.getByRole("log")).toContainText(
      "Thanks. I saved this request.",
    );
    await page.screenshot({
      path: test.info().outputPath("widget-completed.png"),
      fullPage: true,
    });
  });
}
