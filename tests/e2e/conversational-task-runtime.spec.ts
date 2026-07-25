import { expect, test } from "@playwright/test";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import { conversationalTaskSnapshotV1Schema } from "../../src/lib/conversation-contracts";
import {
  applyFieldCandidates,
  clearRuntimeField,
  evaluateRequiredWhen,
  initializeRuntimeTaskFields,
  resetRuntimeFields,
} from "../../src/lib/conversational-task-field-state";
import {
  inboundEventV1Schema,
  startConversationalTaskRunV1Schema,
} from "../../src/lib/conversational-task-runtime-contracts";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

const NOW = new Date("2026-07-25T10:00:00.000Z");
const EXPIRES_AT = new Date("2027-07-25T10:00:00.000Z");

const snapshot = conversationalTaskSnapshotV1Schema.parse({
  schemaVersion: 1,
  assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
  assistantPolicy: REFERENCE_BOOKING_PROJECT_POLICY.assistant,
  conversationPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
  task: {
    id: 95,
    schemaVersion: 1,
    name: "Book a Spa Service",
    objective: "Submit a validated appointment request.",
    description: null,
    definition: REFERENCE_BOOKING_TASK_DEFINITION,
  },
});

function candidate(fieldKey: string, value: unknown) {
  return {
    fieldKey,
    naturalValue: value,
    canonicalValue: value,
    state: "valid" as const,
    provenance: {
      source: "visitor" as const,
      sourceReference: null,
    },
    validation: {
      code: null,
      message: null,
      valid: true,
    },
  };
}

test("runtime fields begin missing and preserve configured retention", () => {
  const fields = initializeRuntimeTaskFields({
    expiresAt: EXPIRES_AT,
    snapshot,
  });

  expect(fields.size).toBe(REFERENCE_BOOKING_TASK_DEFINITION.fields.length);
  expect(fields.get("serviceCategoryId")).toMatchObject({
    attemptCount: 0,
    expiresAt: EXPIRES_AT,
    isRequired: true,
    state: "missing",
  });
});

test("one turn can supply several canonical field candidates", () => {
  const fields = initializeRuntimeTaskFields({
    expiresAt: EXPIRES_AT,
    snapshot,
  });
  const result = applyFieldCandidates({
    candidates: [
      candidate("serviceCategoryId", "massage"),
      candidate("serviceId", "deep_tissue"),
      candidate("preferredDate", "2026-08-15"),
    ],
    definition: snapshot.task.definition,
    eventId: "event-1",
    fields,
    now: NOW,
  });

  expect(result.fields.get("serviceCategoryId")).toMatchObject({
    canonicalValue: "massage",
    state: "valid",
  });
  expect(result.fields.get("serviceId")).toMatchObject({
    canonicalValue: "deep_tissue",
    state: "valid",
  });
  expect(result.fields.get("preferredDate")).toMatchObject({
    canonicalValue: "2026-08-15",
    state: "valid",
  });
});

test("correcting an upstream value invalidates dependent values", () => {
  const initial = initializeRuntimeTaskFields({
    expiresAt: EXPIRES_AT,
    snapshot,
  });
  const collected = applyFieldCandidates({
    candidates: [
      candidate("serviceCategoryId", "massage"),
      candidate("serviceId", "deep_tissue"),
      candidate("preferredDate", "2026-08-15"),
    ],
    definition: snapshot.task.definition,
    eventId: "event-1",
    fields: initial,
    now: NOW,
  });
  const corrected = applyFieldCandidates({
    candidates: [candidate("serviceCategoryId", "facial")],
    definition: snapshot.task.definition,
    eventId: "event-2",
    fields: collected.fields,
    now: new Date("2026-07-25T10:01:00.000Z"),
  });

  expect(corrected.fields.get("serviceCategoryId")).toMatchObject({
    canonicalValue: "facial",
    state: "valid",
  });
  expect(corrected.fields.get("serviceId")).toMatchObject({
    canonicalValue: "deep_tissue",
    state: "candidate",
    validation: { code: "dependency_changed", valid: false },
  });
  expect(corrected.fields.get("preferredDate")).toMatchObject({
    state: "candidate",
    validation: { code: "dependency_changed", valid: false },
  });
});

