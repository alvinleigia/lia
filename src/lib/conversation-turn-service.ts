import {
  isExplicitCancellationRequest,
  isExplicitHumanHandoffRequest,
} from "@/lib/conversation-control-intents";
import {
  advanceConversationException,
  getConversationExceptionState,
} from "@/lib/conversation-exception-store";
import {
  applyConversationExceptionDecision,
  classifyConversationException,
  EXCEPTION_METADATA_KEY,
  getExceptionScope,
  hasPendingExceptionOffer,
} from "@/lib/conversation-exceptions";
import { loadSelectedContactMemory } from "@/lib/conversation-memory";
import { getConversationProjectPolicy } from "@/lib/conversation-project-policies";
import { recordConversationQualityTurn } from "@/lib/conversation-quality-telemetry";
import { projectTurnBudgetGate } from "@/lib/conversation-turn-budget";
import { compileStructuredTurn } from "@/lib/conversation-turn-compiler";
import type {
  StructuredTurnRequestV1,
  TurnContextValueV1,
  TurnFieldStateV1,
} from "@/lib/conversation-turn-contracts";
import {
  createAssistanceDecisionExecution,
  type ExecuteStructuredTurnInput,
  StructuredTurnEngine,
  type StructuredTurnExecution,
  type TurnKnowledgeRetriever,
} from "@/lib/conversation-turn-engine";
import {
  initializeTurnFieldState,
  listLatestPublishedTurnTasks,
  selectModelVisibleTurnContext,
} from "@/lib/conversation-turn-project";
import { ProjectDocumentTurnRetriever } from "@/lib/conversation-turn-retrieval";
import { evaluateTurnAdmission } from "@/lib/conversation-turn-safety";
import { getImportedKnowledgeAnswers } from "@/lib/knowledge-import-store";
import {
  AiSdkStructuredTurnProvider,
  PLATFORM_EXTRACTION_MODEL_ID,
  type StructuredTurnProvider,
} from "@/lib/model-provider";
import { type ModelUsage, sumModelUsage } from "@/lib/model-usage";
import { normalizeProjectAiSettings } from "@/lib/project-ai-settings";
import { measureRuntimeModelCall } from "@/lib/runtime-request-metrics";
import { measureRuntimeStage } from "@/lib/runtime-stage-timing";
import { parseTaskFollowUpConsent } from "@/lib/task-follow-up";

export class PublishedTurnTaskNotFoundError extends Error {
  constructor() {
    super("Published task not found.");
    this.name = "PublishedTurnTaskNotFoundError";
  }
}

export type ProjectStructuredTurnResult = {
  activeTask: {
    id: number;
    name: string;
    versionNumber: number;
  } | null;
  execution: StructuredTurnExecution;
};

type ExecuteProjectStructuredTurnInput = StructuredTurnRequestV1 & {
  companyName: string;
  projectAiSettings: unknown;
  projectName: string;
};

