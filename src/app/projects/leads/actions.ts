"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/access-control";
import type { ActionFormState } from "@/lib/action-form-state";
import { resolveUserAndWorkspace } from "@/lib/auth-project";
import { leadUpdateSchema } from "@/lib/lead-inbox";
import { updateInboxLead } from "@/lib/lead-inbox-data";

export async function updateInboxLeadAction(
  _previous: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = leadUpdateSchema.safeParse({
    submissionId: formData.get("submissionId"),
    expectedRevision: formData.get("expectedRevision"),
    status: formData.get("status"),
    assignedUserId:
      formData.get("assignedUserId") === "none"
        ? null
        : Number(formData.get("assignedUserId")),
    nextFollowUpDate: formData.get("nextFollowUpDate") || null,
    note: formData.get("note") ?? "",
  });
  if (!parsed.success)
    return {
      error: parsed.error.issues[0]?.message ?? "Check the lead details.",
    };
  const context = await resolveUserAndWorkspace();
  assertPermission(context.membership, "company.project.manage");
  try {
    await updateInboxLead(
      { companyId: context.company.id, workspaceId: context.workspace.id },
      parsed.data,
      {
        userId: context.user.id,
        membershipId: context.membership.id,
      },
    );
  } catch (error) {
    return {
      error:
        error instanceof Error &&
        /^(Lead not found|Choose an active|This lead changed)/.test(
          error.message,
        )
          ? error.message
          : "Could not save the lead. Please try again.",
    };
  }
  revalidatePath("/projects/leads");
  revalidatePath(`/projects/leads/${parsed.data.submissionId}`);
  revalidatePath("/projects/submissions");
  revalidatePath(`/projects/submissions/${parsed.data.submissionId}`);
  return { success: "Lead updated." };
}
