import { expect, test } from "@playwright/test";
import {
  detectConversationQuality,
  type QualityMessage,
  qualityNextStep,
} from "../../src/lib/conversation-quality";

const at = new Date("2026-10-20T10:00:00Z");
const message = (
  id: number,
  direction: string,
  text: string,
  seconds: number,
): QualityMessage => ({
  id,
  direction,
  text,
  createdAt: new Date(at.getTime() + seconds * 1000),
});
const detect = (messages: QualityMessage[]) =>
  detectConversationQuality({
    messages,
    lastMessageAt: at,
    activeTask: false,
    now: at,
  });

test("flags repeated collection and first-response delay without counting follow-up bubbles", () => {
  const flags = detect([
    message(1, "outbound", "Which date?", 0),
    message(2, "inbound", "Tuesday", 1),
    message(3, "outbound", "Which date?", 13),
    message(4, "outbound", "Please use a full date.", 16),
  ]);
  expect(flags.map((f) => f.code)).toEqual(["repeated_prompt", "slow_reply"]);
  expect(flags.every((f) => f.messageId === 3)).toBe(true);
});
test("does not call expected FAQ resumption or visitor think time a failure", () => {
  expect(
    detect([
      message(1, "outbound", "Your name?", 0),
      message(2, "inbound", "Do you offer pickup?", 3600),
      message(
        3,
        "outbound",
        "Yes, within five kilometres.\n\nYour name?",
        3602,
      ),
    ]),
  ).toEqual([]);
});
test("fallbacks and inactive unfinished enquiries are signals, cancelled tasks and human ownership are excluded", () => {
  const base = {
    messages: [
      message(
        1,
        "outbound",
        "I could not prepare a reliable answer. Please try again.",
        0,
      ),
    ],
    activeTask: true,
    lastMessageAt: at,
    now: new Date(at.getTime() + 86_400_001),
    failedActions: 1,
  };
  expect(detectConversationQuality(base).map((f) => f.code)).toEqual([
    "fallback",
    "inactive_enquiry",
    "failed_action",
  ]);
  expect(
    detectConversationQuality({ ...base, humanOwned: true }).map((f) => f.code),
  ).not.toContain("inactive_enquiry");
  expect(
    detectConversationQuality({ ...base, activeTask: false }).map(
      (f) => f.code,
    ),
  ).not.toContain("inactive_enquiry");
});
test("feedback points to review work, never directly publishes an override", () => {
  expect(qualityNextStep("wrong_answer")).toContain("Documents");
  expect(qualityNextStep("unnecessary_detail")).toContain(
    "do not add a client-specific override",
  );
  expect(qualityNextStep("correct")).toContain("no live change");
});
