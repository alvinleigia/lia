import { expect, test } from "@playwright/test";
import {
  REFERENCE_BOOKING_PROJECT_POLICY,
  REFERENCE_BOOKING_TASK_DEFINITION,
} from "../../src/lib/conversation-contract-fixtures";
import {
  conversationalTaskSnapshotV1Schema,
  type ToolDefinitionV1,
  toolDefinitionV1Schema,
} from "../../src/lib/conversation-contracts";
import type { TurnResultV1 } from "../../src/lib/conversation-turn-contracts";
import { StructuredTurnEngine } from "../../src/lib/conversation-turn-engine";
import {
  buildCanonicalToolInput,
  validateToolResultPayload,
} from "../../src/lib/conversational-task-tool-runtime";
import type {
  StructuredTurnProvider,
  StructuredTurnProviderInput,
  StructuredTurnProviderResult,
} from "../../src/lib/model-provider";
import { DEFAULT_PROJECT_AI_SETTINGS } from "../../src/lib/project-ai-settings";

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

function modelProposal(overrides: Partial<TurnResultV1> = {}): TurnResultV1 {
  return {
    schemaVersion: 1,
    turnKind: "field_answer",
    reply: "Thanks. What date would you prefer?",
    grounding: { status: "not_needed", excerptIds: [] },
    fieldCandidates: [
      {
        fieldKey: "serviceCategoryId",
        naturalValue: "Facial",
        confidence: 0.96,
        source: "visitor",
      },
    ],
    taskRecommendation: null,
    toolRequest: null,
    routeRecommendation: null,
    outcomeRecommendation: null,
    nextAction: "ask",
    ambiguity: { requiresClarification: false, question: null },
    safety: { decision: "allow", reasonCode: null },
    decisionSummary: "Proposed one visitor-supplied field candidate.",
    ...overrides,
  };
}

function engineInput() {
  return {
    activeTask: snapshot,
    assistantBehavior: DEFAULT_PROJECT_AI_SETTINGS,
    assistantIntroduced: true,
    channel: "project_chat" as const,
    companyName: "Conformance Company",
    context: [],
    fieldState: [],
    history: [],
    projectId: 194,
    projectPolicy: REFERENCE_BOOKING_PROJECT_POLICY,
    projectName: "Conformance Project",
    publishedTasks: [
      {
        candidateFieldKeys: ["serviceCategoryId"],
        id: 95,
        name: "Book a Spa Service",
        objective: "Submit a validated appointment request.",
      },
    ],
    stage: "extraction" as const,
    visitorMessage: "I would like a facial.",
  };
}

class ConformanceModelProvider implements StructuredTurnProvider {
  readonly calls: StructuredTurnProviderInput[] = [];

  constructor(private readonly output: unknown) {}

  async generateTurn(
    input: StructuredTurnProviderInput,
  ): Promise<StructuredTurnProviderResult> {
    this.calls.push(structuredClone(input));
    return {
      modelId: input.modelId,
      output: this.output,
      usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
    };
  }
}

const extensionToolDefinition = toolDefinitionV1Schema.parse({
  schemaVersion: 1,
  id: "operation:901",
  version: 1,
  projectId: 194,
  name: "Check External Availability",
  description: "Read availability through a project-owned operation.",
  access: "read",
  inputSchema: {
    fields: [
      {
        key: "guestName",
        type: "text",
        required: true,
        source: { kind: "field", key: "guestName" },
      },
    ],
  },
  outputSchema: {
    fields: [
      { path: "available", type: "boolean", required: true },
      { path: "status", type: "text", required: false },
    ],
  },
  resultMappings: [
    {
      sourcePath: "available",
      target: "context",
      targetKey: "serviceAvailable",
      type: "boolean",
      freshnessMinutes: 5,
      modelVisible: true,
      toolVisible: true,
    },
  ],
  execution: {
    adapter: "operation",
    handler: "901",
    mode: "synchronous",
    timeoutMs: 5_000,
    retryAttempts: 0,
    retryDelayMs: 0,
    cancellation: "best_effort",
  },
  requiredForCompletion: false,
}) satisfies ToolDefinitionV1;

