"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import type { ActionFormState } from "@/lib/action-form-state";
import { writeAuditLog } from "@/lib/audit";
import { resolveUserAndWorkspace } from "@/lib/auth-project";
import { updateCompanyTimeZone } from "@/lib/companies";
import { isSupportedCompanyTimeZone } from "@/lib/time-zones";

const companyTimeZoneSchema = z.object({
  timeZone: z
    .string()
    .trim()
    .refine(isSupportedCompanyTimeZone, "Select a supported timezone."),
});

export async function updateCompanyTimeZoneAction(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = companyTimeZoneSchema.safeParse({
    timeZone: formData.get("timeZone"),
  });
  if (!parsed.success) {
    return { error: "Select a supported timezone." };
  }

  const context = await resolveUserAndWorkspace();
  assertPermission(context.membership, "company.members.manage");
  const previousTimeZone = context.company.timeZone;
  const company = await updateCompanyTimeZone({
    companyId: context.company.id,
    timeZone: parsed.data.timeZone,
  });
  if (!company) {
    return { error: "Company settings could not be updated." };
  }

  await writeAuditLog({
    ...context,
    action: "company.time_zone_updated",
    targetType: "company",
    targetId: company.id,
    metadata: {
      previousTimeZone,
      timeZone: company.timeZone,
    },
  });

  revalidatePath("/company/settings");
  revalidatePath("/projects/audit");
  revalidatePath("/projects/actions/[actionId]/hybrid-test", "page");
  return { success: "Company timezone saved." };
}
