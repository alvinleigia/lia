"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { writeAuditLog } from "@/lib/audit";
import {
  clearActiveProjectCookie,
  resolveUserAndWorkspace,
  setActiveCompanyCookie,
  setActiveProjectCookie,
} from "@/lib/auth-project";
import {
  getActiveCompanyForUserById,
  updateCompanyName,
} from "@/lib/companies";
import { getFirstProjectForWorkspace } from "@/lib/projects";
import { updateUserProfile } from "@/lib/users";
import { getOrCreateDefaultWorkspaceForCompany } from "@/lib/workspaces";

const profileSchema = z.object({
  name: z.string().trim().max(100),
  companyName: z.string().trim().min(1).max(120),
});

const companyIdSchema = z.coerce.number().int().positive();

export async function selectCompanyFromHeaderAction(formData: FormData) {
  const parsed = companyIdSchema.safeParse(formData.get("companyId"));
  if (!parsed.success) {
    throw new Error("Invalid account.");
  }

  const currentContext = await resolveUserAndWorkspace();
  const selectedCompany = await getActiveCompanyForUserById(
    parsed.data,
    currentContext.user.id,
  );
  if (!selectedCompany) {
    throw new Error("Account not found.");
  }

  const workspace = await getOrCreateDefaultWorkspaceForCompany({
    companyId: selectedCompany.company.id,
    companyName: selectedCompany.company.name,
    userId: currentContext.user.id,
    user: currentContext.user,
  });
  const firstProject = await getFirstProjectForWorkspace(workspace.id);

  await setActiveCompanyCookie(selectedCompany.company.id);
  if (firstProject) {
    await setActiveProjectCookie(firstProject.id);
  } else {
    await clearActiveProjectCookie();
  }

  revalidatePath("/", "layout");
  revalidatePath("/profile");
  revalidatePath("/projects");
}

export async function updateProfileAction(formData: FormData) {
  const parsed = profileSchema.safeParse({
    name: formData.get("name") ?? "",
    companyName: formData.get("companyName"),
  });

  if (!parsed.success) {
    redirect("/profile?error=Please%20enter%20valid%20profile%20details.");
  }

  const context = await resolveUserAndWorkspace();
  assertPermission(context.membership, "company.members.manage");
  const name = parsed.data.name.trim() || null;
  const companyName = parsed.data.companyName.trim();
  const updatedUser = await updateUserProfile({
    userId: context.user.id,
    name,
  });

  if (!updatedUser) {
    redirect("/profile?error=Profile%20not%20found.");
  }

  const updatedCompany =
    companyName === context.company.name
      ? context.company
      : await updateCompanyName({
          companyId: context.company.id,
          name: companyName,
        });

  if (!updatedCompany) {
    redirect("/profile?error=Account%20not%20found.");
  }

  await writeAuditLog({
    ...context,
    company: updatedCompany,
    user: updatedUser,
    action: "user.profile_updated",
    targetType: "user",
    targetId: updatedUser.id,
    metadata: {
      name,
      companyName,
      previousCompanyName: context.company.name,
    },
  });

  revalidatePath("/profile");
  revalidatePath("/projects");
  revalidatePath("/", "layout");
  redirect("/profile?profileUpdated=1#demographics");
}
