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
import { extractLocalTaskFieldCandidates } from "../../src/lib/conversation-field-extraction";
import { compileStructuredTurn } from "../../src/lib/conversation-turn-compiler";
import type { TurnResultV1 } from "../../src/lib/conversation-turn-contracts";
import { StructuredTurnEngine } from "../../src/lib/conversation-turn-engine";
import { validateStructuredTurnProposal } from "../../src/lib/conversation-turn-validator";
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

test("@live-openai routing UAT: detailed service request among lifecycle tasks", async () => {
  test.skip(
    process.env.LIA_LIVE_STATEMENT_UAT !== "1",
    "Opt-in live model test",
  );
  test.setTimeout(45_000);
  const provider = new AiSdkStructuredTurnProvider();
  const calls: unknown[] = [];
  const result = await new StructuredTurnEngine({
    provider: {
      async generateTurn(request) {
        const started = Date.now();
        try {
          const generated = await provider.generateTurn(request);
          calls.push({
            model: request.modelId,
            elapsedMs: Date.now() - started,
            output: generated.output,
          });
          return generated;
        } catch (error) {
          calls.push({
            model: request.modelId,
            elapsedMs: Date.now() - started,
            error: error instanceof Error ? error.name : "unknown",
          });
          throw error;
        }
      },
    },
  }).execute({
    ...input(
      bike,
      "Please arrange a bicycle tune-up for 22 September 2026 at 10:00 am Australia/Sydney.",
    ),
    activeTask: null,
    fieldState: [],
    stage: "knowledge",
    publishedTasks: [
      {
        id: 95,
        name: "Service Booking",
        aliases: ["Check Availability and Book"],
        candidateFieldKeys: [],
        objective:
          "Book a service appointment in an available slot with a required subject.",
      },
      {
        id: 96,
        name: "Service Cancellation",
        aliases: ["Find and Cancel Appointment"],
        candidateFieldKeys: [],
        objective: "Find and cancel an existing service appointment.",
      },
      {
        id: 97,
        name: "Service Rescheduling",
        aliases: ["Find and Reschedule Appointment"],
        candidateFieldKeys: [],
        objective:
          "Find and move an existing service appointment to a newly confirmed available slot.",
      },
    ],
  });
  console.log(JSON.stringify({ calls, result }));
  expect(result.source).toBe("model");
  expect(result.proposal.taskRecommendation?.taskId).toBe(95);
  expect(result.proposal.ambiguity.requiresClarification).toBe(false);
  expect(result.proposal.fieldCandidates).toEqual([]);
});

test("ambiguous date answers reach validation without spending a model call", async () => {
  let calls = 0;
  const provider: StructuredTurnProvider = {
    async generateTurn() {
      calls += 1;
      throw new Error("Must not guess a date");
    },
  };
  const result = await new StructuredTurnEngine({ provider }).execute(
    input(appointment, "09/10/2026", "preferredDate"),
  );
  expect(calls).toBe(0);
  const resolved = await reconcile(
    appointment,
    result.proposal,
    "09/10/2026",
    "preferredDate",
  );
  expect(resolved.values.preferredDate).toBeUndefined();
  expect(resolved.next.reply).toContain("month name");
});

