import { expect, test } from "@playwright/test";
import {
  findRequestedCalendarSlots,
  matchRequestedCalendarSlot,
  suggestCalendarSlots,
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

test("distinguishes an unoffered requested time from missing or ambiguous input", () => {
  const input = {
    date: "2026-09-22",
    timezone: "Australia/Sydney",
    options: [requestedSlot],
  };
  expect(
    findRequestedCalendarSlots({ ...input, text: "Book at 11 am" }),
  ).toEqual([]);
  expect(
    findRequestedCalendarSlots({ ...input, text: "Book at 10 am" }),
  ).toEqual([requestedSlot]);
  for (const text of [
    "Book tomorrow",
    "Book at 10 am or 11 am",
    "Book at 13 am",
    "Book at 10 am IST",
    "Book at 10 am Invalid/Zone",
  ]) {
    expect(findRequestedCalendarSlots({ ...input, text })).toBeNull();
  }
  expect(
    findRequestedCalendarSlots({
      text: "Book at 1:30 am",
      date: "2026-11-01",
      timezone: "America/New_York",
      options: [
        { label: "First 1:30", value: "2026-11-01T05:30:00Z" },
        { label: "Second 1:30", value: "2026-11-01T06:30:00Z" },
      ],
    }),
  ).toHaveLength(2);
});

const afternoonOptions = [
  "09:00",
  "14:00",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
].map((time) => ({ label: time, value: `2026-09-21T${time}:00Z` }));
test("full-day verified results allow a requested time beyond the initial display list", () => {
  const full = {
    ...attempt,
    responsePayload: {
      ...attempt.responsePayload,
      availabilityComplete: true,
      allSlots: afternoonOptions.map((option) => ({
        start: option.value,
        end: new Date(Date.parse(option.value) + 1800000).toISOString(),
        spoken: option.label,
      })),
    },
  };
  expect(verifiedCalendarSlots({ attempt: full, date, now })).toHaveLength(1);
  expect(
    verifiedCalendarSlots({ attempt: full, date, now, includeAll: true }),
  ).toHaveLength(6);
  expect(
    verifiedCalendarSlots({
      attempt: full,
      date,
      now: new Date(now.getTime() + 301000),
      includeAll: true,
    }),
  ).toEqual([]);
  expect(
    verifiedCalendarSlots({
      attempt: { ...full, status: "failed" },
      date,
      now,
      includeAll: true,
    }),
  ).toEqual([]);
  expect(
    verifiedCalendarSlots({
      attempt: {
        ...full,
        responsePayload: {
          ...full.responsePayload,
          allSlots: [{ start: "invented" }],
        },
      },
      date,
      now,
      includeAll: true,
    }),
  ).toEqual(verifiedCalendarSlots({ attempt, date, now }));
});
test("exact afternoon requests use the verified slot and busy requests rank nearest alternatives", () => {
  const input = {
    text: "Is 3:30 pm available?",
    date,
    timezone: "UTC",
    options: afternoonOptions,
  };
  expect(suggestCalendarSlots(input)?.matches).toEqual([afternoonOptions[3]]);
  const busy = suggestCalendarSlots({
    ...input,
    options: afternoonOptions.filter(
      (option) => option !== afternoonOptions[3],
    ),
  });
  expect(busy?.matches).toEqual([]);
  expect(busy?.options.slice(0, 2)).toEqual([
    afternoonOptions[2],
    afternoonOptions[4],
  ]);
  for (const text of ["after 2 pm", "in the afternoon", "before 4 pm"]) {
    expect(suggestCalendarSlots({ ...input, text })?.kind).toBe("window");
    expect(findRequestedCalendarSlots({ ...input, text })).toBeNull();
  }
  expect(
    suggestCalendarSlots({ ...input, text: "after 2 pm" })?.matches,
  ).not.toContainEqual(afternoonOptions[0]);
  for (const text of [
    "not 3:30 pm",
    "3 pm or 4 pm",
    "3:30 pm IST",
    "3:30 pm Invalid/Zone",
    "morning or afternoon",
  ])
    expect(suggestCalendarSlots({ ...input, text })).toBeNull();
});

test("words in an appointment reason do not turn an exact time into a window", () => {
  expect(
    suggestCalendarSlots({
      text: "Book at 3:30 pm for pain after exercise",
      date,
      timezone: "UTC",
      options: afternoonOptions,
    })?.kind,
  ).toBe("exact");
});
