import { documentSections } from "./chunking";
import type { KnowledgeIssue } from "./knowledge-import";

const currencyMarker = /(?:\b(INR|USD|EUR|GBP|CAD|AUD|NZD|SGD|AED|JPY|CHF)(?![a-z])|([₹$€£]))/i;
const amountPattern = /\d+(?:(?:,\d{2})*,\d{3}|(?:,\d{3})+)?(?:\.\d+)?/;
const money = new RegExp(currencyMarker.source + "\\s*(" + amountPattern.source + ")(?!\\d|[.,]\\d)", "gi");
const bareAmount = new RegExp("^" + amountPattern.source + "$");
const currencies: Record<string, string> = { "₹": "INR", "€": "EUR", "£": "GBP" };
const priceHeader = /^per\s|\b(?:prices?|rates?|fees?|charges?|costs?|total|tax)(?:$|\s*[(\[]|\s+(?:per|including|excluding)\b)/;

// Only discard labels that identify a generic publication or audience for
// the document. Retain named plans, seasons, dates and parent headings.
const publicationLabel = /^(?:current )?(?:(?:visitor|staff|customer|reception|price|pricing|service) )?(?:guide|handbook|manual|brochure|price list|rate card)$/i;

type Quote = { key: string; amount: string; source: string; tableOnly?: boolean };
type PriceIndex = Map<string, Map<string, Quote>>;

function normalizeAmount(numeric: string) {
  const [whole, fraction = ""] = numeric.replaceAll(",", "").split(".");
  return whole.replace(/^0+(?=\d)/, "") + "." + fraction.replace(/0+$/, "");
}

function singlePrice(text: string) {
  const matches = [...text.matchAll(money)];
  if (matches.length !== 1) return null;
  const [literal, code, symbol, numeric] = matches[0];
  const currency = code?.toUpperCase() ?? currencies[symbol] ?? symbol;
  return {
    terms: text.replace(literal, "<" + currency + ">"),
    amount: normalizeAmount(numeric),
  };
}

function cells(line: string) {
  return line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(cell =>
    cell.trim().toLowerCase().replace(/\s+/g, " "),
  );
}

function* tablePrices(body: string, heading: string, scopeLabels: string[], sectionIndex: number) {
  if (!body.includes("|")) return;
  // Text before and after each table can specify a date, a caption or a footnote.
  const blocks: string[][] = [];
  for (const line of body.split("\n")) {
    const previous = blocks.at(-1);
    if (previous && previous[0].includes("|") === line.includes("|")) previous.push(line);
    else blocks.push([line]);
  }
  for (const [index, lines] of blocks.entries()) {
    if (lines.length < 3 || !lines[0].includes("|")) continue;
    const headers = cells(lines[0]);
    const separator = cells(lines[1]);
    if (headers.length < 2 || new Set(headers).size !== headers.length || headers.includes("") ||
      separator.length !== headers.length || !separator.every(cell => /^:?-{3,}:?$/.test(cell))) continue;
    const columns = headers.map((header, i) => ({
      header, i,
      price: priceHeader.test(header.replace(currencyMarker, "").trim()) &&
        !/\b(?:minimum|maximum|threshold|eligibility|qualifying)\b/.test(header),
      currency: header.match(currencyMarker)?.[0],
    })).sort((a, b) => a.header.localeCompare(b.header));
    const scope = JSON.stringify(["table", scopeLabels, columns.map(c => c.header),
      blocks[index - 1]?.join("\n").trim() ?? "", blocks[index + 1]?.join("\n").trim() ?? ""]);
    const prices: Quote[] = [];
    for (const line of lines.slice(2)) {
      const values = cells(line);
      if (values.length !== headers.length) continue;
      const identity: string[] = [];
      const rates = [];
      for (const column of columns) {
        const value = values[column.i];
        const withoutCurrency = !column.currency && bareAmount.test(value);
        const explicit = column.currency && /^\d/.test(value) ? column.currency + " " + value : value;
        if (column.price && withoutCurrency) {
          // Without a currency, the amount is comparable only inside this table.
          identity.push("<unspecified>");
          rates.push({ header: column.header, amount: normalizeAmount(value), tableOnly: true });
          continue;
        }
        const rate = column.price ? singlePrice(explicit) : null;
        identity.push(rate?.terms ?? value);
        if (rate) rates.push({ header: column.header, amount: rate.amount, tableOnly: false });
      }
      if (!columns.some(c => !c.price && values[c.i])) continue;
      const rowKey = JSON.stringify(identity);
      const source = [heading, lines[0], line].filter(Boolean).join("\n").slice(0, 1200);
      for (const rate of rates) prices.push({
        key: rowKey + "\n" + rate.header + (rate.tableOnly ? "\n" + sectionIndex + ":" + index : ""),
        amount: rate.amount, tableOnly: rate.tableOnly,
        source: source + "\nColumn: " + rate.header.slice(0, 120),
      });
    }
    if (prices.length) yield { scope, prices };
  }
}

function* priceSections(text: string) {
  const normalizedText = text.trim().replaceAll("\r\n", "\n");
  const sections = normalizedText.includes("\n")
    ? documentSections(normalizedText)
    : [{ heading: "", body: normalizedText }];
  if (!sections.length && !/^[ \t]*(?:\x60{3,}|~{3,})/m.test(normalizedText)) {
    yield* tablePrices(normalizedText, "", [], 0);
  }
  for (const [sectionIndex, { heading, body }] of sections.entries()) {
    const labels = heading.split("\n").map(s => s.replace(/^#+\s*/, "").trim());
    const scopeLabels = labels.filter(label => label && !publicationLabel.test(label)).map(label => label.toLowerCase());
    yield* tablePrices(body, heading, scopeLabels, sectionIndex);
    // Generated FAQs follow the original prose. They have a separate
    // duplicate-question check and must not obscure the source conflict.
    const paragraphs = body.split(/\n\s*\n/).map(block =>
      block.split(/^[ \t]*[QA]:|^[^\n]+=>/im, 1)[0].trim(),
    ).filter(Boolean);
    const qualifications: string[] = [];
    const prices: Quote[] = [];
    for (const paragraph of paragraphs) {
      const normalized = paragraph.toLowerCase().replace(/\s+/g, " ");
      const price = singlePrice(normalized);
      if (!price || /[|\t]/.test(paragraph)) {
        qualifications.push(normalized);
        continue;
      }
      prices.push({
        key: price.terms
          .replace(/\b(?:is priced at|is charged at)(?= <)/g, "costs")
          .replace(/[.!]$/, ""),
        amount: price.amount,
        source: [heading, paragraph].filter(Boolean).join("\n").slice(0, 1200),
      });
    }
    if (!prices.length) continue;
    const scope = JSON.stringify([scopeLabels, qualifications]);
    yield { scope, prices };
  }
}

export function indexImportPrices(text: string): PriceIndex {
  const index: PriceIndex = new Map();
  for (const { scope, prices } of priceSections(text)) {
    const seen = index.get(scope) ?? new Map<string, Quote>();
    index.set(scope, seen);
    for (const price of prices) if (!price.tableOnly) seen.set(price.key, price);
  }
  return index;
}

export function* conflictingImportPrices(text: string, draftIndex?: PriceIndex) {
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

export function inspectImportPrices(text: string): KnowledgeIssue[] {
  return Array.from(conflictingImportPrices(text), ({ previous, current }) => ({
    code: "conflict", line: 0,
    message: "These passages give different prices for the same terms. Correct the price or specify when each rate applies.",
    excerpt: previous + "\n\n" + current,
  }));
}
