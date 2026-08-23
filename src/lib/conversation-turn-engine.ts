import type {
  ConversationalTaskSnapshotV1,
  ConversationProjectPolicyV1,
  TURN_MODEL_STAGES,
} from "@/lib/conversation-contracts";
import {
  isExplicitCancellationRequest,
  isExplicitHumanHandoffRequest,
  isPotentialKnowledgeSideQuestion,
} from "@/lib/conversation-control-intents";
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
  applyIntentRoutingPolicy,
  TurnProposalValidationError,
  validateStructuredTurnProposal,
} from "@/lib/conversation-turn-validator";
import { validateTaskFieldValue } from "@/lib/conversational-task-field-validation";
import {
  AiSdkStructuredTurnProvider,
  PLATFORM_DEFAULT_MODEL_ID,
  PLATFORM_EXTRACTION_FALLBACK_MODEL_ID,
  PLATFORM_EXTRACTION_MODEL_ID,
  PLATFORM_FALLBACK_MODEL_ID,
  type StructuredTurnProvider,
  type StructuredTurnProviderResult,
} from "@/lib/model-provider";
import {
  type ProjectAiSettings,
  resolveApprovedKnowledgeAnswer,
} from "@/lib/project-ai-settings";

export interface TurnKnowledgeRetriever {
  retrieve(input: {
    limit: number;
    projectId: number;
    query: string;
  }): Promise<TurnRetrievalExcerptV1[]>;
}

export type ExecuteStructuredTurnInput = {
  activeTask: ConversationalTaskSnapshotV1 | null;
  assistantBehavior: ProjectAiSettings;
  assistantIntroduced: boolean;
  channel: "project_chat" | "widget" | "whatsapp" | "telnyx_voice";
  companyName: string;
  context: TurnContextValueV1[];
  fieldState: TurnFieldStateV1[];
  history: TurnMessageV1[];
  openingTurn?: boolean;
  projectId: number;
  projectPolicy: ConversationProjectPolicyV1;
  projectName: string;
  publishedTasks: PublishedTaskOption[];
  requestedFieldKey?: string | null;
  stage: (typeof TURN_MODEL_STAGES)[number];
  visitorMessage: string;
};

export type OpenStructuredConversationInput = Omit<
  ExecuteStructuredTurnInput,
  "openingTurn" | "stage" | "visitorMessage"
>;

export type StructuredTurnExecution = {
  attempts: number;
  modelEscalationReason: ModelEscalationReason | null;
  proposal: ValidatedTurnProposalV1;
  source: "model" | "deterministic";
  usage: StructuredTurnProviderResult["usage"];
};

export const MODEL_ESCALATION_REASONS = [
  "ambiguous_intent",
  "clarification",
  "configured_generation",
  "correction",
  "grounded_synthesis",
  "semantic_extraction",
] as const;

export type ModelEscalationReason = (typeof MODEL_ESCALATION_REASONS)[number];

type StructuredTurnEngineOptions = {
  budgetGate?: TurnBudgetGate;
  provider?: StructuredTurnProvider;
  retriever?: TurnKnowledgeRetriever | null;
};

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

const CONTEXTUAL_KNOWLEDGE_REFERENCE_PATTERN =
  /\b(?:it|its|they|their|them|this|that|these|those|listed|above|earlier|previous|former|latter)\b/i;
const MAX_RETRIEVAL_CONTEXT_MESSAGES = 6;
const MAX_RETRIEVAL_QUERY_CHARACTERS = 1_200;

function buildKnowledgeRetrievalQuery(input: {
  history: TurnMessageV1[];
  visitorMessage: string;
}) {
  const visitorMessage = input.visitorMessage.trim();
  if (!CONTEXTUAL_KNOWLEDGE_REFERENCE_PATTERN.test(visitorMessage)) {
    return visitorMessage;
  }

  const context: string[] = [];
  let characters = visitorMessage.length;

  for (let index = input.history.length - 1; index >= 0; index -= 1) {
    const message = input.history[index];
    if (!message || message.role !== "user") continue;

    const content = message.content.trim();
    if (
      !content ||
      content === visitorMessage ||
      !isPotentialKnowledgeSideQuestion(content)
    ) {
      continue;
    }

    if (characters + content.length + 1 > MAX_RETRIEVAL_QUERY_CHARACTERS) {
      continue;
    }

    context.unshift(content);
    characters += content.length + 1;
    if (context.length === MAX_RETRIEVAL_CONTEXT_MESSAGES) break;
  }

  return [...context, visitorMessage].join("\n");
}

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
  return Boolean(
    input.activeTask && isExplicitCancellationRequest(input.visitorMessage),
  );
}

