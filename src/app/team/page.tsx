import { Mail, Settings, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { canAccess } from "@/lib/access-control";
import { listCompanyInvitations, listCompanyMembers } from "@/lib/invitations";
import { resolvePageUserAndWorkspace } from "@/lib/protected-page";
import { cancelTeamInvitationAction } from "./actions";

type TeamPageProps = {
  searchParams: Promise<{
    error?: string;
    inviteAccepted?: string;
    inviteCancelled?: string;
    memberUpdated?: string;
  }>;
};

export default async function TeamPage({ searchParams }: TeamPageProps) {
  const params = await searchParams;
  const { company, membership } = await resolvePageUserAndWorkspace();
  const [members, invitationRows] = await Promise.all([
    listCompanyMembers(company.id),
    listCompanyInvitations(company.id),
  ]);
  const pendingInvitations = invitationRows.filter(
    ({ invitation }) => invitation.status === "pending",
  );
  const canManageMembers = canAccess(membership, "company.members.manage");

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-2xl flex items-center gap-2">
              <Users className="h-6 w-6" />
              Team
            </CardTitle>
            {canManageMembers && (
              <Button asChild>
                <Link href="/team/invite">
                  <UserPlus className="h-4 w-4" />
                  Invite Member
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}
            {params.inviteAccepted === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Invitation accepted.
              </p>
            )}
            {params.inviteCancelled === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Invitation cancelled.
              </p>
            )}
            {params.memberUpdated === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Member updated.
              </p>
            )}

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Members
              </p>
              {members.map(({ membership: memberAccess, user }) => (
                <div
                  key={memberAccess.id}
                  className="flex flex-col gap-3 rounded-md border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{user.name ?? user.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:items-end">
                    <div className="text-left sm:text-right">
                      <p className="text-xs">{memberAccess.role}</p>
                      <p className="text-xs capitalize text-muted-foreground">
                        {memberAccess.status}
                      </p>
                    </div>
                    {canManageMembers && memberAccess.id !== membership.id && (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/team/members/${memberAccess.id}`}>
                          <Settings className="h-4 w-4" />
                          Manage
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Pending Invitations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingInvitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No pending invitations.
              </p>
            ) : (
              pendingInvitations.map(({ invitation }) => (
                <div
                  key={invitation.id}
                  className="flex flex-col gap-3 rounded-md border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{invitation.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Expires {invitation.expiresAt.toLocaleDateString()}
                    </p>
                  </div>
                  {canManageMembers && (
                    <form action={cancelTeamInvitationAction}>
                      <input
                        type="hidden"
                        name="invitationId"
                        value={invitation.id}
                      />
                      <FormSubmitButton
                        label="Cancel"
                        pendingLabel="Cancelling..."
                        variant="outline"
                      />
                    </form>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
