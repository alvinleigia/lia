export type FlowAddressValue = {
  city?: string;
  country?: string;
  formatted: string;
  line1?: string;
  line2?: string;
  postalCode?: string;
  region?: string;
};

export type FlowLocationValue = {
  label: string;
  latitude?: number;
  longitude?: number;
  provider?: "browser" | "text" | "whatsapp";
  rawText?: string;
};

function getRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function tryParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function normalizeFlowAddressValue(value: unknown) {
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (parsed) {
      return normalizeFlowAddressValue(parsed);
    }

    const formatted = value.trim().replace(/\s+/g, " ");
    return formatted
      ? ({ formatted, line1: formatted } satisfies FlowAddressValue)
      : null;
  }

  const record = getRecord(value);
  if (!record) {
    return null;
  }

  const address: FlowAddressValue = {
    city: readString(record.city),
    country: readString(record.country),
    formatted: "",
    line1: readString(record.line1),
    line2: readString(record.line2),
    postalCode: readString(record.postalCode),
    region: readString(record.region),
  };
  const formatted =
    readString(record.formatted) ??
    [
      address.line1,
      address.line2,
      address.city,
      address.region,
      address.postalCode,
      address.country,
    ]
      .filter(Boolean)
      .join(", ");

  if (!formatted) {
    return null;
  }

  return {
    ...address,
    formatted,
  };
}

export function isFlowAddressValue(value: unknown): value is FlowAddressValue {
  return Boolean(normalizeFlowAddressValue(value));
}

export function formatFlowAddressValue(value: unknown) {
  return normalizeFlowAddressValue(value)?.formatted ?? String(value);
}

export function normalizeFlowLocationValue(value: unknown) {
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (parsed) {
      return normalizeFlowLocationValue(parsed);
    }

    const rawText = value.trim();
    if (!rawText) {
      return null;
    }

    const coordinateMatch = rawText.match(
      /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/,
    );
    if (coordinateMatch) {
      const latitude = Number(coordinateMatch[1]);
      const longitude = Number(coordinateMatch[2]);

      if (isValidCoordinates(latitude, longitude)) {
        return {
          label: `${latitude}, ${longitude}`,
          latitude,
          longitude,
          provider: "text",
          rawText,
        } satisfies FlowLocationValue;
      }
    }

    return {
      label: rawText,
      provider: "text",
      rawText,
    } satisfies FlowLocationValue;
  }

  const record = getRecord(value);
  if (!record) {
    return null;
  }

  const latitude = readNumber(record.latitude);
  const longitude = readNumber(record.longitude);

  if (
    (latitude !== undefined || longitude !== undefined) &&
    !isValidCoordinates(latitude, longitude)
  ) {
    return null;
  }

  const label =
    readString(record.label) ??
    readString(record.name) ??
    readString(record.address) ??
    (latitude !== undefined && longitude !== undefined
      ? `${latitude}, ${longitude}`
      : undefined);

  if (!label) {
    return null;
  }

  return {
    label,
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    provider:
      record.provider === "browser" ||
      record.provider === "whatsapp" ||
      record.provider === "text"
        ? record.provider
        : undefined,
    rawText: readString(record.rawText),
  } satisfies FlowLocationValue;
}

export function isValidCoordinates(
  latitude: number | undefined,
  longitude: number | undefined,
) {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function isFlowLocationValue(
  value: unknown,
): value is FlowLocationValue {
  return Boolean(normalizeFlowLocationValue(value));
}

export function formatFlowLocationValue(value: unknown) {
  const location = normalizeFlowLocationValue(value);

  if (!location) {
    return String(value);
  }

  if (
    typeof location.latitude === "number" &&
    typeof location.longitude === "number"
  ) {
    return `${location.label} (${location.latitude}, ${location.longitude})`;
  }

  return location.label;
}
