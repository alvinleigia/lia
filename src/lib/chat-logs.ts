import { lt } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { chatRequestLogs } from "@/lib/db-schema";

type ChatLogInput = {
  route: "chat" | "widget";
  projectId?: number | null;
  statusCode: number;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  errorCode?: string | null;
};

const CHAT_LOG_RETENTION_DAYS = 30;
const CLEANUP_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
let lastCleanupAt = 0;

async function cleanupOldChatLogs(nowMs: number) {
  if (nowMs - lastCleanupAt < CLEANUP_COOLDOWN_MS) {
    return;
  }

  lastCleanupAt = nowMs;
  const cutoff = new Date(
    nowMs - CHAT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  await db.delete(chatRequestLogs).where(lt(chatRequestLogs.createdAt, cutoff));
}

export async function logChatRequest(input: ChatLogInput) {
  try {
    const nowMs = Date.now();
    await db.insert(chatRequestLogs).values({
      route: input.route,
      projectId: input.projectId ?? null,
      statusCode: input.statusCode,
      latencyMs: input.latencyMs,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      totalTokens: input.totalTokens ?? null,
      errorCode: input.errorCode ?? null,
    });

    // Best-effort retention enforcement with low overhead.
    await cleanupOldChatLogs(nowMs);
  } catch (error) {
    // Logging should never block serving user requests.
    console.error("Failed to write chat request log:", error);
  }
}
