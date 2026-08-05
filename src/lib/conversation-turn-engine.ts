import type {
  ConversationalTaskSnapshotV1,
  ConversationProjectPolicyV1,
  TURN_MODEL_STAGES,
} from "@/lib/conversation-contracts";
import {
  compileStructuredTurn,
  type PublishedTaskOption,
  planOpeningTurn,
} from "@/lib/conversation-turn-compiler";
import {
  type TurnContextValueV1,
  type TurnFieldStateV1,
  type TurnMessageV1,
  type TurnResultV1,
  type TurnRetrievalExcerptV1,
  turnResultV1Schema,
  type ValidatedTurnProposalV1,
} from "@/lib/conversation-turn-contracts";
import {
  allowTurnBudget,
  evaluateTurnAdmission,
  hasUnsafeTurnOutput,
  type TurnBudgetGate,
} from "@/lib/conversation-turn-safety";
import {
  TurnProposalValidationError,
  validateStructuredTurnProposal,
} from "@/lib/conversation-turn-validator";
import {
  AiSdkStructuredTurnProvider,
  PLATFORM_DEFAULT_MODEL_ID,
  PLATFORM_FALLBACK_MODEL_ID,
  type StructuredTurnProvider,
  type StructuredTurnProviderResult,
} from "@/lib/model-provider";
import type { ProjectAiSettings } from "@/lib/project-ai-settings";

export interface TurnKnowledgeRetriever {
  retrieve(input: {
    projectId: number;
    query: string;
  }): Promise<TurnRetrievalExcerptV1[]>;
}

export type ExecuteStructuredTurnInput = {
  activeTask: ConversationalTaskSnapshotV1 | null;
  assistantBehavior: ProjectAiSettings;
  assistantIntroduced: boolean;
  channel: "project_chat" | "widget" | "whatsapp";
  companyName: string;
  context: TurnContextValueV1[];
  fieldState: TurnFieldStateV1[];
  history: TurnMessageV1[];
  openingTurn?: boolean;
  projectId: number;
  projectPolicy: ConversationProjectPolicyV1;
  projectName: string;
  publishedTasks: PublishedTaskOption[];
  stage: (typeof TURN_MODEL_STAGES)[number];
  visitorMessage: string;
};

export type OpenStructuredConversationInput = Omit<
  ExecuteStructuredTurnInput,
  "openingTurn" | "stage" | "visitorMessage"
>;

export type StructuredTurnExecution = {
  attempts: number;
  proposal: ValidatedTurnProposalV1;
  source: "model" | "deterministic";
  usage: StructuredTurnProviderResult["usage"];
};

type StructuredTurnEngineOptions = {
  budgetGate?: TurnBudgetGate;
  provider?: StructuredTurnProvider;
  retriever?: TurnKnowledgeRetriever | null;
};

const EXPLICIT_TASK_CANCELLATION_PHRASES = new Set([
  "cancel",
  "cancel booking",
  "cancel my booking",
  "cancel request",
  "cancel the booking",
  "cancel the request",
  "cancel this",
  "cancel this booking",
  "cancel this request",
  "never mind",
  "nevermind",
  "please cancel",
  "stop",
  "stop this",
  "stop this booking",
  "stop this request",
]);

const TASK_INTENT_FILLER_WORDS = new Set([
  "a",
  "an",
  "can",
  "could",
  "for",
  "help",
  "i",
  "like",
  "me",
  "my",
  "need",
  "now",
  "our",
  "please",
  "the",
  "to",
  "us",
  "want",
  "we",
  "with",
  "would",
  "you",
]);

function normalizeTaskIntent(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word && !TASK_INTENT_FILLER_WORDS.has(word))
    .join(" ");
}

function findExplicitTaskIntent(input: ExecuteStructuredTurnInput) {
  if (
    input.activeTask ||
    !input.projectPolicy.entry.allowTaskRecommendation ||
    input.publishedTasks.length === 0
  ) {
    return null;
  }

  const visitorIntent = normalizeTaskIntent(input.visitorMessage);
  const matches = input.publishedTasks.filter((task) => {
    const taskIntent = normalizeTaskIntent(task.name);
    return (
      taskIntent.split(" ").length >= 2 &&
      (visitorIntent === taskIntent ||
        visitorIntent.startsWith(`${taskIntent} `))
    );
  });

  return matches.length === 1 ? matches[0] : null;
}

function isExplicitTaskCancellation(input: ExecuteStructuredTurnInput) {
  if (!input.activeTask) return false;

  const normalized = input.visitorMessage
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");

  return EXPLICIT_TASK_CANCELLATION_PHRASES.has(normalized);
}

