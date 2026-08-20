"use client";

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-action-button";

type HandoffQueueActionButtonProps = {
  icon: ReactNode;
  label: string;
  pendingLabel: string;
  value: string;
};

export function HandoffQueueActionButton({
  icon,
  label,
  pendingLabel,
  value,
}: HandoffQueueActionButtonProps) {
  const { data, pending } = useFormStatus();
  const isActiveAction = pending && data?.get("queueAction") === value;
  const needsConfirmation = ["Release", "Resolve", "Close", "Cancel"].includes(
    label,
  );

  if (needsConfirmation) {
    return (
      <ConfirmSubmitButton
        name="queueAction"
        value={value}
        variant="outline"
        disabled={pending}
        confirmation={{
          title: `${label} ${value.endsWith("_selected") ? "selected handoffs" : "this handoff"}?`,
          description:
            label === "Release"
              ? "This removes the current assignee and returns the handoff to the queue."
              : `This changes the handoff lifecycle status to ${label.toLowerCase()}.`,
          confirmLabel: label,
          confirmVariant: label === "Release" ? "default" : "destructive",
        }}
        pendingContent={
          isActiveAction ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {pendingLabel}
            </>
          ) : (
            <>
              {icon}
              {label}
            </>
          )
        }
      >
        {icon}
        {label}
      </ConfirmSubmitButton>
    );
  }

  return (
    <Button
      type="submit"
      name="queueAction"
      value={value}
      variant="outline"
      disabled={pending}
      aria-busy={isActiveAction}
      pendingBehavior="manual"
    >
      {isActiveAction ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        <>
          {icon}
          {label}
        </>
      )}
    </Button>
  );
}
