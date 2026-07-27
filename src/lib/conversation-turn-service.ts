import { getConversationProjectPolicy } from "@/lib/conversation-project-policies";
import { projectTurnBudgetGate } from "@/lib/conversation-turn-budget";
import type {
  StructuredTurnRequestV1,
  TurnContextValueV1,
  TurnFieldStateV1,
} from "@/lib/conversation-turn-contracts";
import {
  type ExecuteStructuredTurnInput,
  StructuredTurnEngine,
  type StructuredTurnExecution,
} from "@/lib/conversation-turn-engine";
import {
  initializeTurnFieldState,
  listLatestPublishedTurnTasks,
  selectModelVisibleTurnContext,
} from "@/lib/conversation-turn-project";
import { ProjectDocumentTurnRetriever } from "@/lib/conversation-turn-retrieval";
import { normalizeProjectAiSettings } from "@/lib/project-ai-settings";

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
  input: ExecuteStructuredTurnInput,
) {
  const engine = new StructuredTurnEngine({
    budgetGate: projectTurnBudgetGate,
    retriever: new ProjectDocumentTurnRetriever(),
  });

  return engine.execute(input);
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
  const context: TurnContextValueV1[] = activeTask
    ? selectModelVisibleTurnContext(activeTask)
    : [];
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
