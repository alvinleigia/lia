import { eq } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { users } from "@/lib/db-schema";

export async function getUserByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  return user ?? null;
}

export async function getUserById(userId: number) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user ?? null;
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  name?: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const [user] = await db
    .insert(users)
    .values({
      email: normalizedEmail,
      passwordHash: input.passwordHash,
      name: input.name ?? null,
    })
    .returning();

  return user;
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

export async function updateUserProfile(input: {
  userId: number;
  name: string | null;
}) {
  const [user] = await db
    .update(users)
    .set({ name: input.name })
    .where(eq(users.id, input.userId))
    .returning();

  return user ?? null;
}
