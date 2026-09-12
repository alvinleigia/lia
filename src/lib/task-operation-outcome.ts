// Transport completion does not imply that the provider accepted the action.
export function getTaskOperationOutcome(
  attempt: {
    status: string;
    responsePayload: Record<string, unknown>;
  },
  operation?: { operationType: string },
) {
  if (attempt.status === "pending") return "pending";
  if (attempt.status === "outcome_unknown") return "outcome_unknown";
  if (attempt.status !== "completed") return "provider_failure";
  const status = attempt.responsePayload.status;
  switch (status) {
    case "success":
    case "no_result":
    case "rejected":
    case "provider_failure":
    case "timeout":
    case "outcome_unknown":
    case "cancelled":
      return status;
    default:
      // Legacy adapters use delivery success; Calendar requires its business contract.
      return typeof status === "string" ||
        operation?.operationType.startsWith("google_calendar.") ||
        operation?.operationType.startsWith("appointment.")
        ? "outcome_unknown"
        : "success";
  }
}

export function getTaskOperationReason(attempt: {
  responsePayload: Record<string, unknown>;
}) {
  const reason = attempt.responsePayload.reason;
  return typeof reason === "string" && /^[a-z0-9_]{1,80}$/.test(reason)
    ? reason
    : null;
}
