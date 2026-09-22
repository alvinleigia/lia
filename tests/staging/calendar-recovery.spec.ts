import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";

type Reply = {
  text: string;
  intent?: string;
  payload?: { options?: { label: string; value: string }[] };
};
type Result = { action?: { id: number }; replies: Reply[] };
const origin = "https://lia-staging.leigia.com";
const date = "7 October 2026";
const fullDate = "Wednesday, 7 October 2026";

function text(result: Result) {
  return result.replies.map((reply) => reply.text).join("\n");
}

async function openCalendarPage(browser: Browser, contexts: BrowserContext[]) {
  const context = await browser.newContext({
    baseURL: origin,
    storageState: ".playwright-auth/appointment.json",
  });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto("/projects/chat");
  expect(new URL(page.url()).origin).toBe(origin);
  await expect(
    page.getByRole("button", {
      name: /Selected Project: Phase 16 Lifecycle UAT.*94/,
    }),
  ).toBeVisible();
  return page;
}

async function send(page: Page, message: string) {
  await expect(page.locator("textarea")).toBeEnabled();
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/actions/runtime" &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.text === message,
    { timeout: 90_000 },
  );
  await page.locator("textarea").fill(message);
  await page.locator("textarea").press("Enter");
  const response = await pending;
  expect(response.status()).toBe(200);
  const result = (await response.json()) as Result;
  if (result.action) expect(result.action.id).toBe(60);
  await test.info().attach(`turn-${test.info().attachments.length + 1}`, {
    body: JSON.stringify({ message, replies: result.replies }),
    contentType: "application/json",
  });
  return result;
}

