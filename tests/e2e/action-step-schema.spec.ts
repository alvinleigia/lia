import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
  actionStepDynamicChoiceSchemaShape,
  createActionStepSchema,
  parseActionStepLines,
  parseActionStepOptions,
} from "../../src/lib/action-step-schema";

const canvasStepSchema = createActionStepSchema({});
const detailedStepSchema = createActionStepSchema(
  {
    ...actionStepDynamicChoiceSchemaShape,
    sortOrder: z.coerce.number().int().positive(),
  },
  { allowDynamicChoiceSource: true },
);

test("all input step families require a field key, label, and prompt", () => {
  const result = canvasStepSchema.safeParse({
    actionId: 1,
    stepType: "file_upload",
  });

  expect(result.success).toBe(false);
  if (result.success) {
    return;
  }

  expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
    expect.arrayContaining(["fieldKey", "label", "prompt"]),
  );
});

test("input validation rejects inverted ranges and invalid regex", () => {
  const result = canvasStepSchema.safeParse({
    actionId: 1,
    fieldKey: "guestAge",
    inputType: "int",
    label: "Guest age",
    prompt: "How old are you?",
    stepType: "collect_input",
    validationMaxLength: 3,
    validationMaxNumber: 18,
    validationMinLength: 5,
    validationMinNumber: 21,
    validationRegex: "[",
  });

  expect(result.success).toBe(false);
  if (result.success) {
    return;
  }

  expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
    expect.arrayContaining([
      "validationMinLength",
      "validationMinNumber",
      "validationRegex",
    ]),
  );
});

test("detailed steps can use dynamic choices while canvas creation needs manual choices", () => {
  const dynamicChoice = {
    actionId: 1,
    fieldKey: "serviceId",
    label: "Service",
    prompt: "Which service would you like?",
    sortOrder: 1,
    sourceType: "catalog_items",
    stepType: "choice",
  };

  expect(detailedStepSchema.safeParse(dynamicChoice).success).toBe(true);
  expect(canvasStepSchema.safeParse(dynamicChoice).success).toBe(false);
});

test("step-specific resources remain required", () => {
  expect(
    canvasStepSchema.safeParse({
      actionId: 1,
      stepType: "operation",
    }).success,
  ).toBe(false);
  expect(
    canvasStepSchema.safeParse({
      actionId: 1,
      stepType: "media",
    }).success,
  ).toBe(false);
});

test("shared option parsing trims commas, lines, and empty values", () => {
  expect(
    parseActionStepLines(" Massage,\n\nFacials, Body Treatments "),
  ).toEqual(["Massage", "Facials", "Body Treatments"]);
  expect(parseActionStepOptions("Massage\nFacials")).toEqual([
    { label: "Massage", value: "Massage" },
    { label: "Facials", value: "Facials" },
  ]);
});
