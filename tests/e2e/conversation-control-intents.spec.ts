import { expect, test } from "@playwright/test";
import {
  isExplicitCancellationRequest,
  isExplicitConfirmationRequest,
  isPotentialKnowledgeSideQuestion,
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
  });

  test("does not cancel negated or incidental mentions", () => {
    expect(isExplicitCancellationRequest("Do not cancel my booking.")).toBe(
      false,
    );
    expect(
      isExplicitCancellationRequest("What is your cancellation policy?"),
    ).toBe(false);
    expect(isExplicitCancellationRequest("No")).toBe(false);
  });

  test("allows a bare no only at confirmation boundaries", () => {
    expect(isExplicitCancellationRequest("No", { allowBareNo: true })).toBe(
      true,
    );
  });
});

test.describe("deterministic flow side questions", () => {
  test("recognizes bounded question-shaped turns", () => {
    expect(isPotentialKnowledgeSideQuestion("When is check-in?")).toBe(true);
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
