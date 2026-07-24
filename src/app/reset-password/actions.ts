"use server";

import { hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionFormState } from "@/lib/action-form-state";
import { writeAuditLog } from "@/lib/audit";
import { consumePasswordResetToken } from "@/lib/password-reset";
import { updateUserPassword } from "@/lib/users";

const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
});

export async function resetPassword(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { error: "Please check your input." };
  }

  if (parsed.data.password !== parsed.data.confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const resetToken = await consumePasswordResetToken(parsed.data.token);

  if (!resetToken) {
    return { error: "This reset link is invalid or expired." };
  }

  const passwordHash = await hash(parsed.data.password, 12);
  await updateUserPassword(resetToken.userId, passwordHash);
  await writeAuditLog({
    action: "password_reset.completed",
    targetType: "user",
    targetId: resetToken.userId,
  });

  redirect("/sign-in?reset=1");
}
