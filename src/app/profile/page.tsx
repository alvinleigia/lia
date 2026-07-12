import { UserCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { canAccess } from "@/lib/access-control";
import { formatCompanyRole } from "@/lib/company-roles";
import { resolvePageUserAndWorkspace } from "@/lib/protected-page";
import { updateProfileAction } from "./actions";

type ProfilePageProps = {
  searchParams: Promise<{
    error?: string;
    emailSent?: string;
    profileUpdated?: string;
  }>;
};

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const params = await searchParams;
  const { user, company, membership } = await resolvePageUserAndWorkspace();
  const canManageCompany = canAccess(membership, "company.members.manage");

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <UserCircle className="h-6 w-6" />
              Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                User
              </p>
              <p className="mt-1 font-medium">{user.name ?? "No name"}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
            <div className="rounded-md border bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Account
              </p>
              <p className="mt-1 font-medium">{company.name}</p>
              <p className="text-sm capitalize text-muted-foreground">
                {company.status}
              </p>
            </div>
            <div className="rounded-md border bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Access
              </p>
              <p className="mt-1 font-medium">
                {formatCompanyRole(membership.role)}
              </p>
              <p className="text-sm capitalize text-muted-foreground">
                {membership.status}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card id="demographics">
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <UserCircle className="h-5 w-5" />
              Demographic Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {params.profileUpdated === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Profile updated.
              </p>
            )}
            <form action={updateProfileAction} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="profileName">Display Name</Label>
                  <Input
                    id="profileName"
                    name="name"
                    defaultValue={user.name ?? ""}
                    placeholder="Your name"
                    maxLength={100}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="profileEmail">Email</Label>
                  <Input
                    id="profileEmail"
                    value={user.email}
                    readOnly
                    aria-readonly="true"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="companyName">Account Name</Label>
                  <Input
                    id="companyName"
                    name="companyName"
                    defaultValue={company.name}
                    placeholder="Your account name"
                    maxLength={120}
                    readOnly={!canManageCompany}
                    aria-readonly={!canManageCompany}
                    required
                  />
                  {!canManageCompany && (
                    <p className="text-xs text-muted-foreground">
                      Company members can view the account name, but only owners
                      can rename it.
                    </p>
                  )}
                </div>
                <div className="rounded-md border bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Access
                  </p>
                  <p className="mt-1 font-medium">
                    {formatCompanyRole(membership.role)}
                  </p>
                </div>
                <div className="rounded-md border bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Joined
                  </p>
                  <p className="mt-1 font-medium">
                    {user.createdAt.toLocaleDateString()}
                  </p>
                </div>
              </div>
              <FormSubmitButton
                label="Save Profile"
                pendingLabel="Saving..."
                className="w-full sm:w-auto"
              />
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
