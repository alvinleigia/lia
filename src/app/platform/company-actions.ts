"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import {
  getActiveCompanyOwnerCount,
  listCompanyMembers,
  updateCompanyMembershipStatus,
} from "@/lib/invitations";
import { resolvePlatformAdmin } from "@/lib/platform-admin";

const memberStatusSchema = z.object({
  companyId: z.coerce.number().int().positive(),
  membershipId: z.coerce.number().int().positive(),
  status: z.enum(["active", "disabled"]),
});

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
  const members = await listCompanyMembers(parsed.data.companyId);
  const targetMember = members.find(
    ({ membership }) => membership.id === parsed.data.membershipId,
  );

  if (!targetMember) {
    redirect(
      `/platform/companies/${parsed.data.companyId}?error=Member%20not%20found.`,
    );
  }

  if (
    parsed.data.status === "disabled" &&
    targetMember.membership.role === "COMPANY_OWNER" &&
    targetMember.membership.status === "active" &&
    (await getActiveCompanyOwnerCount(parsed.data.companyId)) <= 1
  ) {
    redirect(
      `/platform/companies/${parsed.data.companyId}?error=At%20least%20one%20active%20company%20owner%20is%20required.`,
    );
  }

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
