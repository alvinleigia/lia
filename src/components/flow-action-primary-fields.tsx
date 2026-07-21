"use client";

import {
  CheckCircle2,
  ContactRound,
  GitBranch,
  Tags,
  UsersRound,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  type FlowActionStepType,
  getFlowActionFamilyDefinition,
} from "@/lib/flow-action-editor";

type Option = {
  id: number;
  label: string;
};

type FlowActionPrimaryFieldsProps = {
  defaultEnabled: boolean;
  defaultLabel?: string | null;
  defaultOperationId?: number | null;
  defaultPrompt?: string | null;
  defaultStatusFieldKey?: string | null;
  failureStepId?: string;
  idPrefix: string;
  operations: Option[];
  projectActions: Option[];
  reusableFieldKeys: string[];
  routeSteps: Option[];
  settings?: Record<string, unknown>;
  stepType: FlowActionStepType;
  successStepId?: string;
};

const ACTION_ICONS = {
  add_tag: Tags,
  connect_flow: Workflow,
  handoff: UsersRound,
  operation: GitBranch,
  set_attribute: ContactRound,
  submit: CheckCircle2,
} as const;

function getSettingText(settings: Record<string, unknown>, key: string) {
  const value = settings[key];
  return typeof value === "string" ? value : "";
}

function getHandoffPriority(settings: Record<string, unknown>) {
  const value = settings.handoffPriority;
  return value === "low" ||
    value === "normal" ||
    value === "high" ||
    value === "urgent"
    ? value
    : "normal";
}

function getConnectedActionId(settings: Record<string, unknown>) {
  return typeof settings.connectedActionId === "number"
    ? String(settings.connectedActionId)
    : "";
}

export function FlowActionFamilySummary({
  stepType,
}: {
  stepType: FlowActionStepType;
}) {
  const definition = getFlowActionFamilyDefinition(stepType);
  const Icon = ACTION_ICONS[stepType];

  if (!definition) {
    return null;
  }

  return (
    <div className="flex items-start gap-3 rounded-md border bg-gray-50 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-white">
        <Icon className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-sm font-medium">{definition.title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {definition.description}
        </span>
      </span>
    </div>
  );
}

