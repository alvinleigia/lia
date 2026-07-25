import { expect, test } from "@playwright/test";
import {
  evaluateContextVariableRemoval,
  findContextVariableDependencies,
  isProtectedContextVariable,
} from "../../src/lib/context-variable-dependencies";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import {
  conversationalTaskDefinitionV1Schema,
  conversationalTaskSnapshotV1Schema,
  conversationProjectPolicyV1Schema,
  normalizeConversationalTaskDefinition,
  taskIntentRecommendationV1Schema,
} from "../../src/lib/conversation-contracts";
import {
  conversationalTaskDetailsSchema,
  conversationalTaskIdSchema,
} from "../../src/lib/conversational-task-schema";
import { validateConversationalTaskForPublish } from "../../src/lib/conversational-task-validation";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

test("conversational task details normalize a valid draft", () => {
  const parsed = conversationalTaskDetailsSchema.parse({
    description: "  Used by the booking team.  ",
    name: "  Book a Spa Service  ",
    objective: "  Help a visitor submit an appointment request.  ",
  });

  expect(parsed).toEqual({
    description: "Used by the booking team.",
    name: "Book a Spa Service",
    objective: "Help a visitor submit an appointment request.",
  });
});

test("conversational task details require a name and objective", () => {
  expect(
    conversationalTaskDetailsSchema.safeParse({
      description: "",
      name: " ",
      objective: " ",
    }).success,
  ).toBe(false);
});

test("conversational task details enforce draft field limits", () => {
  expect(
    conversationalTaskDetailsSchema.safeParse({
      name: "n".repeat(121),
      objective: "o".repeat(601),
    }).success,
  ).toBe(false);
});

test("conversational task ids accept only positive integers", () => {
  expect(conversationalTaskIdSchema.parse("42")).toBe(42);
  expect(conversationalTaskIdSchema.safeParse("0").success).toBe(false);
  expect(conversationalTaskIdSchema.safeParse("1.5").success).toBe(false);
});

test("reference booking fixture satisfies the universal contracts", () => {
  expect(
    conversationProjectPolicyV1Schema.safeParse(
      REFERENCE_BOOKING_PROJECT_POLICY,
    ).success,
  ).toBe(true);
  expect(
    conversationalTaskDefinitionV1Schema.safeParse(
      REFERENCE_BOOKING_TASK_DEFINITION,
    ).success,
  ).toBe(true);
  expect(
    validateConversationalTaskForPublish({
      definition: REFERENCE_BOOKING_TASK_DEFINITION,
      projectPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
    }),
  ).toEqual({ issues: [], ready: true });
});

test("legacy task definitions receive backward-compatible contract defaults", () => {
  type LegacyDefinition = {
    fields: Array<Record<string, unknown>>;
    taskPolicy: Record<string, unknown>;
  };
  const legacy = structuredClone(
    REFERENCE_BOOKING_TASK_DEFINITION,
  ) as unknown as LegacyDefinition;

  for (const field of legacy.fields) {
    delete field.cardinality;
    delete field.optionSource;
    delete field.prompt;
  }
  delete legacy.taskPolicy.consentRequirement;
  delete legacy.taskPolicy.identityRequirement;
  delete legacy.taskPolicy.instructions;

  const normalized = normalizeConversationalTaskDefinition(legacy);

  expect(
    normalized.fields.every((field) => field.cardinality === "single"),
  ).toBe(true);
  expect(normalized.fields.every((field) => field.optionSource === null)).toBe(
    true,
  );
  expect(normalized.taskPolicy).toMatchObject({
    consentRequirement: "inherit",
    identityRequirement: "anonymous",
    instructions: null,
  });
  expect(
    validateConversationalTaskForPublish({
      definition: normalized,
      projectPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
    }).ready,
  ).toBe(true);
});

test("task fields support repeatable static and resource-backed choices", () => {
  const staticChoiceField = {
    ...REFERENCE_BOOKING_TASK_DEFINITION.fields[0],
    cardinality: "multiple" as const,
    optionSource: {
      kind: "static" as const,
      options: [
        { label: "Massage", value: "massage" },
        { label: "Facial", value: "facial" },
      ],
    },
    type: "enum" as const,
  };
  const parsed = conversationalTaskDefinitionV1Schema.parse({
    ...REFERENCE_BOOKING_TASK_DEFINITION,
    fields: [
      staticChoiceField,
      ...REFERENCE_BOOKING_TASK_DEFINITION.fields.slice(1),
    ],
  });

  expect(parsed.fields[0]).toMatchObject({
    cardinality: "multiple",
    optionSource: { kind: "static" },
  });
  expect(parsed.fields[1].optionSource).toMatchObject({
    filterByField: "serviceCategoryId",
    kind: "project_resource",
  });
});