for (const channel of ["project_chat", "widget", "telnyx_voice"] as const) {
  test(`${channel} preserves ambiguous dates from statements even when the model guesses ISO`, async () => {
    const message =
      "Book on 09/10/2026. My name is Alex Test and the reason is an oil change.";
    const provider: StructuredTurnProvider = {
      async generateTurn(i) {
        return {
          modelId: i.modelId,
          output: proposal({
            serviceDate: channel === "widget" ? "9 October 2026" : "2026-10-09",
            customerName: "Alex Test",
            serviceSubject: "oil change",
          }),
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
    };
    const result = await new StructuredTurnEngine({ provider }).execute({
      ...input(bike, message),
      channel,
    });
    expect(
      result.proposal.fieldCandidates.find((c) => c.fieldKey === "serviceDate")
        ?.naturalValue,
    ).toBe("09/10/2026");
    const resolved = await reconcile(bike, result.proposal, message, null);
    expect(resolved.values.serviceDate).toBeUndefined();
    expect(resolved.values.customerName).toBe("Alex Test");
    expect(resolved.values.serviceSubject).toBe("oil change");
    expect(resolved.next.reply).toContain("month name");
  });
}

test("an explicit ISO clarification in the same statement is retained", async () => {
  const provider: StructuredTurnProvider = {
    async generateTurn(i) {
      return {
        modelId: i.modelId,
        output: proposal({ preferredDate: "2026-10-09" }),
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
  };
  const result = await new StructuredTurnEngine({ provider }).execute(
    input(
      appointment,
      "Book on 09/10/2026, I mean 2026-10-09.",
      "preferredDate",
    ),
  );
  expect(result.proposal.fieldCandidates[0].naturalValue).toBe("2026-10-09");
});

for (const [snapshot, phoneKey, dateKey, timeKey] of [
  [appointment, "contactNumber", "preferredDate", "requestedTime"],
  [bike, "customerPhone", "serviceDate", "serviceTime"],
] as const) {
  test(`${snapshot.task.name}: local entities map independently of the pending field`, async () => {
    for (const [text, key] of [
      ["+61491570006", phoneKey],
      ["2026-09-22", dateKey],
      ["3:30 pm", timeKey],
    ]) {
      const candidates = extractLocalTaskFieldCandidates({
        fields: snapshot.task.definition.fields,
        text,
        timezone: "Australia/Sydney",
      });
      expect(candidates).toEqual([
        { fieldKey: key, naturalValue: text, source: "visitor", confidence: 1 },
      ]);
      const resolved = await reconcile(
        snapshot,
        { ...proposal({}), fieldCandidates: candidates ?? [] },
        text,
        snapshot.task.definition.fields[0].key,
      );
      expect(resolved.values[key]).toBeDefined();
      expect(
        resolved.values[snapshot.task.definition.fields[0].key],
      ).toBeUndefined();
    }
  });
}

test("explicit configured labels support multiple entities and preserve normal validation", async () => {
  const text =
    "Customer Name: Alex Test; Service Subject: oil change; Service Time: 15:30";
  const candidates = extractLocalTaskFieldCandidates({
    fields: bike.task.definition.fields,
    text,
    timezone: "UTC",
  });
  expect(candidates?.map(({ fieldKey }) => fieldKey)).toEqual([
    "customerName",
    "serviceSubject",
    "serviceTime",
  ]);
  const resolved = await reconcile(
    bike,
    { ...proposal({}), fieldCandidates: candidates ?? [] },
    text,
    "customerPhone",
  );
  expect(resolved.values).toMatchObject({
    customerName: "Alex Test",
    serviceSubject: "oil change",
    serviceTime: "15:30",
  });
  expect(resolved.next.nextAction).toBe("ask");
});

test("local extraction defers ambiguous mappings and compound language to the model", () => {
  const twoTimes = task("Delivery", [
    ["pickup", "Pickup time", "time"],
    ["dropoff", "Dropoff time", "time"],
  ]);
  for (const [snapshot, text] of [
    [twoTimes, "15:30"],
    [bike, "09/10/2026"],
    [bike, bikeMessage],
    [bike, "3 pm or 4 pm"],
    [bike, "Service Time: 15:30; Service Time: 16:00"],
    [bike, "cancel"],
  ] as const) {
    expect(
      extractLocalTaskFieldCandidates({
        fields: snapshot.task.definition.fields,
        text,
        timezone: "UTC",
      }),
    ).toBeNull();
  }
  expect(
    extractLocalTaskFieldCandidates({
      fields: twoTimes.task.definition.fields,
      text: "Dropoff time: 15:30",
      timezone: "UTC",
    })?.[0].fieldKey,
  ).toBe("dropoff");
});

test("a question containing mapped entities can continue collection without accepting ambiguity", () => {
  const clear = {
    ...proposal({ serviceTime: "15:30" }),
    turnKind: "side_question" as const,
  };
  expect(normalizeActiveTaskQuestion(clear).turnKind).toBe("field_answer");
  expect(
    normalizeActiveTaskQuestion({
      ...clear,
      ambiguity: {
        requiresClarification: true,
        question: "Pickup or dropoff?",
      },
    }).turnKind,
  ).toBe("side_question");
});

for (const channel of [
  "project_chat",
  "widget",
  "whatsapp",
  "telnyx_voice",
] as const) {
  test(`${channel}: shared engine extracts labelled fields for tasks and ordinary flows without a model call`, async () => {
    const engine = new StructuredTurnEngine({
      provider: {
        async generateTurn() {
          throw new Error("No model call expected");
        },
      },
    });
    for (const collectionOnly of [false, true]) {
      const result = await engine.execute({
        ...input(
          bike,
          "Customer Name: Alex Test; Service Subject: oil change; Customer Phone: +61491570006",
          "serviceDate",
        ),
        channel,
        activeTask: collectionOnly ? null : bike,
        collection: collectionOnly
          ? { name: "Bike service", fields: bike.task.definition.fields }
          : undefined,
      });
      expect(result.source).toBe("deterministic");
      expect(result.attempts).toBe(0);
      expect(
        result.proposal.fieldCandidates.map(({ fieldKey }) => fieldKey),
      ).toEqual(["customerName", "serviceSubject", "customerPhone"]);
      expect(result.proposal.toolRequest).toBeNull();
    }
  });
}

test("ordinary flow interpretation uses the LLM for context and keeps uncertain mappings as clarification", async () => {
  let calls = 0;
  const engine = new StructuredTurnEngine({
    provider: {
      async generateTurn(i) {
        calls++;
        expect(i.system).toContain("Bike service");
        return {
          modelId: i.modelId,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          output: {
            ...proposal({}),
            turnKind: "ordinary_question",
            nextAction: "clarify",
            ambiguity: {
              requiresClarification: true,
              question: "Do you mean the service subject or the bike model?",
            },
            reply: "Do you mean the service subject or the bike model?",
          },
        };
      },
    },
  });
  const result = await engine.execute({
    ...input(bike, "Can you use the other one?", "customerName"),
    activeTask: null,
    collection: { name: "Bike service", fields: bike.task.definition.fields },
  });
  expect(calls).toBe(1);
  expect(result.proposal.ambiguity.requiresClarification).toBe(true);
  expect(result.proposal.fieldCandidates).toEqual([]);
});

test("field-only contracts cannot invent fields, execute tools, or accept uncertain mappings", () => {
  const allowed = compileStructuredTurn({
    ...input(bike, bikeMessage),
    retrieval: [],
    activeTask: null,
    collection: { name: "Bike service", fields: bike.task.definition.fields },
  }).validation;
  expect(
    validateStructuredTurnProposal(
      proposal({ serviceSubject: "oil change" }),
      allowed,
    ).fieldCandidates,
  ).toHaveLength(1);
  expect(() =>
    validateStructuredTurnProposal(
      proposal({ unconfiguredField: "x" }),
      allowed,
    ),
  ).toThrow();
  expect(() =>
    validateStructuredTurnProposal(
      {
        ...proposal({}),
        toolRequest: {
          toolId: "operation:999",
          stage: "operation",
          arguments: {},
        },
      },
      allowed,
    ),
  ).toThrow();
  const uncertain = proposal({ serviceSubject: "oil change" });
  uncertain.fieldCandidates[0].confidence = 0.4;
  expect(() => validateStructuredTurnProposal(uncertain, allowed)).toThrow();
  expect(
    validateStructuredTurnProposal(
      {
        ...uncertain,
        fieldCandidates: [],
        nextAction: "clarify",
        ambiguity: {
          requiresClarification: true,
          question: "Did you mean an oil change?",
        },
      },
      allowed,
    ).ambiguity.requiresClarification,
  ).toBe(true);
});
