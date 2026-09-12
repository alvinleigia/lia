import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { appointmentMatchSchema } from "@/lib/appointment-lookup";
import {
  createGoogleCalendarApi,
  type GoogleBusyPeriod,
  type GoogleCalendarApi,
  GoogleCalendarApiError,
  type GoogleCalendarConfig,
  type GoogleCalendarEvent,
  googleCalendarConfigSchema,
} from "@/lib/google-calendar-api";

export const GOOGLE_CALENDAR_OPERATION_TYPES = [
  "google_calendar.availability",
  "google_calendar.book",
  "google_calendar.lookup",
  "google_calendar.reschedule",
  "google_calendar.cancel",
] as const;

export type GoogleCalendarAppointment = {
  endAt: Date;
  id: number;
  identityHash: string;
  lookupIdentityHash: string | null;
  lookupIdentityKey: string | null;
  operationKeyHash: string;
  projectId: number;
  providerId: number;
  reference: string;
  remoteEtag: string;
  remoteEventId: string;
  startAt: Date;
  status: "active" | "cancelled" | "outcome_unknown";
  verificationIdentityHash: string | null;
};

export interface GoogleCalendarAppointmentStore {
  findByOperationKey(input: {
    operationKeyHash: string;
    projectId: number;
    providerId: number;
  }): Promise<GoogleCalendarAppointment | null>;
  findByReference(input: {
    identityHash: string;
    lookupIdentityHash: string;
    lookupIdentityKey: string;
    projectId: number;
    providerId: number;
    reference: string;
  }): Promise<GoogleCalendarAppointment | null>;
  listByIdentity(input: {
    identityHash: string;
    lookupIdentityHash: string;
    lookupIdentityKey: string;
    limit: number;
    maxStart: Date;
    minEnd: Date;
    projectId: number;
    providerId: number;
  }): Promise<GoogleCalendarAppointment[]>;
  save(
    input: Omit<GoogleCalendarAppointment, "id">,
  ): Promise<GoogleCalendarAppointment>;
  update(input: {
    endAt?: Date;
    id: number;
    lookupIdentityHash?: string;
    lookupIdentityKey?: string;
    projectId: number;
    providerId: number;
    remoteEtag?: string;
    startAt?: Date;
    status?: "active" | "cancelled" | "outcome_unknown";
    verificationIdentityHash?: string;
  }): Promise<GoogleCalendarAppointment>;
  withLocks<T>(keys: string[], work: () => Promise<T>): Promise<T>;
}

export type GoogleCalendarProviderResult = {
  errorMessage?: string;
  responsePayload: Record<string, unknown>;
  status: "completed" | "failed" | "outcome_unknown";
};

export function getGoogleCalendarHostedVoiceResult(
  value: Record<string, unknown>,
) {
  const result: Record<string, unknown> = {};
  const status = z
    .enum([
      "success",
      "no_result",
      "rejected",
      "provider_failure",
      "outcome_unknown",
    ])
    .safeParse(value.status);
  if (status.success) result.status = status.data;

  const reason = z
    .string()
    .regex(/^[a-z0-9_]{1,80}$/)
    .safeParse(value.reason);
  if (reason.success) result.reason = reason.data;

  const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .safeParse(value.date);
  if (date.success) result.date = date.data;

  const appointment = appointmentMatchSchema.partial().safeParse(value);
  if (appointment.success) Object.assign(result, appointment.data);

  const slots = z
    .array(appointmentMatchSchema.omit({ appointmentRef: true }))
    .max(16)
    .safeParse(value.slots);
  if (slots.success) result.slots = slots.data;

  const appointments = z
    .array(appointmentMatchSchema)
    .max(20)
    .safeParse(value.appointments);
  if (appointments.success) result.appointments = appointments.data;

  return result;
}

