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
  type FlowChatMessage,
  type FlowEditSection,
  getActionStepChoiceDisplayMode,
  getActionStepInputType,
  getActionStepOptions,
  getRunnableActionSteps,
  isActionInputStep,
  type RuntimeAction,
} from "@/lib/action-runtime";
import {
  type BrowserFlowRuntimeResult,
  runtimeRepliesToFlowMessages,
} from "@/lib/browser-flow-contract";

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
  const [serverActiveAction, setServerActiveAction] =
    useState<RuntimeAction | null>(null);
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
      (activeStepHasOptions ||
        activeStep.stepType === "file_upload" ||
        shouldRenderStepControl(getActionStepInputType(activeStep)))
    : false;

  const runCanonicalFlow = async (input: {
    actionId?: number;
    displayUserText?: boolean;
    editSection?: FlowEditSection;
    text?: string;
  }) => {
    setIsSavingSubmission(true);

    try {
      const response = await fetch("/api/widget/actions/runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId: input.actionId,
          conversationId,
          editSection: input.editSection,
          text: input.text,
          token,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to process flow message.");
      }

      const result = (await response.json()) as BrowserFlowRuntimeResult;
      if (!result.handled) {
        return false;
      }

      setFlowMessages((current) => [
        ...current,
        ...(input.displayUserText && input.text
          ? [makeFlowMessage("user", input.text)]
          : []),
        ...runtimeRepliesToFlowMessages(result.replies),
      ]);
      setActiveFlow(result.activeFlow);
      setServerActiveAction(result.activeFlow ? result.action : null);
      return true;
    } catch {
      setFlowMessages((current) => [
        ...current,
        ...(input.displayUserText && input.text
          ? [makeFlowMessage("user", input.text)]
          : []),
        makeFlowMessage(
          "assistant",
          "I could not process that request. Please try again.",
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
      text: openingText,
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
      setFlowMessages((current) => [
        ...current,
        makeFlowMessage("user", upload.label),
        ...runtimeRepliesToFlowMessages(upload.replies),
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

    const handledByFlow = await runCanonicalFlow({
      displayUserText: true,
      text,
    });
    if (handledByFlow) {
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

    await runCanonicalFlow({ displayUserText: true, text: value });
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

    await runCanonicalFlow({ text: "confirm" });
  };

  const editActiveFlowSection = async (section: FlowEditSection) => {
    if (!activeFlow || !activeAction) {
      return;
    }

    await runCanonicalFlow({ editSection: section });
  };

  const cancelActiveFlow = async () => {
    await runCanonicalFlow({ text: "cancel" });
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
