import { expect, test } from "@playwright/test";
import {
  appointmentChoiceOptions,
  appointmentSlotOptions,
  isReadOnlyCalendarOperation,
  resolveAppointmentChoice,
  upcomingAppointmentMatches,
} from "../../src/lib/appointment-lookup";
import { getTaskOperationOutcome } from "../../src/lib/task-operation-outcome";

const now = new Date("2026-09-12T00:00:00Z");
const first = {
  appointmentRef: "provider-A",
  start: "2026-09-21T00:00:00Z",
  end: "2026-09-21T00:30:00Z",
  spoken: "21 September at 10 AM Sydney",
};
const second = {
  ...first,
  appointmentRef: "provider-B",
  start: "2026-09-22T00:00:00Z",
  end: "2026-09-22T00:30:00Z",
  spoken: "22 September at 10 AM Sydney",
};

test("only upcoming complete matches enter the universal choice set", () => {
  expect(
    upcomingAppointmentMatches(
      {
        status: "success",
        appointments: [
          second,
          {
            ...first,
            appointmentRef: "past-appointment",
            start: "2026-09-11T00:00:00Z",
            end: "2026-09-13T00:00:00Z",
          },
          { ...first, privateData: "hidden" },
        ],
      },
      now,
    ),
  ).toEqual([first, second]);
  expect(
    upcomingAppointmentMatches({ status: "success", appointments: [] }, now),
  ).toEqual([]);
});

test("malformed, duplicate, reversed and failed results cannot imply a single match", () => {
  for (const appointments of [
    [first, { ...second, start: "bad" }],
    [first, first],
    [{ ...first, end: first.start }],
    Array(51).fill(first),
  ]) {
    expect(
      upcomingAppointmentMatches({ status: "success", appointments }, now),
    ).toBeNull();
  }
  expect(
    upcomingAppointmentMatches(
      { status: "rejected", appointments: [first] },
      now,
    ),
  ).toBeNull();
});

test("chat buttons, voice ordinals, labels and optional references resolve against the same offer", () => {
  const appointments = [first, second];
  for (const answer of [
    "2",
    "second",
    "the second one",
    "number 2",
    second.spoken,
    `2. ${second.spoken}`,
    second.appointmentRef,
  ]) {
    expect(resolveAppointmentChoice(appointments, answer)).toEqual(second);
  }
  for (const answer of ["0", "3", "another-provider-ref", "tomorrow maybe"])
    expect(resolveAppointmentChoice(appointments, answer)).toBeNull();
  expect(appointmentChoiceOptions(appointments)[1]).toEqual({
    label: `2. ${second.spoken}`,
    value: second.appointmentRef,
  });
});

test("an ambiguous date label needs a numbered choice or a matching reference", () => {
  const duplicateLabel = { ...second, spoken: first.spoken };
  expect(
    resolveAppointmentChoice([first, duplicateLabel], first.spoken),
  ).toBeNull();
  expect(resolveAppointmentChoice([first, duplicateLabel], "second")).toEqual(
    duplicateLabel,
  );
});

test("only declared lookup and availability adapters can bypass write confirmation", () => {
  for (const providerType of ["webhook", "n8n_webhook"]) {
    for (const operationType of [
      "appointment.lookup",
      "appointment.availability",
    ])
      expect(isReadOnlyCalendarOperation({ providerType, operationType })).toBe(
        true,
      );
    for (const operationType of [
      "appointment.book",
      "appointment.reschedule",
      "appointment.cancel",
      "unknown",
    ])
      expect(isReadOnlyCalendarOperation({ providerType, operationType })).toBe(
        false,
      );
  }
  expect(
    isReadOnlyCalendarOperation({
      providerType: "manual_review",
      operationType: "appointment.lookup",
    }),
  ).toBe(false);
});

test("generic calendar adapters require explicit business outcomes and bounded slots", () => {
  expect(
    getTaskOperationOutcome(
      { status: "completed", responsePayload: {} },
      { operationType: "appointment.reschedule" },
    ),
  ).toBe("outcome_unknown");
  expect(
    getTaskOperationOutcome(
      { status: "completed", responsePayload: { status: "rejected" } },
      { operationType: "appointment.reschedule" },
    ),
  ).toBe("rejected");
  expect(appointmentSlotOptions({ slots: [first] })).toEqual([
    { label: first.spoken, value: first.start },
  ]);
  expect(
    appointmentSlotOptions({ slots: [{ ...first, end: first.start }] }),
  ).toEqual([]);
});
