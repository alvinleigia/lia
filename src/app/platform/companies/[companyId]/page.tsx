import { ArrowLeft, FolderKanban, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { writeAuditLog } from "@/lib/audit";
import { formatCompanyRole } from "@/lib/company-roles";
import { listCompanyInvitations, listCompanyMembers } from "@/lib/invitations";
import {
  getTenantCompanyById,
  listTenantProjectsForCompany,
  resolvePlatformAdmin,
} from "@/lib/platform-admin";
import { updatePlatformCompanyMemberStatusAction } from "../../company-actions";

type PlatformCompanyPageProps = {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{
    error?: string;
    memberUpdated?: string;
  }>;
};

function parseCompanyId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default async function PlatformCompanyPage({
  params,
  searchParams,
}: PlatformCompanyPageProps) {
  const platformUser = await resolvePlatformAdmin().catch(() => null);
  if (!platformUser) {
    notFound();
  }

  const routeParams = await params;
  const query = await searchParams;
  const companyId = parseCompanyId(routeParams.companyId);

  if (!companyId) {
    notFound();
  }

  const tenant = await getTenantCompanyById(companyId);
  if (!tenant) {
    notFound();
  }

  const [members, invitationRows, projectRows] = await Promise.all([
    listCompanyMembers(companyId),
    listCompanyInvitations(companyId),
    listTenantProjectsForCompany(companyId),
  ]);
  const pendingInvitations = invitationRows.filter(
    ({ invitation }) => invitation.status === "pending",
  );

  await writeAuditLog({
    user: platformUser,
    company: tenant.company,
    action: "platform.tenant_reviewed",
    targetType: "company",
    targetId: tenant.company.id,
    metadata: {
      companyName: tenant.company.name,
      status: tenant.company.status,
      memberCount: members.length,
      pendingInvitationCount: pendingInvitations.length,
      projectCount: projectRows.length,
    },
  });

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <Button asChild variant="outline">
          <Link href="/platform">
            <ArrowLeft className="h-4 w-4" />
            Platform
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Users className="h-6 w-6" />
              {tenant.company.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Status
              </p>
              <p className="mt-1 font-medium capitalize">
                {tenant.company.status}
              </p>
            </div>
            <div className="rounded-md border bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Owner
              </p>
              <p className="mt-1 font-medium">
                {tenant.owner?.name ?? tenant.owner?.email ?? "No owner"}
              </p>
              <p className="text-sm text-muted-foreground">
                {tenant.owner?.email ?? ""}
              </p>
            </div>
            <div className="rounded-md border bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Created
              </p>
              <p className="mt-1 font-medium">
                {tenant.company.createdAt.toLocaleDateString()}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <Users className="h-5 w-5" />
                Members
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {query.memberUpdated === "1" && (
                <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                  Member updated.
                </p>
              )}
              {members.map(({ membership, user }) => (
                <div
                  key={membership.id}
                  className="flex flex-col gap-3 rounded-md border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{user.name ?? user.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {user.email}
                    </p>
                    <p className="mt-1 text-xs">
                      {formatCompanyRole(membership.role)} / {membership.status}
                    </p>
                  </div>
                  <form action={updatePlatformCompanyMemberStatusAction}>
                    <input type="hidden" name="companyId" value={companyId} />
                    <input
                      type="hidden"
                      name="membershipId"
                      value={membership.id}
                    />
                    <input
                      type="hidden"
                      name="status"
                      value={
                        membership.status === "active" ? "disabled" : "active"
                      }
                    />
                    <FormSubmitButton
                      label={
                        membership.status === "active" ? "Disable" : "Enable"
                      }
                      pendingLabel="Updating..."
                      variant="outline"
                    />
                  </form>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <FolderKanban className="h-5 w-5" />
                Projects
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {projectRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No projects yet.
                </p>
              ) : (
                projectRows.map(({ project }) => (
                  <div
                    key={project.id}
                    className="rounded-md border bg-white px-4 py-3"
                  >
                    <p className="font-medium">{project.name}</p>
                    <p className="text-xs text-muted-foreground">
                      ID: {project.id}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Pending Invitations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {query.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {query.error}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Platform admins can review pending invitations for support
              visibility. Company owners manage invitations from the Team area.
            </p>

            {pendingInvitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No pending invitations.
              </p>
            ) : (
              pendingInvitations.map(({ invitation, invitedBy }) => (
                <div
                  key={invitation.id}
                  className="rounded-md border bg-white px-4 py-3"
                >
                  <p className="font-medium">{invitation.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Invited by{" "}
                    {invitedBy?.name ?? invitedBy?.email ?? "Unknown user"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatCompanyRole(invitation.role)} - Expires{" "}
                    {invitation.expiresAt.toLocaleDateString()}
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
