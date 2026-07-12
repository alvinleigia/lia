import { CheckCircle2, LogIn, UserPlus } from "lucide-react";
import Link from "next/link";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { getCompanyInvitationByToken } from "@/lib/invitations";
import { acceptCompanyInvitationAction } from "./actions";

type AcceptInvitePageProps = {
  searchParams: Promise<{
    token?: string;
    error?: string;
  }>;
};

export default async function AcceptInvitePage({
  searchParams,
}: AcceptInvitePageProps) {
  const params = await searchParams;
  const session = await auth();
  const inviteContext = params.token
    ? await getCompanyInvitationByToken(params.token)
    : null;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6" />
              Accept Invite
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}

            {!inviteContext ? (
              <p className="text-sm text-muted-foreground">
                Invitation not found.
              </p>
            ) : (
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Account
                </p>
                <p className="mt-1 font-medium">{inviteContext.company.name}</p>
                <p className="text-sm text-muted-foreground">
                  {inviteContext.invitation.email}
                </p>
              </div>
            )}

            {inviteContext && session?.user?.email ? (
              <form action={acceptCompanyInvitationAction}>
                <input type="hidden" name="token" value={params.token} />
                <FormSubmitButton
                  className="w-full"
                  label="Accept Invite"
                  pendingLabel="Accepting..."
                  icon={<CheckCircle2 className="h-4 w-4" />}
                />
              </form>
            ) : (
              params.token && (
                <div className="grid gap-2">
                  <Button asChild>
                    <Link
                      href={`/sign-up?inviteToken=${encodeURIComponent(
                        params.token,
                      )}&email=${encodeURIComponent(
                        inviteContext?.invitation.email ?? "",
                      )}`}
                    >
                      <UserPlus className="h-4 w-4" />
                      Create Account
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/sign-in">
                      <LogIn className="h-4 w-4" />
                      Sign In
                    </Link>
                  </Button>
                </div>
              )
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
