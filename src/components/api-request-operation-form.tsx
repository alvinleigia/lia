"use client";

import { Plus, Trash2, Workflow } from "lucide-react";
import { useRef, useState } from "react";
import { createApiRequestOperationAction } from "@/app/projects/operations/actions";
import {
  ActionFormError,
  ActionStateForm,
} from "@/components/ui/action-state-form";
import { Button } from "@/components/ui/button";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HTTP_METHODS } from "@/lib/operation-contracts";

type Pair = { id: number; key: string; value: string };

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background";

function PairEditor({
  addLabel,
  keyLabel,
  keyPlaceholder,
  pairs,
  setPairs,
  valueLabel,
  valuePlaceholder,
}: {
  addLabel: string;
  keyLabel: string;
  keyPlaceholder: string;
  pairs: Pair[];
  setPairs: (pairs: Pair[]) => void;
  valueLabel: string;
  valuePlaceholder: string;
}) {
  const nextId = useRef(Math.max(0, ...pairs.map((pair) => pair.id)) + 1);

  return (
    <div className="space-y-3 rounded-md border p-4">
      {pairs.map((pair, index) => (
        <div key={pair.id} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor={`${addLabel}-${pair.id}-key`}>{keyLabel}</Label>
            <Input
              id={`${addLabel}-${pair.id}-key`}
              value={pair.key}
              placeholder={keyPlaceholder}
              onChange={(event) =>
                setPairs(
                  pairs.map((candidate) =>
                    candidate.id === pair.id
                      ? { ...candidate, key: event.currentTarget.value }
                      : candidate,
                  ),
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${addLabel}-${pair.id}-value`}>{valueLabel}</Label>
            <Input
              id={`${addLabel}-${pair.id}-value`}
              value={pair.value}
              placeholder={valuePlaceholder}
              onChange={(event) =>
                setPairs(
                  pairs.map((candidate) =>
                    candidate.id === pair.id
                      ? { ...candidate, value: event.currentTarget.value }
                      : candidate,
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
            aria-label={`Remove ${addLabel} ${index + 1}`}
            onClick={() => setPairs(pairs.filter(({ id }) => id !== pair.id))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setPairs([...pairs, { id: nextId.current, key: "", value: "" }]);
          nextId.current += 1;
        }}
      >
        <Plus className="h-4 w-4" />
        Add {addLabel}
      </Button>
    </div>
  );
}

function pairsToRecord(pairs: Pair[]) {
  return Object.fromEntries(
    pairs
      .map((pair) => [pair.key.trim(), pair.value.trim()] as const)
      .filter(([key]) => Boolean(key)),
  );
}

function buildOutputMapping(pairs: Pair[]) {
  return Object.fromEntries(
    pairs
      .map((pair) => {
        const target = pair.key.trim();
        const source = pair.value.trim().replace(/^\.+|\.+$/g, "");
        return target && source
          ? [`fields.${target}`, `responsePayload.response.body.${source}`]
          : null;
      })
      .filter((pair): pair is [string, string] => Boolean(pair)),
  );
}

export function ApiRequestOperationForm() {
  const [queryParameters, setQueryParameters] = useState<Pair[]>([]);
  const [headers, setHeaders] = useState<Pair[]>([]);
  const [bodyFields, setBodyFields] = useState<Pair[]>([
    { id: 1, key: "", value: "" },
  ]);
  const [outputFields, setOutputFields] = useState<Pair[]>([
    { id: 1, key: "", value: "" },
  ]);

  return (
    <ActionStateForm
      action={createApiRequestOperationAction}
      className="space-y-4"
    >
      <ActionFormError />
      <input
        type="hidden"
        name="queryParameters"
        value={JSON.stringify(pairsToRecord(queryParameters))}
      />
      <input
        type="hidden"
        name="headers"
        value={JSON.stringify(pairsToRecord(headers))}
      />
      <input
        type="hidden"
        name="inputMapping"
        value={JSON.stringify(pairsToRecord(bodyFields))}
      />
      <input
        type="hidden"
        name="outputMapping"
        value={JSON.stringify(buildOutputMapping(outputFields))}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="apiRequestName">Name</Label>
          <Input
            id="apiRequestName"
            name="name"
            placeholder="Check Availability"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="apiRequestMethod">HTTP Method</Label>
          <select
            id="apiRequestMethod"
            name="method"
            className={selectClassName}
            defaultValue="POST"
          >
            {HTTP_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </div>
      </div>
      <input type="hidden" name="providerType" value="webhook" />
      <div className="space-y-2">
        <Label htmlFor="apiRequestUrl">Endpoint URL</Label>
        <Input
          id="apiRequestUrl"
          name="url"
          placeholder="https://example.com/api/check-availability"
          type="url"
          required
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Query parameters</p>
        <PairEditor
          addLabel="query parameter"
          keyLabel="Parameter"
          keyPlaceholder="location"
          pairs={queryParameters}
          setPairs={setQueryParameters}
          valueLabel="Value"
          valuePlaceholder="Panaji"
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Request headers</p>
        <PairEditor
          addLabel="header"
          keyLabel="Header"
          keyPlaceholder="Authorization"
          pairs={headers}
          setPairs={setHeaders}
          valueLabel="Value"
          valuePlaceholder="Bearer ..."
        />
        <p className="text-xs text-muted-foreground">
          Authorization, token, API-key, password, and secret values are stored
          encrypted and excluded from exports and diagnostics.
        </p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">JSON body</p>
        <PairEditor
          addLabel="body field"
          keyLabel="Request field"
          keyPlaceholder="guestEmail"
          pairs={bodyFields}
          setPairs={setBodyFields}
          valueLabel="Flow field"
          valuePlaceholder="guestEmail"
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Response mapping</p>
        <PairEditor
          addLabel="response mapping"
          keyLabel="Save as flow field"
          keyPlaceholder="bookingId"
          pairs={outputFields}
          setPairs={setOutputFields}
          valueLabel="Response body path"
          valuePlaceholder="booking.id"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="apiRequestTimeoutMs">Timeout (milliseconds)</Label>
          <Input
            id="apiRequestTimeoutMs"
            name="timeoutMs"
            type="number"
            min="1000"
            max="30000"
            step="1000"
            defaultValue="15000"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="apiRequestRetryCount">Immediate retries</Label>
          <Input
            id="apiRequestRetryCount"
            name="retryCount"
            type="number"
            min="0"
            max="5"
            defaultValue="0"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="apiRequestCustomStatusCodes">
            Custom status outputs
          </Label>
          <Input
            id="apiRequestCustomStatusCodes"
            name="customStatusCodes"
            placeholder="202, 409"
          />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <label
          htmlFor="apiRequestAutoRetryEnabled"
          className="flex items-center gap-2 pt-8 text-sm"
        >
          <input
            id="apiRequestAutoRetryEnabled"
            name="autoRetryEnabled"
            type="checkbox"
          />
          Auto retry failed attempts
        </label>
        <div className="space-y-2">
          <Label htmlFor="apiRequestAutoRetryMaxAttempts">Queued retries</Label>
          <Input
            id="apiRequestAutoRetryMaxAttempts"
            name="autoRetryMaxAttempts"
            type="number"
            min="0"
            max="10"
            defaultValue="0"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="apiRequestAutoRetryDelayMinutes">
            Retry delay (minutes)
          </Label>
          <Input
            id="apiRequestAutoRetryDelayMinutes"
            name="autoRetryDelayMinutes"
            type="number"
            min="0"
            max="10080"
            defaultValue="5"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Use Operation Sandbox after creation to run an authorized test request
        with test-only values and inspect the sanitized response.
      </p>
      <FormSubmitButton
        className="w-full"
        label="Create API Request"
        pendingLabel="Creating..."
        icon={<Workflow className="h-4 w-4" />}
      />
    </ActionStateForm>
  );
}
