import {
  Activity,
  ArrowLeft,
  Bot,
  KeyRound,
  RotateCcw,
  Save,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { HostedVoiceBindingForm } from "@/components/hosted-voice-binding-form";
import { NoProjectState } from "@/components/no-project-state";
import {
  ActionFormError,
  ActionFormSuccessToast,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { assertPermission } from "@/lib/access-control";
import { listPublishedConversationalTaskOptions } from "@/lib/conversational-tasks";
import { getHostedVoiceStagingState } from "@/lib/hosted-voice-staging";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import {
  inspectHostedVoiceDeploymentAction,
  promoteHostedVoiceCandidateAction,
  publishHostedVoiceCandidateAction,
  rollbackHostedVoiceDeploymentAction,
  rotateHostedVoiceBindingAction,
  saveHostedVoiceProviderAction,
} from "./actions";

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background";

export default async function TelnyxHostedVoicePage() {
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);
  if (!context) {
    return <NoProjectState title="Hosted voice setup needs a project" />;
  }
  assertPermission(context.membership, "company.widget.manage");
  const { project } = context;
  const [state, taskOptions] = await Promise.all([
    getHostedVoiceStagingState(project.id),
    listPublishedConversationalTaskOptions(project.id),
  ]);
  const config = state.provider?.config;
  const deployment = state.deployment;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Phase 18.14 staging</p>
            <h1 className="text-3xl font-semibold">
              Telnyx Hosted Assistant: {project.name}
            </h1>
          </div>
          <Button asChild variant="outline">
            <Link href="/projects/channels/telnyx">
              <ArrowLeft className="size-4" />
              Legacy Voice settings
            </Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-5" />
              Staging state
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <StatusCell
              label="Provider"
              value={
                state.provider ? `Configured #${state.provider.id}` : "Missing"
              }
            />
            <StatusCell
              label="Deployment"
              value={
                deployment
                  ? `${deployment.status} #${deployment.id}`
                  : "Not published"
              }
            />
            <StatusCell
              label="Candidate version"
              value={deployment?.candidateRemoteVersionId ?? "None"}
            />
            <StatusCell
              label="Tool binding"
              value={
                deployment?.bindingId
                  ? `Active #${deployment.bindingId}`
                  : "Missing"
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5" />
              Restricted hosted provider
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ActionStateForm
              action={saveHostedVoiceProviderAction}
              className="space-y-5"
            >
              <ActionFormError />
              <ActionFormSuccessToast />
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Provider name" name="name">
                  <Input
                    id="name"
                    name="name"
                    defaultValue={
                      state.provider?.name ?? `${project.name} Telnyx Hosted`
                    }
                    required
                  />
                </Field>
                <Field label="Telnyx model ID" name="modelId">
                  <Input
                    id="modelId"
                    name="modelId"
                    defaultValue={config?.modelId ?? ""}
                    placeholder="Choose a current Telnyx model ID"
                    required
                  />
                </Field>
                <Field label="Voice ID" name="voiceId">
                  <Input
                    id="voiceId"
                    name="voiceId"
                    defaultValue={config?.voiceId ?? ""}
                    placeholder="Choose a current Telnyx voice ID"
                    required
                  />
                </Field>
                <Field
                  label="Transcription model ID"
                  name="transcriptionModelId"
                >
                  <Input
                    id="transcriptionModelId"
                    name="transcriptionModelId"
                    defaultValue={config?.transcriptionModelId ?? ""}
                    placeholder="deepgram/flux"
                    required
                  />
                </Field>
                <Field
                  label="Transcription language"
                  name="transcriptionLanguage"
                >
                  <Input
                    id="transcriptionLanguage"
                    name="transcriptionLanguage"
                    defaultValue={config?.transcriptionLanguage ?? "en-AU"}
                    required
                  />
                </Field>
                <Field
                  label="Estimated cost microunits/minute"
                  name="costRateMicrounitsPerMinute"
                >
                  <Input
                    id="costRateMicrounitsPerMinute"
                    name="costRateMicrounitsPerMinute"
                    type="number"
                    min={0}
                    defaultValue={config?.costRateMicrounitsPerMinute ?? 0}
                    required
                  />
                </Field>
                <Field label="Restricted Telnyx API key" name="apiKey">
                  <Input
                    autoComplete="new-password"
                    id="apiKey"
                    name="apiKey"
                    type="password"
                    placeholder={
                      state.provider?.hasApiKey
                        ? "Stored. Leave blank to keep it."
                        : "Required for the first save"
                    }
                  />
                </Field>
                <Field
                  label="Telnyx Ed25519 public key"
                  name="webhookPublicKey"
                >
                  <Textarea
                    id="webhookPublicKey"
                    name="webhookPublicKey"
                    rows={4}
                    defaultValue={config?.webhookPublicKey ?? ""}
                  />
                </Field>
              </div>
              <p className="rounded-md border bg-slate-50 p-3 text-sm text-muted-foreground">
                The API key is encrypted and write-only. Use a staging-only key
                limited to Assistant, integration-secret, number-routing, and
                call-control operations needed by this UAT.
              </p>
              <FormSubmitButton
                icon={<Save className="size-4" />}
                label="Save hosted provider"
                pendingLabel="Saving..."
              />
            </ActionStateForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-5" />
              Publish a non-main candidate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ActionStateForm
              action={publishHostedVoiceCandidateAction}
              className="space-y-5"
            >
              <ActionFormError />
              <ActionFormSuccessToast />
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Stable definition key" name="key">
                  <Input
                    id="key"
                    name="key"
                    defaultValue={
                      deployment?.definitionKey ?? "lia_staging_voice"
                    }
                    required
                  />
                </Field>
                <Field label="Assistant name" name="agentName">
                  <Input
                    id="agentName"
                    name="name"
                    defaultValue={`${project.name} Voice Assistant`}
                    required
                  />
                </Field>
                <Field label="Language" name="language">
                  <Input
                    id="language"
                    name="language"
                    defaultValue="en-AU"
                    required
                  />
                </Field>
                <Field label="Timezone" name="timezone">
                  <Input
                    id="timezone"
                    name="timezone"
                    defaultValue="Australia/Sydney"
                    required
                  />
                </Field>
                <Field label="Identity requirement" name="identityRequirement">
                  <select
                    className={selectClassName}
                    defaultValue="verified"
                    id="identityRequirement"
                    name="identityRequirement"
                  >
                    <option value="verified">Verified</option>
                    <option value="anonymous">Anonymous</option>
                  </select>
                </Field>
                <Field label="Verification factors" name="verificationFactors">
                  <Input
                    id="verificationFactors"
                    name="verificationFactors"
                    defaultValue="date_of_birth,contact_number"
                    placeholder="Comma-separated stable keys"
                  />
                </Field>
                <Field label="Handoff mode" name="handoffMode">
                  <select
                    className={selectClassName}
                    defaultValue="available"
                    id="handoffMode"
                    name="handoffMode"
                  >
                    <option value="available">Available</option>
                    <option value="required">Required</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </Field>
                <Field label="Metadata retention days" name="retentionDays">
                  <Input
                    id="retentionDays"
                    name="retentionDays"
                    type="number"
                    min={1}
                    max={365}
                    defaultValue={30}
                    required
                  />
                </Field>
              </div>
              <Field label="Exact greeting" name="greeting">
                <Textarea
                  id="greeting"
                  name="greeting"
                  rows={3}
                  placeholder="Use synthetic staging identity only."
                  required
                />
              </Field>
              <Field label="Approved agent instructions" name="instructions">
                <Textarea
                  id="instructions"
                  name="instructions"
                  rows={14}
                  placeholder="Paste the reviewed hosted voice instructions."
                  required
                />
              </Field>
              <fieldset className="space-y-3 rounded-md border p-4">
                <legend className="px-1 text-sm font-medium">
                  Immutable published task versions
                </legend>
                {taskOptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Publish the booking task before creating a voice candidate.
                  </p>
                ) : (
                  taskOptions.map((task) => (
                    <label
                      className="flex items-start gap-3 text-sm"
                      key={task.taskVersionId}
                    >
                      <input
                        className="mt-1"
                        name="taskVersionIds"
                        type="checkbox"
                        value={task.taskVersionId}
                      />
                      <span>
                        <span className="font-medium">{task.name}</span>{" "}
                        <span className="text-muted-foreground">
                          task #{task.taskId}, version {task.versionNumber},
                          snapshot #{task.taskVersionId}
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </fieldset>
              <FormSubmitButton
                icon={<Bot className="size-4" />}
                label="Publish verified candidate"
                pendingLabel="Publishing..."
              />
            </ActionStateForm>
          </CardContent>
        </Card>

        {deployment?.candidateDeploymentVersionId && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-5" />
                Candidate tool binding
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Rotating invalidates the prior credential. The generated
                manifest describes the exact candidate-version webhook tools;
                use Telnyx Integration Secrets for the bearer value.
              </p>
              <HostedVoiceBindingForm
                action={rotateHostedVoiceBindingAction}
                deploymentVersionId={deployment.candidateDeploymentVersionId}
              />
            </CardContent>
          </Card>
        )}

        {deployment && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RotateCcw className="size-5" />
                Drift, promotion, and rollback
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 lg:grid-cols-3">
              <LifecycleForm
                action={inspectHostedVoiceDeploymentAction}
                deploymentId={deployment.id}
                label="Inspect remote main"
              />
              <LifecycleForm
                action={promoteHostedVoiceCandidateAction}
                confirmLabel="Candidate passed staging UAT"
                confirmValue="promote"
                deploymentId={deployment.id}
                disabled={!deployment.candidateRemoteVersionId}
                label="Promote candidate"
              />
              <LifecycleForm
                action={rollbackHostedVoiceDeploymentAction}
                confirmLabel="Roll back to the recorded version"
                confirmValue="rollback"
                deploymentId={deployment.id}
                disabled={!deployment.rollbackRemoteVersionId}
                label="Promote rollback target"
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-white p-4">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 break-all font-medium">{value}</p>
    </div>
  );
}

function Field({
  children,
  label,
  name,
}: {
  children: React.ReactNode;
  label: string;
  name: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      {children}
    </div>
  );
}

function LifecycleForm({
  action,
  confirmLabel,
  confirmValue,
  deploymentId,
  disabled = false,
  label,
}: {
  action: (
    previousState: { error?: string; success?: string },
    formData: FormData,
  ) => Promise<{ error?: string; success?: string }>;
  confirmLabel?: string;
  confirmValue?: string;
  deploymentId: number;
  disabled?: boolean;
  label: string;
}) {
  return (
    <ActionStateForm
      action={action}
      className="space-y-3 rounded-md border p-4"
    >
      <input name="deploymentId" type="hidden" value={deploymentId} />
      <ActionFormError />
      <ActionFormSuccessToast />
      {confirmLabel && confirmValue && (
        <label className="flex items-start gap-2 text-sm">
          <input
            className="mt-1"
            name="confirm"
            required
            type="checkbox"
            value={confirmValue}
          />
          {confirmLabel}
        </label>
      )}
      <FormSubmitButton
        disabled={disabled}
        label={label}
        pendingLabel="Working..."
      />
    </ActionStateForm>
  );
}
