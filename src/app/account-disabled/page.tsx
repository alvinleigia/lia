import { CircleAlert, LogOut } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { signOutFromDisabledAccountAction } from "./actions";

export default function AccountDisabledPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <CircleAlert className="h-6 w-6" />
              Account Disabled
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This account is currently disabled. Contact the platform
              administrator to restore access.
            </p>
            <form action={signOutFromDisabledAccountAction}>
              <FormSubmitButton
                label="Sign Out"
                pendingLabel="Signing out..."
                variant="outline"
                icon={<LogOut className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
