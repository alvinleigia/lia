"use client";

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type FormSubmitButtonProps = {
  label: string;
  pendingLabel?: string;
  icon?: ReactNode;
  pendingIcon?: ReactNode;
  className?: string;
  disabled?: boolean;
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
  variant = "default",
}: FormSubmitButtonProps) {
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
