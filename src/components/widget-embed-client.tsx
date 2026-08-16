"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, Loader2, Send } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ActionFlowContentMedia } from "@/components/action-flow-content-media";
import { ActionFlowProductCards } from "@/components/action-flow-product-cards";
import {
  ActionFlowStepInput,
  ActionFlowStepOptions,
} from "@/components/action-flow-step-input";
import { RuntimeInputControl } from "@/components/runtime-input-control";
import {
  type ActiveActionFlow,
  type FlowChatMessage,
  type FlowEditSection,
  getActionStartControlText,
  getActionStepChoiceDisplayMode,
  getActionStepOptions,
  getFlowEditSectionOptions,
  getRunnableActionSteps,
  isActionInputStep,
  type RuntimeAction,
} from "@/lib/action-runtime";
import { browserRuntimeRepliesToFlowMessages } from "@/lib/browser-channel-adapter";
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

type WidgetEmbedClientProps = {
  actions: RuntimeAction[];
  token: string;
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
    id: `widget-flow-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...metadata,
    role,
    text,
  };
}

export function WidgetEmbedClient({ actions, token }: WidgetEmbedClientProps) {
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [flowMessages, setFlowMessages] = useState<FlowChatMessage[]>([]);
  const [activeFlow, setActiveFlow] = useState<ActiveActionFlow | null>(null);
  const [serverActiveAction, setServerActiveAction] =
    useState<RuntimeAction | null>(null);
  const [isSavingSubmission, setIsSavingSubmission] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (messages.length === 0 && flowMessages.length === 0) return;
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [flowMessages, messages]);

  const isLoading = status === "submitted" || status === "streaming";
  const isBusy = !conversationId || isLoading || isSavingSubmission;
  const activeAction = activeFlow
    ? (serverActiveAction ??
      actions.find((action) => action.id === activeFlow.actionId))
    : null;
  const activeStep =
    activeAction && activeFlow?.mode === "collecting"
      ? getRunnableActionSteps(activeAction)[activeFlow.stepIndex]
      : null;
  const isConfirmingFlow = activeFlow?.mode === "confirming";
  const flowEditSectionOptions = activeAction
    ? getFlowEditSectionOptions(activeAction)
    : [];
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
      body: { conversationId, token },
      expectedRevision,
      url: "/api/widget/actions/runtime",
    });
    if (!result) {
      return false;
    }

    setActiveFlow(result.activeFlow);
    setServerActiveAction(result.activeFlow ? result.action : null);
    setFlowMessages((current) => [
      ...current,
      ...browserRuntimeRepliesToFlowMessages("widget", result.replies),
      makeFlowMessage(
        "assistant",
        result.activeFlow
          ? "This request changed in another tab, so I refreshed it. Please send your answer again."
          : "That request is already complete or no longer active. You can start a new request when ready.",
      ),
    ]);
    return true;
  };

  useEffect(() => {
    const restoredConversationId = getOrCreateSessionConversationId({
      key: `lia:widget-chat:${token}`,
      prefix: "widget",
      storage: window.sessionStorage,
    });
    let isCurrent = true;

    setConversationId(restoredConversationId);
    setIsSavingSubmission(true);

    fetch("/api/widget/actions/runtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: restoredConversationId,
        resume: true,
        token,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to resume flow.");
        }

        return (await response.json()) as BrowserFlowRuntimeResult;
      })
      .then((result) => {
        if (!isCurrent || !result.handled) {
          return;
        }

        setFlowMessages(
          browserRuntimeRepliesToFlowMessages("widget", result.replies),
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
  }, [token]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && window.parent) {
        window.parent.postMessage({ type: "RAG_WIDGET_CLOSE" }, "*");
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

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
      const response = await postBrowserFlowCommand(
        "/api/widget/actions/runtime",
        {
          actionId: input.actionId,
          commandId: createBrowserCommandId(),
          conversationId,
          editSection: input.editSection,
          expectedRevision: activeFlow?.revision,
          selection: input.selection,
          text: input.text,
          token,
        },
      );

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
        ...browserRuntimeRepliesToFlowMessages("widget", result.replies),
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
      formData.append("token", token);

      const response = await postBrowserFlowMediaCommand(
        "/api/widget/actions/flow/media",
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
        ...browserRuntimeRepliesToFlowMessages("widget", upload.replies),
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

    setInput("");
    const handledByFlow = await runCanonicalFlow({
      displayUserText: true,
      text,
    });
    if (handledByFlow) {
      return;
    }

    sendMessage({ text });
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

      <div
        aria-live="polite"
        className="flex-1 overflow-y-auto p-3 space-y-3"
        ref={transcriptRef}
        role="log"
      >
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
                    ? "ml-auto w-fit max-w-[80%] rounded-lg bg-black p-2 text-sm text-white whitespace-pre-wrap break-words"
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
                ? "ml-auto w-fit max-w-[80%] rounded-lg bg-black p-2 text-sm text-white whitespace-pre-wrap break-words"
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
        {runtimeInputRequest &&
          runtimeInputHasInlineControl &&
          !activeStepHasInlineControl && (
            <div className="mr-8">
              <RuntimeInputControl
                compact
                disabled={Boolean(error) || isBusy}
                key={`${latestFlowMessage?.id ?? "runtime"}-${runtimeInputRequest.fieldKey}`}
                onSubmit={submitActiveStep}
                request={runtimeInputRequest}
              />
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
              {flowEditSectionOptions.map((option) => (
                <button
                  type="button"
                  className="rounded-full border bg-white px-3 py-1.5 text-sm hover:bg-gray-100"
                  key={option.section}
                  onClick={() => editActiveFlowSection(option.section)}
                >
                  {option.label}
                </button>
              ))}
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
          placeholder={getBrowserComposerPlaceholder({
            fallback: "Ask a question...",
            request: runtimeInputRequest,
          })}
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
