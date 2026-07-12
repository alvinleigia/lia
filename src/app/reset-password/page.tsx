import { ArrowLeft, KeyRound } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getValidPasswordResetToken } from "@/lib/password-reset";
import { resetPassword } from "./actions";

type ResetPasswordPageProps = {
  searchParams: Promise<{
    error?: string;
    token?: string;
  }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = params.token ?? "";
  const resetToken =
    token.length >= 20 ? await getValidPasswordResetToken(token) : null;
  const isTokenValid = Boolean(resetToken);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <KeyRound className="h-6 w-6" />
              Set New Password
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {!isTokenValid && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                This reset link is invalid or expired. Please request a new
                password reset link.
              </p>
            )}

            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}

            {isTokenValid ? (
              <form action={resetPassword} className="space-y-4">
                <input type="hidden" name="token" value={token} />

                <div className="space-y-2">
                  <Label htmlFor="password">New Password</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    required
                  />
                </div>

                <FormSubmitButton
                  className="w-full"
                  label="Update Password"
                  pendingLabel="Updating..."
                  icon={<KeyRound className="h-4 w-4" />}
                />
              </form>
            ) : (
              <Link
                href="/forgot-password"
                className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90"
              >
                Request New Link
              </Link>
            )}

            <p className="text-sm text-muted-foreground">
              <Link href="/sign-in" className="underline underline-offset-4">
                <ArrowLeft className="h-3.5 w-3.5 inline mr-1" />
                Back to sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
