import { expect, test } from "@playwright/test";
import {
  matchRequestedCalendarSlot,
  verifiedCalendarSlots,
} from "../../src/lib/conversational-task-calendar-availability";
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

const requestedSlot = {
  label: "22 September at 10 am Sydney",
  value: "2026-09-22T00:00:00.000Z",
};
for (const text of [
  "Book 22 September at 10:00 am Australia/Sydney. My name is Alex Test.",
  "Book at 10 am",
  "Book at 10:00",
]) {
  test(`opening-message time matches only an offered instant: ${text}`, () => {
    expect(
      matchRequestedCalendarSlot({
        text,
        date: "2026-09-22",
        timezone: "Australia/Sydney",
        options: [requestedSlot],
      }),
    ).toEqual(requestedSlot);
  });
}
for (const text of [
  "Book at 11 am",
  "Book at 10 am or 11 am",
  "Book tomorrow",
  "Book at 13 am",
  "Book at 10 am Invalid/Zone",
  "Book at 10 am Australia/Sydney or Asia/Kolkata",
]) {
  test(`unavailable or ambiguous opening time is not selected: ${text}`, () => {
    expect(
      matchRequestedCalendarSlot({
        text,
        date: "2026-09-22",
        timezone: "Australia/Sydney",
        options: [requestedSlot],
      }),
    ).toBeNull();
  });
}
test("explicit visitor zone overrides provider zone without inventing availability", () => {
  const input = {
    text: "Book at 5:30 am Asia/Kolkata",
    date: "2026-09-22",
    timezone: "Australia/Sydney",
    options: [requestedSlot],
  };
  expect(matchRequestedCalendarSlot(input)).toEqual(requestedSlot);
  expect(
    matchRequestedCalendarSlot({ ...input, date: "2026-09-23" }),
  ).toBeNull();
  expect(matchRequestedCalendarSlot({ ...input, options: [] })).toBeNull();
});
test("a repeated daylight-saving clock hour needs an explicit slot choice", () => {
  expect(
    matchRequestedCalendarSlot({
      text: "Book at 1:30 am",
      date: "2026-11-01",
      timezone: "America/New_York",
      options: [
        { label: "First 1:30", value: "2026-11-01T05:30:00Z" },
        { label: "Second 1:30", value: "2026-11-01T06:30:00Z" },
      ],
    }),
  ).toBeNull();
});

test("explicit UTC overrides local provider time; unsupported zone shorthand asks for a choice", () => {
  const input = {
    date: "2026-09-22",
    timezone: "Australia/Sydney",
    options: [requestedSlot],
  };
  expect(
    matchRequestedCalendarSlot({ ...input, text: "Book at 00:00 UTC" }),
  ).toEqual(requestedSlot);
  for (const text of ["Book at 10 am UTC+10", "Book at 10 am IST"]) {
    expect(matchRequestedCalendarSlot({ ...input, text })).toBeNull();
  }
});
