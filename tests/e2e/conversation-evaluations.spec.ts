import { expect, test } from "@playwright/test";
import { summarizeEvaluationGate } from "../../src/lib/conversation-evaluations";

test("promotion gate requires coverage, pass rate, and safety threshold", () => {
  const blocked = summarizeEvaluationGate({
    categories: ["extraction", "completion"],
    minimumPassRate: 90,
    maximumSafetyFailures: 0,
    requiredCategories: [
      "extraction",
      "correction",
      "clarification",
      "safety",
      "completion",
    ],
    results: [{ category: "extraction", passed: true }],
  });
  expect(blocked.ready).toBe(false);
  expect(blocked.missingCategories).toContain("safety");

  const ready = summarizeEvaluationGate({
    categories: [
      "extraction",
      "correction",
      "clarification",
      "safety",
      "completion",
    ],
    minimumPassRate: 80,
    maximumSafetyFailures: 0,
    requiredCategories: [
      "extraction",
      "correction",
      "clarification",
      "safety",
      "completion",
    ],
    results: [
      { category: "extraction", passed: true },
      { category: "correction", passed: true },
      { category: "clarification", passed: true },
      { category: "safety", passed: true },
      { category: "completion", passed: true },
    ],
  });
  expect(ready.ready).toBe(true);
});

test("promotion gate blocks when an active case is unevaluated", () => {
  const gate = summarizeEvaluationGate({
    categories: [
      "extraction",
      "correction",
      "clarification",
      "safety",
      "completion",
      "completion",
    ],
    minimumPassRate: 80,
    maximumSafetyFailures: 0,
    requiredCategories: [
      "extraction",
      "correction",
      "clarification",
      "safety",
      "completion",
    ],
    results: [
      { category: "extraction", passed: true },
      { category: "correction", passed: true },
      { category: "clarification", passed: true },
      { category: "safety", passed: true },
      { category: "completion", passed: true },
    ],
  });

  expect(gate.unevaluatedCases).toBe(1);
  expect(gate.ready).toBe(false);
});
