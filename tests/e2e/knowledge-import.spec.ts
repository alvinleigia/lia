import { crossPriceFindings, crossPricePlan, crossPricePrompt } from "../../src/lib/knowledge-import-cross-prices";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  applyKnowledgeSuggestions,
  createKnowledgeImportReview,
  extractKnowledgeAnswers,
  inspectKnowledgeImport,
} from "../../src/lib/knowledge-import";
import { extractPdfImportText } from "../../src/lib/pdf-import";
import { priceComparisonContext, prosePriceLines } from "../../src/lib/knowledge-import-prices";
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
  const duplicate = text.replace("Dune Saver\t6,200\t380 per adult each morning",
    "Dune Saver\t6,200\t380 per adult each morning\nDune Saver\t7,100\t380 per adult each morning");
  expect(inspectKnowledgeImport(text, true).filter(i => i.code === "conflict")).toEqual([]);
  expect(inspectKnowledgeImport(duplicate, true).filter(i => i.code === "conflict")).toHaveLength(1);
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

test("pilot review blocks conflicting prose prices and shows both sources", () => {
  const text = "## Current visitor guide\nBicycle fitting costs INR 650 per visit.\n\n## Current reception guide\nBicycle fitting costs ₹950 per visit.";
  const conflicts = (draft: string) => inspectKnowledgeImport(draft, true).filter(i => i.code === "conflict");
  expect(conflicts(text)).toHaveLength(1);
  expect(conflicts(text)[0].excerpt).toMatch(/visitor guide[\s\S]*650[\s\S]*reception guide[\s\S]*950/i);
  expect(conflicts(text.replace("₹950", "₹650.00"))).toEqual([]);
  expect(conflicts(text.replace("costs ₹950", "is priced at ₹950"))).toHaveLength(1);
  expect(inspectKnowledgeImport(text)).toEqual([]);
  expect(conflicts(text.replaceAll("per visit.", "per visit.\nQ: What does it cost here?\nA: Ask reception."))).toHaveLength(1);
});

test("differently worded findings point to original prose and exclude table lines", () => {
  const text = "## Visitor guide\nAn inspection costs INR 650 per visit.\n## Reception\nVisitors pay 950 rupees each time we check their equipment.\nService\tPrice\nInspection\tINR 800";
  expect([...prosePriceLines(text).keys()]).toEqual([2, 4]);
  const scoped = "A 2-hour repair costs INR 650.\nThe 1-hour express repair costs 950 rupees.";
  expect(priceComparisonContext(scoped, prosePriceLines(scoped)).map(row => row.text)).toEqual([
    "A 2-hour repair costs INR [amount].", "The 1-hour express repair costs [amount] rupees.",
  ]);
  const issues = inspectKnowledgeImport(text, true, [{ first: 2, second: 4 }]);
  expect(issues.filter(i => i.code === "conflict")).toHaveLength(1);
  expect(issues[0].excerpt).toContain("Visitors pay 950 rupees");
  expect(inspectKnowledgeImport(text, true, "manual").some(i => i.code === "uncertain")).toBe(true);
});

test("pilot price review respects terms in headings, prose and adjacent paragraphs", () => {
  const price = "A desk pass costs USD 100 per day.";
  for (const [a, b] of [
    ["## Gold plan", "## Silver plan"],
    ["## Adults", "## Children"],
    ["## June 2026", "## July 2026"],
    ["# North branch\n## Current guide", "# South branch\n## Current guide"],
    ["## Summer guide", "## Winter guide"],
  ]) expect(inspectKnowledgeImport(a + "\n" + price + "\n" + b + "\n" + price.replace("100", "80"), true)).toEqual([]);
  for (const variant of [
    "A desk pass costs USD 80 per week.", "A desk pass costs EUR 80 per day.",
    "A desk pass costs USD 80 per day for members.", "Printer hire costs USD 80 per day.",
    "A desk pass costs USD 80 per day.\n\nApplies to members only.",
  ]) expect(inspectKnowledgeImport("## Price guide\n" + price + "\n## Price guide\n" + variant, true)).toEqual([]);
});

