"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import {
  cancelCompanyInvitation,
  createCompanyInvitation,
  sendCompanyInvitationEmail,
  updateCompanyMembershipStatus,
} from "@/lib/invitations";
import {
  getTenantCompanyById,
  resolvePlatformAdmin,
} from "@/lib/platform-admin";

const companyInvitationSchema = z.object({
  companyId: z.coerce.number().int().positive(),
  email: z.string().email(),
});

const cancelInvitationSchema = z.object({
  companyId: z.coerce.number().int().positive(),
  invitationId: z.coerce.number().int().positive(),
});

const memberStatusSchema = z.object({
  companyId: z.coerce.number().int().positive(),
  membershipId: z.coerce.number().int().positive(),
  status: z.enum(["active", "disabled"]),
});

export async function createPlatformCompanyInvitationAction(
  formData: FormData,
) {
  const parsed = companyInvitationSchema.safeParse({
    companyId: formData.get("companyId"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    redirect("/platform?error=Please%20enter%20a%20valid%20invite.");
  }

  const platformUser = await resolvePlatformAdmin();
  const tenant = await getTenantCompanyById(parsed.data.companyId);

  if (!tenant) {
    redirect("/platform?error=Tenant%20not%20found.");
  }

  const { invitation, acceptUrl } = await createCompanyInvitation({
    companyId: parsed.data.companyId,
    invitedByUserId: platformUser.id,
    email: parsed.data.email,
  });
  let emailSent = true;

  try {
    await sendCompanyInvitationEmail({
      acceptUrl,
      companyName: tenant.company.name,
      email: invitation.email,
      invitedByName: platformUser.name ?? platformUser.email,
    });
  } catch {
    emailSent = false;
  }

  await writeAuditLog({
    user: platformUser,
    company: { id: parsed.data.companyId },
    action: "platform.company_invitation.created",
    targetType: "company_invitation",
    targetId: invitation.id,
    metadata: {
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      emailSent,
    },
  });

  revalidatePath(`/platform/companies/${parsed.data.companyId}`);
  redirect(
    `/platform/companies/${parsed.data.companyId}?invited=1&emailSent=${
      emailSent ? "1" : "0"
    }&inviteUrl=${encodeURIComponent(acceptUrl)}`,
  );
}

export async function cancelPlatformCompanyInvitationAction(
  formData: FormData,
) {
  const parsed = cancelInvitationSchema.safeParse({
    companyId: formData.get("companyId"),
    invitationId: formData.get("invitationId"),
  });

  if (!parsed.success) {
    redirect("/platform?error=Invalid%20invitation.");
  }

  const platformUser = await resolvePlatformAdmin();
  const invitation = await cancelCompanyInvitation(parsed.data);

  if (!invitation) {
    redirect(
      `/platform/companies/${parsed.data.companyId}?error=Invitation%20not%20found.`,
    );
  }

  await writeAuditLog({
    user: platformUser,
    company: { id: parsed.data.companyId },
    action: "platform.company_invitation.cancelled",
    targetType: "company_invitation",
    targetId: invitation.id,
    metadata: { email: invitation.email },
  });

  revalidatePath(`/platform/companies/${parsed.data.companyId}`);
  redirect(`/platform/companies/${parsed.data.companyId}?inviteCancelled=1`);
}

export async function updatePlatformCompanyMemberStatusAction(
  formData: FormData,
) {
  const parsed = memberStatusSchema.safeParse({
    companyId: formData.get("companyId"),
    membershipId: formData.get("membershipId"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    redirect("/platform?error=Invalid%20member%20status.");
  }

  const platformUser = await resolvePlatformAdmin();
  const member = await updateCompanyMembershipStatus(parsed.data);

  if (!member) {
    redirect(
      `/platform/companies/${parsed.data.companyId}?error=Member%20not%20found.`,
    );
  }

  await writeAuditLog({
    user: platformUser,
    company: { id: parsed.data.companyId },
    action: "platform.company_member.status_updated",
    targetType: "company_membership",
    targetId: member.id,
    metadata: {
      memberUserId: member.userId,
      status: member.status,
    },
  });

  revalidatePath(`/platform/companies/${parsed.data.companyId}`);
  redirect(`/platform/companies/${parsed.data.companyId}?memberUpdated=1`);
}
