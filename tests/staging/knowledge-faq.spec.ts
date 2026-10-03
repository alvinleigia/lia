import { expect, test } from "@playwright/test";

// Existing staging fixture: project 94 has an approved 15:00 check-in answer,
// an explicit no-answer for guaranteed late checkout, and indexed documents.
const cases = [
  {
    name: "exact FAQ remains deterministic",
    question: "What time is check-in?",
    answer: true,
    deterministic: true,
  },
  {
    name: "FAQ paraphrase uses approved evidence",
    question: "At what time can I check in?",
    answer: true,
    deterministic: false,
  },
  {
    name: "unapproved early check-in is not promised",
    question: "Can I check in at 10 am?",
    answer: true,
    deterministic: false,
  },
  {
    name: "no-answer paraphrase does not invent a guarantee",
    question: "Can you guarantee a late checkout?",
    answer: false,
    deterministic: false,
  },
];

for (const scenario of cases) {
  test(scenario.name, async ({ page }) => {
    await page.goto("/projects");
    await page
      .getByRole("button", { name: /Phase 16 Lifecycle UAT.*94/ })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Selected Project: Phase 16 Lifecycle UAT (#94)",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto("/projects/chat");
    await expect(
      page.getByRole("button", {
        name: "Selected Project: Phase 16 Lifecycle UAT (#94)",
        exact: true,
      }),
    ).toBeVisible();
    const pending = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/conversation/turn" &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.visitorMessage === scenario.question,
      { timeout: 90_000 },
    );
    await expect(page.locator("textarea")).toBeEnabled();
    await page.locator("textarea").fill(scenario.question);
    await page.locator("textarea").press("Enter");
    const response = await pending;
    expect(response.status()).toBe(200);
    const result = await response.json();
    await test.info().attach("knowledge-response", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
    const { proposal } = result.execution;
    await expect(page.getByRole("log")).toContainText(proposal.reply);
    expect(proposal.toolRequest).toBeNull();
    expect(proposal.taskRecommendation).toBeNull();
    if (scenario.answer) {
      expect(proposal.reply).toMatch(/15:00|3\s*p\.?m\.?/i);
      expect(proposal.grounding.excerptIds).toContain(
        "project_approved_answer:1",
      );
      if (scenario.question.includes("10 am")) {
        expect(proposal.reply).not.toMatch(/^yes\b/i);
      }
    } else {
      expect(proposal.reply).toMatch(
        /not|cannot|can.t|don.t|unverified|unavailable/i,
      );
      expect(proposal.grounding.excerptIds).not.toContain(
        "project_approved_answer:2",
      );
      expect(proposal.reply).not.toMatch(/^yes\b/i);
    }
    if (scenario.deterministic) {
      expect(result.execution.source).toBe("deterministic");
      expect(result.execution.attempts).toBe(0);
    }
    await page.screenshot({
      path: test.info().outputPath("reply.png"),
      fullPage: true,
    });
  });
}
