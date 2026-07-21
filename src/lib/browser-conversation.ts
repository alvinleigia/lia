import type { BrowserFlowRuntimeResult } from "@/lib/browser-flow-contract";

const MAX_CONVERSATION_ID_LENGTH = 120;

export type BrowserFlowFailure = {
  code?: "conflict" | "failed" | "processing" | "stale";
  message: string;
};

function createConversationId(prefix: string) {
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${prefix}-${randomId}`.slice(0, MAX_CONVERSATION_ID_LENGTH);
}

export function createBrowserCommandId() {
  return createConversationId("command");
}

export async function postBrowserFlowCommand(
  url: string,
  body: Record<string, unknown>,
) {
  const send = () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  try {
    return await send();
  } catch {
    return send();
  }
}

export async function postBrowserFlowMediaCommand(
  url: string,
  formData: FormData,
) {
  const send = () => fetch(url, { body: formData, method: "POST" });

  try {
    return await send();
  } catch {
    return send();
  }
}

export async function readBrowserFlowFailure(
  response: Response,
  fallbackMessage: string,
): Promise<BrowserFlowFailure> {
  const payload = (await response.json().catch(() => null)) as {
    code?: BrowserFlowFailure["code"];
    message?: string;
  } | null;

  return {
    code: payload?.code,
    message: payload?.message || fallbackMessage,
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function recoverBrowserFlowState(input: {
  body: Record<string, unknown>;
  expectedRevision?: number;
  url: string;
}): Promise<BrowserFlowRuntimeResult | null> {
  let latestResult: BrowserFlowRuntimeResult | null = null;

  for (const delayMs of [0, 250, 750]) {
    if (delayMs > 0) {
      await wait(delayMs);
    }

    const response = await postBrowserFlowCommand(input.url, {
      ...input.body,
      resume: true,
    });
    if (!response.ok) {
      continue;
    }

    latestResult = (await response.json()) as BrowserFlowRuntimeResult;
    if (
      !latestResult.activeFlow ||
      input.expectedRevision === undefined ||
      latestResult.activeFlow.revision !== input.expectedRevision
    ) {
      return latestResult;
    }
  }

  return latestResult;
}

export function getOrCreateSessionConversationId(input: {
  key: string;
  prefix: string;
  storage: Storage;
}) {
  const conversationId = createConversationId(input.prefix);

  try {
    const existing = input.storage.getItem(input.key)?.trim();
    if (existing && existing.length <= MAX_CONVERSATION_ID_LENGTH) {
      return existing;
    }

    input.storage.setItem(input.key, conversationId);
  } catch {
    return conversationId;
  }

  return conversationId;
}