function isExplicitTaskHandoff(input: ExecuteStructuredTurnInput) {
  return Boolean(
    input.activeTask && isExplicitHumanHandoffRequest(input.visitorMessage),
  );
}

function resolveModelIds(
  policy: ConversationProjectPolicyV1,
  stage: (typeof TURN_MODEL_STAGES)[number],
) {
  const modelPolicy = policy.assistant.modelPolicy;
  if (modelPolicy.mode === "platform_default") {
    if (stage === "extraction") {
      return {
        primary: PLATFORM_EXTRACTION_MODEL_ID,
        fallback: PLATFORM_EXTRACTION_FALLBACK_MODEL_ID,
      };
    }
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
  groundingExcerptIds?: string[];
  groundingStatus?: TurnResultV1["grounding"]["status"];
  turnKind?: TurnResultV1["turnKind"];
}): TurnResultV1 {
  return turnResultV1Schema.parse({
    schemaVersion: 1,
    turnKind: input.turnKind ?? "ordinary_question",
    reply: input.reply,
    grounding: {
      status: input.groundingStatus ?? "no_answer",
      excerptIds: input.groundingExcerptIds ?? [],
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

function approvedKnowledgeAnswerProposal(
  input: ExecuteStructuredTurnInput,
): TurnResultV1 | null {
  if (input.stage !== "knowledge" || input.openingTurn) return null;

  const match = resolveApprovedKnowledgeAnswer(
    input.assistantBehavior,
    input.visitorMessage,
  );
  if (!match) return null;
  if (match.kind === "answer") {
    return deterministicProposal({
      nextAction: "ask",
      reasonCode: "approved_exact_answer",
      reply: match.reply,
      groundingExcerptIds: [match.excerptId],
      groundingStatus: "grounded",
      turnKind: input.activeTask ? "side_question" : "ordinary_question",
    });
  }

  return deterministicProposal({
    nextAction: "ask",
    reasonCode: "approved_no_answer",
    reply: match.reply,
    groundingStatus: "no_answer",
    turnKind: input.activeTask ? "side_question" : "ordinary_question",
  });
}

const CORRECTION_MARKERS =
  /\b(?:actually|change|changed|correct|correction|instead|rather|update)\b/i;

function resolveModelEscalationReason(
  input: ExecuteStructuredTurnInput,
): ModelEscalationReason {
  if (input.openingTurn) return "configured_generation";
  if (input.stage === "clarification") return "clarification";
  if (input.stage === "knowledge") {
    return !input.activeTask && input.publishedTasks.length > 0
      ? "ambiguous_intent"
      : "grounded_synthesis";
  }
  if (input.stage === "extraction") {
    if (isPotentialKnowledgeSideQuestion(input.visitorMessage)) {
      return "ambiguous_intent";
    }
    const hasExistingValue = input.fieldState.some((field) =>
      ["confirmed", "valid"].includes(field.state),
    );
    return hasExistingValue && CORRECTION_MARKERS.test(input.visitorMessage)
      ? "correction"
      : "semantic_extraction";
  }
  if (input.stage === "lookup") return "grounded_synthesis";
  return "ambiguous_intent";
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

function directFieldProposal(
  input: ExecuteStructuredTurnInput,
  reasonCode: "model_unavailable" | null,
): TurnResultV1 | null {
  if (!input.activeTask) return null;

  const value = input.visitorMessage.trim();
  const fieldStates = new Map(
    input.fieldState.map((field) => [field.fieldKey, field.state]),
  );
  const unresolvedFields = input.activeTask.task.definition.fields.filter(
    (field) => {
      const state = fieldStates.get(field.key) ?? "missing";
      return ["cleared", "invalid", "missing"].includes(state);
    },
  );
  const requestedField = input.requestedFieldKey
    ? unresolvedFields.find((field) => field.key === input.requestedFieldKey)
    : null;

  if (
    requestedField &&
    requestedField.cardinality === "single" &&
    requestedField.type !== "media" &&
    requestedField.type !== "project_resource" &&
    requestedField.optionSource?.kind !== "project_resource" &&
    !(
      ["address", "text"].includes(requestedField.type) &&
      isPotentialKnowledgeSideQuestion(value)
    )
  ) {
    const contextValues = new Map(
      input.context.map((contextValue) => [
        contextValue.key,
        contextValue.value,
      ]),
    );
    const validation = validateTaskFieldValue({
      contextValues,
      field: requestedField,
      value,
    });
    if (validation.ok) {
      return buildDirectFieldProposal({
        field: requestedField,
        reasonCode,
        value,
      });
    }
  }

  const matches = unresolvedFields.filter((field) => {
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

  return buildDirectFieldProposal({
    field: matches[0],
    reasonCode,
    value,
  });
}

function buildDirectFieldProposal(input: {
  field: ConversationalTaskSnapshotV1["task"]["definition"]["fields"][number];
  reasonCode: "model_unavailable" | null;
  value: string;
}): TurnResultV1 {
  return turnResultV1Schema.parse({
    schemaVersion: 1,
    turnKind: "field_answer",
    reply: `Thanks. I received your ${input.field.label}. Please continue with the remaining required details.`,
    grounding: {
      status: "not_needed",
      excerptIds: [],
    },
    fieldCandidates: [
      {
        fieldKey: input.field.key,
        naturalValue: input.value,
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
      reasonCode: input.reasonCode,
    },
    decisionSummary:
      input.reasonCode === "model_unavailable"
        ? "Recovered one unambiguous visitor field after model failure."
        : "Accepted one unambiguous typed visitor field without model inference.",
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
        modelEscalationReason: null,
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
        modelEscalationReason: null,
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

    if (isExplicitTaskHandoff(input)) {
      return {
        attempts: 0,
        modelEscalationReason: null,
        proposal: asValidatedDeterministic(
          deterministicProposal({
            nextAction: "handoff",
            reasonCode: "explicit_human_help_request",
            reply:
              input.activeTask?.task.definition.taskPolicy.handoffMessage ??
              "A team member will continue this conversation.",
            groundingStatus: "not_needed",
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
        modelEscalationReason: null,
        proposal: asValidatedDeterministic(deterministicProposal(admission)),
        source: "deterministic",
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      };
    }

    const explicitTask = findExplicitTaskIntent(input);
    if (explicitTask) {
      return {
        attempts: 0,
        modelEscalationReason: null,
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

    const directField = directFieldProposal(input, null);
    if (directField) {
      return {
        attempts: 0,
        modelEscalationReason: null,
        proposal: asValidatedDeterministic(directField),
        source: "deterministic",
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      };
    }

    const approvedKnowledgeAnswer = approvedKnowledgeAnswerProposal(input);
    if (approvedKnowledgeAnswer) {
      return {
        attempts: 0,
        modelEscalationReason: null,
        proposal: asValidatedDeterministic(approvedKnowledgeAnswer),
        source: "deterministic",
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      };
    }

    const modelEscalationReason = resolveModelEscalationReason(input);
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
        modelEscalationReason,
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
    if (
      this.retriever &&
      input.stage === "knowledge" &&
      !input.openingTurn &&
      input.projectPolicy.knowledge.sourceSelection.allowedSources.includes(
        "project_documents",
      )
    ) {
      try {
        retrieval = await this.retriever.retrieve({
          limit: Math.min(
            input.projectPolicy.knowledge.sourceSelection.maxExcerpts,
            4,
          ),
          projectId: input.projectId,
          query: buildKnowledgeRetrievalQuery(input),
        });
      } catch {
        return {
          attempts: 0,
          modelEscalationReason,
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
          const proposal = applyIntentRoutingPolicy(
            validateStructuredTurnProposal(
              generated.output,
              compiled.validation,
            ),
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
            modelEscalationReason,
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
      directFieldProposal(input, "model_unavailable") ??
      modelFailureProposal(input);
    return {
      attempts,
      modelEscalationReason,
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