test("pilot review flags duplicate rate-card rows and shows their column headings", () => {
  const table = "| Service | Plan | Per visit |\n| --- | --- | ---: |\n| Frame fitting | Standard | INR 650 |\n| Frame fitting | Standard | ₹950 |";
  for (const text of [table, "## Current price guide\n" + table]) {
    const conflicts = inspectKnowledgeImport(text, true).filter(issue => issue.code === "conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].excerpt).toMatch(/Service.*Plan.*Per visit[\s\S]*650[\s\S]*950/);
    expect(inspectKnowledgeImport(text)).toEqual([]);
    expect(inspectKnowledgeImport(text.replace("₹950", "₹650.00"), true)).toEqual([]);
  }
});

test("rate-card comparisons retain plan, date, customer group, currency, units and footnotes", () => {
  const table = "Service | Plan | Date | Group | Price\n--- | --- | --- | --- | ---\nFrame fitting | Standard | May | Adult | INR 650 per visit [1]";
  const row = "Frame fitting | Standard | May | Adult | INR 950 per visit [1]";
  for (const [from, to] of [["Standard","Premium"], ["May","June"], ["Adult","Child"], ["INR","USD"], ["per visit","per hour"], ["[1]","[2]"]]) {
    expect(inspectKnowledgeImport(table + "\n" + row.replace(from, to), true)).toEqual([]);
  }
  expect(inspectKnowledgeImport("~~~\n" + table + "\n" + row + "\n~~~", true)).toEqual([]);
  expect(inspectKnowledgeImport(table + "\n" + row, true)).toHaveLength(1);
  const tiers = "Service | Minimum order total | Fee\n--- | --- | ---\nDelivery | INR 100 | INR 20\nDelivery | INR 200 | INR 15";
  expect(inspectKnowledgeImport(tiers, true)).toEqual([]);
});

test("table rates with currency in the header compare each price column independently", () => {
  const text = "| Service | Base price (INR) | Total (INR) |\n| --- | --- | --- |\n| Admission | 1,000 | 1,100 |\n| Admission | 1,200 | 1,320 |";
  expect(inspectKnowledgeImport(text, true).filter(i => i.code === "conflict")).toHaveLength(2);
  expect(inspectKnowledgeImport(text.replaceAll(" (INR)", ""), true)).toHaveLength(2);
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

test("separate price sources retain scope and version when comparing differently worded charges", () => {
  const draft = "We charge 950 rupees each time we check a wheel.";
  const source = "## Inspection\nA wheel check costs INR 650 per visit.";
  const review = createKnowledgeImportReview(source, true);
  const other = { id: 8, title: "Inspection guide", review };
  expect(crossPricePlan(draft, [other])).toBeNull();
  review.publishedText = source;
  const plan = crossPricePlan(draft, [other])!;
  const multiLine = "## Staff handbook\n" + draft;
  expect(crossPricePlan(multiLine.replaceAll("\n", "\r\n"), [other])?.fingerprint)
    .toBe(crossPricePlan(multiLine, [other])?.fingerprint);
  expect(crossPricePrompt(plan).sources[0][1].text).toContain("INR [amount]");
  const finding = { fingerprint: plan.fingerprint, manual: false, conflicts: [0] };
  expect(crossPriceFindings(plan, finding)[0]).toContain(source.split("\n")[1]);
  expect(crossPriceFindings(plan, finding)[0]).toContain(draft);
  review.draftText = "## Express only\n" + source;
  expect(crossPricePlan(draft, [other])?.fingerprint).toBe(plan.fingerprint);
  review.approvedAt = new Date().toISOString();
  expect(crossPriceFindings(crossPricePlan(draft, [other]), finding)[0]).toContain("Save and check draft");
  review.publishedText = review.draftText.replace("650", "950");
  review.approvedAt = null;
  expect(crossPricePlan(draft, [other])).toBeNull();
  review.publishedText = source + "\n" + "Terms ".repeat(4200);
  expect(crossPricePlan(draft, [other])?.oversized).toBe(true);
});
