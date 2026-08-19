"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionFormState } from "@/lib/action-form-state";
import { writeAuditLog } from "@/lib/audit";
import { resolveStrictUserAndProject } from "@/lib/auth-project";
import {
  conversationDiagnosticFindingSchema,
  conversationRegressionCaseSchema,
} from "@/lib/conversation-diagnostic-contracts";
import {
  createConversationDiagnosticFinding,
  createConversationRegressionCase,
} from "@/lib/conversation-diagnostic-findings";

function formValues(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

function validationError(message = "Please check the form values.") {
  return { error: message };
}

export async function recordConversationDiagnosticFinding(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = conversationDiagnosticFindingSchema.safeParse(
    formValues(formData),
  );
  if (!parsed.success) return validationError();

  const context = await resolveStrictUserAndProject(parsed.data.projectId);

  try {
    const finding = await createConversationDiagnosticFinding({
      ...parsed.data,
      authorUserId: context.user.id,
    });
    await writeAuditLog({
      ...context,
      action: "conversation.diagnostic_finding_recorded",
      targetType: "channel_conversation",
      targetId: parsed.data.conversationId,
      metadata: {
        findingId: finding.id,
        category: finding.category,
      },
    });
  } catch (error) {
    return validationError(
      error instanceof Error
        ? error.message
        : "The finding could not be recorded.",
    );
  }

  revalidatePath("/projects/diagnostics");
  redirect(
    `/projects/diagnostics?conversationId=${parsed.data.conversationId}&findingRecorded=1`,
  );
}

export async function promoteConversationRegressionCase(
  _previousState: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = conversationRegressionCaseSchema.safeParse(
    formValues(formData),
  );
  if (!parsed.success) return validationError();

  const context = await resolveStrictUserAndProject(parsed.data.projectId);

  try {
    const regressionCase = await createConversationRegressionCase({
      ...parsed.data,
      createdByUserId: context.user.id,
    });
    await writeAuditLog({
      ...context,
      action: "conversation.regression_case_promoted",
      targetType: "conversation_regression_case",
      targetId: regressionCase.id,
      metadata: {
        findingId: parsed.data.findingId,
        conversationId: parsed.data.conversationId,
      },
    });
  } catch (error) {
    return validationError(
      error instanceof Error
        ? error.message
        : "The regression case could not be created.",
    );
  }

  revalidatePath("/projects/diagnostics");
  redirect(
    `/projects/diagnostics?conversationId=${parsed.data.conversationId}&regressionPromoted=1`,
  );
}
