import { expect, test } from "@playwright/test";
import {
  buildEdges,
  countBlockingDiagnostics,
  countWarningDiagnostics,
  getCanvasPosition,
  moveFlowContentBlock,
} from "../../src/components/action-flow-canvas/model";
import type {
  BranchRule,
  FlowStep,
} from "../../src/components/action-flow-canvas/types";
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
