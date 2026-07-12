"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { getRequiredAppBaseUrl, sendEmail } from "@/lib/email";
import {
  createPasswordResetTokenValue,
  storePasswordResetToken,
} from "@/lib/password-reset";
import { getUserByEmail } from "@/lib/users";

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export async function requestPasswordReset(formData: FormData) {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    redirect("/forgot-password?error=Please%20enter%20a%20valid%20email.");
  }

  const email = parsed.data.email.trim().toLowerCase();
  const user = await getUserByEmail(email);

  if (user) {
    const token = createPasswordResetTokenValue();
    await storePasswordResetToken(user.id, token);
    await writeAuditLog({
      action: "password_reset.requested",
      targetType: "user",
      targetId: user.id,
    });

    const resetUrl = new URL("/reset-password", getRequiredAppBaseUrl());
    resetUrl.searchParams.set("token", token);

    await sendEmail({
      to: user.email,
      subject: "Reset your password",
      textBody: [
        "We received a request to reset your password.",
        "",
        `Reset your password here: ${resetUrl.toString()}`,
        "",
        "This link expires in 30 minutes. If you did not request this, you can ignore this email.",
      ].join("\n"),
      htmlBody: `
        <p>We received a request to reset your password.</p>
        <p><a href="${resetUrl.toString()}">Reset your password</a></p>
        <p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>
      `,
    });
  }

  redirect("/forgot-password?sent=1");
}