test("a custom model provider receives a bounded provider-neutral request", async () => {
  const provider = new ConformanceModelProvider(modelProposal());
  const result = await new StructuredTurnEngine({ provider }).execute(
    engineInput(),
  );

  expect(provider.calls).toHaveLength(1);
  expect(provider.calls[0]).toMatchObject({
    maxOutputTokens: expect.any(Number),
    maxRetries: expect.any(Number),
    messages: expect.any(Array),
    modelId: expect.any(String),
    system: expect.any(String),
    timeoutMs: expect.any(Number),
  });
  expect(provider.calls[0]?.maxOutputTokens).toBeGreaterThan(0);
  expect(provider.calls[0]?.timeoutMs).toBeGreaterThan(0);
  expect(result).toMatchObject({
    attempts: 1,
    source: "model",
    usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
  });
  expect(result.proposal.validation).toMatchObject({
    accepted: true,
    modelAttemptCount: 1,
    providerModelId: provider.calls[0]?.modelId,
  });
});

test("a custom model provider cannot extend the published task contract", async () => {
  const provider = new ConformanceModelProvider(
    modelProposal({
      fieldCandidates: [
        {
          fieldKey: "unpublishedSecret",
          naturalValue: "exfiltrate",
          confidence: 1,
          source: "visitor",
        },
      ],
    }),
  );
  const result = await new StructuredTurnEngine({ provider }).execute(
    engineInput(),
  );

  expect(provider.calls.length).toBeGreaterThan(1);
  expect(result.source).toBe("deterministic");
  expect(result.proposal.fieldCandidates).toEqual([]);
  expect(result.proposal.validation.providerModelId).toBe("deterministic");
});

test("business tools receive canonical server values instead of proposed overrides", () => {
  const current = buildCanonicalToolInput({
    context: new Map(),
    definition: extensionToolDefinition,
    fields: new Map([
      ["guestName", { canonicalValue: "Asha", state: "valid" }],
    ]),
    now: new Date("2026-08-23T00:00:00.000Z"),
    proposedInput: { guestName: "Asha" },
  });
  const mismatched = buildCanonicalToolInput({
    context: new Map(),
    definition: extensionToolDefinition,
    fields: new Map([
      ["guestName", { canonicalValue: "Asha", state: "valid" }],
    ]),
    now: new Date("2026-08-23T00:00:00.000Z"),
    proposedInput: { guestName: "Other tenant" },
  });
  const injected = buildCanonicalToolInput({
    context: new Map(),
    definition: extensionToolDefinition,
    fields: new Map([
      ["guestName", { canonicalValue: "Asha", state: "valid" }],
    ]),
    now: new Date("2026-08-23T00:00:00.000Z"),
    proposedInput: { credential: "secret", guestName: "Asha" },
  });

  expect(current).toEqual({ input: { guestName: "Asha" }, ok: true });
  expect(mismatched).toMatchObject({
    error: { code: "tool_input_mismatch" },
    ok: false,
  });
  expect(injected).toMatchObject({
    error: { code: "tool_input_not_allowed" },
    ok: false,
  });
});

test("business tool outputs keep only declared typed paths and mappings", async () => {
  const validated = await validateToolResultPayload({
    contextValues: new Map(),
    definition: extensionToolDefinition,
    fieldValues: new Map(),
    projectId: 194,
    result: {
      available: true,
      providerSecret: "must-not-cross-the-boundary",
      status: "available",
    },
  });

  expect(validated).toEqual({
    mappings: [
      {
        mapping: expect.objectContaining({
          sourcePath: "available",
          targetKey: "serviceAvailable",
        }),
        value: true,
      },
    ],
    ok: true,
    result: { available: true, status: "available" },
  });
});

test("business tool contracts discard provider URLs and credential material", () => {
  const parsed = toolDefinitionV1Schema.parse({
    ...extensionToolDefinition,
    credential: "must-not-persist",
    execution: {
      ...extensionToolDefinition.execution,
      url: "https://provider.example.test/private",
    },
  });

  expect(parsed).not.toHaveProperty("credential");
  expect(parsed.execution).not.toHaveProperty("url");
});
