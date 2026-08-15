"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, MessageSquare } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { ActionFlowContentMedia } from "@/components/action-flow-content-media";
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
import { RuntimeInputControl } from "@/components/runtime-input-control";
import {
  type ActiveActionFlow,
  type FlowChatMessage,
  type FlowEditSection,
  findActionForTaskRecommendation,
  getActionStartControlText,
  getActionStepChoiceDisplayMode,
  getActionStepOptions,
  getRunnableActionSteps,
  isActionInputStep,
  type RuntimeAction,
} from "@/lib/action-runtime";
import {
  browserRuntimeRepliesToFlowMessages,
  mergeBrowserFlowResumeMessages,
} from "@/lib/browser-channel-adapter";
import {
  createBrowserCommandId,
  getOrCreateSessionConversationId,
  postBrowserFlowCommand,
  postBrowserFlowMediaCommand,
  readBrowserFlowFailure,
  recoverBrowserFlowState,
} from "@/lib/browser-conversation";
import type { BrowserFlowRuntimeResult } from "@/lib/browser-flow-contract";
import {
  getBrowserComposerPlaceholder,
  shouldRenderActionStepInlineControl,
  shouldRenderRuntimeInputControl,
} from "@/lib/browser-input-presentation";
import type { TurnMessageV1 } from "@/lib/conversation-turn-contracts";
import type { ProjectStructuredTurnResult } from "@/lib/conversation-turn-service";

type ChatPageClientProps = {
  actions: RuntimeAction[];
  projectId: number;
};

