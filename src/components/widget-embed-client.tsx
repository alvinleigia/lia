"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, Loader2, Send } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { ActionFlowContentMedia } from "@/components/action-flow-content-media";
import { ActionFlowProductCards } from "@/components/action-flow-product-cards";
import {
  ActionFlowStepInput,
  ActionFlowStepOptions,
} from "@/components/action-flow-step-input";
import {
  type ActiveActionFlow,
  buildActionReviewSummary,
  buildActionStepMessage,
  buildActionStepTextFallbackMessage,
  buildInvalidStepAnswerMessage,
  buildStepAnswerResult,
  type FlowChatMessage,
  type FlowEditSection,
  findTriggeredAction,
  getActionStepChoiceDisplayMode,
  getActionStepContentMedia,
  getActionStepContentProductGroups,
  getActionStepInputType,
  getActionStepOptions,
  getActionStepProductDisplayLayout,
  getActionStepProducts,
  getNextActionStepDecision,
  getRunnableActionSteps,
  isActionConfirmationStep,
  isActionInputStep,
  isActionMessageStep,
  isActionMutationStep,
  isActionSubmitStep,
  isProductMessageStep,
  prepareFlowSectionEdit,
  type RuntimeAction,
  type RuntimeRouteDecision,
  summarizeActionFields,
  validateStepAnswer,
} from "@/lib/action-runtime";

type WidgetEmbedClientProps = {
  actions: RuntimeAction[];
  token: string;
};

type FlowMediaUploadResponse = {
  label: string;
  value: unknown;
};

