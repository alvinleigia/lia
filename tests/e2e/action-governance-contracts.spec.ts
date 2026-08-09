import { expect, test } from "@playwright/test";
import {
  BUSINESS_HOURS_FIELD_KEY,
  getAvailabilityBranchFields,
  QUEUE_AVAILABILITY_FIELD_KEY,
} from "../../src/lib/action-availability";
import {
  parseStructuredFormFlowJson,
  validateStructuredFormForPublication,
} from "../../src/lib/structured-forms";

test("availability settings expose deterministic system branch fields", () => {
  const settings = {
    availability: {
      businessHours: {
        enabled: true,
        timeZone: "Asia/Kolkata",
        weekdays: [1],
        startTime: "09:00",
        endTime: "17:00",
      },
      queue: { enabled: true, available: true },
    },
  };

  expect(
    getAvailabilityBranchFields(settings, new Date("2026-08-10T06:00:00Z")),
  ).toEqual({
    [BUSINESS_HOURS_FIELD_KEY]: true,
    [QUEUE_AVAILABILITY_FIELD_KEY]: true,
  });
  expect(
    getAvailabilityBranchFields(settings, new Date("2026-08-10T14:00:00Z")),
  ).toEqual({
    [BUSINESS_HOURS_FIELD_KEY]: false,
    [QUEUE_AVAILABILITY_FIELD_KEY]: true,
  });
});

test("overnight business hours remain open after midnight from a scheduled day", () => {
  const settings = {
    availability: {
      businessHours: {
        enabled: true,
        timeZone: "UTC",
        weekdays: [1],
        startTime: "22:00",
        endTime: "02:00",
      },
      queue: { enabled: false, available: false },
    },
  };

  expect(
    getAvailabilityBranchFields(settings, new Date("2026-08-10T23:00:00Z"))[
      BUSINESS_HOURS_FIELD_KEY
    ],
  ).toBe(true);
  expect(
    getAvailabilityBranchFields(settings, new Date("2026-08-11T01:00:00Z"))[
      BUSINESS_HOURS_FIELD_KEY
    ],
  ).toBe(true);
  expect(
    getAvailabilityBranchFields(settings, new Date("2026-08-11T03:00:00Z"))[
      BUSINESS_HOURS_FIELD_KEY
    ],
  ).toBe(false);
});

test("structured forms require governed fields and reject provider secrets", () => {
  const settings = {
    structuredForm: {
      enabled: true,
      key: "guest_booking",
      version: "1.0.0",
      status: "published",
      fieldKeys: ["guestName", "guestEmail"],
      presentation: "adaptive",
      providers: {
        whatsapp: {
          schemaVersion: "7.1",
          flow: {
            screens: [],
            token: "must-not-be-stored",
          } as Record<string, unknown>,
        },
      },
    },
  };

  expect(
    validateStructuredFormForPublication(settings, ["guestName", "guestEmail"]),
  ).toContain("WhatsApp Flow JSON must not contain credentials or secrets.");
  expect(parseStructuredFormFlowJson("[]")).toEqual({
    error: "WhatsApp Flow JSON must be an object.",
  });

  settings.structuredForm.providers.whatsapp.flow = {
    screens: [],
    integration: { clientSecret: "must-not-be-stored" },
  };
  expect(
    validateStructuredFormForPublication(settings, ["guestName", "guestEmail"]),
  ).toContain("WhatsApp Flow JSON must not contain credentials or secrets.");
});

test("browser-only structured forms publish without a provider schema", () => {
  const settings = {
    structuredForm: {
      enabled: true,
      key: "guest_booking",
      version: "1.0.0",
      status: "published",
      fieldKeys: ["guestName"],
      presentation: "adaptive",
      providers: {},
    },
  };

  expect(validateStructuredFormForPublication(settings, ["guestName"])).toEqual(
    [],
  );
});
