import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import {
  type ConversationalTaskSnapshotV1,
  conversationalTaskSnapshotV1Schema,
} from "../../src/lib/conversation-contracts";
import type { TurnResultV1 } from "../../src/lib/conversation-turn-contracts";
import { StructuredTurnEngine } from "../../src/lib/conversation-turn-engine";
import { canonicalizeFieldCandidates } from "../../src/lib/conversational-task-field-validation";
import {
  bindRequestedTaskTextAnswer,
  normalizeActiveTaskQuestion,
  reconcileTaskTurnWithRuntime,
} from "../../src/lib/hybrid-flow-runtime";
import {
  AiSdkStructuredTurnProvider,
  type StructuredTurnProvider,
} from "../../src/lib/model-provider";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

config({ path: ".env.local", quiet: true });

type FieldSpec = [string, string, "text" | "phone" | "date" | "time"];
function task(name: string, specs: FieldSpec[]) {
  return conversationalTaskSnapshotV1Schema.parse({
    schemaVersion: 1,
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    assistantPolicy: REFERENCE_BOOKING_PROJECT_POLICY.assistant,
    conversationPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
    task: {
      id: 95,
      schemaVersion: 1,
      name,
      objective: `Collect and confirm a ${name} request.`,
      description: null,
      definition: {
        ...REFERENCE_BOOKING_TASK_DEFINITION,
        fieldTransferWhitelist: [],
        fields: specs.map(([key, label, type], index) => ({
          ...REFERENCE_BOOKING_TASK_DEFINITION.fields[4],
          id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          key,
          label,
          type,
          dependsOn: [],
          normalization: null,
          prompt: `Please provide ${label}.`,
        })),
        tools: [
          {
            access: "write",
            allowedStages: ["operation"],
            tool: { id: "operation:999", version: 1 },
          },
        ],
      },
    },
    toolDefinitions: [
      {
        schemaVersion: 1,
        id: "operation:999",
        version: 1,
        projectId: 194,
        name: "Submit request",
        description: "Isolated confirmation fixture; never executed.",
        access: "write",
        inputSchema: { fields: [] },
        outputSchema: { fields: [] },
        resultMappings: [],
        requiredForCompletion: true,
        execution: {
          adapter: "operation",
          handler: "operation:999",
          mode: "synchronous",
          timeoutMs: 1000,
          retryAttempts: 0,
          retryDelayMs: 0,
          cancellation: "unsupported",
        },
      },
    ],
  });
}

const appointment = task("Appointment booking", [
  ["patientName", "Patient Name", "text"],
  ["contactNumber", "Contact Number", "phone"],
  ["preferredDate", "Preferred Date", "date"],
  ["requestedTime", "Requested Time", "time"],
  ["timezone", "Timezone", "text"],
  ["reason", "Appointment Reason", "text"],
]);
const bike = task("Bike service scheduling", [
  ["customerName", "Customer Name", "text"],
  ["bikeModel", "Bike Model", "text"],
  ["serviceSubject", "Service Subject", "text"],
  ["customerPhone", "Customer Phone", "phone"],
  ["serviceDate", "Service Date", "date"],
  ["serviceTime", "Service Time", "time"],
]);
const appointmentMessage =
  "I want to book an appointment on 22 September 2026 at 10:00 am Australia/Sydney. My name is Alex Test, my contact number is +61491570006, and the reason is persistent knee pain.";
const bikeMessage =
  "Book my Yamaha MT-15 for an oil change on 25 September 2026 at 9 am. I am Alex Test, and my number is +61491570006.";

