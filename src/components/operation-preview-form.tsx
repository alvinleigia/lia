"use client";

import { Plus, Trash2, Workflow } from "lucide-react";
import { useMemo, useState } from "react";
import { previewOperationAction } from "@/app/projects/operations/actions";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Button } from "@/components/ui/button";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type TestField = {
  id: number;
  name: string;
  value: string;
};

export function OperationPreviewForm({
  operations,
}: {
  operations: Array<{ id: number; label: string }>;
}) {
  const [nextId, setNextId] = useState(3);
  const [fields, setFields] = useState<TestField[]>([
    { id: 1, name: "guestEmail", value: "test@example.com" },
    { id: 2, name: "preferredDate", value: "2026-08-15" },
  ]);
  const serializedFields = useMemo(
    () =>
      JSON.stringify(
        Object.fromEntries(
          fields
            .map((field) => [field.name.trim(), field.value] as const)
            .filter(([name]) => name),
        ),
      ),
    [fields],
  );

  return (
    <ActionStateForm action={previewOperationAction} className="space-y-4">
      <ActionFormError />
      <div className="space-y-2">
        <Label htmlFor="previewOperationId">Operation</Label>
        <select
          id="previewOperationId"
          name="operationId"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          disabled={operations.length === 0}
          required
        >
          {operations.map((operation) => (
            <option key={operation.id} value={operation.id}>
              {operation.label}
            </option>
          ))}
        </select>
      </div>

      <input name="fields" type="hidden" value={serializedFields} />
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Test values</p>
            <p className="text-xs text-muted-foreground">
              Use non-sensitive sample data. Field names must match the
              operation input mapping.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setFields((current) => [
                ...current,
                { id: nextId, name: "", value: "" },
              ]);
              setNextId((current) => current + 1);
            }}
          >
            <Plus className="h-4 w-4" />
            Add value
          </Button>
        </div>
        {fields.map((field) => (
          <div
            className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
            key={field.id}
          >
            <div className="space-y-1">
              <Label htmlFor={`preview-field-${field.id}-name`}>
                Field name
              </Label>
              <Input
                id={`preview-field-${field.id}-name`}
                placeholder="guestEmail"
                value={field.name}
                onChange={(event) =>
                  setFields((current) =>
                    current.map((item) =>
                      item.id === field.id
                        ? { ...item, name: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`preview-field-${field.id}-value`}>
                Test value
              </Label>
              <Input
                id={`preview-field-${field.id}-value`}
                placeholder="test@example.com"
                value={field.value}
                onChange={(event) =>
                  setFields((current) =>
                    current.map((item) =>
                      item.id === field.id
                        ? { ...item, value: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="self-end"
              aria-label={`Remove ${field.name || "test field"}`}
              onClick={() =>
                setFields((current) =>
                  current.filter((item) => item.id !== field.id),
                )
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
        Running a preview sends a real request to the configured endpoint and
        records an isolated attempt. It does not create or update a live flow
        submission.
      </div>
      <FormSubmitButton
        className="w-full"
        disabled={operations.length === 0}
        label="Send Test Request"
        pendingLabel="Sending..."
        icon={<Workflow className="h-4 w-4" />}
      />
    </ActionStateForm>
  );
}
