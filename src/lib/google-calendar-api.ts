import { createHash } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";

const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
].join(" ");

export const googleCalendarConfigSchema = z
  .object({
    appointmentDurationMinutes: z.number().int().min(5).max(240).default(30),
    calendarId: z.string().trim().min(1).max(512),
    clientEmail: z.string().trim().email().max(320),
    closeTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default("17:00"),
    identityFactors: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[a-z][a-zA-Z0-9_]{0,79}$/),
      )
      .min(1)
      .max(5),
    openTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default("09:00"),
    privateKey: z.string().min(100).max(10_000),
    privateKeyId: z.string().trim().min(1).max(240).optional(),
    schedulingHorizonDays: z.number().int().min(1).max(365).default(60),
    slotIntervalMinutes: z.number().int().min(5).max(240).default(30),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine(isIanaTimezone, "Timezone must be a valid IANA timezone."),
    timeoutMs: z.number().int().min(1_000).max(30_000).default(8_000),
    workingDays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length)
      .default([1, 2, 3, 4, 5]),
  })
  .strict()
  .superRefine((config, context) => {
    if (
      minutesSinceMidnight(config.openTime) >=
      minutesSinceMidnight(config.closeTime)
    ) {
      context.addIssue({
        code: "custom",
        message: "Close time must be after open time.",
        path: ["closeTime"],
      });
    }
  });

export type GoogleCalendarConfig = z.infer<typeof googleCalendarConfigSchema>;

export type GoogleCalendarEvent = {
  end: string;
  etag: string;
  id: string;
  start: string;
  status: string;
};

export interface GoogleCalendarApi {
  deleteEvent(input: { eventId: string; etag: string }): Promise<void>;
  freeBusy(input: { end: Date; start: Date }): Promise<GoogleBusyPeriod[]>;
  getEvent(eventId: string): Promise<GoogleCalendarEvent>;
  insertEvent(input: {
    description: string;
    end: Date;
    eventId: string;
    privateProperties: Record<string, string>;
    start: Date;
    summary: string;
  }): Promise<GoogleCalendarEvent>;
  patchEvent(input: {
    end: Date;
    etag: string;
    eventId: string;
    start: Date;
  }): Promise<GoogleCalendarEvent>;
}

export type GoogleBusyPeriod = { end: Date; start: Date };

export class GoogleCalendarApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null,
  ) {
    super("Google Calendar request failed.");
    this.name = "GoogleCalendarApiError";
  }

  get mutationOutcomeMayBeUnknown() {
    return this.status === null || this.status >= 500;
  }
}

type AccessToken = { expiresAt: number; value: string };
const accessTokenCache = new Map<string, AccessToken>();

