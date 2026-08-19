import { expect, test } from "@playwright/test";
import {
  buildImportedActionFlowStepSettings,
  collectActionFlowResourceReferences,
  parseActionFlowExportJson,
} from "@/lib/action-flow-export";

function parseStep(input: {
  operationId?: number;
  settings: Record<string, unknown>;
  stepType?: string;
}) {
  const [step] = parseActionFlowExportJson(
    JSON.stringify({
      action: { name: "Clone source", settings: {} },
      branchRules: [],
      schemaVersion: 1,
      steps: [
        {
          id: 1,
          operationId: input.operationId,
          settings: input.settings,
          sortOrder: 1,
          stepType: input.stepType ?? "message",
        },
      ],
    }),
  ).steps;
  if (!step) throw new Error("Expected one parsed clone source step.");
  return step;
}

test("clone discovery lists each project resource once", () => {
  const step = parseStep({
    operationId: 6,
    settings: {
      catalogId: 1,
      contentDocument: {
        blocks: [
          { mediaAssetId: 2, productId: 3, productIds: [3, 4] },
          { connectedActionId: 5 },
        ],
      },
      conversationalTask: { task: { taskVersionId: 7 } },
    },
  });

  expect(collectActionFlowResourceReferences({ steps: [step] })).toEqual([
    { kind: "operation", sourceId: 6, stepId: 1, stepLabel: "Step 1" },
    { kind: "catalog", sourceId: 1, stepId: 1, stepLabel: "Step 1" },
    { kind: "media_asset", sourceId: 2, stepId: 1, stepLabel: "Step 1" },
    {
      kind: "catalog_product",
      sourceId: 3,
      stepId: 1,
      stepLabel: "Step 1",
    },
    {
      kind: "catalog_product",
      sourceId: 4,
      stepId: 1,
      stepLabel: "Step 1",
    },
    {
      kind: "connected_action",
      sourceId: 5,
      stepId: 1,
      stepLabel: "Step 1",
    },
    {
      kind: "conversational_task_version",
      sourceId: 7,
      stepId: 1,
      stepLabel: "Step 1",
    },
  ]);
});

test("clone remapping replaces project-scoped resource identifiers", () => {
  const step = parseStep({
    settings: {
      catalogId: 1,
      contentDocument: {
        blocks: [{ mediaAssetId: 2, productId: 3, productIds: [3, 4] }],
      },
    },
  });

  expect(
    buildImportedActionFlowStepSettings(step, new Map(), {
      catalogs: { 1: 11 },
      catalogProducts: { 3: 13, 4: null },
      mediaAssets: { 2: 12 },
    }),
  ).toMatchObject({
    catalogId: 11,
    contentDocument: {
      blocks: [{ mediaAssetId: 12, productId: 13, productIds: [13] }],
    },
  });
});

test("clone remapping reconnects connected flows explicitly", () => {
  const step = parseStep({
    settings: { exportedConnectedActionId: 5 },
    stepType: "connect_flow",
  });

  expect(
    buildImportedActionFlowStepSettings(step, new Map(), {
      connectedActions: { 5: 15 },
    }),
  ).toMatchObject({ connectedActionId: 15, connectFlowMode: "jump" });
});
