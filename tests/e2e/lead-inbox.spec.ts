import { expect, test } from "@playwright/test";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import { conversationalTaskSnapshotV1Schema } from "../../src/lib/conversation-contracts";
import {
  buildLeadFields,
  formatLeadFieldValue,
  isInboxSubmission,
  leadUpdateSchema,
  readLeadManagement,
} from "../../src/lib/lead-inbox";
import { leadFiltersSchema } from "../../src/lib/lead-inbox-data";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

for (const scenario of [
  { key: "arrival", label: "Arrival date", type: "date", value: "2027-01-08" },
  {
    key: "reason",
    label: "Appointment reason",
    type: "text",
    value: "Follow-up",
  },
  { key: "bikeModel", label: "Bike model", type: "text", value: "City bike" },
])
  test(`configured ${scenario.key} fields retain their label, type and native value`, () => {
    expect(
      buildLeadFields({
        fields: { [scenario.key]: scenario.value, quantity: 2, consent: false },
        workflowSnapshot: {
          action: { name: "Original workflow" },
          steps: [
            {
              fieldKey: scenario.key,
              label: scenario.label,
              inputType: scenario.type,
              stepType: "collect_input",
              isRequired: true,
              settings: {},
            },
          ],
        },
      }),
    ).toEqual([
      {
        key: scenario.key,
        label: scenario.label,
        type: scenario.type,
        required: true,
        value: scenario.value,
      },
      {
        key: "quantity",
        label: "quantity",
        type: "unknown",
        required: false,
        value: 2,
      },
      {
        key: "consent",
        label: "consent",
        type: "unknown",
        required: false,
        value: false,
      },
    ]);
  });

test("pinned AI task fields are displayed without changing legacy field values", () => {
  const snapshot = conversationalTaskSnapshotV1Schema.parse({
    schemaVersion: 1,
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    assistantPolicy: REFERENCE_BOOKING_PROJECT_POLICY.assistant,
    conversationPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
    task: {
      id: 95,
      schemaVersion: 1,
      name: "Appointment",
      objective: "Collect details",
      description: null,
      definition: REFERENCE_BOOKING_TASK_DEFINITION,
    },
    toolDefinitions: [],
    publishedAt: "2026-11-07T00:00:00.000Z",
  });
  const field = snapshot.task.definition.fields[0];
  expect(
    buildLeadFields({
      fields: { [field.key]: "original" },
      workflowSnapshot: null,
      taskSnapshots: [snapshot],
    })[0],
  ).toMatchObject({
    key: field.key,
    label: field.label,
    type: field.type,
    value: "original",
  });
});

test("collection drafts and cancellations do not become leads; submitted history stays accessible", () => {
  expect(isInboxSubmission({ status: "in_progress", submittedAt: null })).toBe(
    false,
  );
  expect(isInboxSubmission({ status: "cancelled", submittedAt: null })).toBe(
    false,
  );
  for (const status of ["submitted", "under_review", "completed", "rejected"])
    expect(isInboxSubmission({ status, submittedAt: null })).toBe(true);
  expect(
    isInboxSubmission({ status: "cancelled", submittedAt: new Date() }),
  ).toBe(true);
});

test("lead lifecycle defaults do not interpret workflow completion as a sale", () => {
  expect(readLeadManagement({ status: "completed" }).status).toBe("new");
  expect(
    readLeadManagement({
      leadInbox: { status: "converted", assignedUserId: 4 },
    }),
  ).toMatchObject({ status: "converted", assignedUserId: 4 });
  expect(readLeadManagement({ leadInbox: { status: "invented" } }).status).toBe(
    "new",
  );
});

test("updates validate assigned ownership, notes, dates, revision and pagination bounds", () => {
  const valid = {
    submissionId: 1,
    expectedRevision: 0,
    status: "contacted" as const,
    assignedUserId: null,
    nextFollowUpDate: "2027-02-03",
    note: "Called visitor",
  };
  expect(leadUpdateSchema.safeParse(valid).success).toBe(true);
  expect(
    leadUpdateSchema.safeParse({ ...valid, status: "assigned" }).success,
  ).toBe(false);
  expect(
    leadUpdateSchema.safeParse({ ...valid, nextFollowUpDate: "2027-02-30" })
      .success,
  ).toBe(false);
  expect(
    leadUpdateSchema.safeParse({ ...valid, note: "a".repeat(4001) }).success,
  ).toBe(false);
  expect(
    leadUpdateSchema.safeParse({ ...valid, expectedRevision: -1 }).success,
  ).toBe(false);
  expect(leadFiltersSchema.safeParse({ page: 0 }).success).toBe(false);
  expect(leadFiltersSchema.safeParse({ projectId: "other" }).success).toBe(
    false,
  );
  expect(leadFiltersSchema.safeParse({ status: "in_progress" }).success).toBe(
    false,
  );
});

test("field presentation preserves boolean, array, date range and numeric values", () => {
  expect(formatLeadFieldValue(false)).toBe("No");
  expect(formatLeadFieldValue(0)).toBe("0");
  expect(formatLeadFieldValue([2, 4])).toBe("[2,4]");
  expect(
    formatLeadFieldValue({ start: "2027-01-01", end: "2027-01-03" }),
  ).toContain("2027-01-03");
});
