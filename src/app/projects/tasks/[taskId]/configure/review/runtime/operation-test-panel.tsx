import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  SelectConversationalTaskConfirmation,
  SelectOperationAttempt,
} from "@/lib/db-schema";
import { cn } from "@/lib/utils";
import {
  confirmTaskRuntimeOperationAction,
  executeTaskRuntimeOperationAction,
  prepareTaskRuntimeOperationAction,
  processTaskRuntimeOperationAction,
  reconcileTaskRuntimeOperationAction,
} from "./actions";

type WriteOperation = {
  id: string;
  name: string;
};

type ConfirmationItem = {
  key: string;
  label: string;
  source: "field" | "tool";
  value: unknown;
};

type OperationTestPanelProps = {
  attempt: SelectOperationAttempt | null;
  confirmation: SelectConversationalTaskConfirmation | null;
  isActive: boolean;
  isPaused: boolean;
  operationFeedback?: {
    message: string;
    tone: "error" | "success" | "warning";
  };
  projectId: number;
  taskId: number;
  writeOperations: WriteOperation[];
};

const confirmationLabels: Record<string, string> = {
  confirmed: "Confirmed",
  consumed: "Completed",
  executing: "Queued",
  expired: "Expired",
  failed: "Failed",
  invalidated: "Needs review",
  outcome_unknown: "Needs reconciliation",
  pending: "Awaiting confirmation",
};

const attemptLabels: Record<string, string> = {
  completed: "Completed",
  failed: "Failed",
  outcome_unknown: "Outcome unknown",
  pending: "Queued",
  processing: "Processing",
};

function hiddenContext(projectId: number, taskId: number) {
  return (
    <>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
    </>
  );
}

function confirmationId(value: number) {
  return <input type="hidden" name="confirmationId" value={value} />;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined) return "Not provided";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function readConfirmationItems(
  confirmation: SelectConversationalTaskConfirmation | null,
) {
  const items = confirmation?.summary.items;
  if (!Array.isArray(items)) return [];

  return items.flatMap((item): ConfirmationItem[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.key !== "string" ||
      typeof record.label !== "string" ||
      (record.source !== "field" && record.source !== "tool")
    ) {
      return [];
    }
    return [
      {
        key: record.key,
        label: record.label,
        source: record.source,
        value: record.value,
      },
    ];
  });
}

function ActionForm({
  action,
  children,
  confirmation,
  projectId,
  taskId,
}: {
  action: (
    previousState: { error?: string },
    formData: FormData,
  ) => Promise<{ error?: string }>;
  children: React.ReactNode;
  confirmation: SelectConversationalTaskConfirmation;
  projectId: number;
  taskId: number;
}) {
  return (
    <ActionStateForm action={action} className="space-y-2">
      {hiddenContext(projectId, taskId)}
      {confirmationId(confirmation.id)}
      <ActionFormError />
      {children}
    </ActionStateForm>
  );
}