export async function executeGoogleCalendarProviderOperation(input: {
  api?: GoogleCalendarApi;
  config: Record<string, unknown>;
  identitySecret: string;
  idempotencyKey: string;
  now?: Date;
  operationType: string;
  payload: Record<string, unknown>;
  projectId: number;
  providerId: number;
  store: GoogleCalendarAppointmentStore;
}): Promise<GoogleCalendarProviderResult> {
  try {
    const config = googleCalendarConfigSchema.parse(input.config);
    const payload = operationPayloadSchema.parse(input.payload).payload;
    const context = {
      api: input.api ?? createGoogleCalendarApi(config),
      config,
      identitySecret: requireIdentitySecret(input.identitySecret),
      idempotencyKey: input.idempotencyKey,
      now: input.now ?? new Date(),
      payload,
      projectId: input.projectId,
      providerId: input.providerId,
      store: input.store,
    };

    switch (input.operationType) {
      case "google_calendar.availability":
        return checkAvailability(context);
      case "google_calendar.book":
        return bookAppointment(context);
      case "google_calendar.lookup":
        return lookupAppointments(context);
      case "google_calendar.reschedule":
        return rescheduleAppointment(context);
      case "google_calendar.cancel":
        return cancelAppointment(context);
      default:
        return failed("unsupported_calendar_operation");
    }
  } catch (error) {
    return failed(
      error instanceof GoogleCalendarApiError ? error.code : "calendar_failed",
    );
  }
}

type OperationContext = {
  api: GoogleCalendarApi;
  config: GoogleCalendarConfig;
  identitySecret: string;
  idempotencyKey: string;
  now: Date;
  payload: Record<string, unknown>;
  projectId: number;
  providerId: number;
  store: GoogleCalendarAppointmentStore;
};

async function checkAvailability(
  context: OperationContext,
): Promise<GoogleCalendarProviderResult> {
  const parsed = availabilityInputSchema.safeParse(context.payload);
  if (!parsed.success) return rejected("invalid_availability_request");
  const window = getBusinessWindow(
    parsed.data.date,
    context.config,
    context.now,
  );
  if (!window.ok)
    return completed("no_result", { reason: window.reason, slots: [] });

  const busy = await context.api.freeBusy({
    end: window.end,
    start: window.start,
  });
  const slots = buildAvailableSlots({
    busy,
    config: context.config,
    limit: parsed.data.limit,
    now: context.now,
    window,
  });
  return completed(slots.length ? "success" : "no_result", {
    date: parsed.data.date,
    slots,
  });
}

