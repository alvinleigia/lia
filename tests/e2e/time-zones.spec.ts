import { expect, test } from "@playwright/test";
import {
  formatDateInTimeZone,
  formatDateTimeInTimeZone,
  isSupportedCompanyTimeZone,
  isValidTimeZone,
} from "../../src/lib/time-zones";

const TEST_INSTANT = new Date("2026-08-20T15:58:55.000Z");

test("validates supported company timezones", () => {
  expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
  expect(isSupportedCompanyTimeZone("Asia/Kolkata")).toBe(true);
  expect(isSupportedCompanyTimeZone("Not/A_Time_Zone")).toBe(false);
});

test("formats timestamps in the configured company timezone", () => {
  const formatted = formatDateTimeInTimeZone(TEST_INSTANT, "Asia/Kolkata");

  expect(formatted).toContain("20 Aug 2026");
  expect(formatted).toContain("9:28:55 PM");
  expect(formatted).toMatch(/IST|GMT\+5:30/);
});

test("formats dates in the configured company timezone", () => {
  expect(formatDateInTimeZone(TEST_INSTANT, "Asia/Kolkata")).toBe(
    "20 Aug 2026",
  );
});

test("falls back to UTC for an invalid stored timezone", () => {
  const formatted = formatDateTimeInTimeZone(TEST_INSTANT, "Not/A_Time_Zone");

  expect(formatted).toContain("3:58:55 PM");
  expect(formatted).toContain("UTC");
});
