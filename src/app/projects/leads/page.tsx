import { Inbox } from "lucide-react";
import Link from "next/link";
import { LeadInboxSelect } from "@/components/lead-inbox-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatLeadFieldValue, LEAD_STATUS_LABELS } from "@/lib/lead-inbox";
import { leadFiltersSchema, listInboxLeads } from "@/lib/lead-inbox-data";
import { listProjectsForWorkspace } from "@/lib/projects";
import { resolvePageUserAndWorkspace } from "@/lib/protected-page";
import { formatDateTimeInTimeZone } from "@/lib/time-zones";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) =>
        typeof value === "string" && value !== "all" && value !== "",
    ),
  );
  const parsed = leadFiltersSchema.safeParse(raw);
  const filters = parsed.success ? parsed.data : { page: 1 };
  const { company, workspace } = await resolvePageUserAndWorkspace();
  const [result, projects] = await Promise.all([
    listInboxLeads(
      { companyId: company.id, workspaceId: workspace.id },
      filters,
    ),
    listProjectsForWorkspace(workspace.id),
  ]);
  function pageHref(page: number) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value !== undefined) query.set(key, String(value));
    query.set("page", String(page));
    return `/projects/leads?${query}`;
  }
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Inbox className="size-6" />
              Leads inbox
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {company.name} · Enquiries and follow-up requests across your
              projects.
            </p>
          </CardHeader>
          <CardContent>
            {!parsed.success && (
              <p role="alert" className="mb-4 text-sm text-red-700">
                Some filters were invalid. Showing the first page of all leads.
              </p>
            )}
            <form
              className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-5"
              method="get"
            >
              <div className="space-y-2">
                <Label htmlFor="q">Search collected details</Label>
                <Input
                  id="q"
                  name="q"
                  defaultValue={filters.q}
                  maxLength={120}
                  placeholder="Name, phone or request"
                />
              </div>
              <LeadInboxSelect
                name="projectId"
                label="Project"
                value={String(filters.projectId ?? "all")}
                options={[
                  { value: "all", label: "All projects" },
                  ...projects.map((project) => ({
                    value: String(project.id),
                    label: project.name,
                  })),
                ]}
              />
              <LeadInboxSelect
                name="status"
                label="Lead status"
                value={filters.status ?? "all"}
                options={[
                  { value: "all", label: "All statuses" },
                  ...Object.entries(LEAD_STATUS_LABELS).map(
                    ([value, label]) => ({ value, label }),
                  ),
                ]}
              />
              <LeadInboxSelect
                name="source"
                label="Channel"
                value={filters.source ?? "all"}
                options={[
                  { value: "all", label: "All channels" },
                  { value: "whatsapp_chat", label: "WhatsApp" },
                  { value: "project_chat", label: "Project chat" },
                  { value: "widget_chat", label: "Web widget" },
                  { value: "telnyx_voice", label: "Voice" },
                ]}
              />
              <div className="flex gap-2">
                <Button type="submit">Filter</Button>
                <Button asChild variant="outline">
                  <Link href="/projects/leads">Reset</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
        {result.leads.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              No leads match this view. Saved submissions and requests sent for
              team review appear here automatically. Incomplete and cancelled
              collection sessions stay in Submissions.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {result.leads.map(
              ({ submission, action, project, management, fields }) => (
                <Card key={submission.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-lg">
                        <Link
                          className="underline-offset-4 hover:underline"
                          href={`/projects/leads/${submission.id}`}
                        >
                          #{submission.id} · {action.name}
                        </Link>
                      </CardTitle>
                      <Badge variant="secondary">
                        {LEAD_STATUS_LABELS[management.status]}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {project.name} · {submission.source.replaceAll("_", " ")}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <dl className="space-y-1 text-sm">
                      {fields.slice(0, 4).map((field) => (
                        <div key={field.key} className="flex gap-2">
                          <dt className="shrink-0 text-muted-foreground">
                            {field.label}:
                          </dt>
                          <dd className="truncate">
                            {formatLeadFieldValue(field.value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {management.nextFollowUpDate && (
                      <p className="text-sm">
                        Follow up: {management.nextFollowUpDate}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Received{" "}
                      {formatDateTimeInTimeZone(
                        submission.createdAt,
                        company.timeZone,
                      )}
                    </p>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/projects/leads/${submission.id}`}>
                        Open enquiry
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ),
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <Button asChild variant="outline" disabled={result.page === 1}>
            {result.page > 1 ? (
              <Link href={pageHref(result.page - 1)}>Previous</Link>
            ) : (
              <span>Previous</span>
            )}
          </Button>
          <p className="text-sm">Page {result.page}</p>
          <Button asChild variant="outline" disabled={!result.hasMore}>
            {result.hasMore ? (
              <Link href={pageHref(result.page + 1)}>Next</Link>
            ) : (
              <span>Next</span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
