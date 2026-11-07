import Link from "next/link";
import { notFound } from "next/navigation";
import { LeadInboxSelect } from "@/components/lead-inbox-select";
import {
  ActionFormError,
  ActionFormSuccessToast,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listActionSubmissionEvents } from "@/lib/action-flows";
import { listRecentChannelMessages } from "@/lib/channels";
import { listCompanyMembers } from "@/lib/invitations";
import { formatLeadFieldValue, LEAD_STATUS_LABELS } from "@/lib/lead-inbox";
import { getInboxLead, getInboxLeadConversation } from "@/lib/lead-inbox-data";
import { resolvePageUserAndWorkspace } from "@/lib/protected-page";
import { formatDateTimeInTimeZone } from "@/lib/time-zones";
import { updateInboxLeadAction } from "../actions";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const id = Number(leadId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const { company, workspace } = await resolvePageUserAndWorkspace();
  const lead = await getInboxLead(
    { companyId: company.id, workspaceId: workspace.id },
    id,
  );
  if (!lead) notFound();
  const [members, events, linked] = await Promise.all([
    listCompanyMembers(company.id),
    listActionSubmissionEvents(lead.project.id, id),
    getInboxLeadConversation(lead.project.id, lead.submission),
  ]);
  const messages = linked
    ? await listRecentChannelMessages({
        projectId: lead.project.id,
        conversationId: linked.conversation.id,
        limit: 50,
      })
    : [];
  const activeMembers = members.filter(
    ({ membership }) => membership.status === "active",
  );
  const assigned = members.find(
    ({ user }) => user.id === lead.management.assignedUserId,
  );
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <Button asChild variant="outline">
          <Link href="/projects/leads">Back to leads inbox</Link>
        </Button>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle>
                Enquiry #{id} · {lead.action.name}
              </CardTitle>
              <Badge>{LEAD_STATUS_LABELS[lead.management.status]}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {lead.project.name} ·{" "}
              {lead.submission.source.replaceAll("_", " ")} ·{" "}
              {lead.version
                ? `Workflow version ${lead.version.number}`
                : "Legacy submission"}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {linked?.contact && (
              <p className="text-sm">
                Contact:{" "}
                {linked.contact.name ||
                  linked.contact.phone ||
                  linked.contact.email ||
                  `#${linked.contact.id}`}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Received{" "}
              {formatDateTimeInTimeZone(
                lead.submission.createdAt,
                company.timeZone,
              )}
            </p>
            <dl className="grid gap-3 sm:grid-cols-2">
              {lead.fields.map((field) => (
                <div key={field.key} className="min-w-0 rounded-md border p-3">
                  <dt className="text-sm font-medium">{field.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {formatLeadFieldValue(field.value)}
                  </dd>
                </div>
              ))}
            </dl>
            {lead.fields.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No structured fields were collected for this request.
              </p>
            )}
            {lead.exportAllowed && (
              <Button asChild variant="outline">
                <a href={`/api/leads/${id}`}>View structured JSON</a>
              </Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Manage follow-up</CardTitle>
            <p className="text-sm text-muted-foreground">
              Assigned to{" "}
              {assigned ? assigned.user.name || assigned.user.email : "no one"}.
              Lead status tracks your team's progress separately from the
              workflow.
            </p>
          </CardHeader>
          <CardContent>
            <ActionStateForm
              action={updateInboxLeadAction}
              resetKey={lead.submission.revision}
              className="space-y-4"
            >
              <ActionFormError />
              <ActionFormSuccessToast />
              <input name="submissionId" type="hidden" value={id} />
              <input
                name="expectedRevision"
                type="hidden"
                value={lead.submission.revision}
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <LeadInboxSelect
                  name="status"
                  label="Lead status"
                  value={lead.management.status}
                  options={Object.entries(LEAD_STATUS_LABELS).map(
                    ([value, label]) => ({ value, label }),
                  )}
                />
                <LeadInboxSelect
                  name="assignedUserId"
                  label="Team member"
                  value={String(lead.management.assignedUserId ?? "none")}
                  options={[
                    { value: "none", label: "Unassigned" },
                    ...activeMembers.map(({ user }) => ({
                      value: String(user.id),
                      label: user.name || user.email,
                    })),
                    ...(assigned && assigned.membership.status !== "active"
                      ? [
                          {
                            value: String(assigned.user.id),
                            label: `${assigned.user.name || assigned.user.email} (inactive — reassign)`,
                          },
                        ]
                      : []),
                  ]}
                />
                <div className="space-y-2">
                  <Label htmlFor="nextFollowUpDate">Next follow-up date</Label>
                  <Input
                    id="nextFollowUpDate"
                    name="nextFollowUpDate"
                    type="date"
                    defaultValue={lead.management.nextFollowUpDate ?? ""}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="note">Add an internal note</Label>
                <Textarea
                  id="note"
                  name="note"
                  maxLength={4000}
                  placeholder="What happened, or what should the team do next?"
                />
              </div>
              <FormSubmitButton label="Save follow-up" pendingLabel="Saving…" />
            </ActionStateForm>
            <div className="mt-6 space-y-3">
              {events
                .filter((event) => event.eventType === "lead.updated")
                .reverse()
                .map((event) => (
                  <div key={event.id} className="rounded-md border p-3">
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {event.message}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDateTimeInTimeZone(
                        event.createdAt,
                        company.timeZone,
                      )}
                    </p>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Conversation</CardTitle>
            <p className="text-sm text-muted-foreground">
              Latest 50 messages from the linked conversation.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No linked conversation messages are available.
              </p>
            ) : (
              messages.map((message) => (
                <div key={message.id} className="rounded-md border p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    {message.direction === "inbound" ? "Visitor" : "Lia"} ·{" "}
                    {formatDateTimeInTimeZone(
                      message.createdAt,
                      company.timeZone,
                    )}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {message.text || `[${message.messageType}]`}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
