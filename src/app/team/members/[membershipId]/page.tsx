import { ArrowLeft, UserCog } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { canAccess } from "@/lib/access-control";
import { listCompanyMembers } from "@/lib/invitations";
import { resolvePageUserAndWorkspace } from "@/lib/protected-page";
import { updateTeamMemberStatusAction } from "../../actions";

type TeamMemberPageProps = {
  params: Promise<{
    membershipId: string;
  }>;
};

export default async function TeamMemberPage({ params }: TeamMemberPageProps) {
  const { membershipId } = await params;
  const parsedMembershipId = Number(membershipId);
  if (!Number.isInteger(parsedMembershipId) || parsedMembershipId <= 0) {
    notFound();
  }

  const { company, membership } = await resolvePageUserAndWorkspace();
  const members = await listCompanyMembers(company.id);
  const memberRow = members.find(
    ({ membership: memberAccess }) => memberAccess.id === parsedMembershipId,
  );

  if (!memberRow) {
    notFound();
  }

  const canManageMembers = canAccess(membership, "company.members.manage");
  const member = memberRow.user;
  const memberAccess = memberRow.membership;
  const nextStatus = memberAccess.status === "active" ? "disabled" : "active";
  const isSelf = memberAccess.id === membership.id;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <Button asChild variant="ghost">
          <Link href="/team">
            <ArrowLeft className="h-4 w-4" />
            Team
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <UserCog className="h-6 w-6" />
              Manage Member
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border bg-white p-4">
              <p className="font-medium">{member.name ?? member.email}</p>
              <p className="text-sm text-muted-foreground">{member.email}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Role
                </p>
                <p className="mt-1 font-medium">{memberAccess.role}</p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Status
                </p>
                <p className="mt-1 font-medium capitalize">
                  {memberAccess.status}
                </p>
              </div>
            </div>

            {canManageMembers && !isSelf ? (
              <form action={updateTeamMemberStatusAction}>
                <input
                  type="hidden"
                  name="membershipId"
                  value={memberAccess.id}
                />
                <input type="hidden" name="status" value={nextStatus} />
                <FormSubmitButton
                  label={
                    memberAccess.status === "active"
                      ? "Disable Member"
                      : "Enable Member"
                  }
                  pendingLabel="Updating..."
                  variant="outline"
                />
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                This member cannot be updated from your account.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
