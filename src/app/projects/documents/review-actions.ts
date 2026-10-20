"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import type { ActionFormState } from "@/lib/action-form-state";
import { writeAuditLog } from "@/lib/audit";
import { resolveStrictUserAndProject } from "@/lib/auth-project";
import { knowledgeTextSchema } from "@/lib/knowledge-import";
import {
  approveKnowledgeImport,
  getKnowledgeImport,
  saveKnowledgeDraft,
  startKnowledgeReview,
} from "@/lib/knowledge-import-store";
import { suggestKnowledgeWording } from "@/lib/knowledge-import-suggestions";

const reviewActionSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  documentId: z.coerce.number().int().positive(),
  revision: z.coerce.number().int().nonnegative(),
  intent: z.enum(["start", "save", "suggest", "publish"]),
});

export async function updateKnowledgeReviewAction(
  _state: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const parsed = reviewActionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid document review request." };
  try {
    const input = parsed.data;
    const context = await resolveStrictUserAndProject(input.projectId);
    assertPermission(context.membership, "company.documents.manage");
    const document = await getKnowledgeImport(
      context.project.id,
      input.documentId,
    );
    if (!document) return { error: "Document not found." };
    if (input.intent === "start") {
      await startKnowledgeReview(context.project.id, document.id);
    } else if (input.intent === "publish") {
      if (formData.get("confirmed") !== "on")
        return {
          error:
            "Confirm that you reviewed the wording, facts and flagged limitations.",
        };
      await approveKnowledgeImport({ ...input, userId: context.user.id });
    } else {
      if (["queued", "processing"].includes(document.processingStatus))
        return { error: "Wait for indexing to finish before editing." };
      const text = knowledgeTextSchema.safeParse(formData.get("draftText"));
      if (!text.success)
        return {
          error:
            "Enter between 1 and 200,000 characters. Your draft has not been published.",
        };
      if (input.revision !== document.importReview?.revision)
        return { error: "This review changed. Reload before saving." };
      const draftText =
        input.intent === "suggest"
          ? await suggestKnowledgeWording(context.project.id, text.data)
          : text.data;
      await saveKnowledgeDraft({ ...input, text: draftText });
    }
    await writeAuditLog({
      ...context,
      action: `document.review_${input.intent}`,
      targetType: "source_document",
      targetId: document.id,
      metadata: { revision: input.revision },
    });
    revalidatePath("/projects/documents");
    revalidatePath(`/projects/documents/${document.id}/review`);
    return {
      success:
        input.intent === "publish"
          ? "Approved and queued. Process queued documents to make this version available to chat."
          : input.intent === "suggest"
            ? "Suggestions saved as a draft. Review every change before publishing."
            : "Review saved. Nothing new has been published.",
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not save this review.",
    };
  }
}
