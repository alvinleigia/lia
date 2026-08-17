import { z } from "zod";
import type { ActionFlowVersionSnapshot } from "@/lib/action-flows";
import {
  getNextActionStepDecision,
  getRunnableActionSteps,
  isInlineOperationStep,
  type RuntimeAction,
  type RuntimeActionStep,
} from "@/lib/action-runtime";
import {
  type CompiledHybridFlowGraphV1,
  getHybridNodeId,
} from "@/lib/hybrid-flow-contracts";
import { selectHybridFlowTransition } from "@/lib/hybrid-flow-runtime";
import { getOperationResultOutcome } from "@/lib/operations";

const operationFixtureKindSchema = z.enum([
  "success",
  "failure",
  "retry",
  "timeout",
  "provider_response",
]);

const operationFlowTestCaseV1Schema = z.object({
  detail: z.string(),
  fixture: operationFixtureKindSchema,
  key: z.string(),
  outcome: z.string(),
  routeType: z.string(),
  status: z.enum(["failed", "passed"]),
  stepId: z.number().int().positive(),
  stepLabel: z.string(),
});

export const operationFlowTestReportV1Schema = z.object({
  cases: z.array(operationFlowTestCaseV1Schema),
  casesFailed: z.number().int().nonnegative(),
  casesPassed: z.number().int().nonnegative(),
  casesRun: z.number().int().nonnegative(),
  errors: z.array(z.string()),
  schemaVersion: z.literal(1),
  sideEffectsSuppressed: z.literal(true),
  status: z.enum(["failed", "passed"]),
  stepsConsidered: z.number().int().nonnegative(),
  stepsTested: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export type OperationFlowTestReportV1 = z.infer<
  typeof operationFlowTestReportV1Schema
>;

type FixtureDefinition = {
  attemptStatus: "completed" | "failed" | "outcome_unknown";
  expectedOutcome: string;
  kind: z.infer<typeof operationFixtureKindSchema>;
  responsePayload: Record<string, unknown>;
};

function toRuntimeAction(input: {
  graph: CompiledHybridFlowGraphV1;
  snapshot: ActionFlowVersionSnapshot;
  versionId: number;
  versionNumber: number;
}): RuntimeAction {
  return {
    ...input.snapshot.action,
    branchRules: input.snapshot.branchRules,
    hybridGraph: input.graph,
    steps: input.snapshot.steps,
    versionId: input.versionId,
    versionNumber: input.versionNumber,
  };
}

function getStepLabel(step: RuntimeActionStep) {
  return step.label?.trim() || step.prompt?.trim() || `Step ${step.sortOrder}`;
}

function getCustomProviderStatus(
  action: RuntimeAction,
  step: RuntimeActionStep,
) {
  for (const rule of action.branchRules) {
    if (!rule.isEnabled || rule.sourceStepId !== step.id) {
      continue;
    }
    const outcome = rule.settings?.operationOutcomeRoute;
    if (typeof outcome !== "string") {
      continue;
    }
    const match = /^status_(\d{3})$/.exec(outcome);
    const status = match ? Number(match[1]) : null;
    if (status && status >= 100 && status <= 599) {
      return status;
    }
  }
  return null;
}

function getFixtures(customProviderStatus: number | null): FixtureDefinition[] {
  const providerStatus = customProviderStatus ?? 422;
  return [
    {
      attemptStatus: "completed",
      expectedOutcome: "success",
      kind: "success",
      responsePayload: { response: { status: 200 } },
    },
    {
      attemptStatus: "failed",
      expectedOutcome: "server_error",
      kind: "failure",
      responsePayload: { response: { status: 503 } },
    },
    {
      attemptStatus: "completed",
      expectedOutcome: "success",
      kind: "retry",
      responsePayload: {
        attempts: [
          { attempt: 1, errorKind: "network_failure" },
          { attempt: 2, response: { status: 200 } },
        ],
        finalAttempt: 2,
        response: { status: 200 },
        retryCount: 1,
      },
    },
    {
      attemptStatus: "outcome_unknown",
      expectedOutcome: "timeout",
      kind: "timeout",
      responsePayload: {
        errorKind: "timeout",
        response: { errorKind: "timeout" },
      },
    },
    {
      attemptStatus: "failed",
      expectedOutcome: customProviderStatus
        ? `status_${customProviderStatus}`
        : "client_error",
      kind: "provider_response",
      responsePayload: { response: { status: providerStatus } },
    },
  ];
}

function getExpectedRouteRule(
  action: RuntimeAction,
  step: RuntimeActionStep,
  fixture: FixtureDefinition,
) {
  const rules = action.branchRules
    .filter((rule) => rule.isEnabled && rule.sourceStepId === step.id)
    .sort(
      (left, right) => left.sortOrder - right.sortOrder || left.id - right.id,
    );
  const outcomeRule = rules.find(
    (rule) => rule.settings?.operationOutcomeRoute === fixture.expectedOutcome,
  );
  if (outcomeRule) {
    return outcomeRule;
  }

  const legacyPreset =
    fixture.attemptStatus === "completed"
      ? "success"
      : fixture.attemptStatus === "failed"
        ? "failure"
        : null;
  return legacyPreset
    ? (rules.find(
        (rule) => rule.settings?.operationRoutePreset === legacyPreset,
      ) ?? null)
    : null;
}

export function runOperationHybridFlowTest(input: {
  graph: CompiledHybridFlowGraphV1;
  snapshot: ActionFlowVersionSnapshot;
  versionId: number;
  versionNumber: number;
}): OperationFlowTestReportV1 {
  const action = toRuntimeAction(input);
  const runnableSteps = getRunnableActionSteps(action);
  const operationSteps = action.steps.filter(
    (step) => step.isEnabled && step.stepType === "operation",
  );
  const cases: OperationFlowTestReportV1["cases"] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let stepsTested = 0;

  for (const step of operationSteps) {
    const stepLabel = getStepLabel(step);
    if (!step.operationId) {
      warnings.push(`${stepLabel} has no published operation reference.`);
      continue;
    }

    stepsTested += 1;
    const customProviderStatus = getCustomProviderStatus(action, step);
    if (customProviderStatus === null) {
      warnings.push(
        `${stepLabel} has no custom provider-status route; the provider-response fixture uses the standard 422 client-error outcome.`,
      );
    }

    for (const fixture of getFixtures(customProviderStatus)) {
      const outcome = getOperationResultOutcome({
        attempt: {
          responsePayload: fixture.responsePayload,
          status: fixture.attemptStatus,
        } as Parameters<typeof getOperationResultOutcome>[0]["attempt"],
        operation: {
          settings: {
            customStatusCodes:
              customProviderStatus === null ? [] : [customProviderStatus],
          },
        } as unknown as Parameters<
          typeof getOperationResultOutcome
        >[0]["operation"],
      });
      const statusKey = step.fieldKey?.trim() || `operation_${step.id}_status`;
      const fields = {
        [statusKey]: fixture.attemptStatus,
        [`${statusKey}_outcome`]: outcome,
      };
      const expectedRule = getExpectedRouteRule(action, step, fixture);
      const stepIndex = runnableSteps.findIndex(
        (candidate) => candidate.id === step.id,
      );
      const decision = isInlineOperationStep(step)
        ? getNextActionStepDecision(action, step, stepIndex, fields)
        : null;
      const selectedTransition =
        decision?.branchRuleId !== null && decision?.branchRuleId !== undefined
          ? selectHybridFlowTransition({
              graph: input.graph,
              signals: [
                {
                  kind: "deterministic",
                  sourceRuleId: decision.branchRuleId,
                  triggerKey: "branch",
                },
              ],
              sourceNodeId: getHybridNodeId(step.id),
            })
          : null;
      const retryPayloadValid =
        fixture.kind !== "retry" ||
        (fixture.responsePayload.finalAttempt === 2 &&
          fixture.responsePayload.retryCount === 1 &&
          Array.isArray(fixture.responsePayload.attempts) &&
          fixture.responsePayload.attempts.length === 2);
      const routeValid =
        !isInlineOperationStep(step) ||
        !expectedRule ||
        (decision?.branchRuleId === expectedRule.id &&
          decision.targetStepId === expectedRule.targetStepId &&
          selectedTransition?.targetNodeId ===
            getHybridNodeId(expectedRule.targetStepId));
      const passed =
        outcome === fixture.expectedOutcome && retryPayloadValid && routeValid;
      const routeType = decision?.routeType ?? "post_submit";
      const detail = passed
        ? isInlineOperationStep(step)
          ? `${fixture.kind} classified as ${outcome} and resolved the published ${routeType.replaceAll("_", " ")} route without executing a provider.`
          : `${fixture.kind} classified as ${outcome}; this post-submit operation does not resume the flow.`
        : `${fixture.kind} expected ${fixture.expectedOutcome} but classified as ${outcome}; resolved route ${routeType}${expectedRule ? ` instead of branch #${expectedRule.id}` : ""}.`;

      cases.push({
        detail,
        fixture: fixture.kind,
        key: `operation:${step.id}:${fixture.kind}`,
        outcome,
        routeType,
        status: passed ? "passed" : "failed",
        stepId: step.id,
        stepLabel,
      });
      if (!passed) {
        errors.push(`${stepLabel}: ${detail}`);
      }
    }
  }

  const casesFailed = cases.filter(
    (testCase) => testCase.status === "failed",
  ).length;
  return {
    cases,
    casesFailed,
    casesPassed: cases.length - casesFailed,
    casesRun: cases.length,
    errors,
    schemaVersion: 1,
    sideEffectsSuppressed: true,
    status: errors.length === 0 ? "passed" : "failed",
    stepsConsidered: operationSteps.length,
    stepsTested,
    warnings,
  };
}