test("published task snapshots pin project AI behavior", () => {
  const snapshot = conversationalTaskSnapshotV1Schema.parse({
    schemaVersion: 1,
    assistantBehavior: {
      ...DEFAULT_PROJECT_AI_SETTINGS,
      assistantName: "Ewi",
      businessName: "Ewissen Infra",
    },
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

  expect(snapshot.assistantBehavior).toMatchObject({
    assistantName: "Ewi",
    businessName: "Ewissen Infra",
  });
});

test("task recommendation accepts only a stable published task candidate", () => {
  expect(
    taskIntentRecommendationV1Schema.safeParse({
      schemaVersion: 1,
      taskId: 42,
      candidateFieldMappings: { guestEmail: "visitor@example.com" },
    }).success,
  ).toBe(true);
  expect(
    taskIntentRecommendationV1Schema.safeParse({
      schemaVersion: 1,
      taskId: "book-now",
      candidateFieldMappings: {},
    }).success,
  ).toBe(false);
});

test("publish validation catches missing dependencies and terminal outcomes", () => {
  const invalid = {
    ...REFERENCE_BOOKING_TASK_DEFINITION,
    fields: [
      {
        ...REFERENCE_BOOKING_TASK_DEFINITION.fields[0],
        dependsOn: ["missingField"],
      },
    ],
    outcomes: [],
  };
  const result = validateConversationalTaskForPublish({
    definition: invalid,
    projectPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
  });

  expect(result.ready).toBe(false);
  expect(result.issues).toContain("Add a completed outcome.");
  expect(result.issues).toContain("Add a cancelled outcome.");
  expect(result.issues).toContain(
    "Service Category depends on missing field missingField.",
  );
});

test("publish validation catches cyclic fields and malformed lifecycle rules", () => {
  const firstField = REFERENCE_BOOKING_TASK_DEFINITION.fields[0];
  const secondField = REFERENCE_BOOKING_TASK_DEFINITION.fields[1];
  const invalid = {
    ...REFERENCE_BOOKING_TASK_DEFINITION,
    executionOrder: [
      ...REFERENCE_BOOKING_TASK_DEFINITION.executionOrder,
    ].reverse(),
    fields: [
      { ...firstField, dependsOn: [secondField.key] },
      { ...secondField, dependsOn: [firstField.key] },
      ...REFERENCE_BOOKING_TASK_DEFINITION.fields.slice(2),
    ],
    outcomes: [
      ...REFERENCE_BOOKING_TASK_DEFINITION.outcomes,
      {
        ...REFERENCE_BOOKING_TASK_DEFINITION.outcomes[0],
        id: "00000000-0000-4000-8000-000000000099",
        key: "alsoCompleted",
      },
    ],
    tools: [
      {
        tool: { id: "operation:204", version: 1 },
        access: "read" as const,
        allowedStages: ["lookup" as const, "lookup" as const],
      },
    ],
  };
  const result = validateConversationalTaskForPublish({
    definition: invalid,
    projectPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
  });

  expect(result.ready).toBe(false);
  expect(result.issues).toContain("Field dependencies contain a cycle.");
  expect(result.issues).toContain("Outcome port completed is duplicated.");
  expect(result.issues).toContain(
    "Tool operation:204 has duplicate allowed stages.",
  );
  expect(result.issues).toContain(
    "Execution order must contain each lifecycle stage once in the required order.",
  );
});

test("publish validation catches invalid choice sources", () => {
  const invalid = {
    ...REFERENCE_BOOKING_TASK_DEFINITION,
    fields: [
      {
        ...REFERENCE_BOOKING_TASK_DEFINITION.fields[0],
        optionSource: {
          kind: "static" as const,
          options: [
            { label: "One", value: "same" },
            { label: "Two", value: "same" },
          ],
        },
        type: "enum" as const,
      },
      {
        ...REFERENCE_BOOKING_TASK_DEFINITION.fields[1],
        optionSource: {
          kind: "project_resource" as const,
          resourceType: "service",
          collectionKey: "serviceCatalog",
          filterByField: "missingCategory",
        },
      },
      ...REFERENCE_BOOKING_TASK_DEFINITION.fields.slice(2),
    ],
  };
  const result = validateConversationalTaskForPublish({
    definition: invalid,
    projectPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
  });

  expect(result.ready).toBe(false);
  expect(result.issues).toContain(
    "Service Category contains duplicate option same.",
  );
  expect(result.issues).toContain(
    "Service filters by missing field missingCategory.",
  );
});

test("context dependencies are explicit and identify their usage", () => {
  const definition = {
    ...REFERENCE_BOOKING_TASK_DEFINITION,
    taskPolicy: {
      ...REFERENCE_BOOKING_TASK_DEFINITION.taskPolicy,
      fallbackMessage: "Timezone: {{context.lia_timezone}}",
    },
  };

  expect(findContextVariableDependencies(definition, "lia_timezone")).toEqual([
    {
      key: "lia_timezone",
      location: "Fallback message",
      path: "taskPolicy.fallbackMessage",
    },
  ]);
  expect(findContextVariableDependencies(definition, "guestName")).toEqual([]);
});

test("context dependencies include task instructions and visitor prompts", () => {
  const definition = {
    ...REFERENCE_BOOKING_TASK_DEFINITION,
    fields: [
      {
        ...REFERENCE_BOOKING_TASK_DEFINITION.fields[0],
        prompt: "Choose a service for {{context.lia_timezone}}.",
      },
      ...REFERENCE_BOOKING_TASK_DEFINITION.fields.slice(1),
    ],
    taskPolicy: {
      ...REFERENCE_BOOKING_TASK_DEFINITION.taskPolicy,
      instructions: "Interpret dates in {{context.lia_timezone}}.",
    },
  };

  expect(findContextVariableDependencies(definition, "lia_timezone")).toEqual([
    {
      key: "lia_timezone",
      location: "Task instructions",
      path: "taskPolicy.instructions",
    },
    {
      key: "lia_timezone",
      location: "Service Category visitor prompt",
      path: `fields.${definition.fields[0].id}.prompt`,
    },
  ]);
});

test("publish validation blocks missing context references", () => {
  const definition = {
    ...REFERENCE_BOOKING_TASK_DEFINITION,
    contextVariables: [],
    taskPolicy: {
      ...REFERENCE_BOOKING_TASK_DEFINITION.taskPolicy,
      fallbackMessage: "Timezone: {{context.lia_timezone}}",
    },
  };
  const result = validateConversationalTaskForPublish({
    definition,
    projectPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
  });

  expect(result.ready).toBe(false);
  expect(result.issues).toContain(
    "Fallback message references missing context lia_timezone.",
  );
});

test("system-owned context variables are protected", () => {
  expect(
    isProtectedContextVariable({
      key: "lia_timezone",
      source: "system",
    }),
  ).toBe(true);
  expect(
    isProtectedContextVariable({
      key: "campaignCode",
      source: "project",
    }),
  ).toBe(false);
});

test("context removal is blocked for protected and referenced variables", () => {
  expect(
    evaluateContextVariableRemoval(
      REFERENCE_BOOKING_TASK_DEFINITION,
      "lia_timezone",
    ),
  ).toMatchObject({
    allowed: false,
    protected: true,
  });

  const referenced = {
    ...REFERENCE_BOOKING_TASK_DEFINITION,
    contextVariables: [
      ...REFERENCE_BOOKING_TASK_DEFINITION.contextVariables,
      {
        key: "campaignCode",
        type: "text" as const,
        source: "project" as const,
        defaultValue: null,
        sensitivity: "standard" as const,
        expiresAfterMinutes: null,
        modelVisible: true,
        toolVisible: true,
      },
    ],
    taskPolicy: {
      ...REFERENCE_BOOKING_TASK_DEFINITION.taskPolicy,
      fallbackMessage: "Campaign: {{context.campaignCode}}",
    },
  };
  expect(
    evaluateContextVariableRemoval(referenced, "campaignCode"),
  ).toMatchObject({
    allowed: false,
    dependencies: [
      {
        location: "Fallback message",
      },
    ],
    protected: false,
  });

  expect(
    evaluateContextVariableRemoval(
      {
        ...referenced,
        taskPolicy: {
          ...referenced.taskPolicy,
          fallbackMessage: null,
        },
      },
      "campaignCode",
    ),
  ).toEqual({
    allowed: true,
    dependencies: [],
    protected: false,
    reason: null,
  });
});
