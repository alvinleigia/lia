"use client";

import { getActionResponsePolicy } from "@/lib/action-response-policy";

type RouteStep = { id: number; label: string };

function RouteSelect({
  defaultValue,
  emptyLabel,
  id,
  label,
  name,
  routeSteps,
}: {
  defaultValue: number | null;
  emptyLabel: string;
  id: string;
  label: string;
  name: string;
  routeSteps: RouteStep[];
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <select
        className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        defaultValue={defaultValue ?? ""}
        id={id}
        name={name}
      >
        <option value="">{emptyLabel}</option>
        {routeSteps.map((step) => (
          <option key={step.id} value={step.id}>
            {step.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FlowResponsePolicyFields({
  idPrefix,
  routeSteps,
  settings,
}: {
  idPrefix: string;
  routeSteps: RouteStep[];
  settings?: Record<string, unknown>;
}) {
  const policy = getActionResponsePolicy(settings ?? {});

  return (
    <div className="space-y-4 rounded-md border bg-gray-50/50 p-4">
      <div>
        <p className="text-sm font-semibold">Response policy</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Control invalid answers, cancellation, and how long this exact
          published question waits for a reply.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor={`${idPrefix}-retry-count`}
          >
            Retry count
          </label>
          <input
            className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            defaultValue={policy.retryCount}
            id={`${idPrefix}-retry-count`}
            max="10"
            min="0"
            name="retryCount"
            type="number"
          />
        </div>
        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor={`${idPrefix}-retry-message`}
          >
            Retry message
          </label>
          <input
            className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            defaultValue={policy.retryMessage}
            id={`${idPrefix}-retry-message`}
            maxLength={500}
            name="retryMessage"
          />
        </div>
        <RouteSelect
          defaultValue={policy.validationFailureStepId}
          emptyLabel="Retry this question"
          id={`${idPrefix}-validation-failure-route`}
          label="Validation failure output"
          name="validationFailureStepId"
          routeSteps={routeSteps}
        />
        <RouteSelect
          defaultValue={policy.retryExhaustedStepId}
          emptyLabel="End the request"
          id={`${idPrefix}-retry-exhausted-route`}
          label="Retries exhausted output"
          name="retryExhaustedStepId"
          routeSteps={routeSteps}
        />
        <RouteSelect
          defaultValue={policy.cancellationStepId}
          emptyLabel="Cancel the request"
          id={`${idPrefix}-cancellation-route`}
          label="Cancellation output"
          name="cancellationStepId"
          routeSteps={routeSteps}
        />
      </div>

      <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor={`${idPrefix}-reminder-minutes`}
          >
            No-reply reminder after (minutes)
          </label>
          <input
            className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            defaultValue={policy.noReplyReminderMinutes ?? ""}
            id={`${idPrefix}-reminder-minutes`}
            max="10080"
            min="1"
            name="noReplyReminderMinutes"
            placeholder="Leave blank to disable"
            type="number"
          />
        </div>
        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor={`${idPrefix}-reminder-message`}
          >
            Reminder message
          </label>
          <input
            className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            defaultValue={policy.noReplyReminderMessage}
            id={`${idPrefix}-reminder-message`}
            maxLength={500}
            name="noReplyReminderMessage"
          />
        </div>
        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor={`${idPrefix}-timeout-minutes`}
          >
            No-reply timeout after (minutes)
          </label>
          <input
            className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            defaultValue={policy.noReplyTimeoutMinutes ?? ""}
            id={`${idPrefix}-timeout-minutes`}
            max="10080"
            min="1"
            name="noReplyTimeoutMinutes"
            placeholder="Leave blank to disable"
            type="number"
          />
        </div>
        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor={`${idPrefix}-timeout-message`}
          >
            Timeout message
          </label>
          <input
            className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            defaultValue={policy.noReplyTimeoutMessage}
            id={`${idPrefix}-timeout-message`}
            maxLength={500}
            name="noReplyTimeoutMessage"
          />
        </div>
        <RouteSelect
          defaultValue={policy.noReplyTimeoutStepId}
          emptyLabel="Cancel the request"
          id={`${idPrefix}-timeout-route`}
          label="No-reply timeout output"
          name="noReplyTimeoutStepId"
          routeSteps={routeSteps}
        />
      </div>
    </div>
  );
}
