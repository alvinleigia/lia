"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndWorkspace } from "@/lib/auth-project";
import { COMPANY_ROLES } from "@/lib/company-roles";
import {
  cancelCompanyInvitation,
  createCompanyInvitation,
  getActiveCompanyOwnerCount,
  listCompanyMembers,
  sendCompanyInvitationEmail,
  updateCompanyMembershipRole,
  updateCompanyMembershipStatus,
} from "@/lib/invitations";

const createInvitationSchema = z.object({
  email: z.string().email(),
});

const invitationIdSchema = z.coerce.number().int().positive();
const membershipStatusSchema = z.object({
  membershipId: z.coerce.number().int().positive(),
  status: z.enum(["active", "disabled"]),
});
const membershipRoleSchema = z.object({
  membershipId: z.coerce.number().int().positive(),
  role: z.enum(COMPANY_ROLES),
});

export async function createTeamInvitationAction(formData: FormData) {
  const parsed = createInvitationSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    redirect("/team/invite?error=Please%20enter%20a%20valid%20email.");
  }

  const context = await resolveUserAndWorkspace();
  assertPermission(context.membership, "company.members.manage");

  const { invitation, acceptUrl } = await createCompanyInvitation({
    companyId: context.company.id,
    invitedByUserId: context.user.id,
    email: parsed.data.email,
  });
  let emailSent = true;

  try {
    await sendCompanyInvitationEmail({
      acceptUrl,
      companyName: context.company.name,
      email: invitation.email,
      invitedByName: context.user.name ?? context.user.email,
    });
  } catch {
    emailSent = false;
  }

  await writeAuditLog({
    ...context,
    action: "company_invitation.created",
    targetType: "company_invitation",
    targetId: invitation.id,
    metadata: {
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      emailSent,
    },
  });

  revalidatePath("/team");
  redirect(
    `/team/invite?invited=1&emailSent=${emailSent ? "1" : "0"}&inviteUrl=${encodeURIComponent(
      acceptUrl,
    )}`,
  );
}

export async function cancelTeamInvitationAction(formData: FormData) {
  const parsed = invitationIdSchema.safeParse(formData.get("invitationId"));

  if (!parsed.success) {
    redirect("/team?error=Invalid%20invitation.");
  }

  const context = await resolveUserAndWorkspace();
  assertPermission(context.membership, "company.members.manage");
  const invitation = await cancelCompanyInvitation({
    companyId: context.company.id,
    invitationId: parsed.data,
  });

  if (!invitation) {
    redirect("/team?error=Invitation%20not%20found.");
  }

  await writeAuditLog({
    ...context,
    action: "company_invitation.cancelled",
    targetType: "company_invitation",
    targetId: invitation.id,
    metadata: { email: invitation.email },
  });

  revalidatePath("/team");
  redirect("/team?inviteCancelled=1");
}

export async function updateTeamMemberStatusAction(formData: FormData) {
  const parsed = membershipStatusSchema.safeParse({
    membershipId: formData.get("membershipId"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    redirect("/team?error=Invalid%20member%20status.");
  }

  const context = await resolveUserAndWorkspace();
  assertPermission(context.membership, "company.members.manage");

  if (
    parsed.data.status === "disabled" &&
    parsed.data.membershipId === context.membership.id
  ) {
    redirect("/team?error=You%20cannot%20disable%20your%20own%20access.");
  }

  const members = await listCompanyMembers(context.company.id);
  const targetMember = members.find(
    ({ membership }) => membership.id === parsed.data.membershipId,
  );

  if (!targetMember) {
    redirect("/team?error=Member%20not%20found.");
  }

  if (
    parsed.data.status === "disabled" &&
    targetMember.membership.role === "COMPANY_OWNER" &&
    targetMember.membership.status === "active" &&
    (await getActiveCompanyOwnerCount(context.company.id)) <= 1
  ) {
    redirect(
      "/team?error=At%20least%20one%20active%20company%20owner%20is%20required.",
    );
  }

  const member = await updateCompanyMembershipStatus({
    companyId: context.company.id,
    membershipId: parsed.data.membershipId,
    status: parsed.data.status,
  });

  if (!member) {
    redirect("/team?error=Member%20not%20found.");
  }

  await writeAuditLog({
    ...context,
    action: "company_member.status_updated",
    targetType: "company_membership",
    targetId: member.id,
    metadata: {
      memberUserId: member.userId,
      status: member.status,
    },
  });

  revalidatePath("/team");
  redirect("/team?memberUpdated=1");
}

export async function updateTeamMemberRoleAction(formData: FormData) {
  const parsed = membershipRoleSchema.safeParse({
    membershipId: formData.get("membershipId"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    redirect("/team?error=Invalid%20member%20role.");
  }

  const context = await resolveUserAndWorkspace();
  assertPermission(context.membership, "company.members.manage");

  if (parsed.data.membershipId === context.membership.id) {
    redirect("/team?error=You%20cannot%20change%20your%20own%20role.");
  }

  const members = await listCompanyMembers(context.company.id);
  const targetMember = members.find(
    ({ membership }) => membership.id === parsed.data.membershipId,
  );

  if (!targetMember) {
    redirect("/team?error=Member%20not%20found.");
  }

  if (
    targetMember.membership.role === "COMPANY_OWNER" &&
    targetMember.membership.status === "active" &&
    parsed.data.role !== "COMPANY_OWNER" &&
    (await getActiveCompanyOwnerCount(context.company.id)) <= 1
  ) {
    redirect(
      "/team?error=At%20least%20one%20active%20company%20owner%20is%20required.",
    );
  }

  const member = await updateCompanyMembershipRole({
    companyId: context.company.id,
    membershipId: parsed.data.membershipId,
    role: parsed.data.role,
  });

  if (!member) {
    redirect("/team?error=Member%20not%20found.");
  }

  await writeAuditLog({
    ...context,
    action: "company_member.role_updated",
    targetType: "company_membership",
    targetId: member.id,
    metadata: {
      memberUserId: member.userId,
      role: member.role,
    },
  });

  revalidatePath("/team");
  revalidatePath(`/team/members/${member.id}`);
  revalidatePath("/", "layout");
  redirect("/team?memberUpdated=1");
}
