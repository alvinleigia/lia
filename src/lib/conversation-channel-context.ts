import { eq } from "drizzle-orm";
import type { listRecentChannelMessages } from "@/lib/channels";
import type { TurnMessageV1 } from "@/lib/conversation-turn-contracts";
import { db } from "@/lib/db-config";
import { companies, projects, workspaces } from "@/lib/db-schema";

export type ProjectTurnContext = {
  companyName: string;
  companyTimeZone: string;
  projectAiSettings: unknown;
  projectName: string;
};

export async function getProjectTurnContext(
  projectId: number,
): Promise<ProjectTurnContext | null> {
  const [project] = await db
    .select({
      companyName: companies.name,
      companyTimeZone: companies.timeZone,
      projectAiSettings: projects.aiSettings,
      projectName: projects.name,
    })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .innerJoin(companies, eq(companies.id, workspaces.companyId))
    .where(eq(projects.id, projectId))
    .limit(1);

  return project ?? null;
}

export function toTurnHistory(
  messages: Awaited<ReturnType<typeof listRecentChannelMessages>>,
  activeTaskStartedAt?: Date,
): TurnMessageV1[] {
  // A prior task's confirmed outcome is a context boundary for a NEW task.
  // Keep intervening knowledge questions (for contextual callback entry), and
  // never trim on visitor text or an outcome/error inside the current task.
  const previousOutcome = activeTaskStartedAt
    ? messages.findLastIndex((message) => {
        if (
          message.direction !== "outbound" ||
          message.createdAt >= activeTaskStartedAt
        )
          return false;
        const payload = message.payload;
        if (
          !payload ||
          typeof payload !== "object" ||
          !("runtimeReply" in payload)
        )
          return false;
        const reply = payload.runtimeReply;
        return Boolean(
          reply &&
            typeof reply === "object" &&
            "intent" in reply &&
            reply.intent === "outcome",
        );
      })
    : -1;
  return messages.slice(previousOutcome + 1).flatMap((message) =>
    message.text
      ? [
          {
            content: message.text,
            role: message.direction === "inbound" ? "user" : "assistant",
          } satisfies TurnMessageV1,
        ]
      : [],
  );
}
