export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const OPERATION_RESULT_OUTCOMES = [
  "success",
  "client_error",
  "server_error",
  "timeout",
  "network_failure",
] as const;
export type OperationResultOutcome = (typeof OPERATION_RESULT_OUTCOMES)[number];

export function getOperationOutcomeKeys(settings: Record<string, unknown>) {
  const customStatusCodes = Array.isArray(settings.customStatusCodes)
    ? settings.customStatusCodes.filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isInteger(value) &&
          value >= 100 &&
          value <= 599,
      )
    : [];

  return [
    ...OPERATION_RESULT_OUTCOMES,
    ...customStatusCodes.map((status) => `status_${status}`),
  ];
}

export function isOperationOutcomeKey(value: string) {
  return (
    OPERATION_RESULT_OUTCOMES.includes(
      value as (typeof OPERATION_RESULT_OUTCOMES)[number],
    ) || /^status_[1-5][0-9]{2}$/.test(value)
  );
}

export function formatOperationOutcomeLabel(value: string) {
  const statusMatch = /^status_([1-5][0-9]{2})$/.exec(value);
  return statusMatch
    ? `HTTP ${statusMatch[1]}`
    : value
        .replaceAll("_", " ")
        .replace(/^./, (letter) => letter.toUpperCase());
}