function resolveModelIds(
  policy: ConversationProjectPolicyV1,
  stage: (typeof TURN_MODEL_STAGES)[number],
) {
  const modelPolicy = policy.assistant.modelPolicy;
  if (modelPolicy.mode === "platform_default") {
    return {
      primary: PLATFORM_DEFAULT_MODEL_ID,
      fallback: PLATFORM_FALLBACK_MODEL_ID,
    };
  }

  const override = modelPolicy.stageOverrides.find(
    (candidate) => candidate.stage === stage,
  );
  return {
    primary: override?.modelId ?? modelPolicy.primaryModelId,
    fallback:
      override?.fallbackModelId === undefined
        ? modelPolicy.fallbackModelId
        : override.fallbackModelId,
  };
}

function deterministicProposal(input: {
  nextAction: "ask" | "cancel" | "clarify" | "handoff" | "fail";
  reasonCode: string;
  reply: string;
  groundingStatus?: TurnResultV1["grounding"]["status"];
  turnKind?: TurnResultV1["turnKind"];
}): TurnResultV1 {
  return turnResultV1Schema.parse({
    schemaVersion: 1,
    turnKind: input.turnKind ?? "ordinary_question",
    reply: input.reply,
    grounding: {
      status: input.groundingStatus ?? "no_answer",
      excerptIds: [],
    },
    fieldCandidates: [],
    taskRecommendation: null,
    toolRequest: null,
    routeRecommendation: null,
    outcomeRecommendation: null,
    nextAction: input.nextAction,
    ambiguity: {
      requiresClarification: input.nextAction === "clarify",
      question: input.nextAction === "clarify" ? input.reply : null,
    },
    safety: {
      decision:
        input.nextAction === "handoff"
          ? "handoff"
          : input.nextAction === "clarify"
            ? "clarify"
            : input.nextAction === "fail"
              ? "refuse"
              : "allow",
      reasonCode: input.reasonCode,
    },
    decisionSummary: `Deterministic response: ${input.reasonCode}.`,
  });
}

function asValidatedDeterministic(
  proposal: TurnResultV1,
): ValidatedTurnProposalV1 {
  return {
    ...proposal,
    validation: {
      accepted: true,
      modelAttemptCount: 0,
      providerModelId: "deterministic",
    },
  };
}

function modelFailureProposal(input: ExecuteStructuredTurnInput) {
  const mode =
    input.activeTask?.task.definition.degradedMode.model ??
    "deterministic_fallback";
  if (mode === "handoff") {
    return deterministicProposal({
      nextAction: "handoff",
      reasonCode: "model_unavailable",
      reply:
        input.activeTask?.task.definition.taskPolicy.handoffMessage ??
        "I cannot complete that safely right now. A team member can help.",
    });
  }
  if (mode === "fail") {
    return deterministicProposal({
      nextAction: "fail",
      reasonCode: "model_unavailable",
      reply: "I cannot process that request right now.",
    });
  }
  return deterministicProposal({
    nextAction: "ask",
    reasonCode: "model_unavailable",
    reply:
      input.activeTask?.task.definition.taskPolicy.fallbackMessage ??
      "I could not prepare a reliable answer. Please try again.",
  });
}

function directFieldRecoveryProposal(
  input: ExecuteStructuredTurnInput,
): TurnResultV1 | null {
  if (!input.activeTask) return null;

  const value = input.visitorMessage.trim();
  const fieldStates = new Map(
    input.fieldState.map((field) => [field.fieldKey, field.state]),
  );
  const matches = input.activeTask.task.definition.fields.filter((field) => {
    const state = fieldStates.get(field.key) ?? "missing";
    if (!["cleared", "invalid", "missing"].includes(state)) return false;

    if (field.type === "email") {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }
    if (field.type === "phone") {
      return /^(?:\+|00)[1-9][\d\s().-]{5,20}$/.test(value);
    }
    if (field.type === "date") {
      return /^\d{4}-\d{2}-\d{2}$/.test(value);
    }
    if (field.type === "time") {
      return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
    }
    return false;
  });
  if (matches.length !== 1) return null;

  const [field] = matches;
  return turnResultV1Schema.parse({
    schemaVersion: 1,
    turnKind: "field_answer",
    reply: `Thanks. I received your ${field.label}. Please continue with the remaining required details.`,
    grounding: {
      status: "not_needed",
      excerptIds: [],
    },
    fieldCandidates: [
      {
        fieldKey: field.key,
        naturalValue: value,
        confidence: 1,
        source: "visitor",
      },
    ],
    taskRecommendation: null,
    toolRequest: null,
    routeRecommendation: null,
    outcomeRecommendation: null,
    nextAction: "ask",
    ambiguity: {
      requiresClarification: false,
      question: null,
    },
    safety: {
      decision: "allow",
      reasonCode: "model_unavailable",
    },
    decisionSummary:
      "Recovered one unambiguous visitor field after model failure.",
  });
}

