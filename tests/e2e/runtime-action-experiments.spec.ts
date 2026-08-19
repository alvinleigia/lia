import { expect, test } from "@playwright/test";
import type { RuntimeAction } from "../../src/lib/action-runtime";
import { selectRuntimeExperimentActions } from "../../src/lib/runtime-actions";

function createAction(
  id: number,
  experiment?: { key: string; label: string; weight: number },
): RuntimeAction {
  return {
    branchRules: [],
    description: null,
    id,
    name: `Action ${id}`,
    settings: experiment
      ? {
          experiment: {
            enabled: true,
            key: experiment.key,
            variantLabel: experiment.label,
            weight: experiment.weight,
          },
        }
      : {},
    steps: [],
    triggerPhrases: [`action ${id}`],
    versionId: id,
    versionNumber: 1,
  };
}

test("keeps ordinary actions and selects one stable variant per experiment", () => {
  const actions = [
    createAction(1),
    createAction(2, { key: "support-flow", label: "Short", weight: 50 }),
    createAction(3, { key: "support-flow", label: "Long", weight: 50 }),
    createAction(4, { key: "booking-flow", label: "Control", weight: 100 }),
  ];

  const first = selectRuntimeExperimentActions(actions, "conversation-42");
  const second = selectRuntimeExperimentActions(actions, "conversation-42");

  expect(second.map((action) => action.id)).toEqual(
    first.map((action) => action.id),
  );
  expect(first.filter((action) => [2, 3].includes(action.id))).toHaveLength(1);
  expect(first.map((action) => action.id)).toContain(1);
  expect(first.map((action) => action.id)).toContain(4);
});

test("honors zero and positive experiment weights", () => {
  const actions = [
    createAction(10, { key: "weighted", label: "Disabled", weight: 0 }),
    createAction(11, { key: "weighted", label: "Active", weight: 100 }),
  ];

  for (const allocationKey of ["one", "two", "three", "four"]) {
    expect(selectRuntimeExperimentActions(actions, allocationKey)[0]?.id).toBe(
      11,
    );
  }
});

test("uses a deterministic fallback when all variant weights are zero", () => {
  const actions = [
    createAction(22, { key: "zero", label: "Second", weight: 0 }),
    createAction(21, { key: "zero", label: "First", weight: 0 }),
  ];

  expect(selectRuntimeExperimentActions(actions, "conversation")[0]?.id).toBe(
    21,
  );
});
