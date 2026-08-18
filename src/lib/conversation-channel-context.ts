import { eq } from "drizzle-orm";
import type { listRecentChannelMessages } from "@/lib/channels";
import type { TurnMessageV1 } from "@/lib/conversation-turn-contracts";
import { db } from "@/lib/db-config";
import { companies, projects, workspaces } from "@/lib/db-schema";

export type ProjectTurnContext = {
  companyName: string;
  projectAiSettings: unknown;
  projectName: string;
};

export async function getProjectTurnContext(
  projectId: number,
): Promise<ProjectTurnContext | null> {
  const [project] = await db
    .select({
      companyName: companies.name,
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
): TurnMessageV1[] {
  return messages.flatMap((message) =>
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
