const MAX_CONVERSATION_ID_LENGTH = 120;

function createConversationId(prefix: string) {
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${prefix}-${randomId}`.slice(0, MAX_CONVERSATION_ID_LENGTH);
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
