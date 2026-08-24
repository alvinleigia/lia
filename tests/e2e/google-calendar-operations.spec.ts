import { createHash, generateKeyPairSync } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  executeGoogleCalendarProviderOperation,
  type GoogleCalendarAppointment,
  type GoogleCalendarAppointmentStore,
} from "../../src/lib/google-calendar";
import type {
  GoogleBusyPeriod,
  GoogleCalendarApi,
  GoogleCalendarEvent,
} from "../../src/lib/google-calendar-api";
import {
  createGoogleCalendarApi,
  GoogleCalendarApiError,
} from "../../src/lib/google-calendar-api";
import {
  isProviderSecretReference,
  prepareProviderConfig,
} from "../../src/lib/provider-secrets";

const IDENTITY_SECRET = "phase-18-12-identity-secret-at-least-32-characters";
const NOW = new Date("2026-08-23T22:00:00.000Z");
const MONDAY_NINE = "2026-08-23T23:00:00.000Z";
const MONDAY_NINE_THIRTY = "2026-08-23T23:30:00.000Z";
const TUESDAY_TEN = "2026-08-25T00:00:00.000Z";

const config = {
  appointmentDurationMinutes: 30,
  calendarId: "clinic@example.test",
  clientEmail: "lia-calendar@example.iam.gserviceaccount.com",
  closeTime: "17:00",
  identityFactors: ["patientName", "dateOfBirth"],
  openTime: "09:00",
  privateKey: `-----BEGIN PRIVATE KEY-----\n${"x".repeat(120)}\n-----END PRIVATE KEY-----`,
  schedulingHorizonDays: 60,
  slotIntervalMinutes: 30,
  timezone: "Australia/Sydney",
  timeoutMs: 8_000,
  workingDays: [1, 2, 3, 4, 5],
};

test("Google Calendar credentials are encrypted by the project provider boundary", () => {
  const prepared = prepareProviderConfig(config);
  expect(isProviderSecretReference(prepared.config.privateKey)).toBe(true);
  expect(prepared.secrets.map(({ secretName }) => secretName)).toEqual([
    "privateKey",
  ]);
  expect(JSON.stringify(prepared.config)).not.toContain("BEGIN PRIVATE KEY");
});

test("the direct Google client signs once and calls the v3 freebusy endpoint", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const calls: Array<{ body: string; headers: Headers; url: string }> = [];
  let tokenCalls = 0;
  const fetcher: typeof fetch = async (request, init) => {
    const url = String(request);
    if (url === "https://oauth2.googleapis.com/token") {
      tokenCalls += 1;
      return Response.json({
        access_token: "google-access-token",
        expires_in: 3600,
      });
    }
    calls.push({
      body: String(init?.body ?? ""),
      headers: new Headers(init?.headers),
      url,
    });
    return Response.json({
      calendars: {
        [config.calendarId]: {
          busy: [{ end: "2026-08-24T00:00:00Z", start: MONDAY_NINE_THIRTY }],
        },
      },
    });
  };
  const api = createGoogleCalendarApi(
    {
      ...config,
      privateKey: privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString(),
    },
    fetcher,
  );
  await api.freeBusy({
    end: new Date("2026-08-24T07:00:00Z"),
    start: new Date(MONDAY_NINE),
  });
  await api.freeBusy({
    end: new Date("2026-08-24T07:00:00Z"),
    start: new Date(MONDAY_NINE),
  });

  expect(tokenCalls).toBe(1);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toMatchObject({
    url: "https://www.googleapis.com/calendar/v3/freeBusy",
  });
  expect(calls[0]?.headers.get("authorization")).toBe(
    "Bearer google-access-token",
  );
  expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
    items: [{ id: config.calendarId }],
    timeZone: config.timezone,
  });
});