function input(
  snapshot: ConversationalTaskSnapshotV1,
  message: string,
  requestedFieldKey: string | null = null,
  saved: Record<string, string> = {},
) {
  return {
    activeTask: snapshot,
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    assistantIntroduced: true,
    channel: "project_chat" as const,
    companyName: "Statement UAT",
    context: [],
    history: [],
    projectId: 194,
    projectName: "Statement UAT",
    projectPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
    publishedTasks: [],
    stage: "extraction" as const,
    visitorMessage: message,
    requestedFieldKey,
    fieldState: snapshot.task.definition.fields.map((field) => ({
      fieldKey: field.key,
      label: field.label,
      required: field.required,
      sensitivity: field.sensitivity,
      state: Object.hasOwn(saved, field.key)
        ? ("valid" as const)
        : ("missing" as const),
      value: saved[field.key] ?? null,
    })),
  };
}
function proposal(values: Record<string, string>): TurnResultV1 {
  return {
    schemaVersion: 1,
    turnKind: "field_answer",
    reply: "I will check those details.",
    grounding: { status: "not_needed", excerptIds: [] },
    fieldCandidates: Object.entries(values).map(([fieldKey, naturalValue]) => ({
      fieldKey,
      naturalValue,
      confidence: 1,
      source: "visitor",
    })),
    taskRecommendation: null,
    toolRequest: null,
    routeRecommendation: null,
    outcomeRecommendation: null,
    nextAction: "ask",
    ambiguity: { requiresClarification: false, question: null },
    safety: { decision: "allow", reasonCode: null },
    decisionSummary: "Extracted supplied details.",
  };
}
async function reconcile(
  snapshot: ConversationalTaskSnapshotV1,
  raw: TurnResultV1,
  message: string,
  requestedFieldKey: string | null,
  saved: Record<string, string> = {},
) {
  let extracted = normalizeActiveTaskQuestion(raw);
  if (
    snapshot.task.definition.fields.find((f) => f.key === requestedFieldKey)
      ?.type === "text"
  ) {
    extracted = bindRequestedTaskTextAnswer({
      proposal: extracted,
      text: message,
      requestedFieldKey,
    });
  }
  const canonical = await canonicalizeFieldCandidates({
    candidates: extracted.fieldCandidates.map((c) => ({
      fieldKey: c.fieldKey,
      naturalValue: c.naturalValue,
      state: "candidate",
      provenance: { source: "visitor", sourceReference: null },
      validation: { valid: false, code: null, message: null },
    })),
    contextValues: new Map([["lia_timezone", "Australia/Sydney"]]),
    definition: snapshot.task.definition,
    fieldValues: new Map(Object.entries(saved)),
    projectId: 194,
    referenceDate: new Date("2026-09-13T00:00:00Z"),
  });
  const values = {
    ...saved,
    ...Object.fromEntries(
      canonical
        .filter((c) => c.state === "valid")
        .map((c) => [c.fieldKey, c.canonicalValue]),
    ),
  };
  const fields = snapshot.task.definition.fields.map((field) => {
    const candidate = canonical.find((c) => c.fieldKey === field.key);
    return {
      fieldKey: field.key,
      isRequired: field.required,
      state:
        candidate?.state ??
        (Object.hasOwn(saved, field.key) ? "valid" : "missing"),
      validation: candidate?.validation ?? {},
    };
  });
  return {
    values,
    next: reconcileTaskTurnWithRuntime({
      fields,
      proposal: extracted,
      snapshot,
    }),
  };
}

