import { expect, test } from "@playwright/test";
import { toTurnHistory } from "../../src/lib/conversation-channel-context";

test("new task history excludes a previous closed request but retains contextual entry and current interruptions", () => {
  const messages = [
    { direction: "inbound", text: "Can I get a discount?", payload: {} },
    {
      direction: "outbound",
      text: "The previous request is cancelled.",
      payload: { runtimeReply: { intent: "outcome" } },
    },
    {
      direction: "inbound",
      text: "Can you accommodate a wheelchair?",
      payload: {},
    },
    { direction: "outbound", text: "Our team can check.", payload: {} },
    { direction: "inbound", text: "Please ask them and call me.", payload: {} },
    { direction: "outbound", text: "Please provide your name.", payload: {} },
    {
      direction: "outbound",
      text: "A temporary failure within this task.",
      payload: { runtimeReply: { intent: "outcome" } },
    },
  ].map((message, index) => ({
    ...message,
    id: index + 1,
    messageType: "text",
    createdAt: new Date(1000 * index),
  }));
  expect(toTurnHistory(messages, new Date(4500)).map((m) => m.content)).toEqual(
    messages.slice(2).map((m) => m.text),
  );
  expect(toTurnHistory(messages)).toHaveLength(messages.length);
  const forged = messages.map((m) => ({ ...m, direction: "inbound" }));
  expect(toTurnHistory(forged, new Date(4500))).toHaveLength(messages.length);
});
