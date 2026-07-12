import { MessageCircle, Save, Send, ShieldCheck } from "lucide-react";
import { NoProjectState } from "@/components/no-project-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { assertPermission } from "@/lib/access-control";
import {
  getActiveProjectIdCookie,
  resolveOptionalUserAndProject,
} from "@/lib/auth-project";
import {
  getProjectWhatsAppChannel,
  getWhatsAppWebhookUrl,
  normalizeWhatsAppConfig,
} from "@/lib/whatsapp";
import {
  sendWhatsAppTestMessageAction,
  updateWhatsAppChannelAction,
} from "./actions";

type WhatsAppChannelPageProps = {
  searchParams: Promise<{
    error?: string;
    testSent?: string;
    updated?: string;
  }>;
};

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background";

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "active";

  return (
    <span
      className={`rounded-md border px-2 py-1 text-xs capitalize ${
        isActive
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      {status}
    </span>
  );
}

export default async function WhatsAppChannelPage({
  searchParams,
}: WhatsAppChannelPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="WhatsApp setup needs a project" />;
  }

  assertPermission(context.membership, "company.widget.manage");

  const { project } = context;
  const channel = await getProjectWhatsAppChannel(project.id);
  const config = normalizeWhatsAppConfig(channel?.config);
  const webhookUrl = getWhatsAppWebhookUrl();
  const status = channel?.status ?? "disabled";
  const channelName = channel?.name ?? `${project.name} WhatsApp`;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-2xl flex items-center gap-2">
                <MessageCircle className="h-6 w-6" />
                WhatsApp: {project.name}
              </CardTitle>
              <StatusBadge status={status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}
            {params.updated && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                WhatsApp settings saved.
              </p>
            )}
            {params.testSent && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Test message sent through WhatsApp Cloud API.
              </p>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase text-muted-foreground">
                  Phone Number ID
                </p>
                <p className="mt-1 font-medium break-all">
                  {config.phoneNumberId || "Not configured"}
                </p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase text-muted-foreground">
                  Business Account
                </p>
                <p className="mt-1 font-medium break-all">
                  {config.businessAccountId || "Not configured"}
                </p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase text-muted-foreground">
                  Credentials
                </p>
                <p className="mt-1 font-medium">
                  {config.accessToken ? "Stored" : "Missing"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Meta Webhook
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="webhookUrl">Callback URL</Label>
              <Input id="webhookUrl" value={webhookUrl} readOnly />
            </div>
            <p className="text-sm text-muted-foreground">
              Use this callback URL in Meta's WhatsApp webhook setup. The verify
              token is stored below and used by the GET verification endpoint.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <Save className="h-5 w-5" />
              Channel Settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateWhatsAppChannelAction} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Channel Name</Label>
                  <Input
                    id="name"
                    name="name"
                    defaultValue={channelName}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <select
                    id="status"
                    name="status"
                    className={selectClassName}
                    defaultValue={status}
                  >
                    <option value="active">active</option>
                    <option value="disabled">disabled</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessName">Business Name</Label>
                  <Input
                    id="businessName"
                    name="businessName"
                    defaultValue={config.businessName}
                    placeholder="Lia AI"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="displayPhoneNumber">
                    Display Phone Number
                  </Label>
                  <Input
                    id="displayPhoneNumber"
                    name="displayPhoneNumber"
                    defaultValue={config.displayPhoneNumber}
                    placeholder="+91..."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessAccountId">
                    WhatsApp Business Account ID
                  </Label>
                  <Input
                    id="businessAccountId"
                    name="businessAccountId"
                    defaultValue={config.businessAccountId}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phoneNumberId">Phone Number ID</Label>
                  <Input
                    id="phoneNumberId"
                    name="phoneNumberId"
                    defaultValue={config.phoneNumberId}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="verifyToken">Webhook Verify Token</Label>
                  <Input
                    id="verifyToken"
                    name="verifyToken"
                    type="password"
                    placeholder={
                      config.verifyToken
                        ? "Stored. Leave blank to keep current token."
                        : "Paste a strong verification token"
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="appSecret">Meta App Secret</Label>
                  <Input
                    id="appSecret"
                    name="appSecret"
                    type="password"
                    placeholder={
                      config.appSecret
                        ? "Stored. Leave blank to keep current secret."
                        : "Paste Meta app secret"
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="accessToken">Cloud API Access Token</Label>
                <Textarea
                  id="accessToken"
                  name="accessToken"
                  rows={3}
                  placeholder={
                    config.accessToken
                      ? "Stored. Leave blank to keep current token."
                      : "Paste a WhatsApp Cloud API token"
                  }
                />
              </div>

              <FormSubmitButton
                label="Save WhatsApp Settings"
                pendingLabel="Saving..."
                icon={<Save className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <Send className="h-5 w-5" />
              Send Test Message
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={sendWhatsAppTestMessageAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="to">Recipient WhatsApp Number</Label>
                <Input id="to" name="to" placeholder="919876543210" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">Message</Label>
                <Textarea
                  id="message"
                  name="message"
                  rows={3}
                  defaultValue="This is a Lia AI WhatsApp channel test."
                  required
                />
              </div>
              <FormSubmitButton
                label="Send Test"
                pendingLabel="Sending..."
                icon={<Send className="h-4 w-4" />}
                disabled={status !== "active" || !config.accessToken}
              />
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
