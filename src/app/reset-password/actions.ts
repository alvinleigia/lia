"use server";

import { hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { consumePasswordResetToken } from "@/lib/password-reset";
import { updateUserPassword } from "@/lib/users";

const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
});

export async function resetPassword(formData: FormData) {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    redirect("/reset-password?error=Please%20check%20your%20input.");
  }

  if (parsed.data.password !== parsed.data.confirmPassword) {
    const token = encodeURIComponent(parsed.data.token);
    redirect(
      `/reset-password?token=${token}&error=Passwords%20do%20not%20match.`,
    );
  }

  const resetToken = await consumePasswordResetToken(parsed.data.token);

  if (!resetToken) {
    redirect(
      "/reset-password?error=This%20reset%20link%20is%20invalid%20or%20expired.",
    );
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
