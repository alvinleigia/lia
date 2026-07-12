"use client";

import { Play, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import {
  ActionFlowStepInput,
  ActionFlowStepOptions,
} from "@/components/action-flow-step-input";
import { Button } from "@/components/ui/button";
import {
  buildActionReviewSummary,
  buildActionStepTextFallbackMessage,
  buildInvalidStepAnswerMessage,
  buildStepAnswerResult,
  getActionStepPrompt,
  getNextActionStepDecision,
  getRunnableActionSteps,
  isActionConfirmationStep,
  isActionInputStep,
  isActionMessageStep,
  isActionSubmitStep,
  type RuntimeAction,
  type RuntimeActionStep,
  type RuntimeRouteDecision,
  validateStepAnswer,
} from "@/lib/action-runtime";

type PreviewMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

type PreviewDecision = RuntimeRouteDecision & {
  label: string;
};

type PreviewDiagnostic = {
  detail?: string;
  id: string;
  severity: "error" | "info" | "warning";
  stepLabel?: string;
  title: string;
};

type PreviewState = {
  answer: string;
  decisions: PreviewDecision[];
  diagnostics: PreviewDiagnostic[];
  fields: Record<string, unknown>;
  isComplete: boolean;
  messages: PreviewMessage[];
  stepIndex: number | null;
};

type ActionFlowPreviewProps = {
  action: RuntimeAction;
};

function formatStepName(step: RuntimeActionStep | null | undefined) {
  if (!step) {
    return "Unknown step";
  }

  return `${step.sortOrder}. ${
    step.label || step.fieldKey || step.prompt || step.stepType
  }`;
}

function buildPrompt(step: RuntimeActionStep, fields: Record<string, unknown>) {
  if (isActionConfirmationStep(step)) {
    return `${getActionStepPrompt(step)}\n\n${buildActionReviewSummary(fields)}`;
  }

  return buildActionStepTextFallbackMessage(step, fields);
}

function buildDecisionLabel(
  action: RuntimeAction,
  decision: RuntimeRouteDecision,
) {
  const targetStep = decision.targetStepId
    ? action.steps.find((step) => step.id === decision.targetStepId)
    : null;
  const targetLabel = targetStep ? formatStepName(targetStep) : "end";

  switch (decision.routeType) {
    case "branch":
      return `Branch rule #${decision.branchRuleId} -> ${targetLabel}`;
    case "default_next_step":
      return `Default next step -> ${targetLabel}`;
    case "ordered_next_step":
      return `Next by order -> ${targetLabel}`;
    case "end":
      return "Flow ended";
    default:
      return targetLabel;
  }
}

function getInitialState(action: RuntimeAction): PreviewState {
  const runnableSteps = getRunnableActionSteps(action);
  const firstStep = runnableSteps[0] ?? null;

  return {
    answer: "",
    decisions: [] as PreviewDecision[],
    diagnostics: firstStep
      ? []
      : [
          {
            id: "diagnostic-empty",
            severity: "warning" as const,
            title: "No previewable steps",
            detail: "Enable at least one customer-facing step to run a test.",
          },
        ],
    fields: {} as Record<string, unknown>,
    isComplete: firstStep === null,
    messages: firstStep
      ? [
          {
            id: "assistant-start",
            role: "assistant" as const,
            text: buildPrompt(firstStep, {}),
          },
        ]
      : [
          {
            id: "assistant-empty",
            role: "assistant" as const,
            text: "No enabled customer-facing steps are available to preview.",
          },
        ],
    stepIndex: firstStep ? 0 : null,
  };
}

function getMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ActionFlowPreview({ action }: ActionFlowPreviewProps) {
  const runnableSteps = useMemo(() => getRunnableActionSteps(action), [action]);
  const operationSteps = action.steps.filter(
    (step) => step.isEnabled && step.stepType === "operation",
  );
  const [state, setState] = useState(() => getInitialState(action));
  const currentStep =
    state.stepIndex === null ? null : (runnableSteps[state.stepIndex] ?? null);

  const resetPreview = () => {
    setState(getInitialState(action));
  };

  const completePreview = (
    messages: PreviewMessage[],
    fields: Record<string, unknown>,
    decisions: PreviewDecision[],
    diagnostics: PreviewDiagnostic[],
  ) => {
    setState({
      answer: "",
      decisions,
      diagnostics: [
        ...diagnostics,
        {
          id: getMessageId("diagnostic-complete"),
          severity: "info",
          title: "Preview completed",
          detail: "No live submission was created.",
        },
      ],
      fields,
      isComplete: true,
      messages: [
        ...messages,
        {
          id: getMessageId("assistant-complete"),
          role: "assistant",
          text: "Preview complete. No live submission was created.",
        },
      ],
      stepIndex: null,
    });
  };

  const moveToNextStep = (
    step: RuntimeActionStep,
    stepIndex: number,
    fields: Record<string, unknown>,
    messages: PreviewMessage[],
  ) => {
    if (state.decisions.length > action.steps.length * 2 + 5) {
      setState({
        ...state,
        answer: "",
        diagnostics: [
          ...state.diagnostics,
          {
            id: getMessageId("diagnostic-loop"),
            severity: "error",
            stepLabel: formatStepName(step),
            title: "Possible route loop",
            detail:
              "The preview stopped after too many route decisions. Check branch/default routes around this step.",
          },
        ],
        fields,
        isComplete: true,
        messages: [
          ...messages,
          {
            id: getMessageId("assistant-loop"),
            role: "assistant",
            text: "Preview stopped because this route may be looping.",
          },
        ],
      });
      return;
    }

    const decision = getNextActionStepDecision(action, step, stepIndex, fields);
    const nextDecisions = [
      ...state.decisions,
      { ...decision, label: buildDecisionLabel(action, decision) },
    ];
    const routeDiagnostic: PreviewDiagnostic = {
      id: getMessageId("diagnostic-route"),
      severity: decision.routeType === "end" ? "info" : "info",
      stepLabel: formatStepName(step),
      title: "Route selected",
      detail: buildDecisionLabel(action, decision),
    };
    const nextDiagnostics = [...state.diagnostics, routeDiagnostic];

    if (decision.stepIndex === null) {
      completePreview(messages, fields, nextDecisions, nextDiagnostics);
      return;
    }

    const nextStep = runnableSteps[decision.stepIndex];
    setState({
      answer: "",
      decisions: nextDecisions,
      diagnostics: nextDiagnostics,
      fields,
      isComplete: false,
      messages: [
        ...messages,
        {
          id: getMessageId("assistant-step"),
          role: "assistant",
          text: buildPrompt(nextStep, fields),
        },
      ],
      stepIndex: decision.stepIndex,
    });
  };

  const submitAnswer = (answer: string) => {
    if (!currentStep || state.stepIndex === null || state.isComplete) {
      return;
    }

    const validation = validateStepAnswer(currentStep, answer, state.fields);
    if (!validation.isValid) {
      const invalidMessage = buildInvalidStepAnswerMessage(
        currentStep,
        state.fields,
        answer,
      );
      setState({
        ...state,
        answer: "",
        diagnostics: [
          ...state.diagnostics,
          {
            id: getMessageId("diagnostic-validation"),
            severity: "error",
            stepLabel: formatStepName(currentStep),
            title: "Answer failed validation",
            detail: invalidMessage,
          },
        ],
        messages: [
          ...state.messages,
          {
            id: getMessageId("user-invalid"),
            role: "user",
            text: answer,
          },
          {
            id: getMessageId("assistant-invalid"),
            role: "assistant",
            text: invalidMessage,
          },
        ],
      });
      return;
    }

    const answerResult = currentStep.fieldKey
      ? buildStepAnswerResult(
          currentStep,
          currentStep.fieldKey,
          validation.value,
          state.fields,
        )
      : { fields: {}, label: String(validation.value) };
    const fields = { ...state.fields, ...answerResult.fields };
    const messages = [
      ...state.messages,
      {
        id: getMessageId("user-answer"),
        role: "user" as const,
        text: answerResult.label,
      },
    ];

    moveToNextStep(currentStep, state.stepIndex, fields, messages);
  };

  const continueStep = () => {
    if (!currentStep || state.stepIndex === null || state.isComplete) {
      return;
    }

    if (isActionSubmitStep(currentStep)) {
      completePreview(
        state.messages,
        state.fields,
        state.decisions,
        state.diagnostics,
      );
      return;
    }

    moveToNextStep(currentStep, state.stepIndex, state.fields, state.messages);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
      <div className="space-y-4">
        <div className="min-h-80 rounded-md border bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Preview Chat</p>
              <p className="text-xs text-muted-foreground">
                {currentStep
                  ? `Current step: ${formatStepName(currentStep)}`
                  : "No active step"}
              </p>
            </div>
            <Button type="button" variant="outline" onClick={resetPreview}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          </div>

          <div className="space-y-3">
            {state.messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[88%] whitespace-pre-wrap rounded-md px-3 py-2 text-sm ${
                  message.role === "assistant"
                    ? "bg-gray-100 text-gray-900"
                    : "ml-auto bg-black text-white"
                }`}
              >
                {message.text}
              </div>
            ))}
          </div>
        </div>

        {currentStep && !state.isComplete && (
          <div className="rounded-md border bg-white p-4">
            {isActionInputStep(currentStep) ? (
              <div className="space-y-3">
                <ActionFlowStepOptions
                  step={currentStep}
                  fields={state.fields}
                  onSelect={submitAnswer}
                />
                <ActionFlowStepInput
                  step={currentStep}
                  value={state.answer}
                  onChange={(answer) => setState({ ...state, answer })}
                  onSubmit={submitAnswer}
                />
                {!currentStep.isRequired && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => submitAnswer("")}
                  >
                    Skip
                  </Button>
                )}
              </div>
            ) : (
              <Button type="button" onClick={continueStep}>
                <Play className="h-4 w-4" />
                {isActionSubmitStep(currentStep)
                  ? "Submit Preview"
                  : isActionConfirmationStep(currentStep) ||
                      isActionMessageStep(currentStep)
                    ? "Continue"
                    : "Next"}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="rounded-md border bg-white p-4">
          <p className="mb-2 text-sm font-medium">Test Diagnostics</p>
          {state.diagnostics.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Run through the preview to see validation and routing diagnostics.
            </p>
          ) : (
            <div className="space-y-2">
              {state.diagnostics.map((diagnostic) => (
                <div
                  key={diagnostic.id}
                  className={`rounded-md border px-3 py-2 text-sm ${
                    diagnostic.severity === "error"
                      ? "border-red-200 bg-red-50 text-red-900"
                      : diagnostic.severity === "warning"
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-blue-200 bg-blue-50 text-blue-900"
                  }`}
                >
                  <p className="font-medium">{diagnostic.title}</p>
                  {diagnostic.stepLabel && (
                    <p className="text-xs opacity-80">{diagnostic.stepLabel}</p>
                  )}
                  {diagnostic.detail && (
                    <p className="mt-1 text-xs opacity-90">
                      {diagnostic.detail}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md border bg-white p-4">
          <p className="mb-2 text-sm font-medium">Collected Fields</p>
          <pre className="max-h-52 overflow-auto rounded-md bg-gray-950 p-3 text-xs text-gray-100">
            {JSON.stringify(state.fields, null, 2)}
          </pre>
        </div>

        <div className="rounded-md border bg-white p-4">
          <p className="mb-2 text-sm font-medium">Route Decisions</p>
          {state.decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No routing decisions yet.
            </p>
          ) : (
            <div className="space-y-2">
              {state.decisions.map((decision, index) => (
                <div
                  key={`${decision.sourceStepId}-${index}`}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <p className="font-medium">{decision.label}</p>
                  <p className="text-xs text-muted-foreground">
                    Source step #{decision.sourceStepId}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md border bg-white p-4">
          <p className="mb-2 text-sm font-medium">Operation Preview</p>
          {operationSteps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No enabled operation steps are attached to this flow.
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              {operationSteps.map((step) => (
                <div key={step.id} className="rounded-md border px-3 py-2">
                  <p className="font-medium">{formatStepName(step)}</p>
                  <p className="text-xs text-muted-foreground">
                    Would run operation #{step.operationId ?? "not selected"}{" "}
                    after a real submission.
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
