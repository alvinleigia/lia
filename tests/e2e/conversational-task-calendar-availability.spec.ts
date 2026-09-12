import { expect, test } from "@playwright/test";
import { verifiedCalendarSlots } from "../../src/lib/conversational-task-calendar-availability";
import { getTaskOperationOutcome } from "../../src/lib/task-operation-outcome";

const now = new Date("2026-09-12T00:00:00Z");
const date = "2026-09-21";
const attempt = {
  status: "completed",
  finishedAt: now,
  requestPayload: { payload: { date } },
  responsePayload: {
    status: "success",
    date,
    slots: [
      {
        start: "2026-09-21T09:00:00Z",
        end: "2026-09-21T09:30:00Z",
        spoken: "Monday at 9 AM",
        secret: "private",
      },
    ],
  },
};

test("Calendar choices contain only bounded provider slots and ISO values", () => {
  expect(verifiedCalendarSlots({ attempt, date, now })).toEqual([
    { label: "Monday at 9 AM", value: "2026-09-21T09:00:00Z" },
  ]);
  expect(
    verifiedCalendarSlots({ attempt, date, now }).some(
      ({ value }) => value === "10:00 AM",
    ),
  ).toBe(false);
});
for (const status of [
  "rejected",
  "no_result",
  "provider_failure",
  "timeout",
  "outcome_unknown",
  "cancelled",
]) {
  test(`completed transport with ${status} never supplies choices or success`, () => {
    const failed = {
      ...attempt,
      responsePayload: { ...attempt.responsePayload, status },
    };
    expect(getTaskOperationOutcome(failed)).toBe(status);
    expect(verifiedCalendarSlots({ attempt: failed, date, now })).toEqual([]);
  });
}
test("stale slots and slots for another date cannot authorize a selection", () => {
  expect(verifiedCalendarSlots({ attempt, date: "2026-09-22", now })).toEqual(
    [],
  );
  expect(
    verifiedCalendarSlots({
      attempt,
      date,
      now: new Date(now.getTime() + 301_000),
    }),
  ).toEqual([]);
  expect(
    verifiedCalendarSlots({
      attempt: { ...attempt, status: "pending" },
      date,
      now,
    }),
  ).toEqual([]);
});
test("malformed or unverified Calendar payloads fail closed", () => {
  expect(
    getTaskOperationOutcome(
      { status: "completed", responsePayload: {} },
      { operationType: "google_calendar.book" },
    ),
  ).toBe("outcome_unknown");
  expect(
    verifiedCalendarSlots({
      attempt: {
        ...attempt,
        responsePayload: {
          ...attempt.responsePayload,
          slots: [{ start: "10 AM", end: "later", spoken: "10 AM" }],
        },
      },
      date,
      now,
    }),
  ).toEqual([]);
});
