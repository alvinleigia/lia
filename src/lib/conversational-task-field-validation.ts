import type { ConversationalTaskDefinitionV1 } from "@/lib/conversation-contracts";
import type { FieldCandidateV1 } from "@/lib/conversational-task-runtime-contracts";

export type TaskFieldDefinition =
  ConversationalTaskDefinitionV1["fields"][number];
type TaskFieldType = TaskFieldDefinition["type"];

type ValidationContext = {
  locale: string;
  timezone: string;
};

export type ValidationResult =
  | { ok: true; value: unknown; sourceReference?: string | null }
  | { ok: false; code: string; message: string };

export type ProjectResourceResolution =
  | { status: "resolved"; id: string; label: string }
  | { status: "ambiguous" }
  | { status: "not_found" };

export type ProjectResourceResolver = (input: {
  field: TaskFieldDefinition;
  value: unknown;
  fieldValues: ReadonlyMap<string, unknown>;
  projectId: number;
}) => Promise<ProjectResourceResolution>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function invalid(code: string, message: string): ValidationResult {
  return { code, message, ok: false };
}

function trimmedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validateText(value: unknown): ValidationResult {
  const normalized = trimmedText(value).replace(/\s+/g, " ");
  return normalized
    ? { ok: true, value: normalized }
    : invalid("text_required", "Enter a value.");
}

function validateEmail(value: unknown): ValidationResult {
  const normalized = trimmedText(value).toLowerCase();
  return EMAIL_PATTERN.test(normalized)
    ? { ok: true, value: normalized }
    : invalid("invalid_email", "Enter a valid email address.");
}

function validatePhone(value: unknown): ValidationResult {
  let normalized = trimmedText(value).replace(/[\s().-]/g, "");
  if (normalized.startsWith("00")) normalized = `+${normalized.slice(2)}`;
  return E164_PATTERN.test(normalized)
    ? { ok: true, value: normalized }
    : invalid(
        "invalid_phone",
        "Enter a phone number with country code, for example +919876543210.",
      );
}

function validateInteger(value: unknown): ValidationResult {
  const normalized =
    typeof value === "number" ? String(value) : trimmedText(value);
  if (!/^[+-]?\d+$/.test(normalized)) {
    return invalid("invalid_integer", "Enter a whole number.");
  }
  const number = Number(normalized);
  return Number.isSafeInteger(number)
    ? { ok: true, value: number }
    : invalid(
        "invalid_integer",
        "Enter a whole number in the supported range.",
      );
}

function validateDecimal(value: unknown): ValidationResult {
  const normalized =
    typeof value === "number" ? String(value) : trimmedText(value);
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) {
    return invalid("invalid_decimal", "Enter a valid number.");
  }
  const number = Number(normalized);
  return Number.isFinite(number)
    ? { ok: true, value: number }
    : invalid("invalid_decimal", "Enter a valid number.");
}

function validateBoolean(value: unknown): ValidationResult {
  if (typeof value === "boolean") return { ok: true, value };
  const normalized = trimmedText(value).toLowerCase();
  if (["true", "yes", "1", "on"].includes(normalized)) {
    return { ok: true, value: true };
  }
  if (["false", "no", "0", "off"].includes(normalized)) {
    return { ok: true, value: false };
  }
  return invalid("invalid_boolean", "Enter yes or no.");
}

function validCalendarDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(
    2,
    "0",
  )}-${String(day).padStart(2, "0")}`;
}

function dateInTimezone(value: Date, context: ValidationContext) {
  try {
    const parts = new Intl.DateTimeFormat(context.locale, {
      day: "2-digit",
      month: "2-digit",
      timeZone: context.timezone,
      year: "numeric",
    }).formatToParts(value);
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    return isoDate(read("year"), read("month"), read("day"));
  } catch {
    return null;
  }
}

function validateDate(
  value: unknown,
  context: ValidationContext,
): ValidationResult {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const normalized = dateInTimezone(value, context);
    return normalized
      ? { ok: true, value: normalized }
      : invalid("invalid_timezone", "The project timezone is not valid.");
  }

  const normalized = trimmedText(value);
  const isoMatch = normalized.match(ISO_DATE_PATTERN);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    return validCalendarDate(year, month, day)
      ? { ok: true, value: isoDate(year, month, day) }
      : invalid("invalid_date", "Enter a valid calendar date.");
  }

  const localized = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (localized) {
    const monthFirst = context.locale.toLowerCase().startsWith("en-us");
    const first = Number(localized[1]);
    const second = Number(localized[2]);
    const year = Number(localized[3]);
    const month = monthFirst ? first : second;
    const day = monthFirst ? second : first;
    return validCalendarDate(year, month, day)
      ? { ok: true, value: isoDate(year, month, day) }
      : invalid("invalid_date", "Enter a valid calendar date.");
  }

  const instant = new Date(normalized);
  if (!Number.isNaN(instant.getTime())) {
    const zoned = dateInTimezone(instant, context);
    if (zoned) return { ok: true, value: zoned };
  }
  return invalid("invalid_date", "Enter a date such as 2026-08-15.");
}

function validateTime(value: unknown): ValidationResult {
  const normalized = trimmedText(value);
  const isoMatch = normalized.match(ISO_TIME_PATTERN);
  if (isoMatch) {
    return {
      ok: true,
      value: `${isoMatch[1]}:${isoMatch[2]}${
        isoMatch[3] ? `:${isoMatch[3]}` : ""
      }`,
    };
  }

  const twelveHour = normalized.match(
    /^(0?[1-9]|1[0-2]):([0-5]\d)\s*(am|pm)$/i,
  );
  if (twelveHour) {
    const hour =
      (Number(twelveHour[1]) % 12) +
      (twelveHour[3].toLowerCase() === "pm" ? 12 : 0);
    return {
      ok: true,
      value: `${String(hour).padStart(2, "0")}:${twelveHour[2]}`,
    };
  }
  return invalid("invalid_time", "Enter a time such as 15:30 or 3:30 PM.");
}

function validateDateRange(
  value: unknown,
  context: ValidationContext,
): ValidationResult {
  let start: unknown;
  let end: unknown;
  if (Array.isArray(value) && value.length === 2) {
    [start, end] = value;
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    start = record.start;
    end = record.end;
  } else if (typeof value === "string") {
    const values = value.split(/\s+(?:to|through)\s+/i);
    if (values.length === 2) [start, end] = values;
  }
  const normalizedStart = validateDate(start, context);
  const normalizedEnd = validateDate(end, context);
  if (!normalizedStart.ok || !normalizedEnd.ok) {
    return invalid(
      "invalid_date_range",
      "Enter a start and end date, for example 2026-08-15 to 2026-08-17.",
    );
  }
  if (String(normalizedStart.value) > String(normalizedEnd.value)) {
    return invalid(
      "invalid_date_range",
      "The end date must be on or after the start date.",
    );
  }
  return {
    ok: true,
    value: { end: normalizedEnd.value, start: normalizedStart.value },
  };
}

function normalizeRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== null && item !== undefined)
      .map(([key, item]) => [
        key,
        typeof item === "string" ? item.trim().replace(/\s+/g, " ") : item,
      ]),
  );
}

function validateAddress(value: unknown): ValidationResult {
  if (typeof value === "string") return validateText(value);
  const normalized = normalizeRecord(value);
  return normalized && Object.keys(normalized).length > 0
    ? { ok: true, value: normalized }
    : invalid("invalid_address", "Enter an address.");
}

function validateLocation(value: unknown): ValidationResult {
  let latitude: number;
  let longitude: number;
  if (typeof value === "string") {
    const parts = value.split(",").map((part) => Number(part.trim()));
    [latitude, longitude] = parts;
  } else {
    const record = normalizeRecord(value);
    latitude = Number(record?.latitude ?? record?.lat);
    longitude = Number(record?.longitude ?? record?.lng);
  }
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return invalid(
      "invalid_location",
      "Enter latitude and longitude within their valid ranges.",
    );
  }
  return { ok: true, value: { latitude, longitude } };
}

function validateMedia(value: unknown): ValidationResult {
  const record = normalizeRecord(value);
  const id = record?.id;
  if (
    (typeof id === "number" && Number.isInteger(id) && id > 0) ||
    (typeof id === "string" && id.trim())
  ) {
    return { ok: true, value: { ...record, id } };
  }
  const url = typeof record?.url === "string" ? record.url : "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return { ok: true, value: { ...record, url: parsed.toString() } };
    }
  } catch {
    // The plain validation result below is safer than exposing parser details.
  }
  return invalid("invalid_media", "Choose a valid media item.");
}

function validateEnum(
  value: unknown,
  field: TaskFieldDefinition,
): ValidationResult {
  const normalized = trimmedText(value);
  const options =
    field.optionSource?.kind === "static" ? field.optionSource.options : [];
  if (options.length === 0) {
    return normalized
      ? { ok: true, value: normalized }
      : invalid("invalid_choice", "Choose a value.");
  }
  const matches = options.filter(
    (option) =>
      option.value.toLowerCase() === normalized.toLowerCase() ||
      option.label.toLowerCase() === normalized.toLowerCase(),
  );
  if (matches.length === 1) {
    return {
      ok: true,
      sourceReference: matches[0].value,
      value: matches[0].value,
    };
  }
  return matches.length > 1
    ? invalid("ambiguous_choice", "Choose one unambiguous option.")
    : invalid("invalid_choice", "Choose one of the available options.");
}

type Validator = (
  value: unknown,
  context: ValidationContext,
  field: TaskFieldDefinition,
) => ValidationResult;

export const TASK_FIELD_VALIDATORS = {
  address: (value) => validateAddress(value),
  boolean: (value) => validateBoolean(value),
  date: (value, context) => validateDate(value, context),
  date_range: (value, context) => validateDateRange(value, context),
  decimal: (value) => validateDecimal(value),
  email: (value) => validateEmail(value),
  enum: (value, _context, field) => validateEnum(value, field),
  integer: (value) => validateInteger(value),
  location: (value) => validateLocation(value),
  media: (value) => validateMedia(value),
  phone: (value) => validatePhone(value),
  project_resource: () =>
    invalid("resource_lookup_required", "Choose an available project item."),
  text: (value) => validateText(value),
  time: (value) => validateTime(value),
} satisfies Record<TaskFieldType, Validator>;

function splitMultiple(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [value];
}

function contextValue(
  context: ReadonlyMap<string, unknown>,
  key: string,
  fallback: string,
) {
  const value = context.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function applyConfiguredValidation(
  field: TaskFieldDefinition,
  value: unknown,
): ValidationResult {
  const rule = field.validation?.trim();
  if (!rule) return { ok: true, value };

  const minLength = rule.match(/^minLength:(\d+)$/i);
  if (minLength && String(value).length < Number(minLength[1])) {
    return invalid(
      "minimum_length",
      `Enter at least ${minLength[1]} characters.`,
    );
  }
  const maxLength = rule.match(/^maxLength:(\d+)$/i);
  if (maxLength && String(value).length > Number(maxLength[1])) {
    return invalid(
      "maximum_length",
      `Enter no more than ${maxLength[1]} characters.`,
    );
  }
  return { ok: true, value };
}

async function validateOne(input: {
  context: ValidationContext;
  field: TaskFieldDefinition;
  fieldValues: ReadonlyMap<string, unknown>;
  projectId: number;
  resolveProjectResource?: ProjectResourceResolver;
  value: unknown;
}): Promise<ValidationResult> {
  if (
    input.field.type === "project_resource" ||
    (input.field.type === "media" &&
      input.field.optionSource?.kind === "project_resource")
  ) {
    if (!input.resolveProjectResource) {
      return invalid(
        "resource_lookup_unavailable",
        "Project items cannot be checked right now.",
      );
    }
    const resolution = await input.resolveProjectResource({
      field: input.field,
      fieldValues: input.fieldValues,
      projectId: input.projectId,
      value: input.value,
    });
    if (resolution.status === "ambiguous") {
      return invalid(
        "ambiguous_project_resource",
        "More than one project item matches. Choose a specific item.",
      );
    }
    if (resolution.status === "not_found") {
      return invalid(
        "project_resource_not_found",
        "Choose an available item from this project.",
      );
    }
    return {
      ok: true,
      sourceReference: resolution.id,
      value: resolution.id,
    };
  }

  const normalized = TASK_FIELD_VALIDATORS[input.field.type](
    input.value,
    input.context,
    input.field,
  );
  return normalized.ok
    ? applyConfiguredValidation(input.field, normalized.value)
    : normalized;
}

export function createToolOutputField(input: {
  key: string;
  resourceType?: string;
  type: TaskFieldType;
}): TaskFieldDefinition {
  return {
    cardinality: "single",
    confirmation: "never",
    dependsOn: [],
    id: "00000000-0000-4000-8000-000000000000",
    key: input.key,
    label: input.key,
    normalization: null,
    optionSource:
      input.type === "project_resource"
        ? {
            collectionKey: null,
            filterByField: null,
            kind: "project_resource",
            resourceType: input.resourceType ?? "service",
          }
        : null,
    prompt: null,
    required: false,
    requiredWhen: null,
    sensitivity: "standard",
    sourcePriority: ["tool"],
    type: input.type,
    validation: null,
  };
}

export function validateTaskFieldValue(input: {
  contextValues?: ReadonlyMap<string, unknown>;
  field: TaskFieldDefinition;
  value: unknown;
}) {
  const contextValues = input.contextValues ?? new Map<string, unknown>();
  const context: ValidationContext = {
    locale: contextValue(contextValues, "lia_locale", "en-US"),
    timezone: contextValue(contextValues, "lia_timezone", "UTC"),
  };
  const normalized = TASK_FIELD_VALIDATORS[input.field.type](
    input.value,
    context,
    input.field,
  );
  return normalized.ok
    ? applyConfiguredValidation(input.field, normalized.value)
    : normalized;
}

export async function canonicalizeTaskFieldValue(input: {
  contextValues?: ReadonlyMap<string, unknown>;
  field: TaskFieldDefinition;
  fieldValues?: ReadonlyMap<string, unknown>;
  projectId: number;
  resolveProjectResource?: ProjectResourceResolver;
  value: unknown;
}) {
  const contextValues = input.contextValues ?? new Map<string, unknown>();
  return validateOne({
    context: {
      locale: contextValue(contextValues, "lia_locale", "en-US"),
      timezone: contextValue(contextValues, "lia_timezone", "UTC"),
    },
    field: input.field,
    fieldValues: input.fieldValues ?? new Map<string, unknown>(),
    projectId: input.projectId,
    resolveProjectResource: input.resolveProjectResource,
    value: input.value,
  });
}

export async function canonicalizeFieldCandidates(input: {
  candidates: FieldCandidateV1[];
  contextValues: ReadonlyMap<string, unknown>;
  definition: ConversationalTaskDefinitionV1;
  fieldValues: ReadonlyMap<string, unknown>;
  projectId: number;
  resolveProjectResource?: ProjectResourceResolver;
}) {
  const fields = new Map(
    input.definition.fields.map((field) => [field.key, field]),
  );
  const validationContext: ValidationContext = {
    locale: contextValue(input.contextValues, "lia_locale", "en-US"),
    timezone: contextValue(input.contextValues, "lia_timezone", "UTC"),
  };

  const progressiveValues = new Map(input.fieldValues);
  const canonicalCandidates: FieldCandidateV1[] = [];
  for (const candidate of input.candidates) {
    const field = fields.get(candidate.fieldKey);
    if (!field) {
      canonicalCandidates.push(candidate);
      continue;
    }
    if (!field.sourcePriority.includes(candidate.provenance.source)) {
      canonicalCandidates.push({
        ...candidate,
        canonicalValue: null,
        state: "invalid",
        validation: {
          code: "source_not_allowed",
          message: "This source is not allowed for the selected field.",
          valid: false,
        },
      });
      continue;
    }

    const values =
      field.cardinality === "multiple"
        ? splitMultiple(candidate.naturalValue)
        : [candidate.naturalValue];
    const results = await Promise.all(
      values.map((value) =>
        validateOne({
          context: validationContext,
          field,
          fieldValues: progressiveValues,
          projectId: input.projectId,
          resolveProjectResource: input.resolveProjectResource,
          value,
        }),
      ),
    );
    const failure = results.find(
      (result): result is Extract<ValidationResult, { ok: false }> =>
        !result.ok,
    );
    if (failure) {
      canonicalCandidates.push({
        ...candidate,
        canonicalValue: null,
        state: "invalid",
        validation: {
          code: failure.code,
          message: failure.message,
          valid: false,
        },
      });
      continue;
    }
    const successful = results as Extract<ValidationResult, { ok: true }>[];
    const canonicalValue =
      field.cardinality === "multiple"
        ? successful.map(({ value }) => value)
        : successful[0]?.value;
    const sourceReference =
      successful.find(({ sourceReference }) => sourceReference)
        ?.sourceReference ?? candidate.provenance.sourceReference;
    const canonicalCandidate: FieldCandidateV1 = {
      ...candidate,
      canonicalValue,
      provenance: {
        source: candidate.provenance.source,
        sourceReference: sourceReference ?? null,
      },
      state: "valid",
      validation: { code: null, message: null, valid: true },
    };
    canonicalCandidates.push(canonicalCandidate);
    progressiveValues.set(field.key, canonicalValue);
  }
  return canonicalCandidates;
}
