"use client";

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

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
