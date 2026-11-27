import { crossPriceFindings, crossPricePlan } from "./knowledge-import-cross-prices";
import { reviewCrossPrices } from "./knowledge-import-suggestions";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db-config";
import { documents, sourceDocuments, uploadJobs } from "@/lib/db-schema";
import {
  createKnowledgeImportReview,
  extractKnowledgeAnswers,
  inspectKnowledgeImport,
  knowledgeImportReviewSchema,
  type KnowledgeImportReview,
  knowledgeTextSchema,
} from "@/lib/knowledge-import";
import { approvedQuestionKeys, normalizeKnowledgeQuestion } from "@/lib/project-ai-settings";
import { conflictingImportPrices, indexImportPrices, prosePriceLines } from "@/lib/knowledge-import-prices";

export async function getKnowledgeImport(
  projectId: number,
  documentId: number,
) {
  const [document] = await db
    .select()
    .from(sourceDocuments)
    .where(
      and(
        eq(sourceDocuments.id, documentId),
        eq(sourceDocuments.projectId, projectId),
      ),
    )
    .limit(1);
  return document ?? null;
}

export async function startKnowledgeReview(
  projectId: number,
  documentId: number,
) {
  return db.transaction(async (tx) => {
    const [document] = await tx
      .select()
      .from(sourceDocuments)
      .where(
        and(
          eq(sourceDocuments.id, documentId),
          eq(sourceDocuments.projectId, projectId),
        ),
      )
      .for("update");
    if (!document) throw new Error("Document not found.");
    if (["queued", "processing"].includes(document.processingStatus))
      throw new Error("Wait for indexing to finish before editing.");
    if (document.importReview) return;
    const chunks = await tx
      .select({ content: documents.content })
      .from(documents)
      .where(
        and(
          eq(documents.projectId, projectId),
          eq(documents.sourceDocumentId, documentId),
        ),
      )
      .orderBy(asc(documents.id));
    const text = chunks.map((chunk) => chunk.content).join("\n\n");
    if (!text.trim())
      throw new Error(
        "Upload the original document again to prepare a review.",
      );
    await tx
      .update(sourceDocuments)
      .set({
        importReview: createKnowledgeImportReview(text),
        processingStatus: "review",
      })
      .where(
        and(
          eq(sourceDocuments.id, documentId),
          eq(sourceDocuments.projectId, projectId),
        ),
      );
  });
}

export async function saveKnowledgeDraft(input: {
  projectId: number;
  documentId: number;
  revision: number;
  text: string;
  priceReview?: KnowledgeImportReview["priceReview"];
  crossPriceReview?: KnowledgeImportReview["crossPriceReview"];
}) {
  const draftText = knowledgeTextSchema.parse(input.text);
  return db.transaction(async (tx) => {
    const [document] = await tx
      .select()
      .from(sourceDocuments)
      .where(
        and(
          eq(sourceDocuments.id, input.documentId),
          eq(sourceDocuments.projectId, input.projectId),
        ),
      )
      .for("update");
    const review = knowledgeImportReviewSchema.safeParse(
      document?.importReview,
    );
    if (!document || !review.success)
      throw new Error("Document review not found.");
    if (["queued", "processing"].includes(document.processingStatus))
      throw new Error("Wait for indexing to finish before editing.");
    if (review.data.revision !== input.revision)
      throw new Error("This review changed. Reload before saving.");
    await tx
      .update(sourceDocuments)
      .set({
        processingStatus: "review",
        processingError: null,
        importReview: {
          ...review.data,
          draftText,
          priceReview: input.priceReview,
          crossPriceReview: input.crossPriceReview,
          priceReviewVersion: input.priceReview !== undefined ? 2 : undefined,
          revision: input.revision + 1,
          approvedAt: null,
          approvedByUserId: null,
        },
      })
      .where(
        and(
          eq(sourceDocuments.id, input.documentId),
          eq(sourceDocuments.projectId, input.projectId),
        ),
      );
  });
}

function otherReviewSources(projectId: number, documentId: number | null, client: Pick<typeof db, "select"> = db) {
  return client.select({ id: sourceDocuments.id, title: sourceDocuments.title, review: sourceDocuments.importReview })
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.projectId, projectId), documentId === null ? undefined : ne(sourceDocuments.id, documentId)));
}

export async function checkCrossDocumentPrices(
  projectId: number, documentId: number | null, text: string, pilot?: boolean,
  previous?: KnowledgeImportReview["crossPriceReview"],
) {
  if (!pilot || !prosePriceLines(text).size) return undefined;
  const others = await otherReviewSources(projectId, documentId);
  if (conflictingAnswers(text, others, true).length) return undefined;
  const plan = crossPricePlan(text, others);
  return plan ? reviewCrossPrices(projectId, plan, previous) : undefined;
}

export async function inspectProjectPriceAndAnswerConflicts(
  projectId: number, documentId: number, text: string, preserveHeadings = false,
  crossReview?: KnowledgeImportReview["crossPriceReview"],
) {
  const others = await otherReviewSources(projectId, documentId);
  return reviewConflicts(text, others, preserveHeadings, crossReview);
}

function reviewConflicts(
  text: string, others: Awaited<ReturnType<typeof otherReviewSources>>,
  pilot?: boolean, crossReview?: KnowledgeImportReview["crossPriceReview"],
) {
  const conflicts = conflictingAnswers(text, others, pilot);
  if (conflicts.length || !pilot) return { conflicts, manualSources: [] };
  const plan = crossPricePlan(text, others);
  const manualSources = plan && crossReview?.fingerprint === plan.fingerprint && crossReview.manual
    ? [...new Set(plan.texts.map(source => source.title))] : [];
  return { conflicts: crossPriceFindings(plan, crossReview), manualSources };
}

