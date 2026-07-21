import { expect, test } from "@playwright/test";
import {
  FLOW_ACTION_FAMILY_DEFINITIONS,
  FLOW_ACTION_STEP_TYPES,
  getFlowActionFamilyDefinition,
  isFlowActionFieldRelevant,
  isFlowActionStepType,
  listPlannedFlowActionFamilies,
} from "../../src/lib/flow-action-editor";

test("every executable action step maps to one friendly family", () => {
  for (const stepType of FLOW_ACTION_STEP_TYPES) {
    const definition = getFlowActionFamilyDefinition(stepType);

    expect(isFlowActionStepType(stepType)).toBe(true);
    expect(definition?.availability).toBe("supported");
    expect(definition?.title).toBeTruthy();
    expect(definition?.description).toBeTruthy();
  }

  expect(getFlowActionFamilyDefinition("message")).toBeNull();
});

test("action fields stay relevant to their runtime family", () => {
  expect(isFlowActionFieldRelevant("operation", "operationTiming")).toBe(true);
  expect(isFlowActionFieldRelevant("operation", "handoffQueue")).toBe(false);
  expect(isFlowActionFieldRelevant("handoff", "handoffQueue")).toBe(true);
  expect(isFlowActionFieldRelevant("connect_flow", "connectedFlow")).toBe(true);
  expect(isFlowActionFieldRelevant("add_tag", "tags")).toBe(true);
  expect(isFlowActionFieldRelevant("submit", "completionMessage")).toBe(true);
});

test("route and planned families describe honest availability", () => {
  expect(FLOW_ACTION_FAMILY_DEFINITIONS.condition.availability).toBe("route");

  const planned = listPlannedFlowActionFamilies();
  expect(planned.map((definition) => definition.key)).toEqual([
    "ai_knowledge",
    "wait",
  ]);

  for (const definition of planned) {
    expect(definition.plannedReason).toBeTruthy();
    expect(definition.stepType).toBeUndefined();
  }
});
