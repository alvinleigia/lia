import { and, count, eq, gte } from "drizzle-orm";
import type { TurnBudgetGate } from "@/lib/conversation-turn-safety";
import { db } from "@/lib/db-config";
import { chatRequestLogs } from "@/lib/db-schema";

const RATE_WINDOW_MS = 60_000;

export const projectTurnBudgetGate: TurnBudgetGate = {
  async admit(input) {
    const windowStart = new Date(Date.now() - RATE_WINDOW_MS);
    const [result] = await db
      .select({ total: count() })
      .from(chatRequestLogs)
      .where(
        and(
          eq(chatRequestLogs.projectId, input.projectId),
          eq(chatRequestLogs.route, "structured_turn"),
          gte(chatRequestLogs.createdAt, windowStart),
        ),
      );

    return (result?.total ?? 0) >= input.maxTurnsPerMinute
      ? { allowed: false, reasonCode: "turn_rate_limited" }
      : { allowed: true };
  },
};
