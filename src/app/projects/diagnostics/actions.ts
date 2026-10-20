"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
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
import { QUALITY_FEEDBACK } from "@/lib/conversation-quality";
import { reviewConversationQuality } from "@/lib/conversation-quality-review";

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
  assertPermission(context.membership, "company.project.manage");

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
  assertPermission(context.membership, "company.project.manage");

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

const feedbackSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  conversationId: z.coerce.number().int().positive(),
  messageId: z.coerce.number().int().positive(),
  category: z.enum([
    "correct",
    "wrong_answer",
    "unnecessary_detail",
    "missed_intent",
  ]),
  note: z.string().trim().max(2000),
});

export async function recordQualityFeedback(
  _state: ActionFormState,
  data: FormData,
): Promise<ActionFormState> {
  const parsed = feedbackSchema.safeParse(Object.fromEntries(data));
  if (!parsed.success)
    return {
      error:
        "Choose a bot reply and feedback. Keep notes within 2,000 characters.",
    };
  try {
    const context = await resolveStrictUserAndProject(parsed.data.projectId);
    assertPermission(context.membership, "company.project.manage");
    const finding = await createConversationDiagnosticFinding({
      ...parsed.data,
      authorUserId: context.user.id,
      note:
        parsed.data.note ||
        `Reviewer marked this reply: ${QUALITY_FEEDBACK[parsed.data.category]}.`,
    });
    await writeAuditLog({
      ...context,
      action: "conversation.quality_feedback_recorded",
      targetType: "conversation_diagnostic_finding",
      targetId: finding.id,
      metadata: {
        conversationId: parsed.data.conversationId,
        messageId: parsed.data.messageId,
        category: parsed.data.category,
      },
    });
    revalidatePath("/projects/diagnostics");
    return { success: "Feedback saved. Live bot behaviour has not changed." };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not save feedback.",
    };
  }
}

export async function requestQualityReview(
  _state: ActionFormState,
  data: FormData,
): Promise<ActionFormState> {
  const parsed = z
    .object({
      projectId: z.coerce.number().int().positive(),
      conversationId: z.coerce.number().int().positive(),
    })
    .safeParse(Object.fromEntries(data));
  if (!parsed.success) return { error: "Invalid review request." };
  try {
    const context = await resolveStrictUserAndProject(parsed.data.projectId);
    assertPermission(context.membership, "company.project.manage");
    const note = await reviewConversationQuality(
      context.project.id,
      parsed.data.conversationId,
    );
    const finding = await createConversationDiagnosticFinding({
      ...parsed.data,
      authorUserId: context.user.id,
      category: "ai_review",
      note,
    });
    await writeAuditLog({
      ...context,
      action: "conversation.quality_ai_review_drafted",
      targetType: "conversation_diagnostic_finding",
      targetId: finding.id,
      metadata: { conversationId: parsed.data.conversationId },
    });
    revalidatePath("/projects/diagnostics");
    return {
      success:
        "AI review draft saved below. Verify it before creating a correction or regression case.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not prepare review.",
    };
  }
}
