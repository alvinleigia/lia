"use client";

import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import type {
  FlowStep,
  HybridEntryPolicyInput,
  HybridEntryRouteInput,
} from "@/components/action-flow-canvas/types";
import { FormErrorMessage } from "@/components/ui/action-state-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readHybridFlowEntryPolicySettings } from "@/lib/hybrid-flow-compiler";

type EntryRouteDraft = HybridEntryRouteInput & {
  id: string;
};

let nextEntryRouteId = 0;

function createEntryRouteDraft(route?: HybridEntryRouteInput): EntryRouteDraft {
  nextEntryRouteId += 1;
  return {
    id: `entry-route-${nextEntryRouteId}`,
    key: route?.key ?? "",
    stepId: route?.stepId ?? 0,
  };
}

function toRouteDrafts(routes: Record<string, number>) {
  return Object.entries(routes).map(([key, stepId]) =>
    createEntryRouteDraft({ key, stepId }),
  );
}

function StepSelect({
  id,
  onChange,
  steps,
  value,
}: {
  id: string;
  onChange: (stepId: number) => void;
  steps: FlowStep[];
  value: number;
}) {
  return (
    <select
      id={id}
      className="flex h-10 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      value={value || ""}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      <option value="">Choose a start step</option>
      {steps.map((step) => (
        <option key={step.id} value={step.id}>
          {step.sortOrder}. {step.label || step.stepType}
        </option>
      ))}
    </select>
  );
}

function EntryRouteList({
  description,
  keyPlaceholder,
  label,
  onChange,
  routes,
  steps,
}: {
  description: string;
  keyPlaceholder: string;
  label: string;
  onChange: (routes: EntryRouteDraft[]) => void;
  routes: EntryRouteDraft[];
  steps: FlowStep[];
}) {
  return (
    <div className="space-y-3 rounded-md border p-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>

      {routes.map((route, index) => (
        <div
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]"
          key={route.id}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${route.id}-key`}>Match Value</Label>
            <Input
              id={`${route.id}-key`}
              value={route.key}
              placeholder={keyPlaceholder}
              onChange={(event) =>
                onChange(
                  routes.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, key: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${route.id}-step`}>Start At</Label>
            <StepSelect
              id={`${route.id}-step`}
              onChange={(stepId) =>
                onChange(
                  routes.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, stepId } : item,
                  ),
                )
              }
              steps={steps}
              value={route.stepId}
            />
          </div>
          <Button
            aria-label={`Remove ${label.toLowerCase()} rule ${index + 1}`}
            className="self-end"
            onClick={() =>
              onChange(routes.filter((_, itemIndex) => itemIndex !== index))
            }
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange([...routes, createEntryRouteDraft()])}
      >
        <Plus className="h-4 w-4" />
        Add Rule
      </Button>
    </div>
  );
}

function toEntryRouteInput(routes: EntryRouteDraft[]) {
  return routes.map(({ key, stepId }) => ({ key: key.trim(), stepId }));
}

export function HybridEntryPolicyForm({
  actionSettings,
  isPending,
  onSubmit,
  steps,
}: {
  actionSettings: Record<string, unknown>;
  isPending: boolean;
  onSubmit: (input: HybridEntryPolicyInput) => void;
  steps: FlowStep[];
}) {
  const stored = readHybridFlowEntryPolicySettings(actionSettings);
  const enabledSteps = steps.filter((step) => step.isEnabled);
  const [normalStepId, setNormalStepId] = useState(
    stored?.normalStepId ?? enabledSteps[0]?.id ?? 0,
  );
  const [deepLinkRoutes, setDeepLinkRoutes] = useState(() =>
    toRouteDrafts(stored?.deepLinkRoutes ?? {}),
  );
  const [campaignRoutes, setCampaignRoutes] = useState(() =>
    toRouteDrafts(stored?.campaignRoutes ?? {}),
  );
  const [channelRoutes, setChannelRoutes] = useState(() =>
    toRouteDrafts(stored?.channelRoutes ?? {}),
  );
  const [error, setError] = useState("");

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        const allRoutes = [
          ...deepLinkRoutes,
          ...campaignRoutes,
          ...channelRoutes,
        ];
        if (
          normalStepId === 0 ||
          allRoutes.some((route) => !route.key.trim() || route.stepId === 0)
        ) {
          setError("Choose a start step and complete every entry rule.");
          return;
        }
        onSubmit({
          campaignRoutes: toEntryRouteInput(campaignRoutes),
          channelRoutes: toEntryRouteInput(channelRoutes),
          deepLinkRoutes: toEntryRouteInput(deepLinkRoutes),
          normalStepId,
        });
      }}
    >
      <FormErrorMessage error={error} />

      {enabledSteps.length === 0 ? (
        <p className="rounded-md border px-3 py-3 text-sm text-muted-foreground">
          Add and enable a flow step before configuring entry rules.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="hybrid-normal-entry">Normal Conversations</Label>
            <StepSelect
              id="hybrid-normal-entry"
              onChange={setNormalStepId}
              steps={enabledSteps}
              value={normalStepId}
            />
            <p className="text-xs text-muted-foreground">
              Used when no approved link, campaign, or channel rule matches.
            </p>
          </div>

          <EntryRouteList
            description="Open an approved entry point such as a booking or support link."
            keyPlaceholder="book-service"
            label="Website Link Rules"
            onChange={setDeepLinkRoutes}
            routes={deepLinkRoutes}
            steps={enabledSteps}
          />
          <EntryRouteList
            description="Start a specific journey for a known campaign code."
            keyPlaceholder="summer-offer"
            label="Campaign Rules"
            onChange={setCampaignRoutes}
            routes={campaignRoutes}
            steps={enabledSteps}
          />
          <EntryRouteList
            description="Choose the starting step for a supported conversation channel."
            keyPlaceholder="widget"
            label="Channel Rules"
            onChange={setChannelRoutes}
            routes={channelRoutes}
            steps={enabledSteps}
          />

          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Entry Rules
          </Button>
        </>
      )}
    </form>
  );
}
