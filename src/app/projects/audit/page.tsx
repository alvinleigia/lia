import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { assertPermission } from "@/lib/access-control";
import { listCompanyAuditLogs } from "@/lib/audit";
import { resolvePageUserAndWorkspace } from "@/lib/protected-page";

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatActor(
  actor: { email: string | null; name: string | null } | null,
) {
  if (!actor) {
    return "System";
  }

  if (actor.name?.trim()) {
    return `${actor.name} (${actor.email ?? "no email"})`;
  }

  return actor.email ?? "System";
}

export default async function ProjectAuditPage() {
  const context = await resolvePageUserAndWorkspace();
  assertPermission(context.membership, "audit.view");

  const auditRows = await listCompanyAuditLogs(context.company.id, 100);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <ShieldCheck className="h-6 w-6" />
              Audit Logs: {context.company.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Recent company-scoped audit events for sensitive configuration and
              account changes.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Events</CardTitle>
          </CardHeader>
          <CardContent>
            {auditRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No audit events have been recorded yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-4">Time</th>
                      <th className="py-2 pr-4">Action</th>
                      <th className="py-2 pr-4">Actor</th>
                      <th className="py-2 pr-4">Target</th>
                      <th className="py-2 pr-4">Project</th>
                      <th className="py-2 pr-4">Metadata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map(({ auditLog, actor }) => (
                      <tr
                        key={auditLog.id}
                        className="border-b align-top last:border-b-0"
                      >
                        <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                          {auditLog.createdAt.toLocaleString()}
                        </td>
                        <td className="py-2 pr-4 font-medium">
                          {auditLog.action}
                        </td>
                        <td className="py-2 pr-4">{formatActor(actor)}</td>
                        <td className="py-2 pr-4">
                          {auditLog.targetType ? (
                            <span>
                              {auditLog.targetType}
                              {auditLog.targetId
                                ? ` #${auditLog.targetId}`
                                : ""}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">None</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {auditLog.projectId ?? (
                            <span className="text-muted-foreground">All</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          <pre className="max-w-md overflow-auto rounded-md bg-gray-50 p-2 text-xs">
                            {formatJson(auditLog.metadata)}
                          </pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
