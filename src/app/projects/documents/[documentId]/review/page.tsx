import Link from "next/link";
import { notFound } from "next/navigation";
import { recurringFaqAction, updateKnowledgeReviewAction } from "@/app/projects/documents/review-actions";
import { processQueuedDocumentsAction } from "@/app/upload/actions";
import {
  ActionFormError,
  ActionFormSuccessToast,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { assertPermission, canAccess } from "@/lib/access-control";
import { resolveStrictUserAndProject } from "@/lib/auth-project";
import {
  extractKnowledgeAnswers,
  inspectKnowledgeImport,
  knowledgeImportReviewSchema,
} from "@/lib/knowledge-import";
import {
  inspectProjectPriceAndAnswerConflicts,
  getKnowledgeImport,
} from "@/lib/knowledge-import-store";

export default async function KnowledgeReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ projectId?: string }>;
}) {
  const [{ documentId }, { projectId }] = await Promise.all([
    params,
    searchParams,
  ]);
  if (!projectId || !/^\d+$/.test(projectId) || !/^\d+$/.test(documentId))
    notFound();
  const context = await resolveStrictUserAndProject(projectId);
  assertPermission(context.membership, "company.documents.manage");
  const document = await getKnowledgeImport(
    context.project.id,
    Number(documentId),
  );
  if (!document) notFound();
  const result = knowledgeImportReviewSchema.safeParse(document.importReview);
  const review = result.success ? result.data : null;
  const issues = review
    ? inspectKnowledgeImport(review.draftText, review.preserveHeadings, review.priceReview)
    : [];
  const { conflicts, manualSources } = review
    ? await inspectProjectPriceAndAnswerConflicts(
        context.project.id,
        document.id,
        review.draftText,
        review.preserveHeadings,
        review.crossPriceReview,
      )
    : { conflicts: [], manualSources: [] };
  if (manualSources.length) issues.push({
    code: "uncertain", line: 0, excerpt: manualSources.join("\n"),
    message: "Compare the prices and conditions in these documents before approving, or save this draft again to retry.",
  });
  const busy = ["queued", "processing"].includes(document.processingStatus);
  const blocked =
    issues.some((issue) => ["wording", "conflict"].includes(issue.code)) ||
    conflicts.length > 0;
  const identifiers = (
    <>
      <input type="hidden" name="projectId" value={context.project.id} />
      <input type="hidden" name="documentId" value={document.id} />
      <input type="hidden" name="revision" value={review?.revision ?? 0} />
    </>
  );
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <Link href="/projects/documents" className="underline">
        Back to documents
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Review knowledge: {document.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>
            Check how your business will answer customers. New text stays out of
            chat until you approve and index it. Existing published content
            stays available meanwhile.
          </p>
          <p className="text-sm text-muted-foreground">
            Automatic checks help find issues; they cannot verify business facts
            or catch every contradiction.
            {review?.preserveHeadings && " Saving a draft with differently worded prose prices can use one metered AI comparison."}
          </p>
          <p>Status: {document.processingStatus}</p>
          {document.processingError && (
            <p role="alert" className="text-red-700">
              {document.processingError}
            </p>
          )}
          {!review && (
            <ActionStateForm action={updateKnowledgeReviewAction}>
              {identifiers}
              <input type="hidden" name="intent" value="start" />
              <ActionFormError />
              <p className="mb-4">
                This older upload has no saved original. Review starts from its
                indexed text, which may include overlapping passages.
              </p>
              <FormSubmitButton
                label="Prepare review"
                pendingLabel="Preparing..."
                disabled={busy}
              />
            </ActionStateForm>
          )}
          {busy && (
            <form action={processQueuedDocumentsAction}>
              <input
                type="hidden"
                name="projectId"
                value={context.project.id}
              />
              <FormSubmitButton
                label="Process approved documents"
                pendingLabel="Indexing..."
              />
            </form>
          )}
        </CardContent>
      </Card>
      {review && (
        <>
          {review.preserveHeadings && review.publishedAnswers.length > 0 && canAccess(context.membership, "company.operations.manage") && (
            <Card>
              <CardHeader><CardTitle>Recurring visitor questions</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p>Compare questions asked in at least two conversations in this project over the last 30 days with this document’s published FAQs. Approve a match only if the answer covers the entire question.</p>
                <ActionStateForm action={recurringFaqAction}>
                  {identifiers}
                  <input type="hidden" name="variantRevision" value={review.faqVariantRevision ?? 0} />
                  <input type="hidden" name="intent" value="find" />
                  <ActionFormError /><ActionFormSuccessToast />
                  <FormSubmitButton label="Find recurring questions" pendingLabel="Comparing..."
                    disabled={busy || review.faqVariants?.some(v => v.status === "suggested")} />
                  <p className="mt-2 text-sm text-muted-foreground">Uses up to one AI call to suggest up to five matches. Approved wording uses the published answer directly.</p>
                </ActionStateForm>
                {review.faqVariants?.filter(v => v.status !== "dismissed").map(v => (
                  <article key={v.question} className="space-y-2 rounded-md border p-3">
                    <p className="font-medium">{v.question}</p>
                    <p className="text-sm text-muted-foreground">{v.frequency} conversations at review time · {v.status === "approved" ? "Approved" : "Suggested"}</p>
                    <p><strong>Published question</strong> {v.sourceQuestion}</p>
                    <p className="whitespace-pre-wrap"><strong>Answer</strong> {v.sourceAnswer}</p>
                    <ActionStateForm action={recurringFaqAction} className="space-x-2">
                      {identifiers}
                      <input type="hidden" name="variantRevision" value={review.faqVariantRevision ?? 0} />
                      <input type="hidden" name="question" value={v.question} />
                      <ActionFormError /><ActionFormSuccessToast />
                      {v.status === "suggested" && <Button type="submit" name="intent" value="approve" disabled={busy}>Approve match</Button>}
                      <Button type="submit" name="intent" value="dismiss" variant="outline" disabled={busy}>
                        {v.status === "approved" ? "Withdraw approval" : "Dismiss"}
                      </Button>
                    </ActionStateForm>
                  </article>
                ))}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>
                Items to check ({issues.length + conflicts.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!issues.length && !conflicts.length && (
                <p>
                  No rule-based issues found. Please verify the facts before
                  approval.
                </p>
              )}
              {conflicts.map((message) => (
                <p key={message} className="whitespace-pre-wrap text-red-700">
                  {message}
                </p>
              ))}
              <div className="max-h-96 overflow-auto space-y-3">
                {issues.map((issue, index) => (
                  <div
                    key={`${issue.line}-${issue.code}-${index}`}
                    className="rounded-md border p-3"
                  >
                    <p className="font-medium">
                      {issue.line ? `Line ${issue.line}: ` : ""}
                      {issue.message}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {issue.excerpt}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Customer-facing draft</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <details>
                <summary className="cursor-pointer">
                  Compare with original text
                </summary>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-sm">
                  {review.originalText}
                </pre>
              </details>
              <ActionStateForm
                action={updateKnowledgeReviewAction}
                resetKey={review.revision}
                className="space-y-4"
              >
                {identifiers}
                <ActionFormError />
                <ActionFormSuccessToast />
                <Label htmlFor="draftText">Reviewed text</Label>
                <Textarea
                  id="draftText"
                  name="draftText"
                  defaultValue={review.draftText}
                  rows={22}
                  maxLength={200_000}
                  required
                  disabled={busy}
                />
                <p className="text-sm text-muted-foreground">
                  Use Q: Question A: Answer or Question =&gt; Answer for
                  reusable FAQs. Other text remains searchable knowledge. Keep
                  uncertain details explicit.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="submit"
                    name="intent"
                    value="save"
                    disabled={busy}
                  >
                    Save and check draft
                  </Button>
                  <Button
                    type="submit"
                    name="intent"
                    value="suggest"
                    disabled={
                      busy || !issues.some((issue) => issue.code === "wording")
                    }
                  >
                    Suggest wording with AI
                  </Button>
                  {review.preserveHeadings && (
                    <Button type="submit" name="intent" value="faqs" disabled={busy}>
                      Suggest FAQs
                    </Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Wording suggestions cover up to 12 flagged lines per request.
                  {review.preserveHeadings && " FAQ suggestions add up to 12 questions to your draft. Check each answer against its source section, including fees and exceptions, before approving."}
                  {" "}Each AI request uses one metered call.
                </p>
              </ActionStateForm>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Approve saved draft</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4">
                {
                  extractKnowledgeAnswers(
                    review.draftText,
                    review.preserveHeadings,
                  ).length
                }{" "}
                explicit FAQ answers found. Published answers stay linked to
                this document and are removed when it is deleted.
              </p>
              <ActionStateForm
                action={updateKnowledgeReviewAction}
                resetKey={`approval-${review.revision}-${document.processingStatus}`}
                className="space-y-4"
              >
                {identifiers}
                <input type="hidden" name="intent" value="publish" />
                <ActionFormError />
                <ActionFormSuccessToast />
                <Label className="flex items-start gap-3" htmlFor="confirmed">
                  <Input
                    id="confirmed"
                    name="confirmed"
                    type="checkbox"
                    required
                    className="h-4 w-4 shrink-0"
                    disabled={busy || blocked}
                  />
                  I reviewed this saved draft, checked the facts and flagged
                  limitations, and approve it for customer answers.
                  {(review.priceReview === "manual" || manualSources.length > 0) && " I manually compared the prose prices and their conditions."}
                </Label>
                {blocked && (
                  <p className="text-sm text-red-700">
                    Resolve wording and conflicting answers, then save the draft
                    before approval.
                  </p>
                )}
                <FormSubmitButton
                  label="Approve and queue indexing"
                  pendingLabel="Approving..."
                  disabled={busy || blocked}
                />
              </ActionStateForm>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
