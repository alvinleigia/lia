import { expect, test } from "@playwright/test";
import { getActionFlowVersionDiff } from "../../src/lib/action-flow-version-diff";

type DiffInput = Parameters<typeof getActionFlowVersionDiff>[0];

function createInput(
  draftSettings: Record<string, unknown>,
  publishedSettings: Record<string, unknown>,
): DiffInput {
  return {
    action: {
      description: "Tests draft and runtime comparison.",
      name: "Comparison test",
      settings: {},
      status: "active",
      triggerPhrases: ["compare"],
    } as DiffInput["action"],
    branchRules: [] as DiffInput["branchRules"],
    publishedSnapshot: {
      action: {
        description: "Tests draft and runtime comparison.",
        name: "Comparison test",
        settings: {},
        status: "active",
        triggerPhrases: ["compare"],
      },
      branchRules: [],
      steps: [createStep(publishedSettings)],
    },
    steps: [createStep(draftSettings)] as DiffInput["steps"],
  };
}

function createStep(settings: Record<string, unknown>) {
  return {
    actionId: 1,
    createdAt: new Date("2026-08-17T00:00:00.000Z"),
    fieldKey: "customerName",
    id: 1,
    inputType: "text",
    isEnabled: true,
    isRequired: true,
    label: "Customer name",
    nextStepId: null,
    operationId: null,
    options: [],
    prompt: "What is your name?",
    projectId: 1,
    settings,
    sortOrder: 1,
    stepType: "collect_input",
    updatedAt: new Date("2026-08-17T00:00:00.000Z"),
  };
}

test("canvas positions do not count as unpublished runtime changes", () => {
  const sections = getActionFlowVersionDiff(
    createInput(
      {
        canvasPosition: { x: 480, y: 320 },
        validationMessage: "Please enter your name.",
      },
      {
        canvasPosition: { x: 120, y: 80 },
        validationMessage: "Please enter your name.",
      },
    ),
  );

  expect(sections.find((section) => section.key === "steps")?.changed).toBe(
    false,
  );
});

test("runtime step settings still count as unpublished changes", () => {
  const sections = getActionFlowVersionDiff(
    createInput(
      {
        canvasPosition: { x: 480, y: 320 },
        validationMessage: "Please provide your full name.",
      },
      {
        canvasPosition: { x: 120, y: 80 },
        validationMessage: "Please enter your name.",
      },
    ),
  );

  expect(sections.find((section) => section.key === "steps")?.changed).toBe(
    true,
  );
});