async function bookAppointment(
  context: OperationContext,
): Promise<GoogleCalendarProviderResult> {
  const parsed = bookInputSchema.safeParse(context.payload);
  if (!parsed.success) return rejected("invalid_booking_request");
  const identity = identityHash(context, parsed.data);
  if (!identity.ok) return rejected(identity.reason);
  const interval = validateAppointmentStart(
    parsed.data.start,
    context.config,
    context.now,
  );
  if (!interval.ok) return rejected(interval.reason);

  const operationKeyHash = hashValue(context.idempotencyKey);
  const prior = await context.store.findByOperationKey({
    operationKeyHash,
    projectId: context.projectId,
    providerId: context.providerId,
  });
  if (prior?.status === "active" || prior?.status === "cancelled") {
    return verifiedExistingAppointment(context, prior);
  }

  return context.store.withLocks(
    [calendarDayLock(context, interval.localDate)],
    async () => {
      const existing = await context.store.findByOperationKey({
        operationKeyHash,
        projectId: context.projectId,
        providerId: context.providerId,
      });
      if (existing?.status === "active" || existing?.status === "cancelled") {
        return verifiedExistingAppointment(context, existing);
      }

      const eventId = `lia${operationKeyHash.slice(0, 52)}`;
      if (existing?.status === "outcome_unknown") {
        try {
          const reconciled = await context.api.getEvent(eventId);
          if (!eventMatches(reconciled, interval.start, interval.end)) {
            return outcomeUnknown();
          }
          const activated = await context.store.update({
            endAt: interval.end,
            id: existing.id,
            projectId: context.projectId,
            providerId: context.providerId,
            remoteEtag: reconciled.etag,
            startAt: interval.start,
            status: "active",
          });
          return appointmentSuccess(context, activated);
        } catch (error) {
          if (!isMissingEvent(error)) return outcomeUnknown();
        }
      }

      const busy = await context.api.freeBusy({
        end: interval.end,
        start: interval.start,
      });
      if (hasOverlap(busy, interval.start, interval.end)) {
        try {
          const reconciled = await context.api.getEvent(eventId);
          if (!eventMatches(reconciled, interval.start, interval.end)) {
            return rejected("slot_taken");
          }
          const appointment = await persistBooking({
            context,
            end: interval.end,
            existing,
            identityHash: identity.value,
            lookupIdentityHash: identity.lookupHash,
            lookupIdentityKey: identity.lookupKey,
            operationKeyHash,
            start: interval.start,
            verificationIdentityHash: identity.verificationHash,
            verified: reconciled,
          });
          return appointmentSuccess(context, appointment);
        } catch (error) {
          return isMissingEvent(error)
            ? rejected("slot_taken")
            : outcomeUnknown();
        }
      }

      let event: GoogleCalendarEvent;
      try {
        event = await context.api.insertEvent({
          description: "Booked by Lia.",
          end: interval.end,
          eventId,
          privateProperties: {
            liaIdentityHash: identity.value,
            liaOperationKey: operationKeyHash,
          },
          start: interval.start,
          summary: appointmentSummary(
            parsed.data.patientName,
            parsed.data.reason,
          ),
        });
      } catch (error) {
        if (
          error instanceof GoogleCalendarApiError &&
          (error.status === 409 || error.mutationOutcomeMayBeUnknown)
        ) {
          const reconciled = await getEventOrNull(context.api, eventId);
          if (!reconciled) {
            await saveUnknownBooking({
              context,
              end: interval.end,
              eventId,
              existing,
              identityHash: identity.value,
              lookupIdentityHash: identity.lookupHash,
              lookupIdentityKey: identity.lookupKey,
              operationKeyHash,
              start: interval.start,
              verificationIdentityHash: identity.verificationHash,
            });
            return outcomeUnknown();
          }
          event = reconciled;
        } else {
          throw error;
        }
      }

      const verified = await verifyEvent(
        context.api,
        event.id,
        interval.start,
        interval.end,
      );
      if (!verified) {
        await saveUnknownBooking({
          context,
          end: interval.end,
          eventId,
          existing,
          identityHash: identity.value,
          lookupIdentityHash: identity.lookupHash,
          lookupIdentityKey: identity.lookupKey,
          operationKeyHash,
          start: interval.start,
          verificationIdentityHash: identity.verificationHash,
        });
        return outcomeUnknown();
      }
      const appointment = await persistBooking({
        context,
        end: interval.end,
        existing,
        identityHash: identity.value,
        lookupIdentityHash: identity.lookupHash,
        lookupIdentityKey: identity.lookupKey,
        operationKeyHash,
        start: interval.start,
        verificationIdentityHash: identity.verificationHash,
        verified,
      });
      return appointmentSuccess(context, appointment);
    },
  );
}

async function lookupAppointments(
  context: OperationContext,
): Promise<GoogleCalendarProviderResult> {
  const identity = identityHash(context, context.payload);
  if (!identity.ok) return rejected(identity.reason);
  const maxStart = new Date(
    context.now.getTime() + context.config.schedulingHorizonDays * 86_400_000,
  );
  const appointments = await context.store.listByIdentity({
    identityHash: identity.value,
    lookupIdentityHash: identity.lookupHash,
    lookupIdentityKey: identity.lookupKey,
    limit: 10,
    maxStart,
    minEnd: context.now,
    projectId: context.projectId,
    providerId: context.providerId,
  });
  const matchingAppointments = appointments.filter((appointment) =>
    appointmentMatchesIdentity(appointment, identity),
  );
  if (matchingAppointments.length === 0) {
    return completed("no_result", {
      appointments: [],
      ...(appointments.length > 0 ? { reason: "identity_mismatch" } : {}),
    });
  }
  const verified: GoogleCalendarAppointment[] = [];
  for (const candidate of matchingAppointments) {
    const appointment = await upgradeLegacyIdentity(
      context,
      candidate,
      identity,
    );
    try {
      const event = await context.api.getEvent(appointment.remoteEventId);
      if (event.status === "cancelled") {
        await context.store.update({
          id: appointment.id,
          projectId: context.projectId,
          providerId: context.providerId,
          status: "cancelled",
        });
      } else {
        verified.push(appointment);
      }
    } catch (error) {
      if (isMissingEvent(error)) {
        await context.store.update({
          id: appointment.id,
          projectId: context.projectId,
          providerId: context.providerId,
          status: "cancelled",
        });
      } else {
        throw error;
      }
    }
  }
  return completed(verified.length ? "success" : "no_result", {
    appointments: verified.map((appointment) =>
      publicAppointment(context, appointment),
    ),
  });
}

