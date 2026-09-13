"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DateInputControlProps = {
  compact?: boolean;
  description?: string;
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
  value: string;
};

export function DateInputControl({
  compact = false,
  description,
  disabled = false,
  label,
  onChange,
  onSubmit,
  value,
}: DateInputControlProps) {
  const dateId = useId();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // Server-rendered controls must wait for their change handler before accepting
  // input, otherwise a date entered during hydration can be lost.
  const isDisabled = disabled || !ready;

  return (
    <form
      className="space-y-2 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value && !isDisabled) void onSubmit(value);
      }}
    >
      <Label htmlFor={dateId}>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-auto max-w-full"
          id={dateId}
          type="date"
          required
          value={value}
          disabled={isDisabled}
          aria-describedby={description ? `${dateId}-description` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          type="submit"
          size={compact ? "sm" : "default"}
          variant="outline"
          disabled={isDisabled || !value}
        >
          Use date
        </Button>
      </div>
      {description && (
        <p
          id={`${dateId}-description`}
          className="text-sm text-muted-foreground"
        >
          {description}
        </p>
      )}
    </form>
  );
}
