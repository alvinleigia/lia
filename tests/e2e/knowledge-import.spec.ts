import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  applyKnowledgeSuggestions,
  createKnowledgeImportReview,
  extractKnowledgeAnswers,
  inspectKnowledgeImport,
} from "../../src/lib/knowledge-import";
import { extractPdfImportText } from "../../src/lib/pdf-import";
import { appendSuggestedFaqs, faqSourceBlocks } from "../../src/lib/knowledge-import-faqs";

test("suggested FAQs preserve source conditions and leave independent topics separate", () => {
  const text = "## Birch Plan\nBreakfast costs INR 450 per guest. Children under five eat free. The late checkout charge is unconfirmed.";
  const blocks = faqSourceBlocks(text);
  const price = { block: 0, sentence: 0, question: "What does breakfast cost on Birch?", qualifies: [] };
  const exemption = { block: 0, sentence: 1, question: null, qualifies: [0] };
  const checkout = { block: 0, sentence: 2, question: "What does late checkout cost on Birch?", qualifies: [] };
  const draft = appendSuggestedFaqs(text, blocks, [price, exemption, checkout]);
  expect(draft.startsWith(text + "\nQ:")).toBe(true);
  expect(extractKnowledgeAnswers(draft, true).map((faq) => faq.answer)).toEqual([
    "Breakfast costs INR 450 per guest. Children under five eat free.",
    "The late checkout charge is unconfirmed.",
  ]);
  expect(faqSourceBlocks(draft)).toEqual([]);
  for (const invalid of [
    [price, checkout],
    [price, { ...exemption, qualifies: [3] }, checkout],
    [price, exemption, { ...checkout, question: price.question }],
  ]) expect(appendSuggestedFaqs(text, blocks, invalid)).toBe(text);
});

test("FAQ suggestions stay within each source paragraph and preserve existing FAQs", () => {
  const text = "Green Service\r\nCollection costs INR 200. Available within 5 km only.\r\n\r\nGold Service\r\nQ: How does Gold work?\r\nA: Call for details.";
  const blocks = faqSourceBlocks(text);
  expect(blocks).toHaveLength(1);
  const draft = appendSuggestedFaqs(text, blocks, [{
    block: 0, sentence: 1, question: null, qualifies: [0],
  }, { block: 0, sentence: 0, question: "How does Green collection work?", qualifies: [] }]);
  expect(extractKnowledgeAnswers(draft, true).map((faq) => faq.answer)).toEqual([
    "Collection costs INR 200. Available within 5 km only.", "Call for details.",
  ]);
  expect(draft.replaceAll("\r\n", "")).not.toContain("\n");
});

test("a fee in a later paragraph can qualify its own section's price", () => {
  const text = "## Harbor Studio\nHire costs INR 1,200 per day.\n\nA refundable deposit of INR 500 is required.\n\n## Moss Studio\nHire costs INR 950 per day. No deposit is required.";
  const blocks = faqSourceBlocks(text);
  expect(blocks.map(({ sentences }) => sentences.length)).toEqual([2, 2]);
  const draft = appendSuggestedFaqs(text, blocks, [
    { block: 0, sentence: 0, question: "What does Harbor cost?", qualifies: [] },
    { block: 0, sentence: 1, question: null, qualifies: [0] },
    { block: 1, sentence: 0, question: "What does Moss cost?", qualifies: [] },
    { block: 1, sentence: 1, question: null, qualifies: [0] },
  ]);
  expect(extractKnowledgeAnswers(draft, true).map((faq) => faq.answer)).toEqual([
    "Hire costs INR 1,200 per day. A refundable deposit of INR 500 is required.",
    "Hire costs INR 950 per day. No deposit is required.",
  ]);
});

test("PDF import preserves separate amounts and labels in a rate table", async () => {
  const text = await extractPdfImportText(
    await readFile("output/pdf/dune-house-rate-card.pdf"),
  );
  expect(text).toContain("Rate plan\tNightly rate\tBreakfast");
  expect(text).toContain("Dune Saver\t6,200\t380 per adult each morning");
  expect(text).toContain("Dune Flex\t7,100\tIncluded for both adults");
});

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
