export const BUSINESS_HOURS_FIELD_KEY = "system.business_hours_open";
export const QUEUE_AVAILABILITY_FIELD_KEY = "system.handoff_queue_available";

export type ActionAvailabilitySettings = {
  businessHours: {
    enabled: boolean;
    timeZone: string;
    weekdays: number[];
    startTime: string;
    endTime: string;
  };
  queue: {
    enabled: boolean;
    available: boolean;
  };
};

const DEFAULT_SETTINGS: ActionAvailabilitySettings = {
  businessHours: {
    enabled: false,
    timeZone: "UTC",
    weekdays: [1, 2, 3, 4, 5],
    startTime: "09:00",
    endTime: "17:00",
  },
  queue: {
    enabled: false,
    available: false,
  },
};

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function getActionAvailabilitySettings(
  settings: Record<string, unknown>,
): ActionAvailabilitySettings {
  const availability = getRecord(settings.availability);
  const businessHours = getRecord(availability.businessHours);
  const queue = getRecord(availability.queue);
  const timeZone =
    typeof businessHours.timeZone === "string" &&
    isValidTimeZone(businessHours.timeZone)
      ? businessHours.timeZone
      : DEFAULT_SETTINGS.businessHours.timeZone;
  const weekdays = Array.isArray(businessHours.weekdays)
    ? businessHours.weekdays.filter(
        (day): day is number =>
          typeof day === "number" &&
          Number.isInteger(day) &&
          day >= 0 &&
          day <= 6,
      )
    : DEFAULT_SETTINGS.businessHours.weekdays;

  return {
    businessHours: {
      enabled: businessHours.enabled === true,
      timeZone,
      weekdays,
      startTime:
        typeof businessHours.startTime === "string"
          ? businessHours.startTime
          : DEFAULT_SETTINGS.businessHours.startTime,
      endTime:
        typeof businessHours.endTime === "string"
          ? businessHours.endTime
          : DEFAULT_SETTINGS.businessHours.endTime,
    },
    queue: {
      enabled: queue.enabled === true,
      available: queue.available === true,
    },
  };
}

function parseTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

function getZonedParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone,
    weekday: "short",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    values.weekday,
  );

  return {
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute),
    weekday,
  };
}

export function getAvailabilityBranchFields(
  settings: Record<string, unknown>,
  now = new Date(),
) {
  const availability = getActionAvailabilitySettings(settings);
  const start = parseTime(availability.businessHours.startTime);
  const end = parseTime(availability.businessHours.endTime);
  let businessHoursOpen = false;

  if (availability.businessHours.enabled && start !== null && end !== null) {
    const zoned = getZonedParts(now, availability.businessHours.timeZone);
    const isScheduledDay = availability.businessHours.weekdays.includes(
      zoned.weekday,
    );

    if (start < end) {
      businessHoursOpen =
        isScheduledDay && zoned.minuteOfDay >= start && zoned.minuteOfDay < end;
    } else if (start > end) {
      const previousWeekday = (zoned.weekday + 6) % 7;
      businessHoursOpen =
        (isScheduledDay && zoned.minuteOfDay >= start) ||
        (availability.businessHours.weekdays.includes(previousWeekday) &&
          zoned.minuteOfDay < end);
    }
  }

  return {
    [BUSINESS_HOURS_FIELD_KEY]: businessHoursOpen,
    [QUEUE_AVAILABILITY_FIELD_KEY]:
      availability.queue.enabled && availability.queue.available,
  };
}