type FlowMediaUploadResponse = BrowserFlowRuntimeResult & {
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

export function ChatPageClient({ actions, projectId }: ChatPageClientProps) {
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [flowMessages, setFlowMessages] = useState<FlowChatMessage[]>([]);
  const [activeFlow, setActiveFlow] = useState<ActiveActionFlow | null>(null);
  const [serverActiveAction, setServerActiveAction] =
    useState<RuntimeAction | null>(null);
  const [isSavingSubmission, setIsSavingSubmission] = useState(false);

  useEffect(() => {
    const restoredConversationId = getOrCreateSessionConversationId({
      key: `lia:project-chat:${projectId}`,
      prefix: "project",
      storage: window.sessionStorage,
    });
    let isCurrent = true;

    setConversationId(restoredConversationId);
    setIsSavingSubmission(true);

    fetch("/api/actions/runtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: restoredConversationId,
        projectId,
        resume: true,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to resume flow.");
        }

        return (await response.json()) as BrowserFlowRuntimeResult;
      })
      .then((result) => {
        if (!isCurrent) {
          return;
        }

        setFlowMessages(
          result.history
            ? mergeBrowserFlowResumeMessages(
                "project_chat",
                result.history,
                result.replies,
              )
            : result.handled
              ? browserRuntimeRepliesToFlowMessages(
                  "project_chat",
                  result.replies,
                )
              : [],
        );
        setActiveFlow(result.activeFlow);
        setServerActiveAction(result.activeFlow ? result.action : null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (isCurrent) {
          setIsSavingSubmission(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [projectId]);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { projectId },
    }),
  });
  const activeAction = activeFlow
    ? (serverActiveAction ??
      actions.find((action) => action.id === activeFlow.actionId))
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
      shouldRenderActionStepInlineControl({
        hasOptions: activeStepHasOptions,
        stepType: activeStep.stepType,
      })
    : false;
  const latestFlowMessage = flowMessages[flowMessages.length - 1];
  const runtimeInputRequest =
    latestFlowMessage?.role === "assistant"
      ? latestFlowMessage.inputRequest
      : null;
  const runtimeInputHasInlineControl = runtimeInputRequest
    ? shouldRenderRuntimeInputControl(runtimeInputRequest)
    : false;

  const recoverFlow = async (expectedRevision?: number) => {
    if (!conversationId) {
      return false;
    }

    const result = await recoverBrowserFlowState({
      body: { conversationId, projectId },
      expectedRevision,
      url: "/api/actions/runtime",
    });
    if (!result) {
      return false;
    }

    setActiveFlow(result.activeFlow);
    setServerActiveAction(result.activeFlow ? result.action : null);
    setFlowMessages((current) => [
      ...current,
      ...browserRuntimeRepliesToFlowMessages("project_chat", result.replies),
      makeFlowMessage(
        "assistant",
        result.activeFlow
          ? "This request changed in another tab, so I refreshed it. Please send your answer again."
          : "That request is already complete or no longer active. You can start a new request when ready.",
      ),
    ]);
    return true;
  };

  const runCanonicalFlow = async (input: {
    actionId?: number;
    displayText?: string;
    displayUserText?: boolean;
    editSection?: FlowEditSection;
    selection?: { id: string; label: string; value: string };
    text?: string;
  }) => {
    if (!conversationId) {
      return true;
    }

    const optimisticUserMessage =
      input.displayUserText && input.text
        ? makeFlowMessage("user", input.displayText ?? input.text)
        : null;

    if (optimisticUserMessage) {
      setFlowMessages((current) => [...current, optimisticUserMessage]);
    }

    setIsSavingSubmission(true);

    try {
      const response = await postBrowserFlowCommand("/api/actions/runtime", {
        actionId: input.actionId,
        commandId: createBrowserCommandId(),
        conversationId,
        editSection: input.editSection,
        expectedRevision: activeFlow?.revision,
        projectId,
        selection: input.selection,
        text: input.text,
      });

      if (!response.ok) {
        const failure = await readBrowserFlowFailure(
          response,
          "Failed to process flow message.",
        );
        if (
          response.status === 409 &&
          failure.code &&
          ["conflict", "failed", "processing", "stale"].includes(
            failure.code,
          ) &&
          (await recoverFlow(activeFlow?.revision))
        ) {
          return true;
        }
        throw new Error(failure.message);
      }

      const result = (await response.json()) as BrowserFlowRuntimeResult;
      if (!result.handled) {
        if (optimisticUserMessage) {
          setFlowMessages((current) =>
            current.filter(
              (message) => message.id !== optimisticUserMessage.id,
            ),
          );
        }
        return false;
      }

      setFlowMessages((current) => [
        ...current,
        ...browserRuntimeRepliesToFlowMessages("project_chat", result.replies),
      ]);
      setActiveFlow(result.activeFlow);
      setServerActiveAction(result.activeFlow ? result.action : null);
      return true;
    } catch (error) {
      setFlowMessages((current) => [
        ...current,
        makeFlowMessage(
          "assistant",
          error instanceof Error
            ? error.message
            : "I could not process that request. Please try again.",
        ),
      ]);
      return true;
    } finally {
      setIsSavingSubmission(false);
    }
  };

  const startActionFlow = async (
    action: RuntimeAction,
    openingText?: string,
  ) => {
    await runCanonicalFlow({
      actionId: action.id,
      displayUserText: Boolean(openingText),
      text: openingText ?? getActionStartControlText(action),
    });
  };

  const runStructuredKnowledgeTurn = async (text: string) => {
    const history: TurnMessageV1[] = flowMessages.slice(-48).map((message) => ({
      content: message.text,
      role: message.role,
    }));

    setIsSavingSubmission(true);
    try {
      const response = await fetch("/api/conversation/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeTaskId: null,
          assistantIntroduced:
            messages.length > 0 ||
            history.some(({ role }) => role === "assistant"),
          channel: "project_chat",
          history,
          projectId,
          stage: "knowledge",
          visitorMessage: text,
        }),
      });
      const payload = (await response.json()) as
        | ProjectStructuredTurnResult
        | { error?: string };
      if (!response.ok || !("execution" in payload)) {
        return false;
      }

      const proposal = payload.execution.proposal;
      setFlowMessages((current) => [
        ...current,
        makeFlowMessage("user", text),
        makeFlowMessage("assistant", proposal.reply),
      ]);

      if (proposal.taskRecommendation) {
        const action = findActionForTaskRecommendation(
          actions,
          proposal.taskRecommendation.taskId,
        );
        if (action) {
          await startActionFlow(action);
        }
      }
      return true;
    } catch {
      return false;
    } finally {
      setIsSavingSubmission(false);
    }
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
      formData.append("commandId", createBrowserCommandId());
      formData.append("expectedRevision", String(flow.revision));
      formData.append("stepId", String(step.id));
      formData.append("submissionId", String(flow.submissionId));

      const response = await postBrowserFlowMediaCommand(
        "/api/actions/flow/media",
        formData,
      );

      if (!response.ok) {
        const failure = await readBrowserFlowFailure(
          response,
          "Failed to upload media.",
        );
        if (
          response.status === 409 &&
          failure.code &&
          ["conflict", "failed", "processing", "stale"].includes(
            failure.code,
          ) &&
          (await recoverFlow(flow.revision))
        ) {
          return;
        }
        throw new Error(failure.message);
      }

      const upload = (await response.json()) as FlowMediaUploadResponse;
      setFlowMessages((current) => [
        ...current,
        makeFlowMessage("user", upload.label),
        ...browserRuntimeRepliesToFlowMessages("project_chat", upload.replies),
      ]);
      setActiveFlow(upload.activeFlow);
      setServerActiveAction(upload.activeFlow ? upload.action : null);
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

    setInput("");
    const handledByFlow = await runCanonicalFlow({
      displayUserText: true,
      text,
    });
    if (handledByFlow) {
      return;
    }

    if (await runStructuredKnowledgeTurn(text)) {
      return;
    }

    sendMessage({
      text,
    });
  };

  const submitActiveStep = async (value: string, displayText = value) => {
    if (!activeFlow) {
      return;
    }

    setInput("");
    await runCanonicalFlow({
      displayText,
      displayUserText: true,
      selection:
        (activeStepHasOptions || runtimeInputRequest?.inputKind === "choice") &&
        value.length <= 240
          ? { id: value, label: displayText, value }
          : undefined,
      text: value,
    });
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

    await runCanonicalFlow({ text: "confirm" });
  };

  const editActiveFlowSection = async (section: FlowEditSection) => {
    if (!activeFlow || !activeAction) {
      return;
    }

    await runCanonicalFlow({ editSection: section });
  };

  const cancelActiveFlow = async () => {
    await runCanonicalFlow({ displayUserText: true, text: "cancel" });
    setInput("");
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
                    disabled={
                      !conversationId ||
                      Boolean(activeFlow) ||
                      isSavingSubmission
                    }
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
                  {message.role === "assistant" && message.media && (
                    <ActionFlowContentMedia media={message.media} />
                  )}
                  {message.role === "assistant" && message.products && (
                    <ActionFlowProductCards
                      layout={message.productLayout}
                      products={message.products}
                    />
                  )}
                  {message.role === "assistant" &&
                    message.productGroups?.map((group) => (
                      <ActionFlowProductCards
                        key={`${message.id}-${group.id}`}
                        layout={group.layout}
                        products={group.products}
                      />
                    ))}
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
            {runtimeInputRequest &&
              runtimeInputHasInlineControl &&
              !activeStepHasInlineControl && (
                <Message from="assistant">
                  <MessageContent>
                    <RuntimeInputControl
                      disabled={isSavingSubmission}
                      key={`${latestFlowMessage?.id ?? "runtime"}-${runtimeInputRequest.fieldKey}`}
                      onSubmit={submitActiveStep}
                      request={runtimeInputRequest}
                    />
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
              isSavingSubmission) && (
              <Message from="assistant">
                <MessageContent>
                  <output
                    aria-live="polite"
                    className="flex items-center gap-2 text-muted-foreground"
                  >
                    <Loader />
                    <span>Processing...</span>
                  </output>
                </MessageContent>
              </Message>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <PromptInput onSubmit={handleSubmit} className="mt-4">
          <PromptInputBody>
            <PromptInputTextarea
              disabled={
                status === "submitted" ||
                status === "streaming" ||
                !conversationId ||
                isSavingSubmission
              }
              placeholder={getBrowserComposerPlaceholder({
                fallback: "What would you like to know?",
                request: runtimeInputRequest,
              })}
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
                !conversationId ||
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
