import { expect, test } from "@playwright/test";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import {
  conversationalTaskSnapshotV1Schema,
  type ToolDefinitionV1,
} from "../../src/lib/conversation-contracts";
import {
  applyFieldCandidates,
  clearRuntimeField,
  evaluateRequiredWhen,
  initializeRuntimeTaskFields,
  resetRuntimeFields,
} from "../../src/lib/conversational-task-field-state";
import {
  canonicalizeFieldCandidates,
  type TaskFieldDefinition,
  validateTaskFieldValue,
} from "../../src/lib/conversational-task-field-validation";
import {
  inboundEventV1Schema,
  startConversationalTaskRunV1Schema,
} from "../../src/lib/conversational-task-runtime-contracts";
import {
  buildCanonicalToolInput,
  validateToolResultPayload,
} from "../../src/lib/conversational-task-tool-runtime";
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

function fieldFor(
  type: TaskFieldDefinition["type"],
  overrides: Partial<TaskFieldDefinition> = {},
): TaskFieldDefinition {
  return {
    ...REFERENCE_BOOKING_TASK_DEFINITION.fields[4],
    id: "20000000-0000-4000-8000-000000000001",
    key: "testValue",
    label: "Test Value",
    type,
    ...overrides,
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

test("typed validators normalize common business values deterministically", () => {
  const contextValues = new Map<string, unknown>([
    ["lia_locale", "en-IN"],
    ["lia_timezone", "Asia/Kolkata"],
  ]);

  expect(
    validateTaskFieldValue({
      contextValues,
      field: fieldFor("email"),
      value: " Guest@Example.COM ",
    }),
  ).toEqual({ ok: true, value: "guest@example.com" });
  expect(
    validateTaskFieldValue({
      contextValues,
      field: fieldFor("phone"),
      value: "0091 98765-43210",
    }),
  ).toEqual({ ok: true, value: "+919876543210" });
  expect(
    validateTaskFieldValue({
      contextValues,
      field: fieldFor("date"),
      value: "15/08/2026",
    }),
  ).toEqual({ ok: true, value: "2026-08-15" });
  expect(
    validateTaskFieldValue({
      field: fieldFor("date"),
      value: "15/08/2026",
    }),
  ).toEqual({ ok: true, value: "2026-08-15" });
  expect(
    validateTaskFieldValue({
      contextValues,
      field: fieldFor("time"),
      value: "3:30 PM",
    }),
  ).toEqual({ ok: true, value: "15:30" });
  expect(
    validateTaskFieldValue({
      contextValues,
      field: fieldFor("date_range"),
      value: "2026-08-15 to 2026-08-17",
    }),
  ).toEqual({
    ok: true,
    value: { end: "2026-08-17", start: "2026-08-15" },
  });
  expect(
    validateTaskFieldValue({
      contextValues,
      field: fieldFor("location"),
      value: "15.4909, 73.8278",
    }),
  ).toEqual({
    ok: true,
    value: { latitude: 15.4909, longitude: 73.8278 },
  });
});

test("server canonicalization ignores client-proposed canonical state", async () => {
  const canonical = await canonicalizeFieldCandidates({
    candidates: [
      {
        ...candidate("guestEmail", " Guest@Example.COM "),
        canonicalValue: "attacker-controlled@example.net",
        state: "confirmed",
      },
    ],
    contextValues: new Map(),
    definition: REFERENCE_BOOKING_TASK_DEFINITION,
    fieldValues: new Map(),
    projectId: 194,
  });

  expect(canonical).toContainEqual(
    expect.objectContaining({
      canonicalValue: "guest@example.com",
      fieldKey: "guestEmail",
      state: "valid",
      validation: { code: null, message: null, valid: true },
    }),
  );
});

test("tool input is derived from current allowed runtime values", () => {
  const definition: ToolDefinitionV1 = {
    access: "read",
    description: "Check a service using canonical task state.",
    execution: {
      adapter: "built_in",
      cancellation: "unsupported",
      handler: "test.lookup",
      mode: "synchronous",
      retryAttempts: 0,
      retryDelayMs: 0,
      timeoutMs: 5_000,
    },
    id: "test.lookup",
    inputSchema: {
      fields: [
        {
          key: "serviceId",
          required: true,
          source: { key: "serviceId", kind: "field" },
          type: "project_resource",
        },
      ],
    },
    name: "Test Lookup",
    outputSchema: { fields: [] },
    projectId: 194,
    requiredForCompletion: false,
    resultMappings: [],
    schemaVersion: 1,
    version: 1,
  };
  const fields = new Map([
    ["serviceId", { canonicalValue: "product:12", state: "confirmed" }],
  ]);

  expect(
    buildCanonicalToolInput({
      context: new Map(),
      definition,
      fields,
      now: NOW,
      proposedInput: {},
    }),
  ).toEqual({ input: { serviceId: "product:12" }, ok: true });
  expect(
    buildCanonicalToolInput({
      context: new Map(),
      definition,
      fields,
      now: NOW,
      proposedInput: { serviceId: "product:99" },
    }),
  ).toMatchObject({
    error: { code: "tool_input_mismatch" },
    ok: false,
  });
  expect(
    buildCanonicalToolInput({
      context: new Map(),
      definition,
      fields,
      now: NOW,
      proposedInput: { secret: "not-allowed" },
    }),
  ).toMatchObject({
    error: { code: "tool_input_not_allowed" },
    ok: false,
  });
});

test("tool results keep only declared typed paths and approved mappings", async () => {
  const definition: ToolDefinitionV1 = {
    access: "read",
    description: "Read a current service price.",
    execution: {
      adapter: "built_in",
      cancellation: "unsupported",
      handler: "test.price",
      mode: "synchronous",
      retryAttempts: 0,
      retryDelayMs: 0,
      timeoutMs: 5_000,
    },
    id: "test.price",
    inputSchema: { fields: [] },
    name: "Test Price",
    outputSchema: {
      fields: [
        { path: "amount", required: true, type: "decimal" },
        { path: "currency", required: true, type: "text" },
      ],
    },
    projectId: 194,
    requiredForCompletion: false,
    resultMappings: [
      {
        freshnessMinutes: 30,
        modelVisible: true,
        sourcePath: "amount",
        target: "context",
        targetKey: "servicePriceAmount",
        toolVisible: true,
        type: "decimal",
      },
    ],
    schemaVersion: 1,
    version: 1,
  };

  const validated = await validateToolResultPayload({
    contextValues: new Map(),
    definition,
    fieldValues: new Map(),
    projectId: 194,
    result: {
      amount: "150",
      currency: " INR ",
      providerSecret: "must-not-persist",
    },
  });

  expect(validated).toEqual({
    mappings: [
      {
        mapping: definition.resultMappings[0],
        value: 150,
      },
    ],
    ok: true,
    result: { amount: 150, currency: "INR" },
  });
});

test("tool result statuses cover every deterministic outcome", () => {
  const statuses = [
    "success",
    "no_result",
    "rejected",
    "timeout",
    "provider_failure",
    "cancelled",
    "completed",
    "failed",
    "timed_out",
  ];
  for (const status of statuses) {
    expect(
      inboundEventV1Schema.safeParse({
        authentication: {
          keyId: null,
          kind: "hmac",
          principal: "test-provider",
          verifiedAt: NOW.toISOString(),
        },
        channelIdentity: {},
        channelType: "project_chat",
        conversationId: 10,
        errorCode: null,
        eventId: `event-${status}`,
        expectedRevision: 0,
        occurredAt: NOW.toISOString(),
        projectId: 194,
        providerSequence: 1,
        receivedAt: NOW.toISOString(),
        requestId: "request-1",
        result: null,
        schemaVersion: 1,
        status,
        taskRunId: 20,
        type: "tool.result",
      }).success,
    ).toBe(true);
  }
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
