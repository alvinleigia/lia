export const COMPANY_TIME_ZONE_OPTIONS = [
  { label: "Coordinated Universal Time (UTC)", value: "UTC" },
  { label: "Cairo (Africa/Cairo)", value: "Africa/Cairo" },
  {
    label: "Johannesburg (Africa/Johannesburg)",
    value: "Africa/Johannesburg",
  },
  { label: "Chicago (America/Chicago)", value: "America/Chicago" },
  {
    label: "Los Angeles (America/Los_Angeles)",
    value: "America/Los_Angeles",
  },
  { label: "New York (America/New_York)", value: "America/New_York" },
  { label: "São Paulo (America/Sao_Paulo)", value: "America/Sao_Paulo" },
  { label: "Dubai (Asia/Dubai)", value: "Asia/Dubai" },
  { label: "Hong Kong (Asia/Hong_Kong)", value: "Asia/Hong_Kong" },
  { label: "India (Asia/Kolkata)", value: "Asia/Kolkata" },
  { label: "Singapore (Asia/Singapore)", value: "Asia/Singapore" },
  { label: "Tokyo (Asia/Tokyo)", value: "Asia/Tokyo" },
  { label: "Sydney (Australia/Sydney)", value: "Australia/Sydney" },
  { label: "Berlin (Europe/Berlin)", value: "Europe/Berlin" },
  { label: "London (Europe/London)", value: "Europe/London" },
  { label: "Auckland (Pacific/Auckland)", value: "Pacific/Auckland" },
] as const;

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function isSupportedCompanyTimeZone(value: string) {
  return COMPANY_TIME_ZONE_OPTIONS.some((option) => option.value === value);
}

function normalizeFormattedDate(value: string) {
  return value.replace(/\s+/g, " ");
}

function resolveTimeZone(timeZone: string) {
  return isValidTimeZone(timeZone) ? timeZone : "UTC";
}

export function formatDateInTimeZone(value: Date, timeZone: string) {
  return normalizeFormattedDate(
    new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      timeZone: resolveTimeZone(timeZone),
      year: "numeric",
    }).format(value),
  );
}

export function formatDateTimeInTimeZone(value: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    second: "2-digit",
    timeZone: resolveTimeZone(timeZone),
    timeZoneName: "short",
    year: "numeric",
  });

  return normalizeFormattedDate(
    formatter
      .formatToParts(value)
      .map((part) =>
        part.type === "dayPeriod" ? part.value.toUpperCase() : part.value,
      )
      .join(""),
  );
}
