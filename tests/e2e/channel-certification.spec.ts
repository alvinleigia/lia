import { expect, test } from "@playwright/test";
import { ACTION_STEP_TYPES } from "../../src/lib/action-flow-constants";
import {
  buildChannelCertificationMatrix,
  CERTIFICATION_CHANNELS,
  FLOW_STEP_CERTIFICATION_FAMILIES,
} from "../../src/lib/channel-certification";
import { listEnabledStepFlowComponents } from "../../src/lib/flow-components";

test("every enabled step has one typed certification family", () => {
  const enabled = listEnabledStepFlowComponents();
  const enabledStepTypes = enabled.map((component) => component.stepType);

  expect(new Set(enabledStepTypes).size).toBe(enabledStepTypes.length);
  expect([...enabledStepTypes].sort()).toEqual([...ACTION_STEP_TYPES].sort());
  expect(Object.keys(FLOW_STEP_CERTIFICATION_FAMILIES).sort()).toEqual(
    [...ACTION_STEP_TYPES].sort(),
  );
});

test("certification matrix contains one cell per enabled step and channel", () => {
  const enabled = listEnabledStepFlowComponents();
  const matrix = buildChannelCertificationMatrix();

  expect(matrix).toHaveLength(enabled.length * CERTIFICATION_CHANNELS.length);

  for (const component of enabled) {
    const cells = matrix.filter((cell) => cell.stepType === component.stepType);
    expect(cells.map((cell) => cell.channel).sort()).toEqual(
      [...CERTIFICATION_CHANNELS].sort(),
    );
    expect(cells.every((cell) => cell.automatedContract)).toBe(true);
  }
});

test("future adapter contract covers every enabled flow step", () => {
  const futureCells = buildChannelCertificationMatrix().filter(
    (cell) => cell.channel === "reference_future",
  );

  expect(futureCells).toHaveLength(ACTION_STEP_TYPES.length);
  expect(futureCells.every((cell) => cell.expectation !== "unavailable")).toBe(
    true,
  );
  expect(futureCells.every((cell) => !cell.liveSignOffRequired)).toBe(true);
});

test("channel exclusions stay explicit instead of silently falling back", () => {
  const matrix = buildChannelCertificationMatrix();

  expect(
    matrix.find(
      (cell) =>
        cell.channel === "project_chat" && cell.stepType === "template_message",
    )?.expectation,
  ).toBe("unavailable");
  expect(
    matrix.find(
      (cell) =>
        cell.channel === "project_chat" && cell.stepType === "catalog_message",
    )?.expectation,
  ).toBe("unavailable");
  expect(
    matrix.find(
      (cell) => cell.channel === "widget" && cell.stepType === "message",
    )?.expectation,
  ).toBe("transport");
  expect(
    matrix.find(
      (cell) => cell.channel === "whatsapp" && cell.stepType === "wait",
    )?.expectation,
  ).toBe("runtime");
});

test("hybrid knowledge and task nodes are certified for every channel", () => {
  const matrix = buildChannelCertificationMatrix();

  for (const stepType of [
    "knowledge_conversation",
    "conversational_task",
  ] as const) {
    const cells = matrix.filter((cell) => cell.stepType === stepType);

    expect(cells).toHaveLength(CERTIFICATION_CHANNELS.length);
    expect(cells.every((cell) => cell.expectation !== "unavailable")).toBe(
      true,
    );
  }
});
