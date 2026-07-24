"use server";

import { hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionFormState } from "@/lib/action-form-state";
import {
  acceptCompanyInvitation,
  getCompanyInvitationByToken,
} from "@/lib/invitations";
import { createUser, getUserByEmail } from "@/lib/users";
import { getOrCreateDefaultWorkspaceForUser } from "@/lib/workspaces";

const signUpSchema = z.object({
  name: z.string().trim().max(100).optional(),
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
  inviteToken: z.string().trim().optional(),
});

export async function signUpWithCredentials(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name") || undefined,
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    inviteToken: formData.get("inviteToken") || undefined,
  });

  if (!parsed.success) {
    return { error: "Please check your input." };
  }

  if (parsed.data.password !== parsed.data.confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const existingUser = await getUserByEmail(parsed.data.email);
  if (existingUser) {
    return { error: "Email is already registered." };
  }

  const inviteToken = parsed.data.inviteToken?.trim();
  if (inviteToken) {
    const inviteContext = await getCompanyInvitationByToken(inviteToken);
    const normalizedEmail = parsed.data.email.trim().toLowerCase();

    if (
      !inviteContext ||
      inviteContext.invitation.status !== "pending" ||
      inviteContext.invitation.expiresAt <= new Date() ||
      inviteContext.invitation.email !== normalizedEmail
    ) {
      return { error: "Invitation is not valid." };
    }
  }

  const passwordHash = await hash(parsed.data.password, 12);

  const user = await createUser({
    email: parsed.data.email,
    passwordHash,
    name: parsed.data.name,
  });

  if (inviteToken) {
    await acceptCompanyInvitation({ token: inviteToken, user });
    redirect("/sign-in?registered=1&inviteAccepted=1");
  }

  await getOrCreateDefaultWorkspaceForUser(user);

  redirect("/sign-in?registered=1");
}