function conflictingAnswers(
  text: string,
  others: Array<{ title: string; review: unknown }>,
  preserveHeadings = false,
) {
  const candidates = extractKnowledgeAnswers(text, preserveHeadings);
  const prices = preserveHeadings ? indexImportPrices(text) : undefined;
  const conflicts: string[] = [];
  for (const other of others) {
    const review = knowledgeImportReviewSchema.safeParse(other.review);
    if (!review.success) continue;
    if (prices?.size) {
      const { publishedText, approvedAt, draftText } = review.data;
      // Both versions matter while a replacement is queued. An unapproved
      // edit cannot displace or reserve a price.
      for (const version of new Set([publishedText, approvedAt ? draftText : null])) {
        if (!version) continue;
        for (const match of conflictingImportPrices(version, prices)) {
          conflicts.push(
            'Price differs from "' + other.title + '". Update the existing rate or clarify when each rate applies.' +
            "\n\nThis draft\n" + match.previous + "\n\n" + other.title + "\n" + match.current,
          );
        }
      }
    }
    const answers = [
      ...review.data.publishedAnswers,
      ...(review.data.approvedAt
        ? extractKnowledgeAnswers(
            review.data.draftText,
            review.data.preserveHeadings,
          )
        : []),
    ];
    for (const answer of candidates) {
      if (
        answers.some(
          (existing) =>
            existing.key === answer.key && existing.answer !== answer.answer,
        )
      )
        conflicts.push(`"${answer.question}" differs from "${other.title}".`);
    }
  }
  return [...new Set(conflicts)];
}

export async function approveKnowledgeImport(input: {
  projectId: number;
  documentId: number;
  revision: number;
  userId: number;
}) {
  return db.transaction(async (tx) => {
    // Serialise publication per project so two documents cannot approve
    // contradictory exact answers concurrently.
    await tx.execute(
      sql`select pg_advisory_xact_lock(7824, ${input.projectId})`,
    );
    const [document] = await tx
      .select()
      .from(sourceDocuments)
      .where(
        and(
          eq(sourceDocuments.id, input.documentId),
          eq(sourceDocuments.projectId, input.projectId),
        ),
      )
      .for("update");
    const review = knowledgeImportReviewSchema.safeParse(
      document?.importReview,
    );
    if (!document || !review.success)
      throw new Error("Document review not found.");
    if (review.data.revision !== input.revision)
      throw new Error("This review changed. Reload and review it again.");
    if (["queued", "processing"].includes(document.processingStatus)) return;
    const issues = inspectKnowledgeImport(
      review.data.draftText,
      review.data.preserveHeadings,
      review.data.priceReview,
    );
    if (
      issues.some(
        (issue) => issue.code === "conflict" || issue.code === "wording",
      )
    )
      throw new Error(
        "Resolve conflicting answers and source-report wording before publishing.",
      );
    const others = await otherReviewSources(input.projectId, input.documentId, tx);
    const { conflicts } = reviewConflicts(review.data.draftText, others, review.data.preserveHeadings, review.data.crossPriceReview);
    if (conflicts.length)
      throw new Error(
        `Resolve conflicting answers before publishing: ${conflicts[0]}`,
      );
    await tx
      .update(sourceDocuments)
      .set({
        processingStatus: "queued",
        processingError: null,
        importReview: {
          ...review.data,
          approvedByUserId: input.userId,
          approvedAt: new Date().toISOString(),
        },
      })
      .where(
        and(
          eq(sourceDocuments.id, input.documentId),
          eq(sourceDocuments.projectId, input.projectId),
        ),
      );
    await tx
      .delete(uploadJobs)
      .where(
        and(
          eq(uploadJobs.projectId, input.projectId),
          eq(uploadJobs.sourceDocumentId, input.documentId),
        ),
      );
    await tx.insert(uploadJobs).values({
      projectId: input.projectId,
      sourceDocumentId: input.documentId,
      textContent: review.data.draftText,
    });
  });
}

// Only published, source-owned answers are eligible. No client/domain-specific
// branches and no model call to rewrite an answer at conversation time.
export async function getImportedKnowledgeAnswers(
  projectId: number,
  question: string,
) {
  const { exact, equivalent } = approvedQuestionKeys(question);
  const keys = [...new Set([...exact, ...equivalent])];
  const rows = await db.execute<{ question: string; answer: string }>(sql`
    select matched.question, matched.answer from ${sourceDocuments} d
    cross join lateral (
      select a->>'question' as question, a->>'answer' as answer
      from jsonb_array_elements(d.import_review->'publishedAnswers') a
      where a->>'key' in (${sql.join(keys.map(key => sql`${key}`), sql`, `)})
      union all
      select v->>'question', a->>'answer'
      from jsonb_array_elements(d.import_review->'faqVariants') v
      join jsonb_array_elements(d.import_review->'publishedAnswers') a
        on a->>'question' = v->>'sourceQuestion' and a->>'answer' = v->>'sourceAnswer'
      where d.import_review->>'preserveHeadings' = 'true' and v->>'status' = 'approved'
        and v->>'question' = ${question.trim()}
    ) matched
    where d.project_id = ${projectId}
  `);
  // Fail closed if old/manual data somehow contains a contradiction.
  const literal = rows.filter((row) => exact.includes(normalizeKnowledgeQuestion(row.question)));
  const matches = literal.length ? literal : rows;
  if (new Set(matches.map((row) => row.answer)).size > 1) return [];
  return matches.slice(0, 2);
}
