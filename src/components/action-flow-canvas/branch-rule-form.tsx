"use client";

import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  branchOperatorNeedsComparison,
  CANVAS_BRANCH_OPERATORS,
  formatBranchOperator,
  getBranchFieldOptions,
  getBranchOperatorHint,
  getBranchRuleSettingText,
  getNextBranchSortOrder,
  getStepLabel,
  getStepOptions,
  getStepRouteLabel,
  readBranchRuleForm,
} from "@/components/action-flow-canvas/model";
import type {
  BranchConditionDraft,
  BranchRule,
  CanvasBranchRuleInput,
  FlowStep,
} from "@/components/action-flow-canvas/types";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import {
  getStoredActionFlowConditionGroup,
  type StoredActionFlowConditionGroup,
} from "@/lib/action-flow-compiler";
import type { ActionBranchOperator } from "@/lib/action-flows";
import { getStoredActionOptionRoute } from "@/lib/action-option-routing";

export function BranchRuleForm({
  branchRules,
  isPending,
  mode,
  onDelete,
  onSubmit,
  rule,
  sourceStep,
  steps,
}: {
  branchRules: BranchRule[];
  isPending: boolean;
  mode: "create" | "edit";
  onDelete?: () => void;
  onSubmit: (input: CanvasBranchRuleInput) => void;
  rule?: BranchRule;
  sourceStep: FlowStep;
  steps: FlowStep[];
}) {
  const targetSteps = getStepOptions(steps, sourceStep.id);
  const availableFieldOptions = getBranchFieldOptions(steps);
  const defaultSourceFieldKey =
    rule?.sourceFieldKey ??
    sourceStep.fieldKey ??
    availableFieldOptions[0]?.fieldKey ??
    "";
  const parsedGroup = rule ? getStoredActionFlowConditionGroup(rule) : null;
  const optionRoute = rule ? getStoredActionOptionRoute(rule.settings) : null;
  const initialGroup = parsedGroup?.group ?? {
    combinator: "and" as const,
    conditions: [
      {
        comparisonValue: rule?.comparisonValue ?? "",
        fieldKey: defaultSourceFieldKey,
        operator: (rule?.operator ?? "equals") as ActionBranchOperator,
      },
    ],
    schemaVersion: 1 as const,
  };
  const fieldOptions = [...availableFieldOptions];
  for (const condition of initialGroup.conditions) {
    if (
      condition.fieldKey &&
      !fieldOptions.some((option) => option.fieldKey === condition.fieldKey)
    ) {
      fieldOptions.push({
        fieldKey: condition.fieldKey,
        inputType: "text",
        label: condition.fieldKey,
      });
    }
  }
  const [branchLabel, setBranchLabel] = useState(
    rule ? getBranchRuleSettingText(rule, "branchLabel") : "",
  );
  const [combinator, setCombinator] = useState<"and" | "or">(
    initialGroup.combinator,
  );
  const [conditions, setConditions] = useState<BranchConditionDraft[]>(
    initialGroup.conditions.map((condition, index) => ({
      comparisonValue: condition.comparisonValue ?? "",
      fieldKey: condition.fieldKey,
      id: `condition-${rule?.id ?? sourceStep.id}-${index}`,
      operator: condition.operator,
    })),
  );
  const [targetStepId, setTargetStepId] = useState(
    rule?.targetStepId ? String(rule.targetStepId) : "",
  );
  const firstCondition = conditions[0] ?? {
    comparisonValue: "",
    fieldKey: defaultSourceFieldKey,
    id: "condition-fallback",
    operator: "equals",
  };
  const storedConditionGroup: StoredActionFlowConditionGroup = {
    combinator,
    conditions: conditions.map((condition) => ({
      comparisonValue: branchOperatorNeedsComparison(condition.operator)
        ? condition.comparisonValue
        : null,
      fieldKey: condition.fieldKey,
      operator: condition.operator as ActionBranchOperator,
    })),
    schemaVersion: 1,
  };
  const conditionDescriptions = conditions.map((condition) => {
    const field = fieldOptions.find(
      (option) => option.fieldKey === condition.fieldKey,
    );
    const comparison = branchOperatorNeedsComparison(condition.operator)
      ? ` ${condition.comparisonValue || "value"}`
      : "";
    return `${field?.label || condition.fieldKey || "Answer"} ${formatBranchOperator(
      condition.operator,
    ).toLowerCase()}${comparison}`;
  });
  const conditionPreview = conditionDescriptions.join(
    combinator === "and" ? " and " : " or ",
  );
  const routePreviewLabel = branchLabel.trim() || conditionPreview;
  const targetPreview = targetStepId
    ? getStepRouteLabel(steps, Number(targetStepId))
    : "Select target step";

  function updateCondition(
    conditionId: string,
    updates: Partial<BranchConditionDraft>,
  ) {
    setConditions((current) =>
      current.map((condition) =>
        condition.id === conditionId ? { ...condition, ...updates } : condition,
      ),
    );
  }

  function getAvailableOperators(condition: BranchConditionDraft) {
    const field = fieldOptions.find(
      (option) => option.fieldKey === condition.fieldKey,
    );
    const inputType = field?.inputType ?? "text";
    const compatible = CANVAS_BRANCH_OPERATORS.filter((candidate) => {
      if (candidate === "contains") {
        return inputType === "text";
      }
      if (candidate === "greater_than" || candidate === "less_than") {
        return inputType !== "text";
      }
      return true;
    });

    return compatible.includes(
      condition.operator as (typeof CANVAS_BRANCH_OPERATORS)[number],
    )
      ? compatible
      : [
          condition.operator as (typeof CANVAS_BRANCH_OPERATORS)[number],
          ...compatible,
        ];
  }

  return (
    <form
      key={`${mode}-${rule?.id ?? sourceStep.id}`}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(readBranchRuleForm(event.currentTarget));
      }}
    >
      <input type="hidden" name="sourceStepId" value={sourceStep.id} />
      <input
        type="hidden"
        name="sourceOptionId"
        value={optionRoute?.sourceOptionId ?? ""}
      />
      <input
        type="hidden"
        name="sourceFieldKey"
        value={firstCondition.fieldKey}
      />
      <input type="hidden" name="operator" value={firstCondition.operator} />
      <input
        type="hidden"
        name="comparisonValue"
        value={
          branchOperatorNeedsComparison(firstCondition.operator)
            ? firstCondition.comparisonValue
            : ""
        }
      />
      <input
        type="hidden"
        name="conditionGroup"
        value={JSON.stringify(storedConditionGroup)}
      />

      <div className="rounded-md border bg-gray-50 p-3 text-sm">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Condition preview
        </p>
        <p className="mt-1 font-medium">{routePreviewLabel}</p>
        <p className="mt-1 text-muted-foreground">
          When {conditionPreview || "the conditions match"}, go to{" "}
          {targetPreview}.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-branch-label`}>
          Route name
        </label>
        <input
          id={`${mode}-branch-label`}
          name="branchLabel"
          value={branchLabel}
          onChange={(event) => setBranchLabel(event.currentTarget.value)}
          placeholder="Qualified lead"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          Optional name shown on the canvas line. Leave blank to use the
          condition.
        </p>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Match</p>
            <p className="text-xs text-muted-foreground">
              Check an answer collected by this flow.
            </p>
          </div>
          {conditions.length > 1 && (
            <select
              aria-label="Condition matching"
              value={combinator}
              onChange={(event) =>
                setCombinator(event.currentTarget.value as "and" | "or")
              }
              className="flex h-9 rounded-md border border-input bg-white px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="and">All conditions</option>
              <option value="or">Any condition</option>
            </select>
          )}
        </div>

        {conditions.map((condition, index) => {
          const field = fieldOptions.find(
            (option) => option.fieldKey === condition.fieldKey,
          );
          const needsComparison = branchOperatorNeedsComparison(
            condition.operator,
          );

          return (
            <div
              key={condition.id}
              className="space-y-3 rounded-md border bg-gray-50/60 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Condition {index + 1}
                </p>
                {conditions.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="Remove condition"
                    onClick={() =>
                      setConditions((current) =>
                        current.filter((item) => item.id !== condition.id),
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Remove condition</span>
                  </Button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`${mode}-${condition.id}-field`}
                  >
                    Answer
                  </label>
                  <select
                    id={`${mode}-${condition.id}-field`}
                    required
                    value={condition.fieldKey}
                    onChange={(event) =>
                      updateCondition(condition.id, {
                        fieldKey: event.currentTarget.value,
                        operator: "equals",
                      })
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {fieldOptions.length === 0 ? (
                      <option value="">Create an answer field first</option>
                    ) : (
                      fieldOptions.map((option) => (
                        <option key={option.fieldKey} value={option.fieldKey}>
                          {option.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`${mode}-${condition.id}-operator`}
                  >
                    Comparison
                  </label>
                  <select
                    id={`${mode}-${condition.id}-operator`}
                    required
                    value={condition.operator}
                    onChange={(event) =>
                      updateCondition(condition.id, {
                        operator: event.currentTarget.value,
                      })
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {getAvailableOperators(condition).map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {formatBranchOperator(candidate)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {needsComparison && (
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor={`${mode}-${condition.id}-value`}
                  >
                    Value
                  </label>
                  <input
                    id={`${mode}-${condition.id}-value`}
                    type={field?.inputType ?? "text"}
                    required
                    value={condition.comparisonValue}
                    onChange={(event) =>
                      updateCondition(condition.id, {
                        comparisonValue: event.currentTarget.value,
                      })
                    }
                    placeholder="Value to match"
                    className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {getBranchOperatorHint(condition.operator)}
              </p>
            </div>
          );
        })}

        <Button
          type="button"
          variant="outline"
          disabled={fieldOptions.length === 0 || conditions.length >= 10}
          onClick={() => {
            const fieldKey = fieldOptions[0]?.fieldKey ?? "";
            setConditions((current) => [
              ...current,
              {
                comparisonValue: "",
                fieldKey,
                id: `condition-new-${Date.now()}`,
                operator: "equals",
              },
            ]);
          }}
        >
          <Plus className="h-4 w-4" />
          Add condition
        </Button>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-target`}>
          Go to
        </label>
        <select
          id={`${mode}-target`}
          name="targetStepId"
          required
          value={targetStepId}
          onChange={(event) => setTargetStepId(event.currentTarget.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">Select step</option>
          {targetSteps.map((step) => (
            <option key={step.id} value={step.id}>
              {step.sortOrder}. {getStepLabel(step)}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isEnabled"
          defaultChecked={rule?.isEnabled ?? true}
        />
        Route active
      </label>

      <details className="group rounded-md border bg-gray-50/50">
        <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium">
          Advanced route order
        </summary>
        <div className="space-y-2 border-t p-3">
          <label className="text-sm font-medium" htmlFor={`${mode}-sort-order`}>
            Priority order
          </label>
          <input
            id={`${mode}-sort-order`}
            name="sortOrder"
            type="number"
            min="1"
            required
            defaultValue={
              rule?.sortOrder ??
              getNextBranchSortOrder(branchRules, sourceStep.id)
            }
            className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Lower numbers are checked first when several routes can match.
          </p>
        </div>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending || targetSteps.length === 0}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === "create" ? (
            <Plus className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {mode === "create" ? "Add route" : "Save route"}
        </Button>
        {mode === "edit" && onDelete && (
          <ConfirmActionButton
            variant="destructive"
            disabled={isPending}
            onConfirm={onDelete}
            confirmation={{
              title: "Delete this route?",
              description:
                "This removes the branch route from the editable canvas draft.",
              confirmLabel: "Delete Route",
              confirmVariant: "destructive",
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </ConfirmActionButton>
        )}
      </div>
    </form>
  );
}
