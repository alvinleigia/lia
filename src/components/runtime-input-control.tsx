"use client";

import { Button } from "@/components/ui/button";
import type { RuntimeInputRequest } from "@/lib/runtime-input-request";

type RuntimeInputControlProps = {
  compact?: boolean;
  disabled?: boolean;
  onSubmit: (value: string, displayText?: string) => void | Promise<void>;
  request: RuntimeInputRequest;
};

export function RuntimeInputControl({
  compact = false,
  disabled = false,
  onSubmit,
  request,
}: RuntimeInputControlProps) {
  if (request.inputKind === "choice" && request.options.length > 0) {
    return (
      <div className="flex flex-wrap gap-2 pt-2">
        {request.options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size={compact ? "sm" : "default"}
            variant="outline"
            disabled={disabled}
            onClick={() => onSubmit(option.value, option.label)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    );
  }

  if (request.inputKind === "media") {
    return (
      <p className="mt-2 rounded-md border bg-background p-3 text-sm text-muted-foreground">
        Upload the requested file using this channel&apos;s media control.
      </p>
    );
  }

  return null;
}
