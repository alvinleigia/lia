import Link from "next/link";
import {
  recordQualityFeedback,
  requestQualityReview,
} from "@/app/projects/diagnostics/actions";
import {
  ActionFormError,
  ActionFormSuccessToast,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  QUALITY_FEEDBACK,
  type QualityMessage,
  qualityNextStep,
} from "@/lib/conversation-quality";
import type {
  getConversationQualityEvidence,
  getProjectQualityDashboard,
} from "@/lib/conversation-quality-store";

type QualityRows = Awaited<ReturnType<typeof getProjectQualityDashboard>>;
export function ConversationQualityOverview({
  rows,
  filter,
}: {
  rows: QualityRows;
  filter: string;
}) {
  const visible = rows.filter((r) =>
    filter === "pending"
      ? r.flags.length > 0 && !r.reviewed
      : filter === "sample"
        ? r.sample
        : true,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quality review queue</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Checks refresh when you open this page: the latest 50 conversations
          and up to 100 recent messages each. Flags are review signals, not
          proven mistakes. No LLM is called automatically.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <span>{rows.length} conversations scanned</span>
          <span>
            {rows.filter((r) => r.flags.length && !r.reviewed).length} flagged,
            awaiting review
          </span>
          <span>
            {rows.filter((r) => r.reviewed).length} reviewed since last activity
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "pending", "sample"] as const).map((value) => (
            <Button
              key={value}
              asChild
              size="sm"
              variant={filter === value ? "default" : "outline"}
            >
              <Link href={`/projects/diagnostics?quality=${value}`}>
                {value === "all"
                  ? "Recent"
                  : value === "pending"
                    ? "Needs review"
                    : "10% sample"}
              </Link>
            </Button>
          ))}
          <Button asChild size="sm" variant="outline">
            <Link href="/projects/diagnostics/evaluations">
              Regression checks
            </Link>
          </Button>
        </div>
        {!visible.length ? (
          <p className="text-sm">No conversations in this view.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {visible.map((row) => (
              <Link
                className="rounded-md border p-3 text-sm hover:bg-accent/40"
                key={row.id}
                href={`/projects/diagnostics?conversationId=${row.id}&quality=${filter}#quality-review`}
              >
                <p className="font-medium">
                  {row.channel.replaceAll("_", " ")} #{row.id}
                </p>
                <p>
                  {row.flags.length
                    ? [
                        ...new Set(
                          row.flags.map((f) => f.code.replaceAll("_", " ")),
                        ),
                      ].join(", ")
                    : "No rule flags; not a quality certification"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.reviewed
                    ? "Reviewed since last activity"
                    : "Review pending"}
                  {row.sample ? " · Sample" : ""}
                </p>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ConversationQualityReview({
  projectId,
  conversationId,
  row,
  messages,
  evidence,
}: {
  projectId: number;
  conversationId: number;
  row?: QualityRows[number];
  messages: QualityMessage[];
  evidence: Awaited<ReturnType<typeof getConversationQualityEvidence>>;
}) {
  const replies = messages
    .filter((m) => m.direction === "outbound" && m.text)
    .slice(-30);
  return (
    <Card id="quality-review">
      <CardHeader>
        <CardTitle>Review this conversation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          The transcript shows up to 200 recent messages with collected values
          redacted. Check possible context loss against the task state below.
        </p>
        {row?.flags.length ? (
          <div className="space-y-2">
            {row.flags.map((flag, i) => (
              <div
                className="rounded-md border p-3 text-sm"
                key={`${flag.code}-${flag.messageId}-${i}`}
              >
                <p className="font-semibold">
                  {flag.code.replaceAll("_", " ")}
                  {flag.messageId ? ` · reply #${flag.messageId}` : ""}
                </p>
                <p>{flag.detail}</p>
                <p className="mt-1 text-muted-foreground">
                  {qualityNextStep(flag.code)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm">
            No automatic flags in the scanned messages. Human review can still
            find problems.
          </p>
        )}
        {replies.length > 0 && (
          <ActionStateForm action={recordQualityFeedback} className="space-y-3">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="conversationId" value={conversationId} />
            <Label htmlFor="quality-reply">Bot reply</Label>
            <Select
              name="messageId"
              defaultValue={String(replies[replies.length - 1].id)}
            >
              <SelectTrigger id="quality-reply" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {replies.map((reply) => (
                  <SelectItem key={reply.id} value={String(reply.id)}>
                    #{reply.id}: {reply.text?.slice(0, 95)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label htmlFor="quality-note">
              Review note or expected behaviour (optional)
            </Label>
            <Textarea
              id="quality-note"
              name="note"
              maxLength={2000}
              rows={3}
              placeholder="Describe the correction using synthetic examples, without personal information."
            />
            <ActionFormError />
            <ActionFormSuccessToast />
            <div className="flex flex-wrap gap-2">
              {Object.entries(QUALITY_FEEDBACK).map(([value, label]) => (
                <Button
                  type="submit"
                  variant="outline"
                  name="category"
                  value={value}
                  key={value}
                >
                  {label}
                </Button>
              ))}
            </div>
          </ActionStateForm>
        )}
        {(Boolean(row?.flags.length) || row?.sample) && (
          <ActionStateForm
            action={requestQualityReview}
            className="space-y-2 rounded-md border p-3"
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="conversationId" value={conversationId} />
            <p className="text-sm">
              Optional AI review uses one metered call on up to 30 redacted
              messages. Its findings are suggestions, not verified facts. Review
              usage is recorded separately from customer-chat metrics.
            </p>
            <ActionFormError />
            <ActionFormSuccessToast />
            <FormSubmitButton
              label="Prepare AI review draft"
              pendingLabel="Reviewing..."
            />
          </ActionStateForm>
        )}
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Recorded processing evidence
          </summary>
          <p className="my-2 text-muted-foreground">
            New structured turns record processing time, model tokens and
            knowledge reference IDs below. Historical turns may lack these
            records. Reference IDs identify evidence, not a fact-check. Dollar
            costs are not inferred from tokens; missing usage is not zero cost.
          </p>
          {evidence.timings.slice(0, 10).map((t) => (
            <p key={t.id}>
              Event #{t.id}: {t.status}; received {t.receivedAt.toISOString()}
            </p>
          ))}
          {evidence.events.slice(0, 10).map((e) => (
            <p key={e.id}>
              {e.eventType} · run {e.taskRunId ?? "none"}
              {e.status ? ` · ${e.status}` : ""}
              {e.grounding ? ` · ${e.grounding}` : ""}
              {e.turn &&
                ` · ${e.turn.stage} · ${e.turn.source} · ${e.turn.latencyMs} ms · ${e.turn.totalTokens ?? "unknown"} tokens · references: ${e.turn.referenceIds.join(", ") || "none"}`}
            </p>
          ))}
          {!evidence.timings.length && !evidence.events.length && (
            <p>No linked processing events recorded.</p>
          )}
        </details>
        <p className="text-sm">
          Feedback and AI review drafts appear under Recorded findings. Add a
          synthetic regression case there, test a candidate change, and review
          the result before publishing. This page never changes live knowledge
          or workflows.
        </p>
      </CardContent>
    </Card>
  );
}