export function FlowActionPrimaryFields({
  defaultEnabled,
  defaultLabel,
  defaultOperationId,
  defaultPrompt,
  defaultStatusFieldKey,
  failureStepId = "",
  idPrefix,
  operations,
  projectActions,
  reusableFieldKeys,
  routeSteps,
  settings = {},
  stepType,
  successStepId = "",
}: FlowActionPrimaryFieldsProps) {
  const savedOperationExecutionMode =
    settings.operationExecutionMode === "inline" ? "inline" : "post_submit";
  const [attributeValueSource, setAttributeValueSource] = useState(
    getSettingText(settings, "contactAttributeValueSource") || "field",
  );
  const [operationExecutionMode, setOperationExecutionMode] = useState<
    "inline" | "post_submit"
  >(savedOperationExecutionMode);

  useEffect(() => {
    setOperationExecutionMode(savedOperationExecutionMode);
  }, [savedOperationExecutionMode]);

  const requiresVisitorMessage = stepType === "handoff";
  const supportsVisitorMessage =
    stepType === "handoff" ||
    stepType === "submit" ||
    stepType === "connect_flow";

  return (
    <div className="space-y-4">
      <FlowActionFamilySummary stepType={stepType} />

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${idPrefix}-label`}>
          Step name
        </label>
        <input
          id={`${idPrefix}-label`}
          name="label"
          defaultValue={defaultLabel ?? ""}
          placeholder="Give this action a clear name"
          className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          Used by your team to identify this action on the canvas.
        </p>
      </div>

      {supportsVisitorMessage && (
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`${idPrefix}-prompt`}>
            {stepType === "handoff"
              ? "Message shown before handoff"
              : stepType === "submit"
                ? "Completion message"
                : "Transition message"}
          </label>
          <textarea
            id={`${idPrefix}-prompt`}
            name="prompt"
            rows={3}
            required={requiresVisitorMessage}
            defaultValue={defaultPrompt ?? ""}
            placeholder={
              stepType === "handoff"
                ? "A team member will continue this conversation."
                : stepType === "submit"
                  ? "Thanks. Your details have been saved."
                  : "Let's continue with the next part."
            }
            className="flex min-h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-3 text-sm leading-6 shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
      )}

      {stepType === "handoff" && (
        <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor={`${idPrefix}-handoff-queue`}
            >
              Team or queue
            </label>
            <input
              id={`${idPrefix}-handoff-queue`}
              name="handoffQueue"
              defaultValue={getSettingText(settings, "handoffQueue")}
              placeholder="Sales"
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor={`${idPrefix}-handoff-priority`}
            >
              Priority
            </label>
            <select
              id={`${idPrefix}-handoff-priority`}
              name="handoffPriority"
              defaultValue={getHandoffPriority(settings)}
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 sm:col-span-2">
            <input
              type="checkbox"
              name="handoffNotifyTeam"
              defaultChecked={settings.handoffNotifyTeam !== false}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-medium">Notify the team</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Run the selected notification operation when review is
                requested.
              </span>
            </span>
          </label>
        </div>
      )}

      {stepType === "operation" && (
        <div className="space-y-4 rounded-md border p-4">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor={`${idPrefix}-operation`}
            >
              Integration to run
            </label>
            <select
              id={`${idPrefix}-operation`}
              name="operationId"
              required
              defaultValue={defaultOperationId ?? ""}
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">Select an integration</option>
              {operations.map((operation) => (
                <option key={operation.id} value={operation.id}>
                  {operation.label}
                </option>
              ))}
            </select>
            {operations.length === 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p>Create a project operation before adding this action.</p>
                <Link
                  href="/projects/operations"
                  className="mt-2 inline-flex font-medium underline underline-offset-4"
                >
                  Open integrations
                </Link>
              </div>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">When to run it</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                <input
                  type="radio"
                  name="operationExecutionMode"
                  value="inline"
                  checked={operationExecutionMode === "inline"}
                  onChange={() => setOperationExecutionMode("inline")}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="block text-sm font-medium">
                    During the conversation
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Wait for the result and route on success or failure.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                <input
                  type="radio"
                  name="operationExecutionMode"
                  value="post_submit"
                  checked={operationExecutionMode === "post_submit"}
                  onChange={() => setOperationExecutionMode("post_submit")}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="block text-sm font-medium">
                    After submission
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Save the request first, then run the integration.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <details className="group rounded-md border bg-gray-50/50">
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium">
              Result and routing
            </summary>
            <div className="grid gap-4 border-t p-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <label
                  className="text-sm font-medium"
                  htmlFor={`${idPrefix}-operation-status-key`}
                >
                  Save result status as
                </label>
                <input
                  id={`${idPrefix}-operation-status-key`}
                  name="fieldKey"
                  defaultValue={defaultStatusFieldKey ?? ""}
                  placeholder="booking_status"
                  className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor={`${idPrefix}-operation-success`}
                >
                  On success
                </label>
                <select
                  id={`${idPrefix}-operation-success`}
                  name="operationSuccessStepId"
                  defaultValue={successStepId}
                  className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="">Continue normally</option>
                  {routeSteps.map((routeStep) => (
                    <option key={routeStep.id} value={routeStep.id}>
                      {routeStep.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor={`${idPrefix}-operation-failure`}
                >
                  On failure
                </label>
                <select
                  id={`${idPrefix}-operation-failure`}
                  name="operationFailureStepId"
                  defaultValue={failureStepId}
                  className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="">Continue normally</option>
                  {routeSteps.map((routeStep) => (
                    <option key={routeStep.id} value={routeStep.id}>
                      {routeStep.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </details>
        </div>
      )}

      {stepType === "handoff" && (
        <details className="group rounded-md border bg-gray-50/50">
          <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium">
            Team notification integration
          </summary>
          <div className="space-y-2 border-t p-3">
            <label
              className="text-sm font-medium"
              htmlFor={`${idPrefix}-handoff-operation`}
            >
              Operation to run
            </label>
            <select
              id={`${idPrefix}-handoff-operation`}
              name="operationId"
              defaultValue={defaultOperationId ?? ""}
              className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">No notification integration</option>
              {operations.map((operation) => (
                <option key={operation.id} value={operation.id}>
                  {operation.label}
                </option>
              ))}
            </select>
          </div>
        </details>
      )}

      {stepType === "connect_flow" && (
        <div className="space-y-4 rounded-md border p-4">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor={`${idPrefix}-connected-flow`}
            >
              Flow to open
            </label>
            <select
              id={`${idPrefix}-connected-flow`}
              name="connectedActionId"
              required
              defaultValue={getConnectedActionId(settings)}
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">Select a flow</option>
              {projectActions.map((action) => (
                <option key={action.id} value={action.id}>
                  {action.label}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              After that flow finishes
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                <input
                  type="radio"
                  name="connectFlowMode"
                  value="return"
                  defaultChecked={settings.connectFlowMode === "return"}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="block text-sm font-medium">Return here</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Resume this flow at its next step.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                <input
                  type="radio"
                  name="connectFlowMode"
                  value="jump"
                  defaultChecked={settings.connectFlowMode !== "return"}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="block text-sm font-medium">
                    End this flow
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Continue only in the selected flow.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        </div>
      )}

      {stepType === "set_attribute" && (
        <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <label
              className="text-sm font-medium"
              htmlFor={`${idPrefix}-attribute-name`}
            >
              Contact detail name
            </label>
            <input
              id={`${idPrefix}-attribute-name`}
              name="contactAttributeKey"
              required
              defaultValue={getSettingText(settings, "contactAttributeKey")}
              placeholder="lead_status"
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <p className="text-xs text-muted-foreground">
              Use a stable internal name such as lead_status or
              preferred_service.
            </p>
          </div>
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor={`${idPrefix}-attribute-source`}
            >
              Value comes from
            </label>
            <select
              id={`${idPrefix}-attribute-source`}
              name="contactAttributeValueSource"
              value={attributeValueSource}
              onChange={(event) =>
                setAttributeValueSource(event.currentTarget.value)
              }
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="field">A collected answer</option>
              <option value="static">A fixed value</option>
            </select>
          </div>
          {attributeValueSource === "field" ? (
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={`${idPrefix}-attribute-field`}
              >
                Answer to use
              </label>
              <input
                id={`${idPrefix}-attribute-field`}
                name="contactAttributeFieldKey"
                list={`${idPrefix}-reusable-fields`}
                required
                defaultValue={getSettingText(
                  settings,
                  "contactAttributeFieldKey",
                )}
                placeholder="guestEmail"
                className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <datalist id={`${idPrefix}-reusable-fields`}>
                {reusableFieldKeys.map((fieldKey) => (
                  <option key={fieldKey} value={fieldKey} />
                ))}
              </datalist>
            </div>
          ) : (
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={`${idPrefix}-attribute-value`}
              >
                Fixed value
              </label>
              <input
                id={`${idPrefix}-attribute-value`}
                name="contactAttributeValue"
                required
                defaultValue={getSettingText(settings, "contactAttributeValue")}
                placeholder="qualified"
                className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
          )}
        </div>
      )}

      {stepType === "add_tag" && (
        <div className="space-y-2 rounded-md border p-4">
          <label className="text-sm font-medium" htmlFor={`${idPrefix}-tags`}>
            Tags to add
          </label>
          <textarea
            id={`${idPrefix}-tags`}
            name="contactTagNames"
            rows={3}
            required
            defaultValue={getSettingText(settings, "contactTagNames")}
            placeholder={"Interested Lead\nHigh Intent"}
            className="flex min-h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-3 text-sm leading-6 shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Add one tag per line or separate tags with commas.
          </p>
        </div>
      )}

      <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
        <input
          type="checkbox"
          name="isEnabled"
          defaultChecked={defaultEnabled}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="block text-sm font-medium">Action active</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Include this action when the flow runs.
          </span>
        </span>
      </label>
    </div>
  );
}