async function rescheduleAppointment(
  context: OperationContext,
): Promise<GoogleCalendarProviderResult> {
  const parsed = rescheduleInputSchema.safeParse(context.payload);
  if (!parsed.success) return rejected("invalid_reschedule_request");
  const identity = identityHash(context, parsed.data);
  if (!identity.ok) return rejected(identity.reason);
  let appointment = await context.store.findByReference({
    identityHash: identity.value,
    lookupIdentityHash: identity.lookupHash,
    lookupIdentityKey: identity.lookupKey,
    projectId: context.projectId,
    providerId: context.providerId,
    reference: parsed.data.appointmentRef,
  });
  if (!appointment) {
    return completed("no_result", { reason: "appointment_not_found" });
  }
  if (!appointmentMatchesIdentity(appointment, identity)) {
    return completed("no_result", { reason: "identity_mismatch" });
  }
  appointment = await upgradeLegacyIdentity(context, appointment, identity);
  if (appointment.status !== "active") {
    return completed("no_result", { reason: "appointment_not_found" });
  }
  const interval = validateAppointmentStart(
    parsed.data.newStart,
    context.config,
    context.now,
  );
  if (!interval.ok) return rejected(interval.reason);

  return context.store.withLocks(
    [
      appointmentLock(context, appointment.id),
      calendarDayLock(context, interval.localDate),
    ],
    async () => {
      let current: GoogleCalendarEvent;
      try {
        current = await context.api.getEvent(appointment.remoteEventId);
      } catch (error) {
        if (isMissingEvent(error))
          return completed("no_result", { reason: "appointment_not_found" });
        throw error;
      }
      if (current.status === "cancelled") {
        return completed("no_result", { reason: "appointment_not_found" });
      }
      if (eventMatches(current, interval.start, interval.end)) {
        const updated = await context.store.update({
          endAt: interval.end,
          id: appointment.id,
          projectId: context.projectId,
          providerId: context.providerId,
          remoteEtag: current.etag,
          startAt: interval.start,
        });
        return appointmentSuccess(context, updated);
      }

      const busy = await context.api.freeBusy({
        end: interval.end,
        start: interval.start,
      });
      if (hasOverlap(busy, interval.start, interval.end))
        return rejected("slot_taken");

      let changed: GoogleCalendarEvent;
      try {
        changed = await context.api.patchEvent({
          end: interval.end,
          etag: current.etag,
          eventId: appointment.remoteEventId,
          start: interval.start,
        });
      } catch (error) {
        if (error instanceof GoogleCalendarApiError && error.status === 412) {
          return rejected("appointment_changed");
        }
        if (
          error instanceof GoogleCalendarApiError &&
          error.mutationOutcomeMayBeUnknown
        ) {
          const reconciled = await getEventOrNull(
            context.api,
            appointment.remoteEventId,
          );
          if (
            !reconciled ||
            !eventMatches(reconciled, interval.start, interval.end)
          ) {
            return outcomeUnknown();
          }
          changed = reconciled;
        } else {
          throw error;
        }
      }
      const verified = await verifyEvent(
        context.api,
        changed.id,
        interval.start,
        interval.end,
      );
      if (!verified) return outcomeUnknown();
      const updated = await context.store.update({
        endAt: interval.end,
        id: appointment.id,
        projectId: context.projectId,
        providerId: context.providerId,
        remoteEtag: verified.etag,
        startAt: interval.start,
      });
      return appointmentSuccess(context, updated);
    },
  );
}

