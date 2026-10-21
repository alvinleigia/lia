import { expect, test } from "@playwright/test";
import {
  isExplicitCancellationRequest,
  isExplicitConfirmationRequest,
  isPotentialKnowledgeSideQuestion,
  isSimpleTaskTextAnswer,
  isStandaloneKnowledgeQuestion,
  shouldUseKnowledgeSideQuestion,
} from "../../src/lib/conversation-control-intents";

test.describe("explicit confirmation", () => {
  test("accepts bounded confirmation phrases", () => {
    expect(isExplicitConfirmationRequest("Confirm")).toBe(true);
    expect(isExplicitConfirmationRequest("Yes, confirm.")).toBe(true);
    expect(isExplicitConfirmationRequest("Go ahead")).toBe(true);
  });

  test("does not infer confirmation from unrelated sentences", () => {
    expect(isExplicitConfirmationRequest("Can you confirm the price?")).toBe(
      false,
    );
    expect(isExplicitConfirmationRequest("I am not sure yet")).toBe(false);
  });
});

test.describe("explicit conversation cancellation", () => {
  test("accepts bounded natural cancellation phrases", () => {
    expect(isExplicitCancellationRequest("I'd like to cancel.")).toBe(true);
    expect(isExplicitCancellationRequest("Please stop this request")).toBe(
      true,
    );
    expect(isExplicitCancellationRequest("Never mind")).toBe(true);
    for (const phrase of [
      "Cancel this enquiry.",
      "Please cancel my inquiry",
      "Stop the enquiry",
      "End this inquiry",
    ])
      expect(isExplicitCancellationRequest(phrase)).toBe(true);
  });

  test("does not cancel negated or incidental mentions", () => {
    expect(isExplicitCancellationRequest("Do not cancel my booking.")).toBe(
      false,
    );
    expect(
      isExplicitCancellationRequest("What is your cancellation policy?"),
    ).toBe(false);
    expect(isExplicitCancellationRequest("No")).toBe(false);
    expect(isExplicitCancellationRequest("Do not cancel this enquiry")).toBe(
      false,
    );
    expect(isExplicitCancellationRequest("Can I cancel my enquiry?")).toBe(
      false,
    );
  });

  test("allows a bare no only at confirmation boundaries", () => {
    expect(isExplicitCancellationRequest("No", { allowBareNo: true })).toBe(
      true,
    );
  });
});

test("control instructions are never treated as simple free-text field answers", () => {
  for (const phrase of [
    "Cancel this enquiry.",
    "Please stop this process",
    "End this conversation",
    "Could you cancel it",
  ])
    expect(isSimpleTaskTextAnswer(phrase)).toBe(false);
  expect(isSimpleTaskTextAnswer("Alex Test")).toBe(true);
  expect(isSimpleTaskTextAnswer("oil change")).toBe(true);
});

test.describe("deterministic flow side questions", () => {
  test("standalone FAQ fast path excludes mixed details and control requests", () => {
    for (const question of [
      "Before that, do you have a swimming pool?",
      "Do you offer bike pickup?",
      "Is there parking near the clinic?",
      "Before I give my details, is parking free?",
      "Does that price include breakfast?",
      "Does the service price cover parts?",
      "Is the Wi-Fi fast enough for video calls?",
      "Is the consultation refundable?",
    ])
      expect(isStandaloneKnowledgeQuestion(question)).toBe(true);
    for (const question of [
      "Do you have a swimming pool? My name is Alex.",
      "Do you offer pickup and change my date to tomorrow?",
      "Do you have a slot at 3:30 pm?",
      "Is there parking? Also two adults.",
      "Do you have my booking reference?",
      "Do you have rooms; please cancel the booking",
      "Is the Wi-Fi fast enough? We are four adults.",
      "Does that price include breakfast? Change checkout to tomorrow.",
      "Is my appointment on 22 October?",
    ])
      expect(isStandaloneKnowledgeQuestion(question)).toBe(false);
  });
  test("recognizes bounded question-shaped turns", () => {
    expect(isPotentialKnowledgeSideQuestion("When is check-in?")).toBe(true);
    expect(
      isPotentialKnowledgeSideQuestion("Is parking free? My name is Alex."),
    ).toBe(true);
    expect(
      isPotentialKnowledgeSideQuestion("Two adults. Tell me the price"),
    ).toBe(true);
    expect(
      isPotentialKnowledgeSideQuestion("Oil change and how long will it take"),
    ).toBe(true);
    expect(
      isPotentialKnowledgeSideQuestion("Is late checkout guaranteed"),
    ).toBe(true);
    expect(isPotentialKnowledgeSideQuestion("Phase Sixteen UAT Tester")).toBe(
      false,
    );
  });

  test("does not steal a valid free-text answer without grounding", () => {
    expect(
      shouldUseKnowledgeSideQuestion({
        answerIsValid: true,
        groundingStatus: "no_answer",
        safetyDecision: "allow",
      }),
    ).toBe(false);
    expect(
      shouldUseKnowledgeSideQuestion({
        answerIsValid: true,
        groundingStatus: "grounded",
        safetyDecision: "allow",
      }),
    ).toBe(true);
  });

  test("resumes after invalid question input or a safety refusal", () => {
    expect(
      shouldUseKnowledgeSideQuestion({
        answerIsValid: false,
        groundingStatus: "no_answer",
        safetyDecision: "allow",
      }),
    ).toBe(true);
    expect(
      shouldUseKnowledgeSideQuestion({
        answerIsValid: true,
        groundingStatus: "not_needed",
        safetyDecision: "refuse",
      }),
    ).toBe(true);
  });
});
