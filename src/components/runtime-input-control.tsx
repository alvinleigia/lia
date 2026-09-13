"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const dateId = useId();
  const [date, setDate] = useState("");

  if (request.inputKind === "date") {
    return (
      <form
        className="space-y-2 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (date && !disabled) void onSubmit(date);
        }}
      >
        <Label htmlFor={dateId}>{request.label}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-auto max-w-full"
            id={dateId}
            type="date"
            required
            value={date}
            disabled={disabled}
            onChange={(event) => setDate(event.target.value)}
          />
          <Button
            type="submit"
            size={compact ? "sm" : "default"}
            variant="outline"
            disabled={disabled || !date}
          >
            Use date
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          You can also type a date or your full request below.
        </p>
      </form>
    );
  }

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
