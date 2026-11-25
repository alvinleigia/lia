import { documentSections } from "./chunking";
import type { KnowledgeIssue } from "./knowledge-import";

const money = /(?:\b(INR|USD|EUR|GBP|CAD|AUD|NZD|SGD|AED|JPY|CHF)|([₹$€£]))\s*(\d+(?:(?:,\d{2})*,\d{3}|(?:,\d{3})+)?(?:\.\d+)?)(?!\d|[.,]\d)/gi;
const currencies: Record<string, string> = { "₹": "INR", "€": "EUR", "£": "GBP" };

// Only discard labels that identify a generic publication or audience for
// the document. Retain named plans, seasons, dates and parent headings.
const publicationLabel = /^(?:current )?(?:(?:visitor|staff|customer|reception|price|pricing|service) )?(?:guide|handbook|manual|brochure|price list|rate card)$/i;

type Quote = { key: string; amount: string; source: string };
type PriceIndex = Map<string, Map<string, Quote>>;

function* priceSections(text: string) {
  const normalizedText = text.trim().replaceAll("\r\n", "\n");
  const sections = normalizedText.includes("\n")
    ? documentSections(normalizedText)
    : [{ heading: "", body: normalizedText }];
  for (const { heading, body } of sections) {
    const labels = heading.split("\n").map(s => s.replace(/^#+\s*/, "").trim());
    // Generated FAQs follow the original prose. They have a separate
    // duplicate-question check and must not obscure the source conflict.
    const paragraphs = body.split(/\n\s*\n/).map(block =>
      block.split(/^[ \t]*[QA]:|^[^\n]+=>/im, 1)[0].trim(),
    ).filter(Boolean);
    const qualifications: string[] = [];
    const prices = [];
    for (const paragraph of paragraphs) {
      const normalized = paragraph.toLowerCase().replace(/\s+/g, " ");
      const matches = [...normalized.matchAll(money)];
      if (matches.length !== 1 || /[|\t]/.test(paragraph)) {
        qualifications.push(normalized);
        continue;
      }
      const [literal, code, symbol, numeric] = matches[0];
      const currency = code?.toUpperCase() ?? currencies[symbol] ?? symbol;
      const [whole, fraction = ""] = numeric.replaceAll(",", "").split(".");
      prices.push({
        key: normalized.replace(literal, "<" + currency + ">")
          .replace(/\b(?:is priced at|is charged at)(?= <)/g, "costs")
          .replace(/[.!]$/, ""),
        amount: whole.replace(/^0+(?=\d)/, "") + "." + fraction.replace(/0+$/, ""),
        source: [heading, paragraph].filter(Boolean).join("\n").slice(0, 1200),
      });
    }
    if (!prices.length) continue;
    const scopeLabels = labels.filter(label => label && !publicationLabel.test(label));
    const scope = JSON.stringify([scopeLabels.map(label => label.toLowerCase()), qualifications]);
    yield { scope, prices };
  }
}

export function indexProsePrices(text: string): PriceIndex {
  const index: PriceIndex = new Map();
  for (const { scope, prices } of priceSections(text)) {
    const seen = index.get(scope) ?? new Map<string, Quote>();
    index.set(scope, seen);
    for (const price of prices) seen.set(price.key, price);
  }
  return index;
}

export function* conflictingProsePrices(text: string, draftIndex?: PriceIndex) {
  const scopes = draftIndex ?? new Map<string, Map<string, Quote>>();
  for (const { scope, prices } of priceSections(text)) {
    const seen = scopes.get(scope) ?? new Map<string, Quote>();
    if (!draftIndex) scopes.set(scope, seen);
    for (const price of prices) {
      const previous = seen.get(price.key);
      if (previous && previous.amount !== price.amount) {
        yield { previous: previous.source, current: price.source };
      } else if (!previous && !draftIndex) seen.set(price.key, price);
    }
  }
}

export function inspectProsePrices(text: string): KnowledgeIssue[] {
  return Array.from(conflictingProsePrices(text), ({ previous, current }) => ({
    code: "conflict", line: 0,
    message: "These passages give different prices for the same terms. Correct the price or specify when each rate applies.",
    excerpt: previous + "\n\n" + current,
  }));
}
