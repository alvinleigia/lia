import { and, eq, sql } from "drizzle-orm";
import { redactDiagnosticText } from "./conversation-diagnostics";
import { db } from "./db-config";
import { channelConversations, channelMessages, sourceDocuments } from "./db-schema";
import { knowledgeImportReviewSchema } from "./knowledge-import";
import { matchRecurringFaqs } from "./knowledge-import-suggestions";
import { normalizeKnowledgeQuestion } from "./project-ai-settings";

type ReviewInput = { projectId: number; documentId: number; revision: number; variantRevision: number };
type VariantAction = { intent: "find" } | { intent: "approve" | "dismiss"; question: string };

export async function recentFaqQuestions(projectId: number, excluded: string[]) {
  const rows = await db.execute<{ question: string; frequency: number }>(sql`
    select trim(m.text) as question, count(distinct m.conversation_id)::int as frequency
    from ${channelMessages} m join ${channelConversations} c on c.id = m.conversation_id
    where m.project_id = ${projectId} and c.project_id = ${projectId}
      and m.direction = 'inbound' and m.message_type = 'text'
      and m.created_at >= now() - interval '30 days' and length(m.text) between 8 and 240
    group by trim(m.text) having count(distinct m.conversation_id) >= 2
    order by frequency desc, question limit 250
  `);
  const seen = new Set(excluded.map(normalizeKnowledgeQuestion));
  return rows.filter(({ question }) => {
    const key = normalizeKnowledgeQuestion(question);
    const isQuestion = /[?？]\s*$|^(?:how|what|when|where|why|which|can|could|is|are|do|does)\b/i.test(question);
    const secondQuestion = /[?？]\s*\S|\b(?:and|or|also|plus)\s+(?:how|what|when|where|why|which|who|can|could|is|are|do|does|will|would)\b/i.test(question);
    if (!key || seen.has(key) || !isQuestion || secondQuestion || redactDiagnosticText(question) !== question ||
      /[\r\n@]|https?:|www\.|\b(?:my name is|my address|booking ref(?:erence)?|order (?:id|number)|account number)\b/i.test(question)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
}

export async function reviewRecurringFaqs(input: ReviewInput, action: VariantAction) {
  const scope = and(eq(sourceDocuments.projectId, input.projectId), eq(sourceDocuments.id, input.documentId));
  function read(document?: typeof sourceDocuments.$inferSelect) {
    const review = knowledgeImportReviewSchema.safeParse(document?.importReview);
    if (!document || !review.success || !review.data.preserveHeadings || !review.data.publishedAnswers.length)
      throw new Error("Publish FAQs in a pilot document before reviewing recurring questions.");
    if (["queued", "processing"].includes(document.processingStatus) || review.data.revision !== input.revision ||
      (review.data.faqVariantRevision ?? 0) !== input.variantRevision)
      throw new Error("The document review changed. Reload before continuing.");
    return review.data;
  }
  let suggestions: Awaited<ReturnType<typeof matchRecurringFaqs>> = [];
  if (action.intent === "find") {
    const [document] = await db.select().from(sourceDocuments).where(scope);
    const review = read(document);
    const existing = review.faqVariants ?? [];
    if (existing.some(v => v.status === "suggested")) throw new Error("Review the pending questions first.");
    if (existing.length >= 100) throw new Error("This pilot document has reached its 100-question review limit.");
    const phrases = await recentFaqQuestions(input.projectId, [...existing, ...review.publishedAnswers].map(v => v.question));
    suggestions = (await matchRecurringFaqs(input.projectId, phrases, review.publishedAnswers)).slice(0, 100 - existing.length);
    if (!suggestions.length) return "No new matching questions found.";
  }
  return db.transaction(async tx => {
    const [document] = await tx.select().from(sourceDocuments).where(scope).for("update");
    const review = read(document);
    const variants = review.faqVariants ?? [];
    if (action.intent === "find") {
      if (!suggestions.every(v => review.publishedAnswers.some(f => f.question === v.sourceQuestion && f.answer === v.sourceAnswer)))
        throw new Error("The published FAQs changed. Find questions again.");
      variants.push(...suggestions);
    } else {
      const variant = variants.find(v => v.question === action.question);
      if (!variant || variant.status === "dismissed" || (action.intent === "approve" && variant.status !== "suggested"))
        throw new Error("This suggestion has already been reviewed.");
      variant.status = action.intent === "approve" ? "approved" : "dismissed";
    }
    await tx.update(sourceDocuments).set({ importReview: {
      ...review, faqVariants: variants, faqVariantRevision: input.variantRevision + 1,
    } }).where(scope);
    if (action.intent === "find") return `${suggestions.length} suggested for review.`;
    return action.intent === "approve" ? "Approved for chat." : "Question dismissed.";
  });
}
