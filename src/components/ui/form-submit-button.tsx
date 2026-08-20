"use client";

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  type ActionConfirmation,
  ConfirmSubmitButton,
} from "@/components/ui/confirm-action-button";

type FormSubmitButtonProps = {
  label: string;
  pendingLabel?: string;
  icon?: ReactNode;
  pendingIcon?: ReactNode;
  className?: string;
  disabled?: boolean;
  confirmation?: ActionConfirmation;
  variant?:
    | "default"
    | "outline"
    | "secondary"
    | "ghost"
    | "link"
    | "destructive";
};

export function FormSubmitButton({
  label,
  pendingLabel,
  icon,
  pendingIcon,
  className,
  disabled = false,
  confirmation,
  variant = "default",
}: FormSubmitButtonProps) {
  if (confirmation) {
    return (
      <ConfirmSubmitButton
        className={className}
        confirmation={confirmation}
        disabled={disabled}
        variant={variant}
        pendingContent={
          <>
            {pendingIcon ?? <Loader2 className="h-4 w-4 animate-spin" />}
            {pendingLabel ?? "Please wait..."}
          </>
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
      className={className}
      variant={variant}
      disabled={disabled}
      pendingContent={
        <>
          {pendingIcon ?? <Loader2 className="h-4 w-4 animate-spin" />}
          {pendingLabel ?? "Please wait..."}
        </>
      }
    >
      {icon}
      {label}
    </Button>
  );
}
