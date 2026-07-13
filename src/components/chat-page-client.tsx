"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, MessageSquare } from "lucide-react";
import { Fragment, useState } from "react";
import { ActionFlowProductCards } from "@/components/action-flow-product-cards";
import {
  ActionFlowStepInput,
  ActionFlowStepOptions,
} from "@/components/action-flow-step-input";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/loader";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Response } from "@/components/ai-elements/response";
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

type ChatPageClientProps = {
  actions: RuntimeAction[];
  projectId: number;
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
    id: `flow-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...metadata,
    role,
    text,
  };
}

function makeStepFlowMessage(step: RuntimeAction["steps"][number]) {
  const isProductMessage = isProductMessageStep(step);

  return makeFlowMessage("assistant", buildActionStepMessage(step), {
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
    products: isProductMessage ? getActionStepProducts(step) : undefined,
  });
}

function shouldRenderStepControl(inputType: string | null) {
  return ["date", "time", "int", "float"].includes(inputType ?? "");
}

export function ChatPageClient({ actions, projectId }: ChatPageClientProps) {
  const [input, setInput] = useState("");
  const [conversationId] = useState(
    () => `project-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const [flowMessages, setFlowMessages] = useState<FlowChatMessage[]>([]);
  const [activeFlow, setActiveFlow] = useState<ActiveActionFlow | null>(null);
  const [isSavingSubmission, setIsSavingSubmission] = useState(false);
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { projectId },
    }),
  });
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
      const response = await fetch("/api/actions/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId: action.id,
          conversationId,
          event: "start",
          source: "project_chat",
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
      const response = await fetch("/api/actions/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "submit",
          fields: flow.fields,
          submissionId: flow.submissionId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save submission.");
      }

      const result = (await response.json()) as { submissionId: number };
      setFlowMessages((current) => [
        ...current,
        makeFlowMessage(
          "assistant",
          [
            "Thanks. I saved this request.",
            "",
            summarizeActionFields(flow.fields),
            "",
            `Submission #${result.submissionId} is available in the Submissions area.`,
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
        nextMessages.push(
          makeFlowMessage("assistant", buildActionStepMessage(step)),
        );

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
        nextMessages.push(
          isProductMessageStep(step)
            ? makeStepFlowMessage(step)
            : makeFlowMessage("assistant", buildActionStepMessage(step)),
        );
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
        nextMessages.push(
          makeFlowMessage("assistant", buildActionStepMessage(step)),
        );
        setFlowMessages((current) => [...current, ...nextMessages]);
        await submitActionFlow({ ...flow, stepIndex });
        return;
      }

      if (isActionConfirmationStep(step)) {
        nextMessages.push(
          makeFlowMessage(
            "assistant",
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
          makeFlowMessage(
            "assistant",
            buildActionStepTextFallbackMessage(step, flow.fields),
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

    await fetch("/api/actions/flow", {
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

    const response = await fetch("/api/actions/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "handoff",
        fields: input.fields,
        stepId: input.stepId,
        submissionId: input.flow.submissionId,
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

    await fetch("/api/actions/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentStepId: input.nextStepId,
        event: "mutation",
        fields: input.fields,
        branchDecision: input.branchDecision ?? undefined,
        stepId: input.stepId,
        submissionId: input.flow.submissionId,
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

    await fetch("/api/actions/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "validation_failed",
        fieldKey: input.fieldKey,
        message: input.message,
        stepId: input.stepId,
        submissionId: input.flow.submissionId,
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

      const response = await fetch("/api/actions/flow/media", {
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

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text?.trim();
    if (!text || isSavingSubmission) {
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

    sendMessage({
      text,
    });
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
      fetch("/api/actions/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "cancel",
          submissionId,
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
    <div className="max-w-4xl mx-auto px-6 py-4 relative h-[calc(100dvh-4rem-1px)] overflow-hidden flex flex-col">
      <div className="mb-3 rounded-md border bg-white px-3 py-2 text-sm font-medium inline-flex items-center gap-2">
        <MessageSquare className="h-4 w-4" />
        Project Chat
      </div>
      <div className="flex flex-col flex-1 min-h-0">
        <Conversation className="flex-1 min-h-0">
          <ConversationContent>
            {actions.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {actions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => startActionFlow(action)}
                    className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                    disabled={Boolean(activeFlow) || isSavingSubmission}
                  >
                    <Bot className="h-4 w-4" />
                    {action.name}
                  </button>
                ))}
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id}>
                {message.parts.map((part, i) => {
                  switch (part.type) {
                    case "text":
                      return (
                        <Fragment key={`${message.id}-${i}`}>
                          <Message from={message.role}>
                            <MessageContent>
                              <Response>{part.text}</Response>
                            </MessageContent>
                          </Message>
                        </Fragment>
                      );
                    default:
                      return null;
                  }
                })}
              </div>
            ))}
            {flowMessages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  <Response>{message.text}</Response>
                  {message.role === "assistant" && message.products && (
                    <ActionFlowProductCards
                      layout={message.productLayout}
                      products={message.products}
                    />
                  )}
                </MessageContent>
              </Message>
            ))}
            {activeStep && activeStepHasInlineControl && (
              <Message from="assistant">
                <MessageContent>
                  {activeStepHasOptions ? (
                    <ActionFlowStepOptions
                      step={activeStep}
                      fields={activeFlow?.fields}
                      disabled={isSavingSubmission}
                      onSelect={submitActiveStep}
                    />
                  ) : (
                    <ActionFlowStepInput
                      step={activeStep}
                      value={input}
                      onChange={setInput}
                      onFileSubmit={uploadActiveStepFile}
                      onSubmit={submitActiveStep}
                      disabled={isSavingSubmission}
                    />
                  )}
                </MessageContent>
              </Message>
            )}
            {isConfirmingFlow && (
              <Message from="assistant">
                <MessageContent>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      type="button"
                      className="rounded-full bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                      onClick={confirmActiveFlow}
                      disabled={isSavingSubmission}
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
                </MessageContent>
              </Message>
            )}
            {(status === "submitted" ||
              status === "streaming" ||
              isSavingSubmission) && <Loader />}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <PromptInput onSubmit={handleSubmit} className="mt-4">
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </PromptInputBody>
          <PromptInputToolbar>
            <PromptInputTools />
            <PromptInputSubmit
              disabled={
                !input.trim() ||
                status === "submitted" ||
                status === "streaming" ||
                isSavingSubmission
              }
              status={status}
            />
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </div>
  );
}
