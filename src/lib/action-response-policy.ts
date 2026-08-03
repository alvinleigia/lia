export const ACTION_RESPONSE_POLICY_SETTINGS_KEY = "responsePolicy";
export const ACTION_RESPONSE_POLICY_STATE_METADATA_KEY = "flowResponsePolicy";

export const ACTION_RESPONSE_POLICY_OUTPUTS = [
  "validation_failure",
  "retry_exhausted",
  "cancelled",
  "no_reply_timeout",
] as const;

export type ActionResponsePolicyOutput =
  (typeof ACTION_RESPONSE_POLICY_OUTPUTS)[number];

export type ActionResponsePolicy = {
  cancellationStepId: number | null;
  noReplyReminderMessage: string;
  noReplyReminderMinutes: number | null;
  noReplyTimeoutMessage: string;
  noReplyTimeoutMinutes: number | null;
  noReplyTimeoutStepId: number | null;
  retryCount: number;
  retryExhaustedStepId: number | null;
  retryMessage: string;
  schemaVersion: 1;
  validationFailureStepId: number | null;
};

export type ActionResponsePolicyState = {
  actionVersionId: number | null;
  attemptCount: number;
  enteredAt: string;
  reminderAt: string | null;
  schemaVersion: 1;
  stepId: number;
  timeoutAt: string | null;
};

const DEFAULT_POLICY: ActionResponsePolicy = {
  cancellationStepId: null,
  noReplyReminderMessage:
    "Are you still there? Please reply when you are ready.",
  noReplyReminderMinutes: null,
  noReplyTimeoutMessage:
    "This request timed out because no reply was received.",
  noReplyTimeoutMinutes: null,
  noReplyTimeoutStepId: null,
  retryCount: 2,
  retryExhaustedStepId: null,
  retryMessage: "Please try again.",
  schemaVersion: 1,
  validationFailureStepId: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getInteger(value: unknown, options: { max: number; min: number }) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= options.min &&
    value <= options.max
    ? value
    : null;
}

function getText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 500)
    : fallback;
}

export function getActionResponsePolicy(
  settings: Record<string, unknown>,
): ActionResponsePolicy {
  const value = settings[ACTION_RESPONSE_POLICY_SETTINGS_KEY];
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return { ...DEFAULT_POLICY };
  }

  return {
    cancellationStepId: getInteger(value.cancellationStepId, {
      max: Number.MAX_SAFE_INTEGER,
      min: 1,
    }),
    noReplyReminderMessage: getText(
      value.noReplyReminderMessage,
      DEFAULT_POLICY.noReplyReminderMessage,
    ),
    noReplyReminderMinutes: getInteger(value.noReplyReminderMinutes, {
      max: 10_080,
      min: 1,
    }),
    noReplyTimeoutMessage: getText(
      value.noReplyTimeoutMessage,
      DEFAULT_POLICY.noReplyTimeoutMessage,
    ),
    noReplyTimeoutMinutes: getInteger(value.noReplyTimeoutMinutes, {
      max: 10_080,
      min: 1,
    }),
    noReplyTimeoutStepId: getInteger(value.noReplyTimeoutStepId, {
      max: Number.MAX_SAFE_INTEGER,
      min: 1,
    }),
    retryCount:
      getInteger(value.retryCount, { max: 10, min: 0 }) ??
      DEFAULT_POLICY.retryCount,
    retryExhaustedStepId: getInteger(value.retryExhaustedStepId, {
      max: Number.MAX_SAFE_INTEGER,
      min: 1,
    }),
    retryMessage: getText(value.retryMessage, DEFAULT_POLICY.retryMessage),
    schemaVersion: 1,
    validationFailureStepId: getInteger(value.validationFailureStepId, {
      max: Number.MAX_SAFE_INTEGER,
      min: 1,
    }),
  };
}

export function buildActionResponsePolicy(
  input: Omit<ActionResponsePolicy, "schemaVersion">,
): ActionResponsePolicy {
  return getActionResponsePolicy({
    [ACTION_RESPONSE_POLICY_SETTINGS_KEY]: {
      ...input,
      schemaVersion: 1,
    },
  });
}

export function getActionResponsePolicyTarget(
  policy: ActionResponsePolicy,
  output: ActionResponsePolicyOutput,
) {
  switch (output) {
    case "cancelled":
      return policy.cancellationStepId;
    case "no_reply_timeout":
      return policy.noReplyTimeoutStepId;
    case "retry_exhausted":
      return policy.retryExhaustedStepId;
    case "validation_failure":
      return policy.validationFailureStepId;
  }
}

export function getActionResponsePolicyFailureOutput(
  policy: ActionResponsePolicy,
  attemptCount: number,
): "retry_exhausted" | "validation_failure" | null {
  if (policy.validationFailureStepId !== null) {
    return "validation_failure";
  }

  return attemptCount > policy.retryCount ? "retry_exhausted" : null;
}

export function buildActionResponsePolicyState(input: {
  actionVersionId: number | null;
  attemptCount?: number;
  now?: Date;
  policy: ActionResponsePolicy;
  stepId: number;
}): ActionResponsePolicyState {
  const now = input.now ?? new Date();
  const atMinutes = (minutes: number | null) =>
    minutes === null
      ? null
      : new Date(now.getTime() + minutes * 60_000).toISOString();

  return {
    actionVersionId: input.actionVersionId,
    attemptCount: Math.max(0, Math.trunc(input.attemptCount ?? 0)),
    enteredAt: now.toISOString(),
    reminderAt: atMinutes(input.policy.noReplyReminderMinutes),
    schemaVersion: 1,
    stepId: input.stepId,
    timeoutAt: atMinutes(input.policy.noReplyTimeoutMinutes),
  };
}

export function getActionResponsePolicyState(
  metadata: Record<string, unknown>,
): ActionResponsePolicyState | null {
  const value = metadata[ACTION_RESPONSE_POLICY_STATE_METADATA_KEY];
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return null;
  }

  const stepId = getInteger(value.stepId, {
    max: Number.MAX_SAFE_INTEGER,
    min: 1,
  });
  const attemptCount = getInteger(value.attemptCount, {
    max: Number.MAX_SAFE_INTEGER,
    min: 0,
  });
  const enteredAt =
    typeof value.enteredAt === "string" &&
    !Number.isNaN(Date.parse(value.enteredAt))
      ? value.enteredAt
      : null;
  const getNullableDate = (candidate: unknown) =>
    candidate === null
      ? null
      : typeof candidate === "string" && !Number.isNaN(Date.parse(candidate))
        ? candidate
        : undefined;
  const reminderAt = getNullableDate(value.reminderAt);
  const timeoutAt = getNullableDate(value.timeoutAt);
  const actionVersionId =
    value.actionVersionId === null
      ? null
      : getInteger(value.actionVersionId, {
          max: Number.MAX_SAFE_INTEGER,
          min: 1,
        });

  return stepId &&
    attemptCount !== null &&
    enteredAt &&
    reminderAt !== undefined &&
    timeoutAt !== undefined &&
    actionVersionId !== undefined
    ? {
        actionVersionId,
        attemptCount,
        enteredAt,
        reminderAt,
        schemaVersion: 1,
        stepId,
        timeoutAt,
      }
    : null;
}

export function clearActionResponsePolicyState(
  metadata: Record<string, unknown>,
) {
  const nextMetadata = { ...metadata };
  delete nextMetadata[ACTION_RESPONSE_POLICY_STATE_METADATA_KEY];
  return nextMetadata;
}