function makeFlowMessage(
  role: FlowChatMessage["role"],
  text: string,
  metadata: Omit<FlowChatMessage, "id" | "role" | "text"> = {},
) {
  return {
    id: `widget-flow-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...metadata,
    role,
    text,
  };
}

function makeStepFlowMessage(
  step: RuntimeAction["steps"][number],
  text = buildActionStepMessage(step),
) {
  const isProductMessage = isProductMessageStep(step);

  return makeFlowMessage("assistant", text, {
    media: getActionStepContentMedia(step),
    productMode: isProductMessage
      ? step.stepType === "single_product"
        ? "single_product"
        : step.stepType === "multiple_products"
          ? "multiple_products"
          : "catalog"
      : undefined,
    productLayout: isProductMessage
      ? getActionStepProductDisplayLayout(step)
      : undefined,
    productGroups: getActionStepContentProductGroups(step),
    products: isProductMessage ? getActionStepProducts(step) : undefined,
  });
}

function shouldRenderStepControl(inputType: string | null) {
  return ["date", "time", "int", "float"].includes(inputType ?? "");
}

export function WidgetEmbedClient({ actions, token }: WidgetEmbedClientProps) {
  const [input, setInput] = useState("");
  const [conversationId] = useState(
    () => `widget-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const [flowMessages, setFlowMessages] = useState<FlowChatMessage[]>([]);
  const [activeFlow, setActiveFlow] = useState<ActiveActionFlow | null>(null);
  const [isSavingSubmission, setIsSavingSubmission] = useState(false);

  const apiPath = useMemo(
    () => `/api/widget/chat?token=${encodeURIComponent(token)}`,
    [token],
  );
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: apiPath,
      }),
    [apiPath],
  );

  const { messages, sendMessage, status, error } = useChat({
    transport,
  });

  const isLoading = status === "submitted" || status === "streaming";
  const isBusy = isLoading || isSavingSubmission;
  const activeAction = activeFlow
    ? actions.find((action) => action.id === activeFlow.actionId)
    : null;
  const activeStep =
    activeAction && activeFlow?.mode === "collecting"
      ? getRunnableActionSteps(activeAction)[activeFlow.stepIndex]
      : null;
  const isConfirmingFlow = activeFlow?.mode === "confirming";
  const activeStepHasOptions = activeStep
    ? isActionInputStep(activeStep) &&
      getActionStepChoiceDisplayMode(activeStep) !== "text" &&
      getActionStepOptions(activeStep, activeFlow?.fields).length > 0
    : false;
  const activeStepHasInlineControl = activeStep
    ? isActionInputStep(activeStep) &&
      (activeStepHasOptions ||
        activeStep.stepType === "file_upload" ||
        shouldRenderStepControl(getActionStepInputType(activeStep)))
    : false;

  const startActionFlow = async (
    action: RuntimeAction,
    openingText?: string,
  ) => {
    const steps = getRunnableActionSteps(action);
    if (steps.length === 0) {
      setFlowMessages((current) => [
        ...current,
        ...(openingText ? [makeFlowMessage("user", openingText)] : []),
        makeFlowMessage(
          "assistant",
          `${action.name} is available, but it does not have any flow steps configured yet.`,
        ),
      ]);
      return;
    }

    setIsSavingSubmission(true);
    let submissionId: number;

    try {
      const response = await fetch("/api/widget/actions/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId: action.id,
          conversationId,
          event: "start",
          token,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to start flow.");
      }

      const result = (await response.json()) as { submissionId: number };
      submissionId = result.submissionId;
    } catch {
      setFlowMessages((current) => [
        ...current,
        ...(openingText ? [makeFlowMessage("user", openingText)] : []),
        makeFlowMessage(
          "assistant",
          "I could not start that request. Please try again.",
        ),
      ]);
      setIsSavingSubmission(false);
      return;
    }

    await advanceFlowToNextStep(
      action,
      {
        actionId: action.id,
        actionName: action.name,
        conversationId,
        stepIndex: 0,
        fields: {},
        mode: "collecting",
        submissionId,
      },
      [
        ...(openingText ? [makeFlowMessage("user", openingText)] : []),
        makeFlowMessage("assistant", `Sure, I can help with ${action.name}.`),
      ],
    );
    setIsSavingSubmission(false);
  };

  const submitActionFlow = async (flow: ActiveActionFlow) => {
    if (!flow.submissionId) {
      setFlowMessages((current) => [
        ...current,
        makeFlowMessage(
          "assistant",
          "I could not find the saved request session. Please start again.",
        ),
      ]);
      setActiveFlow(null);
      return;
    }

    setIsSavingSubmission(true);

    try {
      const response = await fetch("/api/widget/actions/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "submit",
          fields: flow.fields,
          submissionId: flow.submissionId,
          token,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save submission.");
      }

      setFlowMessages((current) => [
        ...current,
        makeFlowMessage(
          "assistant",
          [
            "Thanks. I saved this request.",
            "",
            summarizeActionFields(flow.fields),
            "",
            "The team can now review it from their submissions area.",
          ].join("\n"),
        ),
      ]);
      setActiveFlow(null);
    } catch {
      setFlowMessages((current) => [
        ...current,
        makeFlowMessage(
          "assistant",
          "I could not save that request. Please try again.",
        ),
      ]);
    } finally {
      setIsSavingSubmission(false);
    }
  };

  const advanceFlowToNextStep = async (
    action: RuntimeAction,
    flow: ActiveActionFlow,
    messagesToAdd: FlowChatMessage[],
  ) => {
    const steps = getRunnableActionSteps(action);
    const nextMessages = [...messagesToAdd];
    let stepIndex = flow.stepIndex;
    const visitedStepIds = new Set<number>();

    while (stepIndex < steps.length) {
      const step = steps[stepIndex];

      if (visitedStepIds.has(step.id)) {
        nextMessages.push(
          makeFlowMessage(
            "assistant",
            "This flow has a routing loop. Please ask the team to review the action setup.",
          ),
        );
        setFlowMessages((current) => [...current, ...nextMessages]);
        setActiveFlow(null);
        return;
      }

      visitedStepIds.add(step.id);

      if (step.stepType === "handoff") {
        nextMessages.push(makeStepFlowMessage(step));

        try {
          await persistFlowHandoff({
            fields: flow.fields,
            flow,
            stepId: step.id,
          });
        } catch {
          nextMessages.push(
            makeFlowMessage(
              "assistant",
              "I could not notify the team. Please try again.",
            ),
          );
        }

        setFlowMessages((current) => [...current, ...nextMessages]);
        setActiveFlow(null);
        return;
      }

      if (isActionMessageStep(step)) {
        nextMessages.push(makeStepFlowMessage(step));
        const decision = getNextActionStepDecision(
          action,
          step,
          stepIndex,
          flow.fields,
        );

        if (decision.stepIndex === null) {
          break;
        }

        stepIndex = decision.stepIndex;
        continue;
      }

      if (isActionMutationStep(step)) {
        const decision = getNextActionStepDecision(
          action,
          step,
          stepIndex,
          flow.fields,
        );
        const nextStepIndex = decision.stepIndex ?? steps.length;
        const nextStep =
          typeof decision.stepIndex === "number"
            ? steps[decision.stepIndex]
            : null;

        try {
          await persistFlowMutation({
            fields: flow.fields,
            flow,
            branchDecision: decision,
            nextStepId: nextStep?.id ?? null,
            stepId: step.id,
          });
        } catch {
          nextMessages.push(
            makeFlowMessage(
              "assistant",
              "I could not update the contact details. Please try again.",
            ),
          );
          setFlowMessages((current) => [...current, ...nextMessages]);
          return;
        }

        stepIndex = nextStepIndex;
        continue;
      }

      if (isActionSubmitStep(step)) {
        nextMessages.push(makeStepFlowMessage(step));
        setFlowMessages((current) => [...current, ...nextMessages]);
        await submitActionFlow({ ...flow, stepIndex });
        return;
      }

      if (isActionConfirmationStep(step)) {
        nextMessages.push(
          makeStepFlowMessage(
            step,
            [
              buildActionStepMessage(step),
              "",
              buildActionReviewSummary(flow.fields),
            ].join("\n"),
          ),
        );
        setFlowMessages((current) => [...current, ...nextMessages]);
        setActiveFlow({ ...flow, stepIndex, mode: "confirming" });
        return;
      }

      if (isActionInputStep(step)) {
        nextMessages.push(
          makeStepFlowMessage(
            step,
            buildActionStepTextFallbackMessage(step, flow.fields, {
              includeRichContent: false,
            }),
          ),
        );
        setFlowMessages((current) => [...current, ...nextMessages]);
        setActiveFlow({ ...flow, stepIndex, mode: "collecting" });
        return;
      }

      stepIndex += 1;
    }

    nextMessages.push(
      makeFlowMessage(
        "assistant",
        [
          "Please review your request before I save it.",
          "",
          buildActionReviewSummary(flow.fields),
        ].join("\n"),
      ),
    );
    setFlowMessages((current) => [...current, ...nextMessages]);
    setActiveFlow({
      ...flow,
      editStepIndexes: undefined,
      stepIndex: steps.length,
      mode: "confirming",
    });
  };

  const persistFlowProgress = async (input: {
    fieldKey: string;
    fields: Record<string, unknown>;
    nextStepId: number | null;
    stepId: number;
    value: unknown;
    branchDecision?: RuntimeRouteDecision | null;
    flow: ActiveActionFlow;
  }) => {
    if (!input.flow.submissionId) {
      return;
    }

    await fetch("/api/widget/actions/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentStepId: input.nextStepId,
        event: "progress",
        fieldKey: input.fieldKey,
        fields: input.fields,
        branchDecision: input.branchDecision ?? undefined,
        stepId: input.stepId,
        submissionId: input.flow.submissionId,
        token,
        value: input.value,
      }),
    });
  };

  const persistFlowHandoff = async (input: {
    fields: Record<string, unknown>;
    flow: ActiveActionFlow;
    stepId: number;
  }) => {
    if (!input.flow.submissionId) {
      return;
    }

    const response = await fetch("/api/widget/actions/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "handoff",
        fields: input.fields,
        stepId: input.stepId,
        submissionId: input.flow.submissionId,
        token,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to request handoff.");
    }
  };

  const persistFlowMutation = async (input: {
    fields: Record<string, unknown>;
    nextStepId: number | null;
    stepId: number;
    branchDecision?: RuntimeRouteDecision | null;
    flow: ActiveActionFlow;
  }) => {
    if (!input.flow.submissionId) {
      return;
    }

    await fetch("/api/widget/actions/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentStepId: input.nextStepId,
        event: "mutation",
        fields: input.fields,
        branchDecision: input.branchDecision ?? undefined,
        stepId: input.stepId,
        submissionId: input.flow.submissionId,
        token,
      }),
    });
  };

  const recordFlowValidationFailure = async (input: {
    fieldKey: string;
    flow: ActiveActionFlow;
    message: string;
    stepId: number;
    value: unknown;
  }) => {
    if (!input.flow.submissionId) {
      return;
    }

    await fetch("/api/widget/actions/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "validation_failed",
        fieldKey: input.fieldKey,
        message: input.message,
        stepId: input.stepId,
        submissionId: input.flow.submissionId,
        token,
        value: input.value,
      }),
    });
  };

  const handleFlowAnswer = async (text: string, flow: ActiveActionFlow) => {
    const action = actions.find((item) => item.id === flow.actionId);
    if (!action) {
      setActiveFlow(null);
      return;
    }

    const steps = getRunnableActionSteps(action);
    const step = steps[flow.stepIndex];
    if (!step) {
      await submitActionFlow(flow);
      return;
    }

    if (!isActionInputStep(step)) {
      await advanceFlowToNextStep(action, flow, []);
      return;
    }

    const parsedAnswer = validateStepAnswer(step, text, flow.fields);
    if (!parsedAnswer.isValid) {
      const fieldKey = step.fieldKey ?? `step_${step.id}`;
      const invalidMessage = buildInvalidStepAnswerMessage(
        step,
        flow.fields,
        text,
      );

      recordFlowValidationFailure({
        fieldKey,
        flow,
        message: invalidMessage,
        stepId: step.id,
        value: text,
      }).catch(() => {
        // Validation logging must not block the user from correcting input.
      });

      setFlowMessages((current) => [
        ...current,
        makeFlowMessage("user", text),
        makeFlowMessage(
          "assistant",
          `${invalidMessage}\n\n${buildActionStepTextFallbackMessage(
            step,
            flow.fields,
          )}`,
        ),
      ]);
      return;
    }

    const fieldKey = step.fieldKey ?? `step_${step.id}`;
    const answerResult = buildStepAnswerResult(
      step,
      fieldKey,
      parsedAnswer.value,
      flow.fields,
    );
    const nextFields = {
      ...flow.fields,
      ...answerResult.fields,
    };
    const editStepPosition =
      flow.editStepIndexes?.indexOf(flow.stepIndex) ?? -1;
    const branchDecision =
      editStepPosition >= 0
        ? null
        : getNextActionStepDecision(action, step, flow.stepIndex, nextFields);
    const nextStepIndex =
      editStepPosition >= 0
        ? flow.editStepIndexes?.[editStepPosition + 1]
        : (branchDecision?.stepIndex ?? steps.length);
    const nextStep =
      typeof nextStepIndex === "number" ? steps[nextStepIndex] : null;

    try {
      await persistFlowProgress({
        fieldKey,
        fields: nextFields,
        flow,
        branchDecision,
        nextStepId: nextStep?.id ?? null,
        stepId: step.id,
        value: parsedAnswer.value,
      });
    } catch {
      setFlowMessages((current) => [
        ...current,
        makeFlowMessage(
          "assistant",
          "I could not save that answer. Please try again.",
        ),
      ]);
      return;
    }

    await advanceFlowToNextStep(
      action,
      {
        ...flow,
        editStepIndexes:
          editStepPosition >= 0 ? flow.editStepIndexes : undefined,
        stepIndex: nextStepIndex ?? steps.length,
        fields: nextFields,
        mode: "collecting",
      },
      [makeFlowMessage("user", answerResult.label)],
    );
  };

  const handleFlowFileUpload = async (file: File, flow: ActiveActionFlow) => {
    const action = actions.find((item) => item.id === flow.actionId);

    if (!action) {
      setActiveFlow(null);
      return;
    }

    const steps = getRunnableActionSteps(action);
    const step = steps[flow.stepIndex];
    if (!step || step.stepType !== "file_upload") {
      return;
    }

    if (!flow.submissionId) {
      setFlowMessages((current) => [
        ...current,
        makeFlowMessage(
          "assistant",
          "I could not find the saved request session. Please start again.",
        ),
      ]);
      setActiveFlow(null);
      return;
    }

    setIsSavingSubmission(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("stepId", String(step.id));
      formData.append("submissionId", String(flow.submissionId));
      formData.append("token", token);

      const response = await fetch("/api/widget/actions/flow/media", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(errorPayload?.message || "Failed to upload media.");
      }

      const upload = (await response.json()) as FlowMediaUploadResponse;
      const fieldKey = step.fieldKey ?? `step_${step.id}`;
      const answerResult = buildStepAnswerResult(
        step,
        fieldKey,
        upload.value,
        flow.fields,
      );
      const nextFields = {
        ...flow.fields,
        ...answerResult.fields,
      };
      const branchDecision = getNextActionStepDecision(
        action,
        step,
        flow.stepIndex,
        nextFields,
      );
      const nextStepIndex = branchDecision.stepIndex ?? steps.length;
      const nextStep =
        typeof nextStepIndex === "number" ? steps[nextStepIndex] : null;

      await persistFlowProgress({
        fieldKey,
        fields: nextFields,
        flow,
        branchDecision,
        nextStepId: nextStep?.id ?? null,
        stepId: step.id,
        value: upload.value,
      });

      await advanceFlowToNextStep(
        action,
        {
          ...flow,
          stepIndex: nextStepIndex,
          fields: nextFields,
          mode: "collecting",
        },
        [makeFlowMessage("user", upload.label || answerResult.label)],
      );
    } catch (error) {
      setFlowMessages((current) => [
        ...current,
        makeFlowMessage(
          "assistant",
          error instanceof Error
            ? error.message
            : "I could not upload that file. Please try again.",
        ),
      ]);
    } finally {
      setIsSavingSubmission(false);
      setInput("");
    }
  };

  const closeWidget = () => {
    if (typeof window !== "undefined" && window.parent) {
      window.parent.postMessage({ type: "RAG_WIDGET_CLOSE" }, "*");
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || isBusy) {
      return;
    }

    if (activeFlow) {
      if (activeFlow.mode === "confirming") {
        setFlowMessages((current) => [
          ...current,
          makeFlowMessage("user", text),
          makeFlowMessage(
            "assistant",
            "Please use Confirm, Edit, or Cancel to finish this request.",
          ),
        ]);
        setInput("");
        return;
      }

      await handleFlowAnswer(text, activeFlow);
      setInput("");
      return;
    }

    const triggeredAction = findTriggeredAction(actions, text);
    if (triggeredAction) {
      await startActionFlow(triggeredAction, text);
      setInput("");
      return;
    }

    sendMessage({ text });
    setInput("");
  };

  const submitActiveStep = async (value: string) => {
    if (!activeFlow) {
      return;
    }

    await handleFlowAnswer(value, activeFlow);
    setInput("");
  };

  const uploadActiveStepFile = async (file: File) => {
    if (!activeFlow) {
      return;
    }

    await handleFlowFileUpload(file, activeFlow);
  };

  const confirmActiveFlow = async () => {
    if (!activeFlow || activeFlow.mode !== "confirming") {
      return;
    }

    await submitActionFlow(activeFlow);
  };

  const editActiveFlowSection = (section: FlowEditSection) => {
    if (!activeFlow || !activeAction) {
      return;
    }

    const nextFlow = prepareFlowSectionEdit(activeAction, activeFlow, section);
    const nextStep = getRunnableActionSteps(activeAction)[nextFlow.stepIndex];

    setActiveFlow(nextFlow);
    setFlowMessages((current) => [
      ...current,
      makeFlowMessage(
        "assistant",
        nextStep
          ? `No problem. ${buildActionStepTextFallbackMessage(
              nextStep,
              nextFlow.fields,
            )}`
          : "No problem. Let's update the details.",
      ),
    ]);
  };

  const cancelActiveFlow = () => {
    const submissionId = activeFlow?.submissionId;
    if (submissionId) {
      fetch("/api/widget/actions/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "cancel",
          submissionId,
          token,
        }),
      });
    }

    setActiveFlow(null);
    setInput("");
    setFlowMessages((current) => [
      ...current,
      makeFlowMessage("assistant", "Okay, I cancelled this request."),
    ]);
  };

  return (
    <div className="h-screen w-full bg-[#f7f7f8] flex flex-col">
      <div className="px-4 py-3 border-b bg-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-black text-white flex items-center justify-center text-sm font-semibold">
            R
          </div>
          <div>
            <p className="text-base font-semibold leading-none">Lia AI</p>
            <p className="text-xs text-muted-foreground mt-1">
              Ask anything about this project
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close chat"
          onClick={closeWidget}
          className="h-8 w-8 rounded-full border text-lg leading-none hover:bg-gray-100"
        >
          x
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => startActionFlow(action)}
                disabled={Boolean(activeFlow) || isBusy}
                className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1.5 text-xs hover:bg-gray-100 disabled:opacity-50"
              >
                <Bot className="h-3.5 w-3.5" />
                {action.name}
              </button>
            ))}
          </div>
        )}

        {messages.map((message) =>
          message.parts.map((part, idx) => {
            if (part.type !== "text") {
              return null;
            }

            return (
              <div
                key={`${message.id}-${idx}`}
                className={
                  message.role === "user"
                    ? "ml-8 rounded-lg bg-black text-white p-2 text-sm"
                    : "mr-8 rounded-lg bg-gray-100 text-gray-900 p-2 text-sm"
                }
              >
                {part.text}
              </div>
            );
          }),
        )}
        {flowMessages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "ml-8 rounded-lg bg-black text-white p-2 text-sm whitespace-pre-wrap"
                : "mr-8 rounded-lg bg-gray-100 text-gray-900 p-2 text-sm whitespace-pre-wrap"
            }
          >
            {message.text}
            {message.role === "assistant" && message.media && (
              <ActionFlowContentMedia compact media={message.media} />
            )}
            {message.role === "assistant" && message.products && (
              <ActionFlowProductCards
                compact
                layout={message.productLayout}
                products={message.products}
              />
            )}
            {message.role === "assistant" &&
              message.productGroups?.map((group) => (
                <ActionFlowProductCards
                  compact
                  key={`${message.id}-${group.id}`}
                  layout={group.layout}
                  products={group.products}
                />
              ))}
          </div>
        ))}
        {activeStep && activeStepHasInlineControl && (
          <div className="mr-8 rounded-lg bg-gray-100 text-gray-900 p-2 text-sm">
            {activeStepHasOptions ? (
              <ActionFlowStepOptions
                step={activeStep}
                fields={activeFlow?.fields}
                disabled={isBusy}
                onSelect={submitActiveStep}
              />
            ) : (
              <ActionFlowStepInput
                compact
                step={activeStep}
                value={input}
                onChange={setInput}
                onFileSubmit={uploadActiveStepFile}
                onSubmit={submitActiveStep}
                disabled={Boolean(error) || isBusy}
              />
            )}
          </div>
        )}
        {isConfirmingFlow && (
          <div className="mr-8 rounded-lg bg-gray-100 text-gray-900 p-2 text-sm">
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                className="rounded-full bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                onClick={confirmActiveFlow}
                disabled={isBusy}
              >
                Confirm Request
              </button>
              <button
                type="button"
                className="rounded-full border bg-white px-3 py-1.5 text-sm hover:bg-gray-100"
                onClick={() => editActiveFlowSection("service")}
              >
                Edit Service
              </button>
              <button
                type="button"
                className="rounded-full border bg-white px-3 py-1.5 text-sm hover:bg-gray-100"
                onClick={() => editActiveFlowSection("schedule")}
              >
                Edit Schedule
              </button>
              <button
                type="button"
                className="rounded-full border bg-white px-3 py-1.5 text-sm hover:bg-gray-100"
                onClick={() => editActiveFlowSection("name")}
              >
                Edit Name
              </button>
              <button
                type="button"
                className="rounded-full border bg-white px-3 py-1.5 text-sm hover:bg-gray-100"
                onClick={() => editActiveFlowSection("email")}
              >
                Edit Email
              </button>
              <button
                type="button"
                className="rounded-full border bg-white px-3 py-1.5 text-sm hover:bg-gray-100"
                onClick={() => editActiveFlowSection("phone")}
              >
                Edit Phone
              </button>
              <button
                type="button"
                className="rounded-full border bg-white px-3 py-1.5 text-sm hover:bg-gray-100"
                onClick={cancelActiveFlow}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {isBusy && (
          <div className="mr-8 rounded-lg bg-gray-100 text-gray-900 p-2 text-sm">
            Thinking...
          </div>
        )}
        {error && (
          <div className="mr-8 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 p-2 text-sm">
            {error.message.includes("disabled")
              ? error.message
              : "Chat is unavailable right now. Please try again later."}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="border-t bg-white p-3 flex gap-2">
        <input
          className="flex-1 rounded-md border px-3 py-2 text-sm"
          placeholder="Ask a question..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={Boolean(error) || isBusy}
        />
        <button
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black text-white disabled:opacity-50"
          disabled={Boolean(error) || isBusy || !input.trim() || !token}
          type="submit"
          aria-label="Send"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </form>
    </div>
  );
}
