import { expect, test } from "@playwright/test";
import {
  createDeterministicChatResponse,
  getLatestUserText,
} from "../../src/lib/deterministic-chat-response";
import {
  formatApprovedKnowledgeAnswers,
  normalizeProjectAiSettings,
  parseApprovedKnowledgeAnswersText,
} from "../../src/lib/project-ai-settings";

test("approved knowledge answers parse and format without losing no-answer entries", () => {
  const parsed = parseApprovedKnowledgeAnswersText(
    "What time is check-in? => Check-in begins at 15:00.\nIs late checkout guaranteed? =>",
  );

  expect(parsed).toEqual({
    ok: true,
    answers: [
      {
        question: "What time is check-in?",
        answer: "Check-in begins at 15:00.",
      },
      { question: "Is late checkout guaranteed?", answer: null },
    ],
  });
  if (parsed.ok) {
    expect(formatApprovedKnowledgeAnswers(parsed.answers)).toBe(
      "What time is check-in? => Check-in begins at 15:00.\nIs late checkout guaranteed? => ",
    );
  }
});

test("approved knowledge answers reject normalized duplicate questions", () => {
  expect(
    parseApprovedKnowledgeAnswersText(
      "What time is check-in? => 15:00\nWHAT TIME IS CHECK IN! => 3 PM",
    ),
  ).toEqual({
    ok: false,
    error: "Line 2 duplicates another approved question.",
  });
});

test("stored approved knowledge answers are normalized safely", () => {
  const settings = normalizeProjectAiSettings({
    approvedKnowledgeAnswers: [
      { question: "What time is check-in?", answer: "15:00" },
      { question: "WHAT TIME IS CHECK IN!", answer: "duplicate" },
      { question: "Is late checkout guaranteed?", answer: "" },
    ],
  });

  expect(settings.approvedKnowledgeAnswers).toEqual([
    { question: "What time is check-in?", answer: "15:00" },
    { question: "Is late checkout guaranteed?", answer: null },
  ]);
});

test("deterministic chat responses use the latest visitor text and UI stream", async () => {
  const messages = [
    {
      id: "user-1",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "First" }],
    },
    {
      id: "assistant-1",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Reply" }],
    },
    {
      id: "user-2",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "What time is check-in?" }],
    },
  ];

  expect(getLatestUserText(messages)).toBe("What time is check-in?");
  const response = createDeterministicChatResponse(
    messages,
    "Check-in begins at 15:00.",
  );
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  expect(await response.text()).toContain("Check-in begins at 15:00.");
});