export function createGoogleCalendarApi(
  value: GoogleCalendarConfig,
  fetcher: typeof fetch = fetch,
): GoogleCalendarApi {
  const config = googleCalendarConfigSchema.parse(value);
  const calendarPath = `/calendars/${encodeURIComponent(config.calendarId)}`;

  async function request(path: string, init: RequestInit): Promise<unknown> {
    const accessToken = await getAccessToken(config, fetcher);
    let response: Response;
    try {
      response = await fetcher(`${GOOGLE_CALENDAR_BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch {
      throw new GoogleCalendarApiError("network_failure", null);
    }
    if (!response.ok) {
      throw new GoogleCalendarApiError(
        calendarErrorCode(response.status),
        response.status,
      );
    }
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new GoogleCalendarApiError("invalid_response", response.status);
    }
  }

  return {
    async freeBusy({ end, start }) {
      const payload = freeBusyResponseSchema.parse(
        await request("/freeBusy", {
          body: JSON.stringify({
            items: [{ id: config.calendarId }],
            timeMax: end.toISOString(),
            timeMin: start.toISOString(),
            timeZone: config.timezone,
          }),
          method: "POST",
        }),
      );
      const calendar = payload.calendars[config.calendarId];
      if (!calendar || calendar.errors?.length) {
        throw new GoogleCalendarApiError("calendar_unavailable", 502);
      }
      return calendar.busy.map((period) => ({
        end: new Date(period.end),
        start: new Date(period.start),
      }));
    },

    async insertEvent(input) {
      return parseEvent(
        await request(`${calendarPath}/events`, {
          body: JSON.stringify({
            description: input.description,
            end: {
              dateTime: input.end.toISOString(),
              timeZone: config.timezone,
            },
            extendedProperties: { private: input.privateProperties },
            id: input.eventId,
            start: {
              dateTime: input.start.toISOString(),
              timeZone: config.timezone,
            },
            summary: input.summary,
          }),
          method: "POST",
        }),
      );
    },

    async getEvent(eventId) {
      return parseEvent(
        await request(`${calendarPath}/events/${encodeURIComponent(eventId)}`, {
          method: "GET",
        }),
      );
    },

    async patchEvent(input) {
      return parseEvent(
        await request(
          `${calendarPath}/events/${encodeURIComponent(input.eventId)}`,
          {
            body: JSON.stringify({
              end: {
                dateTime: input.end.toISOString(),
                timeZone: config.timezone,
              },
              start: {
                dateTime: input.start.toISOString(),
                timeZone: config.timezone,
              },
            }),
            headers: { "If-Match": input.etag },
            method: "PATCH",
          },
        ),
      );
    },

    async deleteEvent({ eventId, etag }) {
      await request(`${calendarPath}/events/${encodeURIComponent(eventId)}`, {
        headers: { "If-Match": etag },
        method: "DELETE",
      });
    },
  };
}

async function getAccessToken(
  config: GoogleCalendarConfig,
  fetcher: typeof fetch,
) {
  const cacheKey = createHash("sha256")
    .update(
      `${config.clientEmail}:${config.privateKeyId ?? ""}:${config.privateKey}`,
    )
    .digest("hex");
  const cached = accessTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

  const now = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(
    config.privateKey.replace(/\\n/g, "\n"),
    "RS256",
  );
  const assertion = await new SignJWT({ scope: GOOGLE_CALENDAR_SCOPES })
    .setProtectedHeader({
      alg: "RS256",
      ...(config.privateKeyId ? { kid: config.privateKeyId } : {}),
      typ: "JWT",
    })
    .setIssuer(config.clientEmail)
    .setAudience(GOOGLE_TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3_600)
    .sign(privateKey);

  let response: Response;
  try {
    response = await fetcher(GOOGLE_TOKEN_URL, {
      body: new URLSearchParams({
        assertion,
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    throw new GoogleCalendarApiError("authentication_unavailable", null);
  }
  if (!response.ok) {
    throw new GoogleCalendarApiError("authentication_failed", response.status);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GoogleCalendarApiError("authentication_invalid", response.status);
  }
  const token = accessTokenResponseSchema.parse(body);
  accessTokenCache.set(cacheKey, {
    expiresAt: Date.now() + token.expires_in * 1_000,
    value: token.access_token,
  });
  return token.access_token;
}

const accessTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

const freeBusyResponseSchema = z.object({
  calendars: z.record(
    z.string(),
    z.object({
      busy: z.array(
        z.object({
          end: z.string().datetime({ offset: true }),
          start: z.string().datetime({ offset: true }),
        }),
      ),
      errors: z.array(z.unknown()).optional(),
    }),
  ),
});

const eventResponseSchema = z.object({
  end: z.object({ dateTime: z.string().datetime({ offset: true }) }),
  etag: z.string().min(1),
  id: z.string().min(1),
  start: z.object({ dateTime: z.string().datetime({ offset: true }) }),
  status: z.string().min(1),
});

function parseEvent(value: unknown): GoogleCalendarEvent {
  const event = eventResponseSchema.parse(value);
  return {
    end: event.end.dateTime,
    etag: event.etag,
    id: event.id,
    start: event.start.dateTime,
    status: event.status,
  };
}

function calendarErrorCode(status: number) {
  if (status === 404) return "not_found";
  if (status === 409) return "duplicate";
  if (status === 410) return "gone";
  if (status === 412) return "precondition_failed";
  if (status === 429) return "rate_limited";
  return status >= 500 ? "provider_unavailable" : "request_rejected";
}

function isIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function minutesSinceMidnight(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
