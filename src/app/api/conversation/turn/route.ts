import { writeAuditLog } from "@/lib/audit";
import {
  isInactiveAccountError,
  resolveStrictUserAndProject,
} from "@/lib/auth-project";
import { logChatRequest } from "@/lib/chat-logs";
import { structuredTurnRequestV1Schema } from "@/lib/conversation-turn-contracts";
import { buildSafeTurnDecisionSummary } from "@/lib/conversation-turn-safety";
import {
  executeProjectStructuredTurn,
  PublishedTurnTaskNotFoundError,
} from "@/lib/conversation-turn-service";

class InvalidTurnRequestError extends Error {
  constructor() {
    super("Invalid structured turn request.");
    this.name = "InvalidTurnRequestError";
  }
}

function errorResponse(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let projectId: number | null = null;

  try {
    const parsed = structuredTurnRequestV1Schema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      throw new InvalidTurnRequestError();
    }
    projectId = parsed.data.projectId;

    const context = await resolveStrictUserAndProject(projectId);
    const result = await executeProjectStructuredTurn({
      ...parsed.data,
      companyName: context.company.name,
      projectAiSettings: context.project.aiSettings,
      projectName: context.project.name,
    });

    await logChatRequest({
      route: "structured_turn",
      projectId,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
      promptTokens: result.execution.usage.inputTokens,
      completionTokens: result.execution.usage.outputTokens,
      totalTokens: result.execution.usage.totalTokens,
      errorCode:
        result.execution.source === "deterministic"
          ? result.execution.proposal.safety.reasonCode
          : null,
    });
    await writeAuditLog({
      ...context,
      action: "structured_turn.decided",
      targetType: result.activeTask ? "conversational_task" : "project",
      targetId: result.activeTask?.id ?? projectId,
      metadata: buildSafeTurnDecisionSummary(result.execution),
    });

    return Response.json(result);
  } catch (error) {
    const status =
      error instanceof InvalidTurnRequestError
        ? 400
        : error instanceof PublishedTurnTaskNotFoundError ||
            (error instanceof Error && error.message === "Project not found.")
          ? 404
          : error instanceof Error && error.message === "Unauthorized"
            ? 401
            : isInactiveAccountError(error)
              ? 423
              : 500;
    const message =
      status === 400
        ? "Please check the turn request."
        : status === 401
          ? "Sign in to continue."
          : status === 404
            ? "The selected project or published task was not found."
            : status === 423
              ? "This account is currently disabled."
              : "The structured turn could not be processed.";

    if (status === 500) {
      console.error("Structured turn failed:", error);
    }
    await logChatRequest({
      route: "structured_turn",
      projectId,
      statusCode: status,
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });

    return errorResponse(status, message);
  }
}