async function cancelAppointment(
  context: OperationContext,
): Promise<GoogleCalendarProviderResult> {
  const parsed = cancelInputSchema.safeParse(context.payload);
  if (!parsed.success) return rejected("invalid_cancel_request");
  const identity = identityHash(context, parsed.data);
  if (!identity.ok) return rejected(identity.reason);
  let appointment = await context.store.findByReference({
    identityHash: identity.value,
    lookupIdentityHash: identity.lookupHash,
    lookupIdentityKey: identity.lookupKey,
    projectId: context.projectId,
    providerId: context.providerId,
    reference: parsed.data.appointmentRef,
  });
  if (!appointment)
    return completed("no_result", { reason: "appointment_not_found" });
  if (!appointmentMatchesIdentity(appointment, identity)) {
    return completed("no_result", { reason: "identity_mismatch" });
  }
  appointment = await upgradeLegacyIdentity(context, appointment, identity);
  if (appointment.status === "cancelled") {
    return completed("success", { appointmentRef: appointment.reference });
  }

  return context.store.withLocks(
    [appointmentLock(context, appointment.id)],
    async () => {
      let current: GoogleCalendarEvent;
      try {
        current = await context.api.getEvent(appointment.remoteEventId);
      } catch (error) {
        if (isMissingEvent(error)) return markCancelled(context, appointment);
        throw error;
      }
      if (current.status === "cancelled")
        return markCancelled(context, appointment);

      try {
        await context.api.deleteEvent({
          etag: current.etag,
          eventId: appointment.remoteEventId,
        });
      } catch (error) {
        if (isMissingEvent(error)) return markCancelled(context, appointment);
        if (error instanceof GoogleCalendarApiError && error.status === 412) {
          return rejected("appointment_changed");
        }
        if (
          error instanceof GoogleCalendarApiError &&
          error.mutationOutcomeMayBeUnknown
        ) {
          const reconciled = await getEventOrNull(
            context.api,
            appointment.remoteEventId,
          );
          if (reconciled && reconciled.status !== "cancelled")
            return outcomeUnknown();
        } else {
          throw error;
        }
      }

      try {
        const verified = await context.api.getEvent(appointment.remoteEventId);
        if (verified.status !== "cancelled") return outcomeUnknown();
      } catch (error) {
        if (!isMissingEvent(error)) return outcomeUnknown();
      }
      return markCancelled(context, appointment);
    },
  );
}

async function verifiedExistingAppointment(
  context: OperationContext,
  appointment: GoogleCalendarAppointment,
) {
  if (appointment.status !== "active") return rejected("appointment_cancelled");
  const verified = await verifyEvent(
    context.api,
    appointment.remoteEventId,
    appointment.startAt,
    appointment.endAt,
  );
  return verified ? appointmentSuccess(context, appointment) : outcomeUnknown();
}

async function saveUnknownBooking(input: {
  context: OperationContext;
  end: Date;
  eventId: string;
  existing: GoogleCalendarAppointment | null;
  identityHash: string;
  lookupIdentityHash: string;
  lookupIdentityKey: string;
  operationKeyHash: string;
  start: Date;
  verificationIdentityHash: string;
}) {
  if (input.existing) return input.existing;
  return input.context.store.save({
    endAt: input.end,
    identityHash: input.identityHash,
    lookupIdentityHash: input.lookupIdentityHash,
    lookupIdentityKey: input.lookupIdentityKey,
    operationKeyHash: input.operationKeyHash,
    projectId: input.context.projectId,
    providerId: input.context.providerId,
    reference: `apt_${randomBytes(18).toString("base64url")}`,
    remoteEtag: "",
    remoteEventId: input.eventId,
    startAt: input.start,
    status: "outcome_unknown",
    verificationIdentityHash: input.verificationIdentityHash,
  });
}

async function persistBooking(input: {
  context: OperationContext;
  end: Date;
  existing: GoogleCalendarAppointment | null;
  identityHash: string;
  lookupIdentityHash: string;
  lookupIdentityKey: string;
  operationKeyHash: string;
  start: Date;
  verificationIdentityHash: string;
  verified: GoogleCalendarEvent;
}) {
  return input.existing
    ? input.context.store.update({
        endAt: input.end,
        id: input.existing.id,
        lookupIdentityHash: input.lookupIdentityHash,
        lookupIdentityKey: input.lookupIdentityKey,
        projectId: input.context.projectId,
        providerId: input.context.providerId,
        remoteEtag: input.verified.etag,
        startAt: input.start,
        status: "active",
        verificationIdentityHash: input.verificationIdentityHash,
      })
    : input.context.store.save({
        endAt: input.end,
        identityHash: input.identityHash,
        lookupIdentityHash: input.lookupIdentityHash,
        lookupIdentityKey: input.lookupIdentityKey,
        operationKeyHash: input.operationKeyHash,
        projectId: input.context.projectId,
        providerId: input.context.providerId,
        reference: `apt_${randomBytes(18).toString("base64url")}`,
        remoteEtag: input.verified.etag,
        remoteEventId: input.verified.id,
        startAt: input.start,
        status: "active",
        verificationIdentityHash: input.verificationIdentityHash,
      });
}

