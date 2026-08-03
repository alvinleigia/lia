import { expect, test } from "@playwright/test";
import {
  buildEdges,
  countBlockingDiagnostics,
  countWarningDiagnostics,
  getCanvasPosition,
  getDefaultTaskOutcomeRoutes,
  moveFlowContentBlock,
} from "../../src/components/action-flow-canvas/model";
import type {
  BranchRule,
  FlowStep,
} from "../../src/components/action-flow-canvas/types";
import { buildStoredActionOptionRoute } from "../../src/lib/action-option-routing";
import type { FlowContentBlock } from "../../src/lib/flow-content-blocks";

function createStep(
  id: number,
  sortOrder: number,
  input: Partial<FlowStep> = {},
): FlowStep {
  return {
    id,
    isEnabled: true,
    nextStepId: null,
    settings: {},
    sortOrder,
    stepType: "message",
    ...input,
  } as FlowStep;
}

function createBranchRule(
  id: number,
  sourceStepId: number,
  targetStepId: number,
): BranchRule {
  return {
    id,
    isEnabled: true,
    operator: "equals",
    settings: {},
    sourceFieldKey: "answer",
    sourceStepId,
    targetStepId,
  } as BranchRule;
}

test("canvas positions accept only finite coordinates", () => {
  expect(getCanvasPosition({ canvasPosition: { x: 120, y: 80 } })).toEqual({
    x: 120,
    y: 80,
  });
  expect(getCanvasPosition({ canvasPosition: { x: Number.NaN, y: 80 } })).toBe(
    null,
  );
  expect(getCanvasPosition({ canvasPosition: [120, 80] })).toBe(null);
});

test("business task outcomes default to terminal routes", () => {
  expect(
    getDefaultTaskOutcomeRoutes([
      { outputPort: "completed" },
      { outputPort: "cancelled" },
      { outputPort: "needs_team_help" },
      { outputPort: "booking_failed" },
    ]),
  ).toEqual({
    booking_failed: "end",
    cancelled: "end",
    completed: "end",
    needs_team_help: "end",
  });
});

test("canvas edges preserve explicit routes, branches, and ordered fallbacks", () => {
  const edges = buildEdges({
    branchRules: [createBranchRule(20, 2, 3)],
    routeIssues: [],
    steps: [
      createStep(1, 1, { nextStepId: 3 }),
      createStep(2, 2),
      createStep(3, 3, { stepType: "submit" }),
    ],
  });

  expect(edges.map((edge) => edge.id)).toEqual([
    "default-1-3",
    "branch-20",
    "ordered-2-3",
  ]);
  expect(edges.find((edge) => edge.id === "branch-20")?.label).toBe(
    "answer equals",
  );
});

test("canvas option routes use the stable option handle and current label", () => {
  const optionRoute = createBranchRule(21, 1, 2);
  optionRoute.comparisonValue = "deep_tissue";
  optionRoute.settings = {
    optionRoute: buildStoredActionOptionRoute("service-deep-tissue"),
  };
  const edges = buildEdges({
    branchRules: [optionRoute],
    routeIssues: [],
    steps: [
      createStep(1, 1, {
        fieldKey: "service",
        inputType: "text",
        options: [
          {
            id: "service-deep-tissue",
            label: "Deep Tissue Massage",
            value: "deep_tissue",
          },
        ],
        stepType: "choice",
      }),
      createStep(2, 2, { stepType: "submit" }),
    ],
  });
  const edge = edges.find((candidate) => candidate.id === "branch-21");

  expect(edge).toMatchObject({
    label: "Deep Tissue Massage route",
    sourceHandle: "option:service-deep-tissue",
  });
});

test("content reordering is immutable and ignores invalid moves", () => {
  const blocks: FlowContentBlock[] = [
    { id: "first", text: "First", type: "text" },
    { id: "second", text: "Second", type: "text" },
    { id: "third", text: "Third", type: "text" },
  ];

  const moved = moveFlowContentBlock(blocks, 0, 2);

  expect(moved.map((block) => block.id)).toEqual(["second", "third", "first"]);
  expect(blocks.map((block) => block.id)).toEqual(["first", "second", "third"]);
  expect(moveFlowContentBlock(blocks, -1, 1)).toBe(blocks);
});

test("diagnostic counts keep warnings separate from publish blockers", () => {
  const issues = [
    {
      message: "Missing terminal path",
      severity: "error",
      source: "graph_terminal",
    },
    {
      message: "Channel fallback recommended",
      severity: "warning",
      source: "channel_capability",
    },
  ] as Parameters<typeof countBlockingDiagnostics>[0];

  expect(countBlockingDiagnostics(issues)).toBe(1);
  expect(countWarningDiagnostics(issues)).toBe(1);
});
