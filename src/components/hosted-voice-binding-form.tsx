"use client";

import { KeyRound } from "lucide-react";
import { useActionState } from "react";
import type { HostedVoiceBindingActionState } from "@/app/projects/channels/telnyx/hosted/actions";
import { FormErrorMessage } from "@/components/ui/action-state-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type HostedVoiceBindingFormProps = {
  action: (
    previousState: HostedVoiceBindingActionState,
    formData: FormData,
  ) => Promise<HostedVoiceBindingActionState>;
  deploymentVersionId: number;
};

export function HostedVoiceBindingForm({
  action,
  deploymentVersionId,
}: HostedVoiceBindingFormProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <input
        name="deploymentVersionId"
        type="hidden"
        value={deploymentVersionId}
      />
      <FormErrorMessage error={state.error} />
      {state.success && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          {state.success}
        </p>
      )}
      {state.credential && state.setupJson && (
        <div className="space-y-4 rounded-md border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-2 text-sm text-amber-900">
            <KeyRound className="mt-0.5 size-4 shrink-0" />
            This credential is shown once. Store it as a bearer-type Telnyx
            Integration Secret, then clear or navigate away from this page.
          </div>
          <div className="space-y-2">
            <Label htmlFor="hostedBindingCredential">
              One-time binding credential
            </Label>
            <Input
              id="hostedBindingCredential"
              readOnly
              value={state.credential}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hostedToolSetup">Telnyx tool setup manifest</Label>
            <Textarea
              className="font-mono text-xs"
              id="hostedToolSetup"
              readOnly
              rows={18}
              value={state.setupJson}
            />
          </div>
        </div>
      )}
      <Button disabled={pending} type="submit" variant="outline">
        <KeyRound className="size-4" />
        {pending ? "Rotating..." : "Rotate binding and generate setup"}
      </Button>
    </form>
  );
}
