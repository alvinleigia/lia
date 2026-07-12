import { KeyRound, LogIn, Mail, UserPlus } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithCredentials, signInWithGoogle } from "./actions";

type SignInPageProps = {
  searchParams: Promise<{
    error?: string;
    inviteAccepted?: string;
    registered?: string;
    reset?: string;
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <LogIn className="h-6 w-6" />
              Sign In
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {params.registered === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Account created successfully. Please sign in.
              </p>
            )}

            {params.inviteAccepted === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Invitation accepted. Please sign in.
              </p>
            )}

            {params.reset === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Password updated successfully. Please sign in.
              </p>
            )}

            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}

            <form action={signInWithCredentials} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="/forgot-password"
                    className="text-sm underline underline-offset-4"
                  >
                    Forgot?
                  </Link>
                </div>
                <Input id="password" name="password" type="password" required />
              </div>

              <FormSubmitButton
                className="w-full"
                label="Sign In with Email"
                pendingLabel="Signing in..."
                icon={<Mail className="h-4 w-4" />}
              />
            </form>

            <form action={signInWithGoogle}>
              <FormSubmitButton
                className="w-full"
                label="Sign In with Google"
                pendingLabel="Redirecting..."
                variant="outline"
                icon={<KeyRound className="h-4 w-4" />}
              />
            </form>

            <p className="text-sm text-muted-foreground">
              No account?{" "}
              <Link href="/sign-up" className="underline underline-offset-4">
                <UserPlus className="h-3.5 w-3.5 inline mr-1" />
                Create one
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
