import { z } from "zod";
import {
  buildStepAnswerResult,
  getActionStepInputType,
  getActionStepOptions,
  isActionInputStep,
  isActionReplyOption,
  type RuntimeActionStep,
  validateStepAnswer,
} from "@/lib/action-runtime";

const MAX_BEHAVIORAL_CASES = 100;

const behavioralFlowTestCaseV1Schema = z.object({
  actualValid: z.boolean(),
  caseType: z.enum(["empty", "invalid", "option", "valid"]),
  detail: z.string(),
  expectedValid: z.boolean(),
  input: z.string(),
  status: z.enum(["failed", "passed"]),
  stepId: z.number().int().positive(),
  stepLabel: z.string(),
});

const behavioralFlowTestSkippedStepV1Schema = z.object({
  reason: z.string(),
  stepId: z.number().int().positive(),
  stepLabel: z.string(),
});

export const behavioralFlowTestReportV1Schema = z.object({
  cases: z.array(behavioralFlowTestCaseV1Schema),
  casesFailed: z.number().int().nonnegative(),
  casesPassed: z.number().int().nonnegative(),
  casesRun: z.number().int().nonnegative(),
  errors: z.array(z.string()),
  schemaVersion: z.literal(1),
  skippedSteps: z.array(behavioralFlowTestSkippedStepV1Schema),
  status: z.enum(["failed", "passed"]),
  stepsConsidered: z.number().int().nonnegative(),
  stepsTested: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export type BehavioralFlowTestReportV1 = z.infer<
  typeof behavioralFlowTestReportV1Schema
>;

type Candidate = {
  caseType: "invalid" | "valid";
  expectedValid: boolean;
  input: string;
};

function getStepLabel(step: RuntimeActionStep) {
  return step.label?.trim() || step.prompt?.trim() || `Step ${step.sortOrder}`;
}

function getNumberSetting(step: RuntimeActionStep, key: string) {
  const value = step.settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getStringSetting(step: RuntimeActionStep, key: string) {
  const value = step.settings[key];
  return typeof value === "string" ? value.trim() : "";
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildTextSample(step: RuntimeActionStep) {
  const minLength = getNumberSetting(step, "validationMinLength") ?? 0;
  const maxLength = getNumberSetting(step, "validationMaxLength");
  const fieldKey = step.fieldKey?.toLowerCase() ?? "";
  const isName = [
    "name",
    "guestname",
    "customername",
    "clientname",
    "fullname",
  ].includes(fieldKey);
  const base = isName ? "Test User" : "Test value";
  const targetLength = Math.max(base.length, minLength, isName ? 2 : 1);

  if (maxLength !== null && targetLength > maxLength) {
    return base.slice(0, Math.max(0, maxLength));
  }

  return `${base}${"a".repeat(Math.max(0, targetLength - base.length))}`;
}

function buildNumericSample(step: RuntimeActionStep, integer: boolean) {
  const minimum = getNumberSetting(step, "validationMinNumber");
  const maximum = getNumberSetting(step, "validationMaxNumber");
  let value = minimum ?? maximum ?? 2;

  if (integer) {
    value = minimum !== null ? Math.ceil(minimum) : Math.floor(value);
  }
  if (maximum !== null && value > maximum) {
    value = integer ? Math.floor(maximum) : maximum;
  }

  return String(value);
}

function buildValidCandidates(step: RuntimeActionStep): string[] {
  const inputType = getActionStepInputType(step);

  if (step.stepType === "date_range") {
    return ["2030-06-15 to 2030-06-16"];
  }
  if (step.stepType === "address") {
    return ["10 Test Street, Test City"];
  }
  if (step.stepType === "location") {
    return ["Test City", "12.9716, 77.5946"];
  }

  switch (inputType) {
    case "date": {
      const minimum = getStringSetting(step, "validationMinDate");
      const maximum = getStringSetting(step, "validationMaxDate");
      return [minimum || maximum || "2030-06-15"];
    }
    case "email":
      return ["tester@example.com", "behavioral.test@example.com"];
    case "float":
      return [buildNumericSample(step, false)];
    case "int":
      return [buildNumericSample(step, true)];
    case "phone":
      return ["+919876543210"];
    case "time":
      return ["14:30"];
    default:
      return [buildTextSample(step), "Test User", "Test value", "ABC123"];
  }
}

function buildInvalidCandidates(step: RuntimeActionStep): Candidate[] {
  const inputType = getActionStepInputType(step);
  const candidates: Candidate[] = [];
  const fieldKey = step.fieldKey?.toLowerCase() ?? "";
  const isName = [
    "name",
    "guestname",
    "customername",
    "clientname",
    "fullname",
  ].includes(fieldKey);

  if (step.stepType === "date_range") {
    candidates.push({
      caseType: "invalid",
      expectedValid: false,
      input: "2030-06-16 to 2030-06-15",
    });
  } else if (isName) {
    candidates.push({
      caseType: "invalid",
      expectedValid: false,
      input: "12345",
    });
  } else {
    const invalidByInputType: Record<string, string | undefined> = {
      date: "not-a-date",
      email: "not-an-email",
      float: "not-a-number",
      int: "1.5",
      phone: "abc",
      time: "25:99",
    };
    const input = inputType ? invalidByInputType[inputType] : undefined;
    if (input) {
      candidates.push({ caseType: "invalid", expectedValid: false, input });
    }
  }

  const minLength = getNumberSetting(step, "validationMinLength");
  if (minLength !== null && minLength > 1) {
    candidates.push({
      caseType: "invalid",
      expectedValid: false,
      input: "a".repeat(Math.min(minLength - 1, 200)),
    });
  }

  const maxLength = getNumberSetting(step, "validationMaxLength");
  if (maxLength !== null && maxLength >= 0 && maxLength < 200) {
    candidates.push({
      caseType: "invalid",
      expectedValid: false,
      input: "a".repeat(maxLength + 1),
    });
  }

  const minNumber = getNumberSetting(step, "validationMinNumber");
  if (minNumber !== null) {
    candidates.push({
      caseType: "invalid",
      expectedValid: false,
      input: String(minNumber - 1),
    });
  }

  const maxNumber = getNumberSetting(step, "validationMaxNumber");
  if (maxNumber !== null) {
    candidates.push({
      caseType: "invalid",
      expectedValid: false,
      input: String(maxNumber + 1),
    });
  }

  const minDate = getStringSetting(step, "validationMinDate");
  const beforeMinimum = minDate ? addDays(minDate, -1) : null;
  if (beforeMinimum) {
    candidates.push({
      caseType: "invalid",
      expectedValid: false,
      input: beforeMinimum,
    });
  }

  const maxDate = getStringSetting(step, "validationMaxDate");
  const afterMaximum = maxDate ? addDays(maxDate, 1) : null;
  if (afterMaximum) {
    candidates.push({
      caseType: "invalid",
      expectedValid: false,
      input: afterMaximum,
    });
  }

  return candidates;
}

export function runBehavioralHybridFlowTest(
  publishedSteps: RuntimeActionStep[],
): BehavioralFlowTestReportV1 {
  const cases: BehavioralFlowTestReportV1["cases"] = [];
  const errors: string[] = [];
  const skippedSteps: BehavioralFlowTestReportV1["skippedSteps"] = [];
  const warnings: string[] = [];
  const fields: Record<string, unknown> = {};
  const testedStepIds = new Set<number>();
  const inputSteps = publishedSteps
    .filter((step) => step.isEnabled && isActionInputStep(step))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  function addCase(
    step: RuntimeActionStep,
    candidate:
      | Candidate
      | { caseType: "empty" | "option"; expectedValid: boolean; input: string },
  ) {
    if (cases.length >= MAX_BEHAVIORAL_CASES) {
      return;
    }
    const result = validateStepAnswer(step, candidate.input, fields);
    const status =
      result.isValid === candidate.expectedValid ? "passed" : "failed";
    const stepLabel = getStepLabel(step);
    const detail =
      status === "passed"
        ? `${candidate.caseType} input was ${
            result.isValid ? "accepted" : "rejected"
          } as expected.`
        : `${candidate.caseType} input was ${
            result.isValid ? "accepted" : "rejected"
          }, expected ${candidate.expectedValid ? "acceptance" : "rejection"}.`;

    cases.push({
      actualValid: result.isValid,
      caseType: candidate.caseType,
      detail,
      expectedValid: candidate.expectedValid,
      input: candidate.input,
      status,
      stepId: step.id,
      stepLabel,
    });
    testedStepIds.add(step.id);
    if (status === "failed") {
      errors.push(
        `${stepLabel}: ${candidate.caseType} input was ${
          result.isValid ? "accepted" : "rejected"
        }, but it should have been ${candidate.expectedValid ? "accepted" : "rejected"}.`,
      );
    }
    return result;
  }

  for (const step of inputSteps) {
    const stepLabel = getStepLabel(step);
    if (step.stepType === "file_upload") {
      skippedSteps.push({
        reason:
          "File object and acceptance rules are covered by the resource-backed checks in this run.",
        stepId: step.id,
        stepLabel,
      });
      continue;
    }
    if (step.stepType === "product_selection") {
      skippedSteps.push({
        reason:
          "Published catalog options are covered by the resource-backed checks in this run.",
        stepId: step.id,
        stepLabel,
      });
      continue;
    }

    addCase(step, {
      caseType: "empty",
      expectedValid: !step.isRequired,
      input: "",
    });

    const options = getActionStepOptions(step, fields).filter(
      isActionReplyOption,
    );
    if (options.length > 0) {
      for (const option of options) {
        addCase(step, {
          caseType: "option",
          expectedValid: true,
          input: option.label,
        });
      }
      addCase(step, {
        caseType: "invalid",
        expectedValid: false,
        input: "__unknown_test_option__",
      });

      const firstOption = options[0];
      if (step.fieldKey && firstOption) {
        const result = validateStepAnswer(step, firstOption.label, fields);
        if (result.isValid) {
          Object.assign(
            fields,
            buildStepAnswerResult(step, step.fieldKey, result.value, fields)
              .fields,
          );
        }
      }
      continue;
    }

    const validCandidate = buildValidCandidates(step).find(
      (input) => validateStepAnswer(step, input, fields).isValid,
    );
    if (!validCandidate) {
      const reason = getStringSetting(step, "validationRegex")
        ? "No safe generated value matched the custom regular expression."
        : "No safe generated value satisfied the published validation settings.";
      skippedSteps.push({ reason, stepId: step.id, stepLabel });
      warnings.push(`${stepLabel}: ${reason}`);
      continue;
    }

    const validResult = addCase(step, {
      caseType: "valid",
      expectedValid: true,
      input: validCandidate,
    });
    for (const candidate of buildInvalidCandidates(step)) {
      addCase(step, candidate);
    }

    if (step.fieldKey && validResult?.isValid) {
      Object.assign(
        fields,
        buildStepAnswerResult(step, step.fieldKey, validResult.value, fields)
          .fields,
      );
    }
  }

  if (cases.length >= MAX_BEHAVIORAL_CASES) {
    warnings.push(
      `The behavioral run reached its safety limit of ${MAX_BEHAVIORAL_CASES} cases.`,
    );
  }

  const casesFailed = cases.filter((item) => item.status === "failed").length;
  const casesPassed = cases.length - casesFailed;

  return behavioralFlowTestReportV1Schema.parse({
    cases,
    casesFailed,
    casesPassed,
    casesRun: cases.length,
    errors,
    schemaVersion: 1,
    skippedSteps,
    status: casesFailed === 0 ? "passed" : "failed",
    stepsConsidered: inputSteps.length,
    stepsTested: testedStepIds.size,
    warnings,
  });
}