test("the direct Google client uses conditional event writes without returning provider bodies", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const calls: Array<{
    body: string;
    headers: Headers;
    method: string;
    url: string;
  }> = [];
  const event = {
    end: { dateTime: "2026-08-23T23:30:00Z" },
    etag: "etag-1",
    id: "liaevent1",
    start: { dateTime: MONDAY_NINE },
    status: "confirmed",
  };
  const fetcher: typeof fetch = async (request, init) => {
    const url = String(request);
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({
        access_token: "write-access-token",
        expires_in: 3600,
      });
    }
    calls.push({
      body: String(init?.body ?? ""),
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url,
    });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json(event);
  };
  const api = createGoogleCalendarApi(
    {
      ...config,
      privateKey: privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString(),
    },
    fetcher,
  );
  await api.insertEvent({
    description: "Booked by Lia.",
    end: new Date(event.end.dateTime),
    eventId: event.id,
    privateProperties: { liaOperationKey: "operation-hash" },
    start: new Date(event.start.dateTime),
    summary: "Appointment",
  });
  await api.patchEvent({
    end: new Date(event.end.dateTime),
    etag: event.etag,
    eventId: event.id,
    start: new Date(event.start.dateTime),
  });
  await api.deleteEvent({ eventId: event.id, etag: event.etag });

  expect(calls.map(({ method }) => method)).toEqual([
    "POST",
    "PATCH",
    "DELETE",
  ]);
  expect(calls[0]?.url).toBe(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events`,
  );
  expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
    extendedProperties: { private: { liaOperationKey: "operation-hash" } },
    id: event.id,
  });
  expect(calls[1]?.headers.get("if-match")).toBe(event.etag);
  expect(calls[2]?.headers.get("if-match")).toBe(event.etag);
});

test("availability uses freebusy and excludes past, closed, and overlapping slots", async () => {
  const api = new MemoryGoogleCalendarApi();
  api.busy.push({
    end: new Date("2026-08-24T00:00:00.000Z"),
    start: new Date(MONDAY_NINE_THIRTY),
  });
  const context = fixture({ api });
  const available = await execute(context, "google_calendar.availability", {
    date: "2026-08-24",
    limit: 4,
  });
  expect(available).toMatchObject({
    responsePayload: {
      status: "success",
      slots: [
        { start: MONDAY_NINE },
        { start: "2026-08-24T00:00:00.000Z" },
        { start: "2026-08-24T00:30:00.000Z" },
        { start: "2026-08-24T01:00:00.000Z" },
      ],
    },
    status: "completed",
  });
  expect(api.freeBusyCalls).toBe(1);

  const weekend = await execute(context, "google_calendar.availability", {
    date: "2026-08-29",
  });
  const past = await execute(context, "google_calendar.availability", {
    date: "2026-08-22",
  });
  expect(weekend.responsePayload).toMatchObject({
    reason: "clinic_closed",
    slots: [],
    status: "no_result",
  });
  expect(past.responsePayload).toMatchObject({
    reason: "date_in_past",
    slots: [],
    status: "no_result",
  });
  expect(api.freeBusyCalls).toBe(1);

  const outsideHours = await execute(
    fixture({ api, idempotencyKey: "outside-hours" }),
    "google_calendar.book",
    identity({ start: "2026-08-24T07:00:00.000Z" }),
  );
  expect(outsideHours.responsePayload).toEqual({
    reason: "outside_booking_rules",
    status: "rejected",
  });
});

test("booking rechecks the slot, verifies the event, and replays one opaque reference", async () => {
  const api = new MemoryGoogleCalendarApi();
  const store = new MemoryAppointmentStore();
  const context = fixture({ api, idempotencyKey: "booking-1", store });
  const payload = identity({ start: MONDAY_NINE });
  const first = await execute(context, "google_calendar.book", payload);
  const replay = await execute(context, "google_calendar.book", payload);

  expect(first.status).toBe("completed");
  expect(first.responsePayload.status).toBe("success");
  expect(first.responsePayload.appointmentRef).toMatch(/^apt_[A-Za-z0-9_-]+$/);
  expect(replay.responsePayload).toEqual(first.responsePayload);
  expect(api.insertCalls).toBe(1);
  expect(api.getCalls).toBe(2);
  expect(JSON.stringify(first)).not.toContain("lia");
  expect(JSON.stringify(store.appointments)).not.toContain("Ava Example");
  expect(JSON.stringify(store.appointments)).not.toContain("1990-01-01");
});

test("two callers racing for one slot produce exactly one verified booking", async () => {
  const api = new MemoryGoogleCalendarApi();
  const store = new MemoryAppointmentStore();
  const [left, right] = await Promise.all([
    execute(
      fixture({ api, idempotencyKey: "race-left", store }),
      "google_calendar.book",
      identity({ start: MONDAY_NINE }),
    ),
    execute(
      fixture({ api, idempotencyKey: "race-right", store }),
      "google_calendar.book",
      identity({ start: MONDAY_NINE }),
    ),
  ]);
  expect(
    [left.responsePayload.status, right.responsePayload.status].sort(),
  ).toEqual(["rejected", "success"]);
  expect(
    [left.responsePayload.reason, right.responsePayload.reason].filter(Boolean),
  ).toEqual(["slot_taken"]);
  expect(api.insertCalls).toBe(1);
  expect(store.appointments).toHaveLength(1);
});

test("lookup, reschedule, and cancel require identity and never expose Google IDs", async () => {
  const api = new MemoryGoogleCalendarApi();
  const store = new MemoryAppointmentStore();
  const booked = await execute(
    fixture({ api, idempotencyKey: "lifecycle-book", store }),
    "google_calendar.book",
    identity({ start: MONDAY_NINE }),
  );
  const appointmentRef = String(booked.responsePayload.appointmentRef);

  const wrongIdentity = await execute(
    fixture({ api, idempotencyKey: "lookup-wrong", store }),
    "google_calendar.lookup",
    identity({ dateOfBirth: "1991-02-02" }),
  );
  expect(wrongIdentity.responsePayload).toEqual({
    appointments: [],
    status: "no_result",
  });

  const lookup = await execute(
    fixture({ api, idempotencyKey: "lookup-right", store }),
    "google_calendar.lookup",
    identity(),
  );
  expect(lookup.responsePayload).toMatchObject({
    appointments: [{ appointmentRef, start: MONDAY_NINE }],
    status: "success",
  });
  expect(JSON.stringify(lookup)).not.toContain(
    store.appointments[0]?.remoteEventId,
  );

  const moved = await execute(
    fixture({ api, idempotencyKey: "lifecycle-move", store }),
    "google_calendar.reschedule",
    identity({ appointmentRef, newStart: TUESDAY_TEN }),
  );
  expect(moved.responsePayload).toMatchObject({
    appointmentRef,
    start: TUESDAY_TEN,
    status: "success",
  });
  expect(api.patchCalls).toBe(1);

  const cancelled = await execute(
    fixture({ api, idempotencyKey: "lifecycle-cancel", store }),
    "google_calendar.cancel",
    identity({ appointmentRef }),
  );
  const cancelReplay = await execute(
    fixture({ api, idempotencyKey: "lifecycle-cancel-replay", store }),
    "google_calendar.cancel",
    identity({ appointmentRef }),
  );
  expect(cancelled.responsePayload).toEqual({
    appointmentRef,
    status: "success",
  });
  expect(cancelReplay.responsePayload).toEqual(cancelled.responsePayload);
  expect(api.deleteCalls).toBe(1);
});

test("an uncertain booking reconciles its deterministic event before retry", async () => {
  const api = new MemoryGoogleCalendarApi();
  const store = new MemoryAppointmentStore();
  api.insertUnknownAfterCreate = true;
  api.getFailures = 1;
  const context = fixture({ api, idempotencyKey: "uncertain-book", store });

  const uncertain = await execute(
    context,
    "google_calendar.book",
    identity({ start: MONDAY_NINE }),
  );
  expect(uncertain).toMatchObject({
    responsePayload: { status: "outcome_unknown" },
    status: "outcome_unknown",
  });
  expect(store.appointments[0]?.status).toBe("outcome_unknown");

  const reconciled = await execute(
    context,
    "google_calendar.book",
    identity({ start: MONDAY_NINE }),
  );
  expect(reconciled).toMatchObject({
    responsePayload: { status: "success" },
    status: "completed",
  });
  expect(store.appointments[0]?.status).toBe("active");
  expect(api.insertCalls).toBe(1);
});

test("a retry recovers a deterministic event created before local persistence", async () => {
  const api = new MemoryGoogleCalendarApi();
  const store = new MemoryAppointmentStore();
  const idempotencyKey = "crash-before-local-save";
  const eventId = `lia${createHash("sha256")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, 52)}`;
  api.events.set(
    eventId,
    eventValue(
      eventId,
      new Date(MONDAY_NINE),
      new Date("2026-08-23T23:30:00.000Z"),
      1,
    ),
  );

  const result = await execute(
    fixture({ api, idempotencyKey, store }),
    "google_calendar.book",
    identity({ start: MONDAY_NINE }),
  );
  expect(result).toMatchObject({
    responsePayload: { status: "success" },
    status: "completed",
  });
  expect(api.insertCalls).toBe(0);
  expect(store.appointments).toHaveLength(1);
});

function fixture(input?: {
  api?: MemoryGoogleCalendarApi;
  idempotencyKey?: string;
  store?: MemoryAppointmentStore;
}) {
  return {
    api: input?.api ?? new MemoryGoogleCalendarApi(),
    config,
    identitySecret: IDENTITY_SECRET,
    idempotencyKey: input?.idempotencyKey ?? "calendar-operation-1",
    now: NOW,
    payload: {},
    projectId: 10,
    providerId: 20,
    store: input?.store ?? new MemoryAppointmentStore(),
  };
}

function execute(
  context: ReturnType<typeof fixture>,
  operationType: string,
  payload: Record<string, unknown>,
) {
  return executeGoogleCalendarProviderOperation({
    ...context,
    operationType,
    payload: { payload },
  });
}

function identity(extra: Record<string, unknown> = {}) {
  return {
    dateOfBirth: "1990-01-01",
    patientName: "Ava Example",
    ...extra,
  };
}

class MemoryGoogleCalendarApi implements GoogleCalendarApi {
  readonly busy: GoogleBusyPeriod[] = [];
  readonly events = new Map<string, GoogleCalendarEvent>();
  deleteCalls = 0;
  freeBusyCalls = 0;
  getCalls = 0;
  getFailures = 0;
  insertCalls = 0;
  insertUnknownAfterCreate = false;
  patchCalls = 0;

  async freeBusy({ end, start }: { end: Date; start: Date }) {
    this.freeBusyCalls += 1;
    return [
      ...this.busy,
      ...[...this.events.values()]
        .filter((event) => event.status !== "cancelled")
        .map((event) => ({
          end: new Date(event.end),
          start: new Date(event.start),
        })),
    ].filter((period) => start < period.end && end > period.start);
  }

  async insertEvent(input: { end: Date; eventId: string; start: Date }) {
    this.insertCalls += 1;
    if (this.events.has(input.eventId)) {
      throw new GoogleCalendarApiError("duplicate", 409);
    }
    const event = eventValue(input.eventId, input.start, input.end, 1);
    this.events.set(input.eventId, event);
    if (this.insertUnknownAfterCreate) {
      this.insertUnknownAfterCreate = false;
      throw new GoogleCalendarApiError("network_failure", null);
    }
    return structuredClone(event);
  }

  async getEvent(eventId: string) {
    this.getCalls += 1;
    if (this.getFailures > 0) {
      this.getFailures -= 1;
      throw new GoogleCalendarApiError("network_failure", null);
    }
    const event = this.events.get(eventId);
    if (!event) throw new GoogleCalendarApiError("not_found", 404);
    return structuredClone(event);
  }

  async patchEvent(input: {
    end: Date;
    etag: string;
    eventId: string;
    start: Date;
  }) {
    this.patchCalls += 1;
    const current = this.events.get(input.eventId);
    if (!current) throw new GoogleCalendarApiError("not_found", 404);
    if (current.etag !== input.etag) {
      throw new GoogleCalendarApiError("precondition_failed", 412);
    }
    const event = eventValue(input.eventId, input.start, input.end, 2);
    this.events.set(input.eventId, event);
    return structuredClone(event);
  }

  async deleteEvent(input: { etag: string; eventId: string }) {
    this.deleteCalls += 1;
    const current = this.events.get(input.eventId);
    if (!current) throw new GoogleCalendarApiError("not_found", 404);
    if (current.etag !== input.etag) {
      throw new GoogleCalendarApiError("precondition_failed", 412);
    }
    this.events.set(input.eventId, { ...current, status: "cancelled" });
  }
}

function eventValue(eventId: string, start: Date, end: Date, revision: number) {
  return {
    end: end.toISOString(),
    etag: `etag-${revision}`,
    id: eventId,
    start: start.toISOString(),
    status: "confirmed",
  } satisfies GoogleCalendarEvent;
}

class MemoryAppointmentStore implements GoogleCalendarAppointmentStore {
  readonly appointments: GoogleCalendarAppointment[] = [];
  private lockTail = Promise.resolve();

  async withLocks<T>(_keys: string[], work: () => Promise<T>) {
    const previous = this.lockTail;
    let release = () => {};
    this.lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  async findByOperationKey(input: {
    operationKeyHash: string;
    projectId: number;
    providerId: number;
  }) {
    return (
      this.appointments.find(
        (appointment) =>
          appointment.operationKeyHash === input.operationKeyHash &&
          appointment.projectId === input.projectId &&
          appointment.providerId === input.providerId,
      ) ?? null
    );
  }

  async findByReference(input: {
    identityHash: string;
    projectId: number;
    providerId: number;
    reference: string;
  }) {
    return (
      this.appointments.find(
        (appointment) =>
          appointment.identityHash === input.identityHash &&
          appointment.projectId === input.projectId &&
          appointment.providerId === input.providerId &&
          appointment.reference === input.reference,
      ) ?? null
    );
  }

  async listByIdentity(input: {
    identityHash: string;
    limit: number;
    maxStart: Date;
    minEnd: Date;
    projectId: number;
    providerId: number;
  }) {
    return this.appointments
      .filter(
        (appointment) =>
          appointment.identityHash === input.identityHash &&
          appointment.projectId === input.projectId &&
          appointment.providerId === input.providerId &&
          appointment.status === "active" &&
          appointment.endAt >= input.minEnd &&
          appointment.startAt <= input.maxStart,
      )
      .slice(0, input.limit);
  }

  async save(input: Omit<GoogleCalendarAppointment, "id">) {
    const existing = await this.findByOperationKey(input);
    if (existing) return existing;
    const appointment = structuredClone({
      ...input,
      id: this.appointments.length + 1,
    });
    this.appointments.push(appointment);
    return appointment;
  }

  async update(input: {
    endAt?: Date;
    id: number;
    projectId: number;
    providerId: number;
    remoteEtag?: string;
    startAt?: Date;
    status?: "active" | "cancelled" | "outcome_unknown";
  }) {
    const appointment = this.appointments.find(
      (candidate) =>
        candidate.id === input.id &&
        candidate.projectId === input.projectId &&
        candidate.providerId === input.providerId,
    );
    if (!appointment) throw new Error("Appointment not found.");
    if (input.endAt) appointment.endAt = new Date(input.endAt);
    if (input.remoteEtag) appointment.remoteEtag = input.remoteEtag;
    if (input.startAt) appointment.startAt = new Date(input.startAt);
    if (input.status) appointment.status = input.status;
    return appointment;
  }
}
