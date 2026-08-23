import { KeyRound, PhoneCall, Save, ShieldCheck } from "lucide-react";
import { NoProjectState } from "@/components/no-project-state";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { assertPermission } from "@/lib/access-control";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import {
  getProjectTelnyxVoiceChannel,
  getTelnyxVoiceWebhookUrl,
  normalizeTelnyxVoiceConfig,
  TELNYX_TRANSCRIPTION_ENGINES,
} from "@/lib/telnyx-voice-provider";
import { updateTelnyxVoiceChannelAction } from "./actions";

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

export default async function TelnyxVoiceChannelPage() {
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Telnyx Voice setup needs a project" />;
  }

  assertPermission(context.membership, "company.widget.manage");

  const { project } = context;
  const channel = await getProjectTelnyxVoiceChannel(project.id);
  const config = normalizeTelnyxVoiceConfig(channel?.config);
  const status = channel?.status ?? "disabled";
  const channelName = channel?.name ?? `${project.name} Telnyx Voice`;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-5xl space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2 text-2xl">
                <PhoneCall className="h-6 w-6" />
                Telnyx Voice: {project.name}
              </CardTitle>
              <StatusBadge status={status} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase text-muted-foreground">
                  Connection ID
                </p>
                <p className="mt-1 break-all font-medium">
                  {config.connectionId || "Not configured"}
                </p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase text-muted-foreground">
                  Phone Number
                </p>
                <p className="mt-1 break-all font-medium">
                  {config.phoneNumber || "Not configured"}
                </p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase text-muted-foreground">
                  API Credential
                </p>
                <p className="mt-1 font-medium">
                  {config.apiKey ? "Stored" : "Missing"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ShieldCheck className="h-5 w-5" />
              Verified Webhook
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="webhookUrl">Callback URL</Label>
              <Input
                id="webhookUrl"
                value={getTelnyxVoiceWebhookUrl()}
                readOnly
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Add this URL to the Telnyx Voice API application. Lia verifies
              each webhook with the public key saved below before processing
              call events.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Save className="h-5 w-5" />
              Channel Settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ActionStateForm
              action={updateTelnyxVoiceChannelAction}
              className="space-y-5"
            >
              <ActionFormError />
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
                  <Label htmlFor="connectionId">Voice API Connection ID</Label>
                  <Input
                    id="connectionId"
                    name="connectionId"
                    defaultValue={config.connectionId}
                    required={status === "active"}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phoneNumber">Assigned Phone Number</Label>
                  <Input
                    id="phoneNumber"
                    name="phoneNumber"
                    defaultValue={config.phoneNumber}
                    placeholder="+15551234567"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="language">Transcription Language</Label>
                  <Input
                    id="language"
                    name="language"
                    defaultValue={config.language}
                    placeholder="en"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transcriptionEngine">
                    Transcription Engine
                  </Label>
                  <select
                    id="transcriptionEngine"
                    name="transcriptionEngine"
                    className={selectClassName}
                    defaultValue={config.transcriptionEngine}
                  >
                    {TELNYX_TRANSCRIPTION_ENGINES.map((engine) => (
                      <option key={engine} value={engine}>
                        {engine}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transcriptionModel">
                    Transcription Model
                  </Label>
                  <Input
                    id="transcriptionModel"
                    name="transcriptionModel"
                    defaultValue={config.transcriptionModel}
                    placeholder="Optional provider model"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="voice">Text-to-Speech Voice</Label>
                  <Input
                    id="voice"
                    name="voice"
                    defaultValue={config.voice}
                    required
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="transferDestination">
                    Approved Handoff Destination
                  </Label>
                  <Input
                    id="transferDestination"
                    name="transferDestination"
                    defaultValue={config.transferDestination}
                    placeholder="+15551234567 or approved SIP URI"
                  />
                  <p className="text-xs text-muted-foreground">
                    Handoffs fall back to readable speech when this is blank.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="greeting">Opening Greeting</Label>
                <Textarea
                  id="greeting"
                  name="greeting"
                  rows={3}
                  defaultValue={config.greeting}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="apiKey">Telnyx API Key</Label>
                  <Input
                    id="apiKey"
                    name="apiKey"
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      config.apiKey
                        ? "Stored. Leave blank to keep the current key."
                        : "Paste a Telnyx API key"
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="publicKey">Webhook Public Key</Label>
                  <Textarea
                    id="publicKey"
                    name="publicKey"
                    rows={4}
                    defaultValue={config.publicKey}
                    placeholder="Base64 Ed25519 or PEM public key"
                  />
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-md border bg-slate-50 p-3 text-sm text-muted-foreground">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
                The API key is encrypted at rest and never displayed after it is
                saved. The webhook public key is not a secret and remains
                visible for verification and rotation.
              </div>

              <FormSubmitButton
                label="Save Telnyx Voice Settings"
                pendingLabel="Saving..."
                icon={<Save className="h-4 w-4" />}
              />
            </ActionStateForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