test("calendar conflict retains details and multiple-match lookup selects the existing appointment", async ({
  browser,
}) => {
  test.skip(
    process.env.RUN_STAGING_CALENDAR_UAT !== "1",
    "Explicit opt-in: creates and cancels synthetic staging calendar events.",
  );
  test.setTimeout(600_000);
  expect(Date.now()).toBeLessThan(Date.parse("2026-10-07T00:00:00+11:00"));
  const name = "UAT Recovery Rider";
  const phone = `+1202555${String(Date.now() % 10_000).padStart(4, "0")}`;
  const reason = "synthetic recovery test";
  const contexts: BrowserContext[] = [];
  const open = () => openCalendarPage(browser, contexts);
  const booking = (time: string) =>
    `I want to book an appointment on ${date} at ${time} Australia/Sydney. My name is ${name}, my contact number is ${phone}, and the reason is ${reason}.`;
  const review = (result: Result, time: string) => {
    expect(
      result.replies.some((reply) => reply.intent === "confirmation"),
    ).toBe(true);
    expect(text(result)).toContain(`${fullDate} at ${time}`);
    expect(text(result)).toContain(name);
    expect(text(result)).toContain(phone);
    expect(text(result)).toContain(reason);
  };
  let writesAttempted = false;
  try {
    const preflight = await open();
    expect(
      text(
        await send(
          preflight,
          `I want to cancel my appointment. My name is ${name} and my contact number is ${phone}.`,
        ),
      ),
    ).toMatch(/could not find a matching appointment/i);
    await send(preflight, "Cancel");
    const waiting = await open();
    review(await send(waiting, booking("3:00 pm")), "3:00 pm");
    const winner = await open();
    review(await send(winner, booking("3:00 pm")), "3:00 pm");
    writesAttempted = true;
    expect(text(await send(winner, "Confirm"))).toMatch(
      /completed[\s\S]*successfully/,
    );

    const conflict = await send(waiting, "Confirm");
    expect(text(conflict)).toMatch(
      /couldn't confirm availability|no longer available|not available/i,
    );
    expect(text(conflict)).not.toMatch(/completed[\s\S]*successfully/);
    expect(
      conflict.replies
        .flatMap((reply) => reply.payload?.options ?? [])
        .some((option) => option.label === `${fullDate} at 3:00 pm`),
    ).toBe(false);
    review(await send(waiting, "Is 3:30 pm available?"), "3:30 pm");
    await waiting.screenshot({
      path: test.info().outputPath("conflict-recovered.png"),
      fullPage: true,
    });
    await send(waiting, "Cancel");

    const second = await open();
    review(await send(second, booking("4:00 pm")), "4:00 pm");
    expect(text(await send(second, "Confirm"))).toMatch(
      /completed[\s\S]*successfully/,
    );

    const lookup = await open();
    const matches = await send(
      lookup,
      `I want to reschedule my appointment. My name is ${name} and my contact number is ${phone}.`,
    );
    expect(text(matches)).toMatch(/Which upcoming appointment/i);
    expect(text(matches)).toContain(`${fullDate} at 3:00 pm`);
    expect(text(matches)).toContain(`${fullDate} at 4:00 pm`);
    const early = await send(lookup, "Is 3:30 pm available?");
    expect(text(early)).toMatch(/noted your preferred time/i);
    expect(text(early)).toMatch(/Which upcoming appointment/i);
    const selected = await send(lookup, `${fullDate} at 3:00 pm`);
    expect(text(selected)).toMatch(/Preferred Date/i);
    const reschedule = await send(lookup, "2026-10-07");
    review(reschedule, "3:30 pm");
    expect(text(reschedule)).toContain("Appointment Reference: apt_");
    expect(text(reschedule)).toContain(`${fullDate} at 3:00 pm`);
    expect(text(reschedule)).toMatch(/currently available/i);
    await lookup.screenshot({
      path: test.info().outputPath("multiple-match-review.png"),
      fullPage: true,
    });
    await send(lookup, "Cancel");
  } finally {
    // Only this run's synthetic identity is eligible for cleanup, through the same UI.
    try {
      if (writesAttempted) {
        let empty = false;
        for (let index = 0; index < 3; index++) {
          const cleanup = await open();
          let result = await send(
            cleanup,
            `I want to cancel my appointment. My name is ${name} and my contact number is ${phone}.`,
          );
          if (/could not find a matching appointment/i.test(text(result))) {
            empty = true;
            await send(cleanup, "Cancel");
            break;
          }
          if (/Which upcoming appointment/i.test(text(result))) {
            result = await send(cleanup, `${fullDate} at 3:00 pm`);
          }
          expect(text(result)).toContain(name);
          expect(text(result)).toContain(phone);
          expect(text(result)).toContain(reason);
          expect(text(result)).toMatch(/Appointment Reference: apt_/);
          expect(
            result.replies.some((reply) => reply.intent === "confirmation"),
          ).toBe(true);
          expect(text(await send(cleanup, "Confirm"))).toMatch(
            /completed[\s\S]*successfully/,
          );
        }
        expect(
          empty,
          "Synthetic appointment lookup must be empty after cleanup",
        ).toBe(true);
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  }
});

for (const time of ["3:00 pm", "3:30 pm", "4:00 pm"]) {
  test(`simultaneous booking allows one winner at ${time}`, async ({
    browser,
  }) => {
    test.skip(
      process.env.RUN_STAGING_CALENDAR_RACE_UAT !== "1",
      "Explicit opt-in: races two synthetic staging bookings and cancels the result.",
    );
    test.setTimeout(300_000);
    expect(Date.now()).toBeLessThan(Date.parse("2026-10-09T00:00:00+11:00"));
    const appointment = `Friday, 9 October 2026 at ${time}`;
    const reason = "synthetic simultaneous booking test";
    const contexts: BrowserContext[] = [];
    const open = () => openCalendarPage(browser, contexts);
    const suffix = Date.now() % 9_999;
    const callers = ["UAT Race Alpha", "UAT Race Beta"].map((name, index) => ({
      name,
      phone: `+1202555${String(suffix + index).padStart(4, "0")}`,
    }));
    const lookup = (caller: (typeof callers)[number]) =>
      `I want to cancel my appointment. My name is ${caller.name} and my contact number is ${caller.phone}.`;
    let writesAttempted = false;
    let bookingsFound = 0;
    try {
      const pages: Page[] = [];
      for (const caller of callers) {
        const preflight = await open();
        expect(text(await send(preflight, lookup(caller)))).toMatch(
          /could not find a matching appointment/i,
        );
        await send(preflight, "Cancel");
        const page = await open();
        const review = await send(
          page,
          `I want to book an appointment on 9 October 2026 at ${time} Australia/Sydney. My name is ${caller.name}, my contact number is ${caller.phone}, and the reason is ${reason}.`,
        );
        expect(
          review.replies.some((reply) => reply.intent === "confirmation"),
        ).toBe(true);
        expect(text(review)).toContain(appointment);
        expect(text(review)).toContain(caller.name);
        expect(text(review)).toContain(caller.phone);
        expect(text(review)).toContain(reason);
        pages.push(page);
      }
      // Hold both UI-generated requests until ready, then release them together.
      let release = () => {};
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const releasedAt: number[] = [];
      let arrivals = 0;
      const timeout = setTimeout(release, 30_000);
      for (const page of pages) {
        await page.route("**/api/actions/runtime", async (route) => {
          if (
            route.request().method() === "POST" &&
            route.request().postDataJSON()?.text === "Confirm"
          ) {
            arrivals++;
            if (arrivals === 2) release();
            await barrier;
            releasedAt.push(performance.now());
          }
          await route.continue();
        });
      }
      writesAttempted = true;
      const settled = await Promise.allSettled(
        pages.map((page) => send(page, "Confirm")),
      );
      clearTimeout(timeout);
      const results = settled.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
      expect(arrivals).toBe(2);
      const releaseSkewMs = Math.abs(releasedAt[1] - releasedAt[0]);
      await test.info().attach("race-timing", {
        body: JSON.stringify({ releaseSkewMs, replies: results.map(text) }),
        contentType: "application/json",
      });
      expect(releaseSkewMs).toBeLessThan(100);
      const winners = results.filter((result) =>
        /completed[\s\S]*successfully/.test(text(result)),
      );
      expect(winners).toHaveLength(1);
      const loser = results.find((result) => result !== winners[0]);
      if (!loser) throw new Error("Expected a second caller response");
      expect(text(loser)).toMatch(
        /couldn't confirm availability|no longer available|not available/i,
      );
      const alternatives = loser.replies.flatMap(
        (reply) => reply.payload?.options ?? [],
      );
      expect(alternatives.length).toBeGreaterThan(0);
      expect(alternatives.some((option) => option.label === appointment)).toBe(
        false,
      );
      for (const [index, page] of pages.entries()) {
        await page.screenshot({
          path: test.info().outputPath(`race-caller-${index + 1}.png`),
          fullPage: true,
        });
      }
      const loserIndex = results.indexOf(loser);
      const alternativeReview = await send(
        pages[loserIndex],
        alternatives[0].label,
      );
      expect(
        alternativeReview.replies.some(
          (reply) => reply.intent === "confirmation",
        ),
      ).toBe(true);
      expect(text(alternativeReview)).toContain(callers[loserIndex].name);
      expect(text(alternativeReview)).toContain(callers[loserIndex].phone);
      expect(text(alternativeReview)).toContain(reason);
      expect(text(alternativeReview)).toContain(alternatives[0].label);
      await send(pages[loserIndex], "Cancel");
    } finally {
      try {
        if (writesAttempted) {
          for (const caller of callers) {
            const cleanup = await open();
            const found = await send(cleanup, lookup(caller));
            if (/could not find a matching appointment/i.test(text(found))) {
              await send(cleanup, "Cancel");
              continue;
            }
            expect(
              found.replies.some((reply) => reply.intent === "confirmation"),
            ).toBe(true);
            expect(text(found)).toContain(caller.name);
            expect(text(found)).toContain(caller.phone);
            expect(text(found)).toContain(reason);
            expect(text(found)).toContain(`${appointment} (Australia/Sydney)`);
            expect(text(found)).toContain("Appointment Reference: apt_");
            bookingsFound++;
            expect(text(await send(cleanup, "Confirm"))).toMatch(
              /completed[\s\S]*successfully/,
            );
            const empty = await open();
            expect(text(await send(empty, lookup(caller)))).toMatch(
              /could not find a matching appointment/i,
            );
            await send(empty, "Cancel");
          }
        }
      } finally {
        await Promise.all(contexts.map((context) => context.close()));
      }
    }
    expect(
      bookingsFound,
      "Exactly one actual booking must be found across both identities",
    ).toBe(1);
  });
}

test.describe("delayed calendar", () => {
  test.describe.configure({ mode: "parallel" });
  for (const resumeMode of ["open", "reload"] as const) {
    test(`delayed confirmation ${resumeMode} revalidates after fifteen minutes without repeating review`, async ({
      browser,
    }) => {
      test.skip(
        process.env.RUN_STAGING_DELAYED_CALENDAR_UAT !== "1",
        "Explicit opt-in: waits over fifteen minutes and creates/cancels a synthetic staging event.",
      );
      test.setTimeout(22 * 60_000);
      expect(Date.now()).toBeLessThan(Date.parse("2026-10-08T00:00:00+11:00"));
      const name =
        resumeMode === "open" ? "UAT Waiting Rider" : "UAT Delayed Rider";
      const phone = `+1202555${String(Date.now() % 10_000).padStart(4, "0")}`;
      const reason = "synthetic delayed confirmation test";
      const time = resumeMode === "open" ? "4:00 pm" : "3:00 pm";
      const appointment = `Thursday, 8 October 2026 at ${time}`;
      const contexts: BrowserContext[] = [];
      const open = () => openCalendarPage(browser, contexts);
      const lookupMessage = `I want to cancel my appointment. My name is ${name} and my contact number is ${phone}.`;
      let writeAttempted = false;
      let bookingCompleted = false;
      try {
        const preflight = await open();
        expect(text(await send(preflight, lookupMessage))).toMatch(
          /could not find a matching appointment/i,
        );
        await send(preflight, "Cancel");
        const page = await open();
        const review = await send(
          page,
          `I want to book an appointment on 8 October 2026 at ${time} Australia/Sydney. My name is ${name}, my contact number is ${phone}, and the reason is ${reason}.`,
        );
        expect(
          review.replies.some((reply) => reply.intent === "confirmation"),
        ).toBe(true);
        expect(text(review)).toContain(appointment);
        expect(text(review)).toContain(name);
        expect(text(review)).toContain(phone);
        expect(text(review)).toContain(reason);
        await expect(
          page.getByRole("button", { name: "Confirm", exact: true }),
        ).toBeVisible();
        const reviewedAt = new Date().toISOString();
        const started = performance.now();
        const waitMs = 15 * 60_000 + 10_000;
        console.log(
          `[delayed-confirmation] Review ready at ${reviewedAt}; waiting 15 minutes 10 seconds with no clock or database changes.`,
        );
        // Wall-clock expiry must happen on the deployed server; a browser clock mock is insufficient.
        while (performance.now() - started < waitMs) {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Math.min(30_000, waitMs - (performance.now() - started)),
            ),
          );
        }
        const elapsedMs = performance.now() - started;
        expect(elapsedMs).toBeGreaterThanOrEqual(waitMs);
        await test.info().attach("elapsed-time", {
          body: JSON.stringify({
            reviewedAt,
            confirmingAt: new Date().toISOString(),
            elapsedMs,
          }),
          contentType: "application/json",
        });
        // Test both an untouched expired review and a restored chat after a reload.
        if (resumeMode === "reload") await page.reload();
        await expect(
          page.getByRole("button", { name: "Confirm", exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("log")).toContainText(reason);
        writeAttempted = true;
        const completed = await send(page, "Confirm");
        bookingCompleted = /completed[\s\S]*successfully/.test(text(completed));
        expect(bookingCompleted).toBe(true);
        expect(
          completed.replies.some((reply) => reply.intent === "confirmation"),
        ).toBe(false);
        expect(text(completed)).not.toMatch(
          /Please review|choose.*time|provide.*(?:name|number|reason)/i,
        );
        await expect(page.getByRole("log")).toContainText(
          /completed[\s\S]*successfully/,
        );
        await page.screenshot({
          path: test.info().outputPath("delayed-confirmation-completed.png"),
          fullPage: true,
        });
      } finally {
        try {
          if (writeAttempted) {
            const cleanup = await open();
            const found = await send(cleanup, lookupMessage);
            if (/could not find a matching appointment/i.test(text(found))) {
              expect(
                bookingCompleted,
                "A reported successful booking must be discoverable",
              ).toBe(false);
              await send(cleanup, "Cancel");
            } else {
              expect(
                found.replies.some((reply) => reply.intent === "confirmation"),
              ).toBe(true);
              expect(text(found)).toContain(name);
              expect(text(found)).toContain(phone);
              expect(text(found)).toContain(reason);
              expect(text(found)).toContain(
                `${appointment} (Australia/Sydney)`,
              );
              expect(text(found)).toContain("Appointment Reference: apt_");
              expect(text(await send(cleanup, "Confirm"))).toMatch(
                /completed[\s\S]*successfully/,
              );
              const empty = await open();
              expect(text(await send(empty, lookupMessage))).toMatch(
                /could not find a matching appointment/i,
              );
              await send(empty, "Cancel");
            }
          }
        } finally {
          await Promise.all(contexts.map((context) => context.close()));
        }
      }
    });
  }
});
