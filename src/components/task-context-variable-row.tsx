import { Pencil, Trash2 } from "lucide-react";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-action-button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionFormState } from "@/lib/action-form-state";
import type { ContextVariableRemovalEvaluation } from "@/lib/context-variable-dependencies";
import {
  type ConversationalTaskDefinitionV1,
  CUSTOM_CONTEXT_SOURCES,
  FIELD_TYPES,
} from "@/lib/conversation-contracts";

type ContextVariable =
  ConversationalTaskDefinitionV1["contextVariables"][number];

type TaskContextVariableRowProps = {
  projectId: number;
  taskId: number;
  variable: ContextVariable;
  removal: ContextVariableRemovalEvaluation;
  updateAction: (
    previousState: ActionFormState,
    formData: FormData,
  ) => Promise<ActionFormState>;
  removeAction: (formData: FormData) => Promise<void>;
};

const selectClass = "h-9 w-full rounded-md border bg-white px-3 text-sm";

export function TaskContextVariableRow({
  projectId,
  taskId,
  variable,
  removal,
  updateAction,
  removeAction,
}: TaskContextVariableRowProps) {
  const usageId = `context-usage-${variable.key}`;

  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{variable.key}</p>
          {removal.protected && (
            <Badge variant="secondary">System protected</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {variable.source} / {variable.type} / {variable.sensitivity}
          {variable.expiresAfterMinutes
            ? ` / expires in ${variable.expiresAfterMinutes} minutes`
            : ""}
        </p>
        {removal.dependencies.length > 0 && (
          <p id={usageId} className="text-sm text-muted-foreground">
            Used by:{" "}
            {removal.dependencies
              .map((dependency) => dependency.location)
              .join(", ")}
          </p>
        )}
      </div>
      {!removal.protected && (
        <div className="flex shrink-0 items-center gap-1">
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" size="icon" variant="ghost">
                <Pencil className="h-4 w-4" />
                <span className="sr-only">Edit {variable.key}</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Context Variable</DialogTitle>
                <DialogDescription>
                  Update trusted sourcing, privacy, and expiry without changing
                  the stable key.
                </DialogDescription>
              </DialogHeader>
              <ActionStateForm action={updateAction} className="space-y-4">
                <ActionFormError />
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="taskId" value={taskId} />
                <input type="hidden" name="contextKey" value={variable.key} />
                <div className="space-y-2">
                  <Label>Key</Label>
                  <Input value={variable.key} disabled />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`source-${variable.key}`}>Source</Label>
                    <select
                      id={`source-${variable.key}`}
                      name="contextSource"
                      className={selectClass}
                      defaultValue={variable.source}
                    >
                      {CUSTOM_CONTEXT_SOURCES.map((source) => (
                        <option key={source} value={source}>
                          {source}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`type-${variable.key}`}>Type</Label>
                    <select
                      id={`type-${variable.key}`}
                      name="contextType"
                      className={selectClass}
                      defaultValue={variable.type}
                    >
                      {FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor={`default-${variable.key}`}>
                      Default Value
                    </Label>
                    <Input
                      id={`default-${variable.key}`}
                      name="defaultValue"
                      defaultValue={variable.defaultValue ?? ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`sensitivity-${variable.key}`}>
                      Sensitivity
                    </Label>
                    <select
                      id={`sensitivity-${variable.key}`}
                      name="contextSensitivity"
                      className={selectClass}
                      defaultValue={variable.sensitivity}
                    >
                      <option value="standard">Standard</option>
                      <option value="personal">Personal</option>
                      <option value="sensitive">Sensitive</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`expiry-${variable.key}`}>
                      Expires After (minutes)
                    </Label>
                    <Input
                      id={`expiry-${variable.key}`}
                      name="expiresAfterMinutes"
                      type="number"
                      min={1}
                      defaultValue={variable.expiresAfterMinutes ?? ""}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-6">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      name="modelVisible"
                      defaultChecked={variable.modelVisible}
                    />
                    Visible to the assistant
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      name="toolVisible"
                      defaultChecked={variable.toolVisible}
                    />
                    Visible to allowed tools
                  </label>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="outline">
                      Cancel
                    </Button>
                  </DialogClose>
                  <FormSubmitButton
                    label="Save Changes"
                    pendingLabel="Saving..."
                  />
                </DialogFooter>
              </ActionStateForm>
            </DialogContent>
          </Dialog>
          {removal.allowed ? (
            <form action={removeAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="taskId" value={taskId} />
              <input type="hidden" name="contextKey" value={variable.key} />
              <ConfirmSubmitButton
                size="icon"
                variant="ghost"
                confirmation={{
                  title: `Remove ${variable.key}?`,
                  description:
                    "This removes the context variable from the editable task definition.",
                  confirmLabel: "Remove Context",
                  confirmVariant: "destructive",
                }}
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Remove {variable.key}</span>
              </ConfirmSubmitButton>
            </form>
          ) : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled
              aria-describedby={usageId}
              title={removal.reason}
            >
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">{removal.reason}</span>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