function hasDirectUnresolvedFieldEvidence(input: ExecuteStructuredTurnInput) {
  if (!input.activeTask || input.stage !== "extraction") return false;

  const fieldStates = new Map(
    input.fieldState.map((field) => [field.fieldKey, field.state]),
  );
  const value = input.visitorMessage.trim();

  return input.activeTask.task.definition.fields.some((field) => {
    const state = fieldStates.get(field.key) ?? "missing";
    if (!["cleared", "invalid", "missing"].includes(state)) return false;

    if (field.type === "email") {
      return /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(value);
    }
    if (field.type === "phone") {
      return /(?:\+|00)[1-9][\d\s().-]{5,20}/.test(value);
    }
    if (field.type === "date") {
      return /\b\d{4}-\d{2}-\d{2}\b/.test(value);
    }
    if (field.type === "time") {
      return /\b(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/.test(value);
    }
    return false;
  });
}

function retrievalFailureProposal(input: ExecuteStructuredTurnInput) {
  const mode =
    input.activeTask?.task.definition.degradedMode.retrieval ?? "clarify";
  if (mode === "handoff") {
    return deterministicProposal({
      nextAction: "handoff",
      reasonCode: "retrieval_unavailable",
      reply:
        input.activeTask?.task.definition.taskPolicy.handoffMessage ??
        "I cannot verify that information right now. A team member can help.",
    });
  }
  if (mode === "fail") {
    return deterministicProposal({
      nextAction: "fail",
      reasonCode: "retrieval_unavailable",
      reply: "I cannot verify that information right now.",
    });
  }
  return deterministicProposal({
    nextAction: "clarify",
    reasonCode: "retrieval_unavailable",
    reply: "Could you rephrase the specific detail you need?",
  });
}

function repairInstruction(attempt: number, codes: string[]) {
  return `\n\nRepair attempt ${attempt}: the previous structured result was rejected for these server validation codes: ${codes
    .slice(0, 8)
    .join(
      ", ",
    )}. Return a corrected complete StructuredTurnV1 object. Do not broaden permissions.`;
}

export class StructuredTurnEngine {
  private readonly budgetGate: TurnBudgetGate;
  private readonly provider: StructuredTurnProvider;
  private readonly retriever: TurnKnowledgeRetriever | null;

  constructor(options: StructuredTurnEngineOptions = {}) {
    this.budgetGate = options.budgetGate ?? allowTurnBudget;
    this.provider = options.provider ?? new AiSdkStructuredTurnProvider();
    this.retriever = options.retriever ?? null;
  }

  async open(
    input: OpenStructuredConversationInput,
  ): Promise<StructuredTurnExecution | null> {
    const opening = planOpeningTurn(input.projectPolicy);
    if (opening.mode === "wait") {
      return null;
    }
    if (opening.mode === "exact") {
      return {
        attempts: 0,
        proposal: asValidatedDeterministic(
          deterministicProposal({
            nextAction: "ask",
            reasonCode: "configured_greeting",
            reply: opening.reply,
            groundingStatus: "not_needed",
            turnKind: "greeting",
          }),
        ),
        source: "deterministic",
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      };
    }

    return this.execute({
      ...input,
      assistantIntroduced: false,
      openingTurn: true,
      stage: "knowledge",
      visitorMessage: "Begin the conversation using the published policy.",
    });
  }

  async execute(
    input: ExecuteStructuredTurnInput,
  ): Promise<StructuredTurnExecution> {
    if (isExplicitTaskCancellation(input)) {
      return {
        attempts: 0,
        proposal: asValidatedDeterministic(
          deterministicProposal({
            nextAction: "cancel",
            reasonCode: "explicit_task_cancellation",
            reply: "No problem. I cancelled this request.",
            groundingStatus: "not_needed",
            turnKind: "cancellation",
          }),
        ),
        source: "deterministic",
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      };
    }

    const admission = evaluateTurnAdmission({
      history: input.history,
      policy: input.projectPolicy,
      visitorMessage: input.visitorMessage,
    });
    if (!admission.allowed) {
      return {
        attempts: 0,
        proposal: asValidatedDeterministic(deterministicProposal(admission)),
        source: "deterministic",
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      };
    }

    const explicitTask = findExplicitTaskIntent(input);
    if (explicitTask) {
      return {
        attempts: 0,
        proposal: {
          ...asValidatedDeterministic(
            turnResultV1Schema.parse({
              schemaVersion: 1,
              turnKind: "task_recommendation",
              reply:
                "I'll help you with that now. Please share the details you already know.",
              grounding: {
                status: "not_needed",
                excerptIds: [],
              },
              fieldCandidates: [],
              taskRecommendation: {
                taskId: explicitTask.id,
                confidence: 1,
                reason: "The visitor explicitly requested this published task.",
              },
              toolRequest: null,
              routeRecommendation: null,
              outcomeRecommendation: null,
              nextAction: "ask",
              ambiguity: {
                requiresClarification: false,
                question: null,
              },
              safety: {
                decision: "allow",
                reasonCode: null,
              },
              decisionSummary: "Matched one explicit published task request.",
            }),
          ),
        },
        source: "deterministic",
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      };
    }

    const modelIds = resolveModelIds(input.projectPolicy, input.stage);
    const budget = await this.budgetGate.admit({
      estimatedCostUnits: admission.estimatedCostUnits ?? 0,
      estimatedInputTokens: admission.estimatedInputTokens ?? 0,
      maxTurnsPerMinute:
        input.projectPolicy.assistant.modelPolicy.maxTurnsPerMinute,
      modelId: modelIds.primary,
      projectId: input.projectId,
    });
    if (!budget.allowed) {
      return {
        attempts: 0,
        proposal: asValidatedDeterministic(
          deterministicProposal({
            nextAction: "fail",
            reasonCode: budget.reasonCode ?? "turn_rate_limited",
            reply:
              "This project has reached its current conversation limit. Please try again shortly.",
          }),
        ),
        source: "deterministic",
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      };
    }

    let retrieval: TurnRetrievalExcerptV1[] = [];
    if (this.retriever && input.stage === "knowledge" && !input.openingTurn) {
      try {
        retrieval = await this.retriever.retrieve({
          projectId: input.projectId,
          query: input.visitorMessage,
        });
      } catch {
        return {
          attempts: 0,
          proposal: asValidatedDeterministic(retrievalFailureProposal(input)),
          source: "deterministic",
          usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        };
      }
    }

    const compiled = compileStructuredTurn({ ...input, retrieval });
    const modelPolicy = input.projectPolicy.assistant.modelPolicy;
    const models = [...new Set([modelIds.primary, modelIds.fallback])].filter(
      (modelId): modelId is string => Boolean(modelId),
    );
    let attempts = 0;
    let lastUsage: StructuredTurnProviderResult["usage"] = {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    };

    for (const modelId of models) {
      let repair = "";
      for (
        let repairAttempt = 0;
        repairAttempt <= modelPolicy.maxRepairAttempts;
        repairAttempt += 1
      ) {
        attempts += 1;
        try {
          const generated = await this.provider.generateTurn({
            maxOutputTokens: modelPolicy.maxOutputTokens,
            maxRetries: modelPolicy.maxRetries,
            messages: compiled.messages,
            modelId,
            system: compiled.system + repair,
            timeoutMs: modelPolicy.timeoutMs,
          });
          lastUsage = generated.usage;
          const proposal = validateStructuredTurnProposal(
            generated.output,
            compiled.validation,
          );
          if (hasUnsafeTurnOutput(proposal.reply)) {
            throw new TurnProposalValidationError(["unsafe_output"]);
          }
          if (
            proposal.fieldCandidates.length === 0 &&
            proposal.nextAction === "ask" &&
            proposal.safety.decision === "allow" &&
            hasDirectUnresolvedFieldEvidence(input)
          ) {
            throw new TurnProposalValidationError([
              "missing_direct_field_candidate",
            ]);
          }

          return {
            attempts,
            proposal: {
              ...proposal,
              validation: {
                accepted: true,
                modelAttemptCount: attempts,
                providerModelId: generated.modelId,
              },
            },
            source: "model",
            usage: generated.usage,
          };
        } catch (error) {
          const codes =
            error instanceof TurnProposalValidationError
              ? error.codes
              : ["provider_or_structured_output_failure"];
          repair = repairInstruction(repairAttempt + 1, codes);
        }
      }
    }

    const fallback =
      directFieldRecoveryProposal(input) ?? modelFailureProposal(input);
    return {
      attempts,
      proposal: {
        ...asValidatedDeterministic(fallback),
        validation: {
          accepted: true,
          modelAttemptCount: attempts,
          providerModelId: "deterministic",
        },
      },
      source: "deterministic",
      usage: lastUsage,
    };
  }
}