async function markCancelled(
  context: OperationContext,
  appointment: GoogleCalendarAppointment,
) {
  const updated = await context.store.update({
    id: appointment.id,
    projectId: context.projectId,
    providerId: context.providerId,
    status: "cancelled",
  });
  return completed("success", { appointmentRef: updated.reference });
}

function appointmentSuccess(
  context: OperationContext,
  appointment: GoogleCalendarAppointment,
) {
  return completed("success", publicAppointment(context, appointment));
}

function publicAppointment(
  context: OperationContext,
  appointment: GoogleCalendarAppointment,
) {
  return {
    appointmentRef: appointment.reference,
    end: appointment.endAt.toISOString(),
    spoken: spokenDateTime(appointment.startAt, context.config.timezone),
    start: appointment.startAt.toISOString(),
  };
}

async function verifyEvent(
  api: GoogleCalendarApi,
  eventId: string,
  start: Date,
  end: Date,
) {
  try {
    const event = await api.getEvent(eventId);
    return event.status !== "cancelled" && eventMatches(event, start, end)
      ? event
      : null;
  } catch {
    return null;
  }
}

async function getEventOrNull(api: GoogleCalendarApi, eventId: string) {
  try {
    return await api.getEvent(eventId);
  } catch {
    return null;
  }
}

function eventMatches(event: GoogleCalendarEvent, start: Date, end: Date) {
  return (
    new Date(event.start).getTime() === start.getTime() &&
    new Date(event.end).getTime() === end.getTime()
  );
}

function identityHash(
  context: OperationContext,
  payload: Record<string, unknown>,
):
  | {
      lookupHash: string;
      lookupKey: string;
      ok: true;
      value: string;
      verificationHash: string;
    }
  | { ok: false; reason: string } {
  const values: string[] = [];
  const lookupKey = getPrimaryIdentityFactor(context.config);
  const verificationValues: string[] = [];
  let lookupValue = "";
  for (const factor of context.config.identityFactors) {
    const value = payload[factor];
    if (typeof value !== "string" || !value.trim()) {
      return { ok: false, reason: "identity_required" };
    }
    const normalized = normalizeIdentityValue(value);
    values.push(`${factor}:${normalized}`);
    if (factor === lookupKey) {
      lookupValue = normalizeLookupIdentityValue(factor, value);
    } else {
      verificationValues.push(`${factor}:${normalized}`);
    }
  }
  if (!lookupValue) return { ok: false, reason: "identity_invalid" };
  const scope = `${context.projectId}:${context.providerId}`;
  return {
    lookupHash: createHmac("sha256", context.identitySecret)
      .update(`${scope}:lookup:${lookupKey}:${lookupValue}`)
      .digest("hex"),
    lookupKey,
    ok: true,
    value: createHmac("sha256", context.identitySecret)
      .update(`${scope}:${values.join("|")}`)
      .digest("hex"),
    verificationHash: createHmac("sha256", context.identitySecret)
      .update(`${scope}:verification:${verificationValues.join("|")}`)
      .digest("hex"),
  };
}

function getPrimaryIdentityFactor(config: GoogleCalendarConfig) {
  if (config.primaryIdentityFactor) return config.primaryIdentityFactor;
  return (
    config.identityFactors.find((factor) =>
      /phone|mobile|contactnumber|telephone/i.test(factor),
    ) ?? config.identityFactors[0]
  );
}

function normalizeLookupIdentityValue(factor: string, value: string) {
  if (/phone|mobile|contactnumber|telephone/i.test(factor)) {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15 ? digits : "";
  }
  return normalizeIdentityValue(value);
}

