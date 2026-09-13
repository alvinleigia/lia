"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DateTimeInputControlProps = {
  compact?: boolean;
  description?: string;
  disabled?: boolean;
  label: string;
  type: "date" | "time";
  onChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
  value: string;
};

export function DateTimeInputControl({
  compact = false,
  description,
  disabled = false,
  label,
  onChange,
  onSubmit,
  type,
  value,
}: DateTimeInputControlProps) {
  const inputId = useId();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // Server-rendered controls must wait for their change handler before accepting
  // input, otherwise a value entered during hydration can be lost.
  const isDisabled = disabled || !ready;

  return (
    <form
      className="space-y-2 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value && !isDisabled) void onSubmit(value);
      }}
    >
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-auto max-w-full"
          id={inputId}
          type={type}
          required
          value={value}
          disabled={isDisabled}
          aria-describedby={description ? `${inputId}-description` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          type="submit"
          size={compact ? "sm" : "default"}
          variant="outline"
          disabled={isDisabled || !value}
        >
          Use {type}
        </Button>
      </div>
      {description && (
        <p
          id={`${inputId}-description`}
          className="text-sm text-muted-foreground"
        >
          {description}
        </p>
      )}
    </form>
  );
}
