"use server";

import { compare } from "bcryptjs";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn } from "@/auth";
import { isUserBlockedFromSignIn } from "@/lib/account-status";
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

export async function signInWithCredentials(formData: FormData) {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect(
      "/sign-in?error=Please%20enter%20a%20valid%20email%20and%20password.",
    );
  }

  if (await isDisabledAccountCredential(parsed.data)) {
    redirect("/sign-in?accountDisabled=1");
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/post-login",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/sign-in?error=Invalid%20email%20or%20password.");
    }
    throw error;
  }
}

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/post-login" });
}
