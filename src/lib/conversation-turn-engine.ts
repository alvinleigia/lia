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
  nextAction: "ask" | "clarify" | "handoff" | "fail";
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
    if (this.retriever && !input.openingTurn) {
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

    return {
      attempts,
      proposal: {
        ...asValidatedDeterministic(modelFailureProposal(input)),
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
