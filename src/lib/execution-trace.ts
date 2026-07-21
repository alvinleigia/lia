import { randomUUID } from "node:crypto";

const TRACE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;

export function normalizeTraceId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return TRACE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function resolveTraceId(value?: unknown) {
  return normalizeTraceId(value) ?? randomUUID();
}
