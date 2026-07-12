import { Plus, Save, Trash2 } from "lucide-react";
import {
  createActionFlowBranchRuleAction,
  deleteActionFlowBranchRuleAction,
  updateActionFlowBranchRuleAction,
} from "@/app/projects/actions/actions";
import { ACTION_BRANCH_OPERATORS } from "@/lib/action-flows";
import { FormSubmitButton } from "./ui/form-submit-button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type RouteStepOption = {
  id: number;
  sortOrder: number;
  stepType: string;
  fieldKey: string | null;
  label: string | null;
};

type BranchRule = {
  id: number;
  sourceStepId: number;
  sourceFieldKey: string;
  operator: string;
  comparisonValue: string | null;
  targetStepId: number;
  sortOrder: number;
  isEnabled: boolean;
};

type ActionBranchRulesFormProps = {
  actionId: number;
  defaultSourceFieldKey: string;
  nextSortOrder: number;
  rules: BranchRule[];
  sourceStepId: number;
  steps: RouteStepOption[];
};

function formatOptionLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatStepLabel(step: RouteStepOption) {
  return `${step.sortOrder}. ${
    step.label || step.fieldKey || formatOptionLabel(step.stepType)
  }`;
}

function BranchRuleFields({
  defaultSourceFieldKey,
  defaultSortOrder,
  rule,
  sourceStepId,
  targetSteps,
}: {
  defaultSourceFieldKey: string;
  defaultSortOrder: number;
  rule?: BranchRule;
  sourceStepId: number;
  targetSteps: RouteStepOption[];
}) {
  return (
    <>
      <input type="hidden" name="sourceStepId" value={sourceStepId} />
      {rule && <input type="hidden" name="ruleId" value={rule.id} />}
      <div className="grid gap-3 md:grid-cols-5">
        <div className="space-y-2">
          <Label htmlFor={rule ? `sortOrder-${rule.id}` : "sortOrder-new"}>
            Order
          </Label>
          <Input
            id={rule ? `sortOrder-${rule.id}` : "sortOrder-new"}
            min="1"
            name="sortOrder"
            type="number"
            defaultValue={rule?.sortOrder ?? defaultSortOrder}
            required
          />
        </div>
        <div className="space-y-2">
          <Label
            htmlFor={rule ? `sourceFieldKey-${rule.id}` : "sourceFieldKey-new"}
          >
            Source Field
          </Label>
          <Input
            id={rule ? `sourceFieldKey-${rule.id}` : "sourceFieldKey-new"}
            name="sourceFieldKey"
            defaultValue={rule?.sourceFieldKey ?? defaultSourceFieldKey}
            placeholder="guestEmail"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={rule ? `operator-${rule.id}` : "operator-new"}>
            Operator
          </Label>
          <select
            id={rule ? `operator-${rule.id}` : "operator-new"}
            name="operator"
            defaultValue={rule?.operator ?? "equals"}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            required
          >
            {ACTION_BRANCH_OPERATORS.map((operator) => (
              <option key={operator} value={operator}>
                {formatOptionLabel(operator)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label
            htmlFor={
              rule ? `comparisonValue-${rule.id}` : "comparisonValue-new"
            }
          >
            Compare
          </Label>
          <Input
            id={rule ? `comparisonValue-${rule.id}` : "comparisonValue-new"}
            name="comparisonValue"
            defaultValue={rule?.comparisonValue ?? ""}
            placeholder="value"
          />
        </div>
        <div className="space-y-2">
          <Label
            htmlFor={rule ? `targetStepId-${rule.id}` : "targetStepId-new"}
          >
            Target
          </Label>
          <select
            id={rule ? `targetStepId-${rule.id}` : "targetStepId-new"}
            name="targetStepId"
            defaultValue={rule?.targetStepId ?? ""}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            required
          >
            <option value="">Select step</option>
            {targetSteps.map((step) => (
              <option key={step.id} value={step.id}>
                {formatStepLabel(step)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isEnabled"
          defaultChecked={rule?.isEnabled ?? true}
        />
        Enabled
      </label>
    </>
  );
}

export function ActionBranchRulesForm({
  actionId,
  defaultSourceFieldKey,
  nextSortOrder,
  rules,
  sourceStepId,
  steps,
}: ActionBranchRulesFormProps) {
  const targetSteps = steps.filter((step) => step.id !== sourceStepId);
  const canCreateRule = targetSteps.length > 0;

  return (
    <div className="space-y-5">
      {rules.length === 0 ? (
        <p className="rounded-md border bg-white p-3 text-sm text-muted-foreground">
          No branch rules configured for this step.
        </p>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-md border bg-white p-3">
              <form
                action={updateActionFlowBranchRuleAction}
                className="space-y-3"
              >
                <input type="hidden" name="actionId" value={actionId} />
                <BranchRuleFields
                  defaultSourceFieldKey={defaultSourceFieldKey}
                  defaultSortOrder={nextSortOrder}
                  rule={rule}
                  sourceStepId={sourceStepId}
                  targetSteps={targetSteps}
                />
                <div className="flex flex-wrap gap-2">
                  <FormSubmitButton
                    label="Save Rule"
                    pendingLabel="Saving..."
                    icon={<Save className="h-4 w-4" />}
                  />
                </div>
              </form>
              <form action={deleteActionFlowBranchRuleAction} className="mt-2">
                <input type="hidden" name="actionId" value={actionId} />
                <input type="hidden" name="ruleId" value={rule.id} />
                <input type="hidden" name="sourceStepId" value={sourceStepId} />
                <FormSubmitButton
                  label="Delete Rule"
                  pendingLabel="Deleting..."
                  variant="destructive"
                  icon={<Trash2 className="h-4 w-4" />}
                />
              </form>
            </div>
          ))}
        </div>
      )}

      <form action={createActionFlowBranchRuleAction} className="space-y-3">
        <input type="hidden" name="actionId" value={actionId} />
        <BranchRuleFields
          defaultSourceFieldKey={defaultSourceFieldKey}
          defaultSortOrder={nextSortOrder}
          sourceStepId={sourceStepId}
          targetSteps={targetSteps}
        />
        {!canCreateRule && (
          <p className="text-sm text-muted-foreground">
            Add another step before creating a branch rule.
          </p>
        )}
        <FormSubmitButton
          label="Create Rule"
          pendingLabel="Creating..."
          disabled={!canCreateRule}
          icon={<Plus className="h-4 w-4" />}
        />
      </form>
    </div>
  );
}
