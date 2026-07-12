"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { writeAuditLog } from "@/lib/audit";
import { acceptCompanyInvitation } from "@/lib/invitations";
import { getUserByEmail } from "@/lib/users";

export async function acceptCompanyInvitationAction(formData: FormData) {
  const token = formData.get("token");

  if (typeof token !== "string" || token.trim() === "") {
    redirect("/invite/accept?error=Invalid%20invitation.");
  }

  const session = await auth();
  const email = session?.user?.email;

  if (!email) {
    redirect(
      `/invite/accept?token=${encodeURIComponent(token)}&error=Please%20sign%20in%20first.`,
    );
  }

  const user = await getUserByEmail(email);
  if (!user) {
    redirect(
      `/invite/accept?token=${encodeURIComponent(token)}&error=User%20not%20found.`,
    );
  }

  try {
    const { invitation, company, membership } = await acceptCompanyInvitation({
      token,
      user,
    });

    await writeAuditLog({
      user,
      membership,
      company,
      action: "company_invitation.accepted",
      targetType: "company_invitation",
      targetId: invitation.id,
      metadata: { email: invitation.email },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to accept invitation.";
    redirect(
      `/invite/accept?token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`,
    );
  }

  redirect("/profile?inviteAccepted=1");
}