export async function executeConfiguredStructuredTurn(
  input: ExecuteStructuredTurnInput & {
    conversationId?: number | null;
    inboundMessageId?: number | null;
    exceptionScope?: string;
    handoffAvailable?: boolean;
  },
  retriever: TurnKnowledgeRetriever = new ProjectDocumentTurnRetriever(),
  provider: StructuredTurnProvider = new AiSdkStructuredTurnProvider(),
) {
  const startedAt = performance.now();
  const deadline =
    Date.now() + input.projectPolicy.assistant.modelPolicy.timeoutMs;
  const scope = getExceptionScope(input, input.exceptionScope);
  const candidateContext =
    input.conversationId && input.inboundMessageId
      ? {
          projectId: input.projectId,
          conversationId: input.conversationId,
          messageId: input.inboundMessageId,
        }
      : null;
  const stored = candidateContext
    ? await getConversationExceptionState(candidateContext)
    : null;
  const context = stored ? candidateContext : null;
  const previous = stored?.state ?? null;
  const canHandoff =
    input.handoffAvailable ??
    Boolean(
      input.activeTask?.task.definition.outcomes.some(
        (outcome) => outcome.type === "handoff",
      ),
    );
  let consent: boolean | undefined;
  let consentUsage: ModelUsage | undefined;
  if (
    previous?.scope === scope &&
    previous.action === "offer_assistance" &&
    hasPendingExceptionOffer({ [EXCEPTION_METADATA_KEY]: previous }) &&
    context &&
    context.messageId > previous.messageId &&
    !isExplicitCancellationRequest(input.visitorMessage)
  ) {
    const direct = parseTaskFollowUpConsent(input.visitorMessage);
    if (direct !== null) consent = direct;
    else if (isExplicitHumanHandoffRequest(input.visitorMessage))
      consent = true;
    else if (
      provider.reviewInterpretation &&
      evaluateTurnAdmission({
        history: input.history,
        policy: input.projectPolicy,
        visitorMessage: input.visitorMessage,
      }).allowed
    ) {
      // Interpret a contextual request semantically, without collecting it as a field.
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Turn deadline exceeded.");
      const budget = await projectTurnBudgetGate.admit({
        projectId: input.projectId,
        modelId: PLATFORM_EXTRACTION_MODEL_ID,
        maxTurnsPerMinute:
          input.projectPolicy.assistant.modelPolicy.maxTurnsPerMinute,
        estimatedInputTokens: 0,
        estimatedCostUnits: 0,
      });
      if (budget.allowed) {
        const reviewInterpretation =
          provider.reviewInterpretation.bind(provider);
        const review = await measureRuntimeModelCall(
          input.projectId,
          () =>
            reviewInterpretation({
              kind: "exception_assistance",
              modelId: PLATFORM_EXTRACTION_MODEL_ID,
              timeoutMs: remaining,
              messages: compileStructuredTurn({ ...input, retrieval: [] })
                .messages,
              selected: [],
            }),
          PLATFORM_EXTRACTION_MODEL_ID,
          "clarification",
        );
        consentUsage = review.usage;
        if (review.matches) consent = true;
        else if (review.assistanceDecision === "decline") consent = false;
      }
    }
  }
  if (
    consent === undefined &&
    (input.stage === "knowledge" || input.prefetchKnowledge) &&
    input.projectPolicy.knowledge.sourceSelection.allowedSources.includes(
      "project_documents",
    )
  ) {
    const importedAnswers = await getImportedKnowledgeAnswers(
      input.projectId,
      input.visitorMessage,
    );
    if (importedAnswers.length)
      input = {
        ...input,
        assistantBehavior: {
          ...input.assistantBehavior,
          approvedKnowledgeAnswers: [
            ...importedAnswers,
            ...input.assistantBehavior.approvedKnowledgeAnswers,
          ],
        },
      };
  }
  const engine = new StructuredTurnEngine({
    budgetGate: projectTurnBudgetGate,
    retriever,
    provider,
  });

  let execution =
    consent !== undefined
      ? createAssistanceDecisionExecution()
      : await measureRuntimeStage(
          `turn_${input.stage}`,
          input.recordTiming,
          () =>
            engine.execute({
              ...input,
              projectPolicy: {
                ...input.projectPolicy,
                assistant: {
                  ...input.projectPolicy.assistant,
                  modelPolicy: {
                    ...input.projectPolicy.assistant.modelPolicy,
                    timeoutMs: Math.max(1, deadline - Date.now()),
                  },
                },
              },
            }),
        );
  if (consentUsage)
    execution = {
      ...execution,
      attempts: execution.attempts + 1,
      usage: sumModelUsage([execution.usage, consentUsage]),
    };
  const reason =
    consent !== undefined
      ? null
      : classifyConversationException(input, execution);
  if (
    context &&
    reason !== "defer" &&
    (reason !== null ||
      consent !== undefined ||
      (previous && previous.action !== "resolved"))
  ) {
    const state = await advanceConversationException({
      ...context,
      scope,
      reason,
      limit: input.projectPolicy.knowledge.noAnswerPolicy.clarificationAttempts,
      canHandoff,
      consent,
      offeredMessageId: previous?.messageId,
    });
    if (state?.scope === scope && state.messageId === context.messageId)
      execution = applyConversationExceptionDecision(execution, state, input);
    else if (consent !== undefined)
      throw new Error(
        "The assistance offer changed. Please review the current request.",
      );
  }
  if (input.conversationId)
    await recordConversationQualityTurn({
      projectId: input.projectId,
      conversationId: input.conversationId,
      stage: input.stage,
      latencyMs: performance.now() - startedAt,
      execution,
    });
  return execution;
}

export async function executeProjectStructuredTurn(
  input: ExecuteProjectStructuredTurnInput,
): Promise<ProjectStructuredTurnResult> {
  const [currentPolicy, publishedTaskVersions] = await Promise.all([
    getConversationProjectPolicy(input.projectId),
    listLatestPublishedTurnTasks(input.projectId),
  ]);
  const activeTaskVersion =
    input.activeTaskId === null
      ? null
      : (publishedTaskVersions.find(
          ({ taskId }) => taskId === input.activeTaskId,
        ) ?? null);

  if (input.activeTaskId !== null && !activeTaskVersion) {
    throw new PublishedTurnTaskNotFoundError();
  }

  const activeTask = activeTaskVersion?.snapshot ?? null;
  const projectPolicy = activeTask?.conversationPolicy ?? currentPolicy;
  const assistantBehavior = activeTask
    ? normalizeProjectAiSettings(activeTask.assistantBehavior)
    : normalizeProjectAiSettings(input.projectAiSettings);
  const fieldState: TurnFieldStateV1[] = activeTask
    ? initializeTurnFieldState(activeTask)
    : [];
  const taskContext: TurnContextValueV1[] = activeTask
    ? selectModelVisibleTurnContext(activeTask)
    : [];
  const taskContextKeys = new Set(taskContext.map(({ key }) => key));
  const memoryContext = await loadSelectedContactMemory({
    contactId: input.contactId,
    policy: projectPolicy,
    projectId: input.projectId,
  });
  const context = [
    ...taskContext,
    ...memoryContext.filter(({ key }) => !taskContextKeys.has(key)),
  ];
  const execution = await executeConfiguredStructuredTurn({
    activeTask,
    assistantBehavior,
    assistantIntroduced: input.assistantIntroduced,
    channel: input.channel,
    companyName: input.companyName,
    context,
    fieldState,
    history: input.history,
    projectId: input.projectId,
    projectName: input.projectName,
    projectPolicy,
    publishedTasks: publishedTaskVersions.map(
      ({ taskId, name, objective }) => ({
        candidateFieldKeys: [],
        id: taskId,
        name,
        objective,
      }),
    ),
    stage: input.stage,
    visitorMessage: input.visitorMessage,
  });

  return {
    activeTask: activeTaskVersion
      ? {
          id: activeTaskVersion.taskId,
          name: activeTaskVersion.name,
          versionNumber: activeTaskVersion.versionNumber,
        }
      : null,
    execution,
  };
}
