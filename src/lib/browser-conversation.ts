const MAX_CONVERSATION_ID_LENGTH = 120;

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