test("clearing and restarting retain an auditable lifecycle state", () => {
  const initial = initializeRuntimeTaskFields({
    expiresAt: EXPIRES_AT,
    snapshot,
  });
  const collected = applyFieldCandidates({
    candidates: [candidate("guestEmail", "guest@example.com")],
    definition: snapshot.task.definition,
    eventId: "event-1",
    fields: initial,
    now: NOW,
  });
  const cleared = clearRuntimeField({
    definition: snapshot.task.definition,
    eventId: "event-2",
    fieldKey: "guestEmail",
    fields: collected.fields,
    now: new Date("2026-07-25T10:01:00.000Z"),
    reason: "visitor_correction",
  });

  expect(cleared.fields.get("guestEmail")).toMatchObject({
    canonicalValue: null,
    naturalValue: null,
    state: "cleared",
  });

  const restarted = resetRuntimeFields(
    cleared.fields,
    new Date("2026-07-25T10:02:00.000Z"),
  );
  expect(
    [...restarted.values()].every((field) => field.state === "missing"),
  ).toBe(true);
});

test("conditional required expressions support common deterministic rules", () => {
  const fields = initializeRuntimeTaskFields({
    expiresAt: EXPIRES_AT,
    snapshot,
  });
  const collected = applyFieldCandidates({
    candidates: [candidate("serviceCategoryId", "massage")],
    definition: snapshot.task.definition,
    eventId: "event-1",
    fields,
    now: NOW,
  });

  expect(
    evaluateRequiredWhen(
      "serviceCategoryId is present and serviceCategoryId == massage",
      collected.fields,
    ),
  ).toBe(true);
  expect(
    evaluateRequiredWhen("serviceCategoryId == facial", collected.fields),
  ).toBe(false);
  expect(
    evaluateRequiredWhen("unsupported business prose", collected.fields),
  ).toBeNull();
});

test("external tool results require authenticated typed provenance", () => {
  const base = {
    schemaVersion: 1 as const,
    eventId: "event-1",
    projectId: 194,
    conversationId: 10,
    taskRunId: 20,
    channelType: "project_chat",
    channelIdentity: {},
    providerSequence: 1,
    expectedRevision: 0,
    occurredAt: NOW.toISOString(),
    receivedAt: NOW.toISOString(),
    authentication: null,
    type: "tool.result" as const,
    requestId: "request-1",
    status: "completed" as const,
    result: { available: true },
    errorCode: null,
  };

  expect(inboundEventV1Schema.safeParse(base).success).toBe(false);
  expect(
    inboundEventV1Schema.safeParse({
      ...base,
      authentication: {
        kind: "hmac",
        principal: "availability-provider",
        verifiedAt: NOW.toISOString(),
        keyId: "key-1",
      },
    }).success,
  ).toBe(true);
});

test("verified and authenticated starts require explicit identity references", () => {
  const base = {
    projectId: 194,
    conversationId: 10,
    taskId: 95,
    eventId: "event-1",
    channelType: "project_chat",
    channelIdentity: {},
    anonymousVisitorId: null,
    sessionId: "session-1",
    sessionExpiresAt: null,
    verifiedContactId: null,
    authenticatedUserId: null,
    occurredAt: NOW.toISOString(),
    receivedAt: NOW.toISOString(),
    providerSequence: null,
    initializationContext: {},
  };

  expect(
    startConversationalTaskRunV1Schema.safeParse({
      ...base,
      identityKind: "verified_contact",
    }).success,
  ).toBe(false);
  expect(
    startConversationalTaskRunV1Schema.safeParse({
      ...base,
      identityKind: "authenticated_user",
      authenticatedUserId: 7,
    }).success,
  ).toBe(true);
});
