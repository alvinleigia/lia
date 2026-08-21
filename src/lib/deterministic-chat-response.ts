import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";

export function getLatestUserText(messages: UIMessage[]) {
  const message = messages.findLast((candidate) => candidate.role === "user");
  if (!message) return null;

  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  return text || null;
}

export function createDeterministicChatResponse(
  messages: UIMessage[],
  reply: string,
) {
  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: ({ writer }) => {
      const id = "deterministic-answer";
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: reply });
      writer.write({ type: "text-end", id });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
