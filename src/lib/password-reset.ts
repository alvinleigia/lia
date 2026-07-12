import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { passwordResetTokens } from "@/lib/db-schema";

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 1000 * 60 * 30;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createPasswordResetTokenValue() {
  return randomBytes(RESET_TOKEN_BYTES).toString("base64url");
}

export function getPasswordResetExpiry() {
  return new Date(Date.now() + RESET_TOKEN_TTL_MS);
}

export async function storePasswordResetToken(userId: number, token: string) {
  await db.insert(passwordResetTokens).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: getPasswordResetExpiry(),
  });
}

export async function getValidPasswordResetToken(token: string) {
  const tokenHash = hashToken(token);
  const [record] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return record ?? null;
}

export async function consumePasswordResetToken(token: string) {
  const tokenHash = hashToken(token);
  const [record] = await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .returning();

  return record ?? null;
}
