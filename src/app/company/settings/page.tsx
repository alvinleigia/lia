import { Clock3 } from "lucide-react";
import {
  ActionFormError,
  ActionFormSuccessToast,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { assertPermission } from "@/lib/access-control";
import { resolvePageUserAndWorkspace } from "@/lib/protected-page";
import { COMPANY_TIME_ZONE_OPTIONS } from "@/lib/time-zones";
import { updateCompanyTimeZoneAction } from "./actions";

export default async function CompanySettingsPage() {
  const context = await resolvePageUserAndWorkspace();
  assertPermission(context.membership, "company.members.manage");

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Clock3 className="size-6" />
              Company Settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ActionStateForm
              action={updateCompanyTimeZoneAction}
              className="space-y-5"
            >
              <ActionFormSuccessToast />
              <ActionFormError />
              <div className="space-y-2">
                <Label htmlFor="timeZone">Display timezone</Label>
                <Select defaultValue={context.company.timeZone} name="timeZone">
                  <SelectTrigger className="w-full" id="timeZone">
                    <SelectValue placeholder="Select a timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPANY_TIME_ZONE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  Audit logs and automated flow test timestamps use this
                  timezone. Stored timestamps remain in UTC.
                </p>
              </div>
              <FormSubmitButton
                label="Save timezone"
                pendingLabel="Saving..."
              />
            </ActionStateForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
