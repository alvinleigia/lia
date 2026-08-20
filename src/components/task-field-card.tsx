import { ArrowDown, ArrowUp, Copy, Pencil, Save, Trash2 } from "lucide-react";
import { TaskFieldFormFields } from "@/components/task-field-form-fields";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-action-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import type { ActionFormState } from "@/lib/action-form-state";
import {
  getFriendlyTaskFieldType,
  type TaskField,
} from "@/lib/conversational-task-builder";

type StatefulAction = (
  previousState: ActionFormState,
  formData: FormData,
) => Promise<ActionFormState>;

type FormAction = (formData: FormData) => Promise<void>;

export function TaskFieldCard({
  catalogs,
  duplicateAction,
  field,
  fields,
  index,
  moveAction,
  needsSetup,
  projectId,
  removeAction,
  taskId,
  updateAction,
}: {
  catalogs: Array<{ id: number; name: string }>;
  duplicateAction: FormAction;
  field: TaskField;
  fields: TaskField[];
  index: number;
  moveAction: FormAction;
  needsSetup: boolean;
  projectId: number;
  removeAction: FormAction;
  taskId: number;
  updateAction: StatefulAction;
}) {
  return (
    <div className="space-y-3 px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">
              {index + 1}. {field.label}
            </p>
            <Badge variant="outline">
              {getFriendlyTaskFieldType(field.type)}
            </Badge>
            {(field.required || field.requiredWhen) && (
              <Badge variant="secondary">
                {field.required ? "Required" : "Conditional"}
              </Badge>
            )}
            {needsSetup && (
              <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">
                Needs setup
              </Badge>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {field.prompt || "Lia will ask naturally using the visitor label."}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <form action={moveAction}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="fieldId" value={field.id} />
            <input type="hidden" name="direction" value="up" />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              disabled={index === 0}
              title="Move up"
            >
              <ArrowUp className="h-4 w-4" />
              <span className="sr-only">Move {field.label} up</span>
            </Button>
          </form>
          <form action={moveAction}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="fieldId" value={field.id} />
            <input type="hidden" name="direction" value="down" />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              disabled={index === fields.length - 1}
              title="Move down"
            >
              <ArrowDown className="h-4 w-4" />
              <span className="sr-only">Move {field.label} down</span>
            </Button>
          </form>
          <form action={duplicateAction}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="fieldId" value={field.id} />
            <Button type="submit" size="icon" variant="ghost" title="Duplicate">
              <Copy className="h-4 w-4" />
              <span className="sr-only">Duplicate {field.label}</span>
            </Button>
          </form>

          <Dialog>
            <DialogTrigger asChild>
              <Button size="icon" variant="ghost" title="Edit">
                <Pencil className="h-4 w-4" />
                <span className="sr-only">Edit {field.label}</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Edit {field.label}</DialogTitle>
                <DialogDescription>
                  Keep the common choices simple and open advanced sections only
                  when needed.
                </DialogDescription>
              </DialogHeader>
              <ActionStateForm action={updateAction} className="space-y-4">
                <ActionFormError />
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="taskId" value={taskId} />
                <TaskFieldFormFields
                  catalogs={catalogs}
                  field={field}
                  fields={fields}
                  idPrefix={`edit-${field.id}`}
                />
                <FormSubmitButton
                  label="Save Field"
                  pendingLabel="Saving..."
                  icon={<Save className="h-4 w-4" />}
                />
              </ActionStateForm>
            </DialogContent>
          </Dialog>

          <form action={removeAction}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="fieldId" value={field.id} />
            <ConfirmSubmitButton
              size="icon"
              variant="ghost"
              className="text-red-600 hover:text-red-700"
              title="Delete"
              confirmation={{
                title: `Delete ${field.label}?`,
                description:
                  "This removes the field from the editable task definition.",
                confirmLabel: "Delete Field",
                confirmVariant: "destructive",
              }}
            >
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Remove {field.label}</span>
            </ConfirmSubmitButton>
          </form>
        </div>
      </div>
    </div>
  );
}
