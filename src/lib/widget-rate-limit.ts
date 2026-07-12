import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { widgetRateLimits } from "@/lib/db-schema";

type WidgetRateLimitOptions = {
  maxRequests: number;
  windowMs: number;
};

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function getWindowStart(nowMs: number, windowMs: number) {
  return new Date(Math.floor(nowMs / windowMs) * windowMs);
}

export async function isWidgetRateLimited(
  token: string,
  clientIp: string,
  options: WidgetRateLimitOptions,
) {
  const tokenHash = sha256Hex(token);
  const nowMs = Date.now();
  const windowStart = getWindowStart(nowMs, options.windowMs);

  const [row] = await db
    .insert(widgetRateLimits)
    .values({
      tokenHash,
      clientIp,
      windowStart,
      requestCount: 1,
      updatedAt: new Date(nowMs),
    })
    .onConflictDoUpdate({
      target: [
        widgetRateLimits.tokenHash,
        widgetRateLimits.clientIp,
        widgetRateLimits.windowStart,
      ],
      set: {
        requestCount: sql`${widgetRateLimits.requestCount} + 1`,
        updatedAt: new Date(nowMs),
      },
    })
    .returning({
      requestCount: widgetRateLimits.requestCount,
    });

  const currentCount = Number(row?.requestCount ?? 0);
  return currentCount > options.maxRequests;
}