test("text-only bike details use extraction instead of filling the name with a sentence", async () => {
  const expected = {
    customerName: "Alex Test",
    bikeModel: "Yamaha MT-15",
    serviceSubject: "oil change",
  };
  const provider: StructuredTurnProvider = {
    async generateTurn(i) {
      return {
        modelId: i.modelId,
        output: proposal(expected),
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
  };
  const result = await new StructuredTurnEngine({ provider }).execute(
    input(
      bike,
      "My name is Alex Test, my bike is a Yamaha MT-15 and it needs an oil change.",
      "customerName",
    ),
  );
  expect(result.source).toBe("model");
  expect(result.proposal.fieldCandidates).toEqual(
    proposal(expected).fieldCandidates,
  );
});

test("simple answers keep caller wording even if the model proposes a default", async () => {
  const result = await reconcile(
    appointment,
    proposal({ reason: "General appointment" }),
    "Persistent knee pain",
    "reason",
  );
  expect(result.values.reason).toBe("Persistent knee pain");
});

test("a name correction while collecting another text field still uses extraction", async () => {
  const expected = { customerName: "Sam Test" };
  const provider: StructuredTurnProvider = {
    async generateTurn(i) {
      return {
        modelId: i.modelId,
        output: { ...proposal(expected), turnKind: "field_correction" },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
  };
  const message = "Actually, my name is Sam Test.";
  const saved = { customerName: "Alex Test" };
  const result = await new StructuredTurnEngine({ provider }).execute(
    input(bike, message, "bikeModel", saved),
  );
  expect(result.source).toBe("model");
  const resolved = await reconcile(
    bike,
    result.proposal,
    message,
    "bikeModel",
    saved,
  );
  expect(resolved.values).toEqual(expected);
  expect(resolved.next.reply).toBe("Please provide Bike Model.");
});

test("a single extracted name retains its value instead of the surrounding sentence", async () => {
  const result = await reconcile(
    bike,
    proposal({ customerName: "Alex Test" }),
    "My name is Alex Test.",
    "customerName",
  );
  expect(result.values.customerName).toBe("Alex Test");
  expect(result.next.reply).toBe("Please provide Bike Model.");
});

const cases: Array<{
  name: string;
  snapshot: ConversationalTaskSnapshotV1;
  message: string;
  requested: string | null;
  expected: Record<string, string>;
  missing: string | null;
  saved?: Record<string, string>;
}> = [
  {
    name: "appointment opening statement",
    snapshot: appointment,
    message: appointmentMessage,
    requested: null,
    expected: {
      patientName: "Alex Test",
      contactNumber: "+61491570006",
      preferredDate: "2026-09-22",
      requestedTime: "10:00",
      timezone: "Australia/Sydney",
      reason: "persistent knee pain",
    },
    missing: null,
  },
  {
    name: "appointment statement at name prompt",
    snapshot: appointment,
    message: appointmentMessage,
    requested: "patientName",
    expected: {
      patientName: "Alex Test",
      contactNumber: "+61491570006",
      preferredDate: "2026-09-22",
      requestedTime: "10:00",
      timezone: "Australia/Sydney",
      reason: "persistent knee pain",
    },
    missing: null,
  },
  {
    name: "bike statement at name prompt",
    snapshot: bike,
    message: bikeMessage,
    requested: "customerName",
    expected: {
      customerName: "Alex Test",
      customerPhone: "+61491570006",
      bikeModel: "Yamaha MT-15",
      serviceSubject: "oil change",
      serviceDate: "2026-09-25",
      serviceTime: "09:00",
    },
    missing: null,
  },
  {
    name: "text-only bike statement",
    snapshot: bike,
    message:
      "My name is Alex Test, my bike is a Yamaha MT-15 and it needs an oil change.",
    requested: "customerName",
    expected: {
      customerName: "Alex Test",
      bikeModel: "Yamaha MT-15",
      serviceSubject: "oil change",
    },
    missing: "Customer Phone",
  },
  {
    name: "missing appointment reason",
    snapshot: appointment,
    message:
      "Book an appointment on 22 September 2026 at 10:00 am Australia/Sydney. My name is Alex Test and my number is +61491570006.",
    requested: null,
    expected: {
      patientName: "Alex Test",
      contactNumber: "+61491570006",
      preferredDate: "2026-09-22",
      requestedTime: "10:00",
      timezone: "Australia/Sydney",
    },
    missing: "Appointment Reason",
  },
  {
    name: "single name in a sentence",
    snapshot: bike,
    message: "My name is Alex Test.",
    requested: "customerName",
    expected: { customerName: "Alex Test" },
    missing: "Bike Model",
  },
];

cases.push(
  {
    name: "bike correction retains previously collected details",
    snapshot: bike,
    message:
      "Actually, my bike is a Honda CB350, not a Yamaha MT-15. Keep the other details.",
    requested: null,
    saved: {
      customerName: "Alex Test",
      customerPhone: "+61491570006",
      bikeModel: "Yamaha MT-15",
      serviceSubject: "oil change",
      serviceDate: "2026-09-25",
      serviceTime: "09:00",
    },
    expected: {
      customerName: "Alex Test",
      customerPhone: "+61491570006",
      bikeModel: "Honda CB350",
      serviceSubject: "oil change",
      serviceDate: "2026-09-25",
      serviceTime: "09:00",
    },
    missing: null,
  },
  {
    name: "missing bike service subject",
    snapshot: bike,
    message:
      "Book my Yamaha MT-15 on 25 September 2026 at 9 am. I am Alex Test, and my number is +61491570006.",
    requested: null,
    expected: {
      customerName: "Alex Test",
      customerPhone: "+61491570006",
      bikeModel: "Yamaha MT-15",
      serviceDate: "2026-09-25",
      serviceTime: "09:00",
    },
    missing: "Service Subject",
  },
);

cases.push({
  name: "pasted booking summary ending in a confirmation question",
  snapshot: appointment,
  message:
    "I have noted your preferred appointment on 2026-09-22 at 10:00 am Australia/Sydney, patient name Alex Test, contact +61491570006, and reason persistent knee pain. How would you like to proceed with confirmation?",
  requested: null,
  expected: {
    patientName: "Alex Test",
    contactNumber: "+61491570006",
    preferredDate: "2026-09-22",
    requestedTime: "10:00",
    timezone: "Australia/Sydney",
    reason: "persistent knee pain",
  },
  missing: null,
});

for (const scenario of cases) {
  test(`@live-openai statement UAT: ${scenario.name}`, async () => {
    const testInfo = test.info();
    test.skip(
      process.env.LIA_LIVE_STATEMENT_UAT !== "1",
      "Enable explicitly for synthetic live-model UAT.",
    );
    test.setTimeout(45_000);
    expect(
      Boolean(process.env.OPENAI_API_KEY),
      "Live model credentials must be configured",
    ).toBe(true);
    const started = Date.now();
    const provider = new AiSdkStructuredTurnProvider();
    const repairs: string[] = [];
    const result = await new StructuredTurnEngine({
      provider: {
        async generateTurn(request) {
          const repair = request.system.match(/Repair attempt[^\n]+/g);
          if (repair) repairs.push(...repair);
          return provider.generateTurn(request);
        },
      },
    }).execute(
      input(
        scenario.snapshot,
        scenario.message,
        scenario.requested,
        scenario.saved,
      ),
    );
    await testInfo.attach("extraction-result", {
      body: JSON.stringify(
        { elapsedMs: Date.now() - started, ...result },
        null,
        2,
      ),
      contentType: "application/json",
    });
    console.log(
      JSON.stringify({
        scenario: scenario.name,
        elapsedMs: Date.now() - started,
        source: result.source,
        attempts: result.attempts,
        usage: result.usage,
        repairs,
        fields: result.proposal.fieldCandidates.map(
          (candidate) => candidate.fieldKey,
        ),
      }),
    );
    expect(result.source).toBe("model");
    const resolved = await reconcile(
      scenario.snapshot,
      result.proposal,
      scenario.message,
      scenario.requested,
      scenario.saved,
    );
    // Both HH:mm and HH:mm:ss are valid time-field values. Compare the same
    // clock precision without accepting a different date, time, or timezone.
    const comparable = (values: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          scenario.snapshot.task.definition.fields.find(
            (field) => field.key === key,
          )?.type === "time" &&
          typeof value === "string" &&
          /^\d{2}:\d{2}$/.test(value)
            ? `${value}:00`
            : value,
        ]),
      );
    expect(comparable(resolved.values)).toEqual(comparable(scenario.expected));
    expect(resolved.next.nextAction).toBe(scenario.missing ? "ask" : "confirm");
    if (scenario.missing)
      expect(resolved.next.reply).toBe(`Please provide ${scenario.missing}.`);
    expect(resolved.next.toolRequest).toBeNull();
  });
}