function appointmentMatchesIdentity(
  appointment: GoogleCalendarAppointment,
  identity: Extract<ReturnType<typeof identityHash>, { ok: true }>,
) {
  if (
    !appointment.lookupIdentityKey ||
    !appointment.lookupIdentityHash ||
    !appointment.verificationIdentityHash
  ) {
    return appointment.identityHash === identity.value;
  }
  return (
    appointment.lookupIdentityKey === identity.lookupKey &&
    appointment.lookupIdentityHash === identity.lookupHash &&
    appointment.verificationIdentityHash === identity.verificationHash
  );
}

async function upgradeLegacyIdentity(
  context: OperationContext,
  appointment: GoogleCalendarAppointment,
  identity: Extract<ReturnType<typeof identityHash>, { ok: true }>,
) {
  if (
    appointment.lookupIdentityKey &&
    appointment.lookupIdentityHash &&
    appointment.verificationIdentityHash
  ) {
    return appointment;
  }
  return context.store.update({
    id: appointment.id,
    lookupIdentityHash: identity.lookupHash,
    lookupIdentityKey: identity.lookupKey,
    projectId: context.projectId,
    providerId: context.providerId,
    verificationIdentityHash: identity.verificationHash,
  });
}

type AppointmentInterval =
  | { end: Date; localDate: string; ok: true; start: Date }
  | { ok: false; reason: string };

function validateAppointmentStart(
  value: string,
  config: GoogleCalendarConfig,
  now: Date,
): AppointmentInterval {
  const start = new Date(value);
  if (Number.isNaN(start.getTime()))
    return { ok: false, reason: "invalid_time" };
  const parts = zonedParts(start, config.timezone);
  const localDate = dateFromParts(parts);
  const window = getBusinessWindow(localDate, config, now);
  if (!window.ok) return window;
  const localMinute = parts.hour * 60 + parts.minute;
  const openMinute = minutes(config.openTime);
  const closeMinute = minutes(config.closeTime);
  if (
    start <= now ||
    parts.second !== 0 ||
    start.getMilliseconds() !== 0 ||
    localMinute < openMinute ||
    localMinute + config.appointmentDurationMinutes > closeMinute ||
    (localMinute - openMinute) % config.slotIntervalMinutes !== 0
  ) {
    return { ok: false, reason: "outside_booking_rules" };
  }
  return {
    end: new Date(start.getTime() + config.appointmentDurationMinutes * 60_000),
    localDate,
    ok: true,
    start,
  };
}

type BusinessWindow =
  | { end: Date; localDate: string; ok: true; start: Date }
  | { ok: false; reason: string };

function getBusinessWindow(
  date: string,
  config: GoogleCalendarConfig,
  now: Date,
): BusinessWindow {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return { ok: false, reason: "invalid_date" };
  const parsed = parseDate(date);
  if (!parsed) return { ok: false, reason: "invalid_date" };
  const today = dateFromParts(zonedParts(now, config.timezone));
  const lastDate = addDays(today, config.schedulingHorizonDays);
  if (date < today) return { ok: false, reason: "date_in_past" };
  if (date > lastDate) return { ok: false, reason: "outside_horizon" };
  const start = zonedDateTime(date, config.openTime, config.timezone);
  const end = zonedDateTime(date, config.closeTime, config.timezone);
  const day = isoWeekday(zonedParts(start, config.timezone).weekday);
  if (!config.workingDays.includes(day))
    return { ok: false, reason: "clinic_closed" };
  return { end, localDate: date, ok: true, start };
}

function buildAvailableSlots(input: {
  busy: GoogleBusyPeriod[];
  config: GoogleCalendarConfig;
  limit: number;
  now: Date;
  window: Extract<BusinessWindow, { ok: true }>;
}) {
  const slots: Array<{ end: string; spoken: string; start: string }> = [];
  const durationMs = input.config.appointmentDurationMinutes * 60_000;
  const stepMs = input.config.slotIntervalMinutes * 60_000;
  for (
    let cursor = input.window.start.getTime();
    cursor + durationMs <= input.window.end.getTime() &&
    slots.length < input.limit;
    cursor += stepMs
  ) {
    const start = new Date(cursor);
    const end = new Date(cursor + durationMs);
    if (start <= input.now || hasOverlap(input.busy, start, end)) continue;
    slots.push({
      end: end.toISOString(),
      spoken: spokenDateTime(start, input.config.timezone),
      start: start.toISOString(),
    });
  }
  return slots;
}

