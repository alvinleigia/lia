"use client";

import { Send } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  RuntimeInputKind,
  RuntimeInputRequest,
} from "@/lib/runtime-input-request";
import { cn } from "@/lib/utils";

type RuntimeInputControlProps = {
  compact?: boolean;
  disabled?: boolean;
  onSubmit: (value: string) => void | Promise<void>;
  request: RuntimeInputRequest;
};

const INPUT_TYPES: Record<
  Exclude<RuntimeInputKind, "choice">,
  "date" | "email" | "number" | "tel" | "text" | "time"
> = {
  date: "date",
  email: "email",
  number: "number",
  phone: "tel",
  text: "text",
  time: "time",
};

export function RuntimeInputControl({
  compact = false,
  disabled = false,
  onSubmit,
  request,
}: RuntimeInputControlProps) {
  const inputId = useId();
  const [value, setValue] = useState("");

  const submitValue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextValue = value.trim();
    if (!nextValue || disabled) {
      return;
    }

    await onSubmit(nextValue);
  };

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
            onClick={() => onSubmit(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    );
  }

  const inputType =
    request.inputKind === "choice" ? "text" : INPUT_TYPES[request.inputKind];

  return (
    <form
      className={cn(
        "mt-2 flex items-end gap-2 rounded-md border bg-background p-3",
        compact && "p-2",
      )}
      onSubmit={submitValue}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <label
          className="block text-xs font-medium text-foreground"
          htmlFor={inputId}
        >
          {request.label}
          {request.required ? " (required)" : ""}
        </label>
        <Input
          aria-label={request.label}
          autoComplete={
            request.inputKind === "email"
              ? "email"
              : request.inputKind === "phone"
                ? "tel"
                : undefined
          }
          disabled={disabled}
          inputMode={
            request.inputKind === "number"
              ? "decimal"
              : request.inputKind === "phone"
                ? "tel"
                : undefined
          }
          id={inputId}
          onChange={(event) => setValue(event.target.value)}
          type={inputType}
          value={value}
        />
      </div>
      <Button
        aria-label={`Send ${request.label}`}
        disabled={disabled || !value.trim()}
        size={compact ? "sm" : "icon"}
        type="submit"
      >
        <Send />
      </Button>
    </form>
  );
}