export function OperationTestPanel({
  attempt,
  confirmation,
  isActive,
  isPaused,
  operationFeedback,
  projectId,
  taskId,
  writeOperations,
}: OperationTestPanelProps) {
  if (writeOperations.length === 0 && !confirmation) return null;

  const items = readConfirmationItems(confirmation);
  const canPrepare =
    isActive &&
    !isPaused &&
    (!confirmation ||
      ["expired", "failed", "invalidated"].includes(confirmation.status));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <ShieldCheck className="h-5 w-5" />
          Confirmation and Operation Test
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Review the exact task values before a write operation is queued.
          Duplicate clicks reuse one durable attempt.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {operationFeedback && (
          <p
            role={operationFeedback.tone === "error" ? "alert" : "status"}
            className={cn(
              "rounded-md px-3 py-2 text-sm",
              operationFeedback.tone === "error" && "bg-red-50 text-red-700",
              operationFeedback.tone === "success" &&
                "bg-green-50 text-green-800",
              operationFeedback.tone === "warning" &&
                "bg-amber-50 text-amber-900",
            )}
          >
            {operationFeedback.message}
          </p>
        )}

        {canPrepare && (
          <ActionStateForm
            action={prepareTaskRuntimeOperationAction}
            className="space-y-4 rounded-md border p-4"
          >
            {hiddenContext(projectId, taskId)}
            <ActionFormError />
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="runtimeWriteTool">Write Operation</Label>
                <Select name="toolId" defaultValue={writeOperations[0]?.id}>
                  <SelectTrigger id="runtimeWriteTool" className="w-full">
                    <SelectValue placeholder="Choose an operation" />
                  </SelectTrigger>
                  <SelectContent>
                    {writeOperations.map((operation) => (
                      <SelectItem key={operation.id} value={operation.id}>
                        {operation.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit">
                <ClipboardCheck className="h-4 w-4" />
                Prepare Summary
              </Button>
            </div>
          </ActionStateForm>
        )}

        {confirmation && (
          <div className="space-y-4 rounded-md border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-medium">Confirmation Summary</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  This immutable summary expires at{" "}
                  {confirmation.expiresAt.toLocaleString()}.
                </p>
              </div>
              <Badge
                variant={
                  ["failed", "outcome_unknown"].includes(confirmation.status)
                    ? "destructive"
                    : confirmation.status === "consumed"
                      ? "default"
                      : "secondary"
                }
              >
                {confirmationLabels[confirmation.status] ?? confirmation.status}
              </Badge>
            </div>

            {items.length > 0 && (
              <dl className="grid gap-3 sm:grid-cols-2">
                {items.map((item) => (
                  <div key={`${item.source}:${item.key}`}>
                    <dt className="text-xs text-muted-foreground">
                      {item.label}
                    </dt>
                    <dd className="mt-1 break-words text-sm font-medium">
                      {displayValue(item.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {confirmation.status === "pending" && isActive && !isPaused && (
              <ActionForm
                action={confirmTaskRuntimeOperationAction}
                confirmation={confirmation}
                projectId={projectId}
                taskId={taskId}
              >
                <Button type="submit">
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm Explicitly
                </Button>
              </ActionForm>
            )}

            {confirmation.status === "confirmed" && isActive && !isPaused && (
              <ActionForm
                action={executeTaskRuntimeOperationAction}
                confirmation={confirmation}
                projectId={projectId}
                taskId={taskId}
              >
                <Button type="submit">
                  <Send className="h-4 w-4" />
                  Queue Operation
                </Button>
              </ActionForm>
            )}

            {confirmation.status === "executing" && isActive && (
              <div className="flex flex-wrap gap-2">
                <ActionForm
                  action={processTaskRuntimeOperationAction}
                  confirmation={confirmation}
                  projectId={projectId}
                  taskId={taskId}
                >
                  <Button type="submit">
                    <Play className="h-4 w-4" />
                    Process and Reconcile
                  </Button>
                </ActionForm>
                <ActionForm
                  action={executeTaskRuntimeOperationAction}
                  confirmation={confirmation}
                  projectId={projectId}
                  taskId={taskId}
                >
                  <Button type="submit" variant="outline">
                    <RefreshCw className="h-4 w-4" />
                    Verify Duplicate Protection
                  </Button>
                </ActionForm>
              </div>
            )}

            {confirmation.status === "outcome_unknown" && isActive && (
              <div className="space-y-4 rounded-md bg-amber-50 p-4 text-amber-950">
                <div className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-medium">
                      Manual reconciliation required
                    </p>
                    <p className="mt-1 text-sm">
                      Lia will not report success until an authorized operator
                      records the provider outcome.
                    </p>
                  </div>
                </div>
                <ActionStateForm
                  action={reconcileTaskRuntimeOperationAction}
                  className="space-y-3"
                >
                  {hiddenContext(projectId, taskId)}
                  {confirmationId(confirmation.id)}
                  <ActionFormError />
                  <div className="space-y-2">
                    <Label htmlFor="runtimeReconciliationPayload">
                      Provider Result JSON
                    </Label>
                    <Textarea
                      id="runtimeReconciliationPayload"
                      name="responsePayload"
                      placeholder='{"requestId":"confirmed-by-provider"}'
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" name="status" value="completed">
                      <CheckCircle2 className="h-4 w-4" />
                      Mark Completed
                    </Button>
                    <Button
                      type="submit"
                      name="status"
                      value="failed"
                      variant="outline"
                    >
                      Mark Failed
                    </Button>
                  </div>
                </ActionStateForm>
              </div>
            )}
          </div>
        )}

        {attempt && (
          <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Attempt</p>
              <p className="mt-1 font-medium">#{attempt.id}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Delivery Status</p>
              <p className="mt-1 font-medium">
                {attemptLabels[attempt.status] ?? attempt.status}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Finished</p>
              <p className="mt-1 font-medium">
                {attempt.finishedAt?.toLocaleString() ?? "Not yet"}
              </p>
            </div>
            {attempt.errorMessage && (
              <p className="text-sm text-destructive sm:col-span-3">
                {attempt.errorMessage}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
