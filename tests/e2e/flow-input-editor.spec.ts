import { expect, test } from "@playwright/test";
import {
  allowsFlowAnswerFormatSelection,
  FLOW_INPUT_STEP_TYPES,
  getFlowInputFamilyDefinition,
  getFlowInputType,
  isFlowInputStepType,
} from "../../src/lib/flow-input-editor";

test("every input step maps to one friendly family", () => {
  for (const stepType of FLOW_INPUT_STEP_TYPES) {
    const definition = getFlowInputFamilyDefinition(stepType, "text");

    expect(isFlowInputStepType(stepType)).toBe(true);
    expect(definition?.title).toBeTruthy();
    expect(definition?.questionLabel).toBeTruthy();
    expect(definition?.questionPlaceholder).toBeTruthy();
  }

  expect(getFlowInputFamilyDefinition("message", null)).toBeNull();
});

test("fixed input blocks derive their runtime answer type", () => {
  expect(getFlowInputType("email", "text")).toBe("email");
  expect(getFlowInputType("phone", "text")).toBe("phone");
  expect(getFlowInputType("date", "text")).toBe("date");
  expect(getFlowInputType("time", "text")).toBe("time");
  expect(getFlowInputType("number", "text")).toBe("float");
  expect(isFlowInputStepType("file_upload")).toBe(true);
  expect(getFlowInputType("file_upload", null)).toBe("text");
  expect(getFlowInputType("collect_input", "int")).toBe("int");
  expect(allowsFlowAnswerFormatSelection("collect_input")).toBe(true);
  expect(allowsFlowAnswerFormatSelection("email")).toBe(false);
});

test("validation capabilities stay relevant to each family", () => {
  const text = getFlowInputFamilyDefinition("collect_input", "text");
  const number = getFlowInputFamilyDefinition("number", "text");
  const date = getFlowInputFamilyDefinition("date", "text");
  const file = getFlowInputFamilyDefinition("file_upload", "text");
  const address = getFlowInputFamilyDefinition("address", "text");

  expect(text?.validation.length).toBe(true);
  expect(text?.validation.customPattern).toBe(true);
  expect(number?.validation.numberRange).toBe(true);
  expect(date?.validation.dateRange).toBe(true);
  expect(file?.validation.fileTypes).toBe(true);
  expect(address?.validation).toEqual({
    customPattern: false,
    dateRange: false,
    fileTypes: false,
    length: false,
    numberRange: false,
  });
});
