import { ArrowLeft, Copy, UserPlus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canAccess } from "@/lib/access-control";
import { resolvePageUserAndWorkspace } from "@/lib/protected-page";
import { createTeamInvitationAction } from "../actions";

type InviteTeamPageProps = {
  searchParams: Promise<{
    error?: string;
    emailSent?: string;
    invited?: string;
    inviteUrl?: string;
  }>;
};

export default async function InviteTeamPage({
  searchParams,
}: InviteTeamPageProps) {
  const params = await searchParams;
  const { membership } = await resolvePageUserAndWorkspace();
  const canManageMembers = canAccess(membership, "company.members.manage");

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
              <UserPlus className="h-6 w-6" />
              Invite Member
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}
            {params.invited === "1" && params.inviteUrl && (
              <div className="space-y-2 rounded-md border bg-green-50 p-3">
                <p className="text-sm font-medium text-green-800">
                  {params.emailSent === "0"
                    ? "Invitation created, but email delivery failed."
                    : "Invitation emailed."}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input readOnly value={params.inviteUrl} />
                  <Button asChild variant="outline">
                    <a href={params.inviteUrl}>
                      <Copy className="h-4 w-4" />
                      Open
                    </a>
                  </Button>
                </div>
              </div>
            )}

            {canManageMembers ? (
              <form action={createTeamInvitationAction} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="inviteEmail">Invite Email</Label>
                  <Input
                    id="inviteEmail"
                    name="email"
                    type="email"
                    placeholder="teammate@example.com"
                    required
                  />
                </div>
                <FormSubmitButton
                  className="w-full"
                  label="Create Invite"
                  pendingLabel="Creating..."
                  icon={<UserPlus className="h-4 w-4" />}
                />
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                You do not have permission to invite members.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
