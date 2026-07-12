import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "./actions";

type ForgotPasswordPageProps = {
  searchParams: Promise<{
    error?: string;
    sent?: string;
  }>;
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const params = await searchParams;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Mail className="h-6 w-6" />
              Reset Password
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {params.sent === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                If that email exists, a reset link has been sent.
              </p>
            )}

            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}

            <form action={requestPasswordReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>

              <FormSubmitButton
                className="w-full"
                label="Send Reset Link"
                pendingLabel="Sending..."
                icon={<Mail className="h-4 w-4" />}
              />
            </form>

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
