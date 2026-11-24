import { and, asc, eq, ne, sql } from "drizzle-orm";
import { stripKnowledgeDiscoursePrefix } from "@/lib/conversation-control-intents";
import { db } from "@/lib/db-config";
import { documents, sourceDocuments, uploadJobs } from "@/lib/db-schema";
import {
  createKnowledgeImportReview,
  extractKnowledgeAnswers,
  inspectKnowledgeImport,
  knowledgeImportReviewSchema,
  knowledgeTextSchema,
} from "@/lib/knowledge-import";
import { normalizeKnowledgeQuestion } from "@/lib/project-ai-settings";

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

export async function findKnowledgeAnswerConflicts(
  projectId: number,
  documentId: number,
  text: string,
) {
  const others = await db
    .select({
      title: sourceDocuments.title,
      review: sourceDocuments.importReview,
    })
    .from(sourceDocuments)
    .where(
      and(
        eq(sourceDocuments.projectId, projectId),
        ne(sourceDocuments.id, documentId),
      ),
    );
  return conflictingAnswers(text, others);
}

function conflictingAnswers(
  text: string,
  others: Array<{ title: string; review: unknown }>,
) {
  const candidates = extractKnowledgeAnswers(text);
  const conflicts: string[] = [];
  for (const other of others) {
    const review = knowledgeImportReviewSchema.safeParse(other.review);
    if (!review.success) continue;
    const answers = [
      ...review.data.publishedAnswers,
      ...(review.data.approvedAt
        ? extractKnowledgeAnswers(review.data.draftText)
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
    const issues = inspectKnowledgeImport(review.data.draftText);
    if (
      issues.some(
        (issue) => issue.code === "conflict" || issue.code === "wording",
      )
    )
      throw new Error(
        "Resolve conflicting answers and source-report wording before publishing.",
      );
    const others = await tx
      .select({
        title: sourceDocuments.title,
        review: sourceDocuments.importReview,
      })
      .from(sourceDocuments)
      .where(
        and(
          eq(sourceDocuments.projectId, input.projectId),
          ne(sourceDocuments.id, input.documentId),
        ),
      );
    const conflicts = conflictingAnswers(review.data.draftText, others);
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
  const keys = [
    ...new Set(
      [question, stripKnowledgeDiscoursePrefix(question)].map(
        normalizeKnowledgeQuestion,
      ),
    ),
  ];
  const rows = await db.execute<{ question: string; answer: string }>(sql`
    select a->>'question' as question, a->>'answer' as answer
    from ${sourceDocuments},
    jsonb_array_elements(coalesce(${sourceDocuments.importReview}->'publishedAnswers', '[]'::jsonb)) a
    where ${sourceDocuments.projectId} = ${projectId}
      and a->>'key' in (${sql.join(
        keys.map((key) => sql`${key}`),
        sql`, `,
      )})
  `);
  // Fail closed if old/manual data somehow contains a contradiction.
  if (new Set(rows.map((row) => row.answer)).size > 1) return [];
  return rows.slice(0, 2);
}
