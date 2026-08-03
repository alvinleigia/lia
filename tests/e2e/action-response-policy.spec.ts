import { expect, test } from "@playwright/test";
import {
  ACTION_RESPONSE_POLICY_STATE_METADATA_KEY,
  buildActionResponsePolicy,
  buildActionResponsePolicyState,
  clearActionResponsePolicyState,
  getActionResponsePolicy,
  getActionResponsePolicyFailureOutput,
  getActionResponsePolicyState,
} from "../../src/lib/action-response-policy";

test("response policy normalizes deterministic defaults and routes", () => {
  const policy = buildActionResponsePolicy({
    cancellationStepId: 5,
    noReplyReminderMessage: "Still there?",
    noReplyReminderMinutes: 2,
    noReplyTimeoutMessage: "Timed out.",
    noReplyTimeoutMinutes: 5,
    noReplyTimeoutStepId: 6,
    retryCount: 3,
    retryExhaustedStepId: 4,
    retryMessage: "Try once more.",
    validationFailureStepId: null,
  });

  expect(getActionResponsePolicy({ responsePolicy: policy })).toEqual(policy);
  expect(getActionResponsePolicyFailureOutput(policy, 1)).toBeNull();
  expect(getActionResponsePolicyFailureOutput(policy, 4)).toBe(
    "retry_exhausted",
  );
});

test("response state pins the version, attempts, and no-reply deadlines", () => {
  const policy = buildActionResponsePolicy({
    cancellationStepId: null,
    noReplyReminderMessage: "Still there?",
    noReplyReminderMinutes: 2,
    noReplyTimeoutMessage: "Timed out.",
    noReplyTimeoutMinutes: 5,
    noReplyTimeoutStepId: null,
    retryCount: 2,
    retryExhaustedStepId: null,
    retryMessage: "Try again.",
    validationFailureStepId: null,
  });
  const state = buildActionResponsePolicyState({
    actionVersionId: 91,
    attemptCount: 1,
    now: new Date("2026-08-03T10:00:00.000Z"),
    policy,
    stepId: 42,
  });
  const metadata = {
    [ACTION_RESPONSE_POLICY_STATE_METADATA_KEY]: state,
    keep: true,
  };

  expect(state).toEqual({
    actionVersionId: 91,
    attemptCount: 1,
    enteredAt: "2026-08-03T10:00:00.000Z",
    reminderAt: "2026-08-03T10:02:00.000Z",
    schemaVersion: 1,
    stepId: 42,
    timeoutAt: "2026-08-03T10:05:00.000Z",
  });
  expect(getActionResponsePolicyState(metadata)).toEqual(state);
  expect(clearActionResponsePolicyState(metadata)).toEqual({ keep: true });
});
