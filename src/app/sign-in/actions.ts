"use server";

import { compare } from "bcryptjs";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn } from "@/auth";
import { isUserBlockedFromSignIn } from "@/lib/account-status";
import type { ActionFormState } from "@/lib/action-form-state";
import { getUserByEmail } from "@/lib/users";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

async function isDisabledAccountCredential(input: {
  email: string;
  password: string;
}) {
  const user = await getUserByEmail(input.email);
  if (!user || !user.passwordHash.startsWith("$2")) {
    return false;
  }

  const isValidPassword = await compare(input.password, user.passwordHash);
  if (!isValidPassword) {
    return false;
  }

  return isUserBlockedFromSignIn(user.id);
}

export async function signInWithCredentials(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Please enter a valid email and password." };
  }

  if (await isDisabledAccountCredential(parsed.data)) {
    return {
      error:
        "This account is currently disabled. Contact the platform administrator to restore access.",
    };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/post-login",
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    throw error;
  }
}

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/post-login" });
}
