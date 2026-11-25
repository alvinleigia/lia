import { createHash } from "node:crypto";
import { knowledgeImportReviewSchema, type KnowledgeImportReview } from "./knowledge-import";
import { priceComparisonContext, prosePriceLines } from "./knowledge-import-prices";

type Source = { id: number; title: string; review: unknown };
type PricePair = { draftLine: number; source: number; sourceLine: number };

export function crossPricePlan(draft: string, others: Source[]) {
  const amounts = prosePriceLines(draft);
  if (!amounts.size) return null;
  const texts: { title: string; text: string; amounts: Map<number, string> }[] = [];
  const fingerprint = createHash("sha256").update(JSON.stringify(["cross-prices-v1", draft]));
  const pairs: PricePair[] = [];
  let length = draft.length;
  let oversized = false;
  const distinct = new Set(amounts.values());
  for (const other of [...others].sort((a, b) => a.id - b.id)) {
    const parsed = knowledgeImportReviewSchema.safeParse(other.review);
    if (!parsed.success) continue;
    const { publishedText, approvedAt, draftText } = parsed.data;
    for (const text of new Set([publishedText, approvedAt ? draftText : null])) {
      if (!text) continue;
      const prices = prosePriceLines(text);
      if (![...prices.values()].some(amount => distinct.size > 1 || !distinct.has(amount))) continue;
      const source = texts.length;
      texts.push({ title: other.title, text, amounts: prices });
      fingerprint.update(JSON.stringify([other.id, text]));
      length += text.length;
      if (length > 24_000) oversized = true;
      if (oversized) continue;
      for (const [draftLine, value] of amounts) {
        for (const [sourceLine, otherValue] of prices) {
          if (value !== otherValue) pairs.push({ draftLine, source, sourceLine });
          if (pairs.length > 16) break;
        }
        if (pairs.length > 16) { oversized = true; break; }
      }
    }
  }
  if (!texts.length) return null;
  return { fingerprint: fingerprint.digest("hex"), oversized, pairs, texts, draft, amounts };
}

export type CrossPricePlan = NonNullable<ReturnType<typeof crossPricePlan>>;

export function crossPricePrompt(plan: CrossPricePlan) {
  return {
    draft: priceComparisonContext(plan.draft, plan.amounts),
    sources: plan.texts.map(({ text, amounts }) => priceComparisonContext(text, amounts)),
    pairs: plan.pairs.map((pair, id) => ({ id, ...pair })),
  };
}

export function crossPriceFindings(plan: CrossPricePlan | null, review: KnowledgeImportReview["crossPriceReview"]) {
  if (!plan) return [];
  if (review?.fingerprint !== plan.fingerprint)
    return ["Project price sources changed or still need comparison. Select Save and check draft before approval."];
  return review.conflicts.map(id => {
    const pair = plan.pairs[id];
    const source = plan.texts[pair.source];
    return 'Price differs from "' + source.title + '". Correct the price or clarify when each rate applies.\n\nThis draft\n' +
      plan.draft.split(/\r?\n/)[pair.draftLine - 1] + "\n\n" + source.title + "\n" +
      source.text.split(/\r?\n/)[pair.sourceLine - 1];
  });
}
