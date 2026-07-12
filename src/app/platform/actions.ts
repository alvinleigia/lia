"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import {
  COMPANY_STATUSES,
  resolvePlatformAdmin,
  updateCompanyStatus,
} from "@/lib/platform-admin";

const companyStatusSchema = z.object({
  companyId: z.coerce.number().int().positive(),
  status: z.enum(COMPANY_STATUSES),
});

export async function updateTenantStatusAction(formData: FormData) {
  const parsed = companyStatusSchema.safeParse({
    companyId: formData.get("companyId"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    redirect("/platform?error=Invalid%20tenant%20status.");
  }

  const platformUser = await resolvePlatformAdmin();
  const company = await updateCompanyStatus(parsed.data);

  if (!company) {
    redirect("/platform?error=Tenant%20not%20found.");
  }

  await writeAuditLog({
    user: platformUser,
    company,
    action: "platform.tenant_status_updated",
    targetType: "company",
    targetId: company.id,
    metadata: {
      companyName: company.name,
      status: company.status,
    },
  });

  revalidatePath("/platform");
  redirect("/platform?updated=1");
}
