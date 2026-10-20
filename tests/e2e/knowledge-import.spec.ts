import { expect, test } from "@playwright/test";
import {
  applyKnowledgeSuggestions,
  createKnowledgeImportReview,
  extractKnowledgeAnswers,
  inspectKnowledgeImport,
} from "../../src/lib/knowledge-import";

test("import flags source-report wording across business domains without rewriting facts", () => {
  for (const text of [
    "Q: Is there Wi-Fi? A: Wi-Fi is listed. Speed is not supplied.",
    "Q: Is pickup available? A: Bike pickup is listed. Charges are not supplied.",
    "Q: Where can I park? A: Parking is mentioned. Availability is not provided.",
  ]) {
    const review = createKnowledgeImportReview(text);
    expect(review.draftText).toBe(text);
    expect(review.originalText).toBe(text);
    expect(review.publishedAnswers).toEqual([]);
    expect(inspectKnowledgeImport(text).map((i) => i.code)).toContain(
      "wording",
    );
    expect(inspectKnowledgeImport(text).map((i) => i.code)).toContain(
      "uncertain",
    );
  }
});

test("extracts explicit FAQ formats and detects contradictory duplicates", () => {
  const text =
    "Q: Is parking free?\nA: Yes, we offer free parking.\nPickup? => Pickup costs INR 200.\nQ: Is parking free? A: Parking costs INR 500.";
  expect(extractKnowledgeAnswers(text)).toHaveLength(3);
  expect(inspectKnowledgeImport(text).some((i) => i.code === "conflict")).toBe(
    true,
  );
  expect(
    extractKnowledgeAnswers("We have parking, and prices may change."),
  ).toEqual([]);
  expect(
    extractKnowledgeAnswers(
      "Q: Is pickup available?\nA: Yes, we offer pickup.\nOnly within five kilometres.\n\nOther facts.",
    )[0].answer,
  ).toBe("Yes, we offer pickup. Only within five kilometres.");
});

test("test prices, guarantees and unresolved facts are visible at import", () => {
  const issues = inspectKnowledgeImport(
    "Mock estimate for UAT: INR 400. Final price is unconfirmed.\nWe guarantee the lowest price.",
  );
  expect(issues.map((i) => i.code)).toEqual(
    expect.arrayContaining(["internal", "uncertain", "claim"]),
  );
});

test("AI suggestions cannot change numbers, erase uncertainty, or edit invented source lines", () => {
  const text =
    "Q: Is pickup free? A: Pickup costs INR 200. Hours are not supplied.";
  for (const replacement of [
    "Q: Is pickup free? A: We offer free pickup.",
    "Q: Is pickup free? A: Pickup costs INR 20. I can't confirm hours.",
    "Q: Is pickup free? A: Pickup costs INR 200. It is available all day.",
  ])
    expect(
      applyKnowledgeSuggestions(text, [{ source: text, replacement }]),
    ).toBe(text);
  const safe =
    "Q: Is pickup free? A: We charge INR 200 for pickup. I can't confirm the hours.";
  expect(
    applyKnowledgeSuggestions(text, [{ source: text, replacement: safe }]),
  ).toBe(safe);
  expect(
    applyKnowledgeSuggestions(text, [
      { source: "invented line", replacement: safe },
    ]),
  ).toBe(text);
});