function hasOverlap(periods: GoogleBusyPeriod[], start: Date, end: Date) {
  return periods.some((period) => start < period.end && end > period.start);
}

function completed(status: string, extra: Record<string, unknown> = {}) {
  return {
    responsePayload: { ...extra, status },
    status: "completed" as const,
  };
}

function rejected(reason: string) {
  return completed("rejected", { reason });
}

function failed(reason: string): GoogleCalendarProviderResult {
  return {
    errorMessage: "Google Calendar could not complete the operation.",
    responsePayload: { reason, status: "provider_failure" },
    status: "failed",
  };
}

function outcomeUnknown(): GoogleCalendarProviderResult {
  return {
    errorMessage: "The Google Calendar write needs reconciliation.",
    responsePayload: { status: "outcome_unknown" },
    status: "outcome_unknown",
  };
}

function isMissingEvent(error: unknown) {
  return (
    error instanceof GoogleCalendarApiError &&
    (error.status === 404 || error.status === 410)
  );
}

function appointmentSummary(patientName: string, reason?: string) {
  const name = patientName.trim().slice(0, 120);
  const suffix = reason?.trim().slice(0, 120);
  return suffix ? `${name} — ${suffix}` : `${name} — Appointment`;
}

function normalizeIdentityValue(value: string) {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function requireIdentitySecret(secret: string) {
  if (secret.trim().length < 32) {
    throw new Error(
      "Google Calendar identity hashing requires a 32-character secret.",
    );
  }
  return secret;
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function calendarDayLock(context: OperationContext, date: string) {
  return `google-calendar:${context.projectId}:${context.providerId}:day:${date}`;
}

function appointmentLock(context: OperationContext, appointmentId: number) {
  return `google-calendar:${context.projectId}:${context.providerId}:appointment:${appointmentId}`;
}

function spokenDateTime(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  }).format(value);
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

type ZonedParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  weekday: string;
  year: number;
};

function zonedParts(value: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    month: Number(get("month")),
    second: Number(get("second")),
    weekday: get("weekday"),
    year: Number(get("year")),
  };
}

function zonedDateTime(date: string, time: string, timezone: string) {
  const parsedDate = parseDate(date);
  if (!parsedDate) throw new Error("Invalid local date.");
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(
    parsedDate.year,
    parsedDate.month - 1,
    parsedDate.day,
    hour,
    minute,
  );
  let instant = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedParts(new Date(instant), timezone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    instant += desired - represented;
  }
  const result = new Date(instant);
  const actual = zonedParts(result, timezone);
  if (
    actual.year !== parsedDate.year ||
    actual.month !== parsedDate.month ||
    actual.day !== parsedDate.day ||
    actual.hour !== hour ||
    actual.minute !== minute
  ) {
    throw new Error("Local time does not exist in the configured timezone.");
  }
  return result;
}

function parseDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
    ? { day, month, year }
    : null;
}

function dateFromParts(parts: Pick<ZonedParts, "day" | "month" | "year">) {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

function addDays(date: string, days: number) {
  const parsed = parseDate(date);
  if (!parsed) throw new Error("Invalid date.");
  const result = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day + days),
  );
  return dateFromParts({
    day: result.getUTCDate(),
    month: result.getUTCMonth() + 1,
    year: result.getUTCFullYear(),
  });
}

function isoWeekday(value: string) {
  return (
    { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<
      string,
      number
    >
  )[value];
}

const operationPayloadSchema = z
  .object({ payload: z.record(z.string(), z.unknown()) })
  .passthrough();

const availabilityInputSchema = z.object({
  date: z.string(),
  limit: z.number().int().min(1).max(16).default(6),
});

const bookInputSchema = z
  .object({
    patientName: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(1).max(240).optional(),
    start: z.string().datetime({ offset: true }),
  })
  .passthrough();

const rescheduleInputSchema = z
  .object({
    appointmentRef: z
      .string()
      .trim()
      .regex(/^apt_[A-Za-z0-9_-]{20,120}$/),
    newStart: z.string().datetime({ offset: true }),
  })
  .passthrough();

const cancelInputSchema = z
  .object({
    appointmentRef: z
      .string()
      .trim()
      .regex(/^apt_[A-Za-z0-9_-]{20,120}$/),
  })
  .passthrough();
