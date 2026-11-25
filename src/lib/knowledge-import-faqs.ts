import { extractKnowledgeAnswers, knowledgeTextSchema } from "./knowledge-import";
import { normalizeKnowledgeQuestion } from "./project-ai-settings";
import { documentSections } from "./chunking";

export const FAQ_SUGGESTION_TEXT_LIMIT = 24_000;

// Conditions may appear in a later paragraph of the same section.
export function faqSourceBlocks(text: string) {
  const lines = text.split(/\r?\n/);
  const plainSections = new Set(documentSections(lines.join("\n")).filter(
    ({ heading }) => heading && !heading.startsWith("#"),
  ).map(
    ({ heading, body }) => heading + "\n" + body,
  ));
  const blocks: { endLine: number; sentences: string[] }[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim() || /^ {0,3}#{1,6}\s/.test(lines[i])) {
      i++;
      continue;
    }
    const start = i++;
    while (i < lines.length && !/^ {0,3}#{1,6}\s/.test(lines[i]) &&
      (!plainSections.size || lines[i].trim())) i++;
    let endLine = i - 1;
    while (!lines[endLine].trim()) endLine--;
    const section = lines.slice(start, endLine + 1);
    if (section.some((line) => /^\s*[QA]:|=>|\t|\|/i.test(line))) continue;
    // A plain-text section title supplies context for the question.
    if (section.length > 1 && plainSections.has(section.join("\n").trim())) {
      section.shift();
    }
    const sentences = section.join("\n").split(/\n\s*\n/).flatMap((paragraph) =>
      Array.from(segmenter.segment(paragraph.replaceAll("\n", " ").trim()), (s) => s.segment.trim()),
    );
    if (sentences.length) blocks.push({ endLine, sentences });
  }
  return blocks;
}

export type FaqFact = {
  block: number;
  sentence: number;
  qualifies: number[];
  question: string | null;
};

export function appendSuggestedFaqs(
  text: string,
  blocks: ReturnType<typeof faqSourceBlocks>,
  facts: FaqFact[],
) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const parts = text.split(/(\r?\n)/); // Keep the original line separators.
  const used = new Set(extractKnowledgeAnswers(text, true).map((faq) => faq.key));
  const keys = facts.flatMap(({question}) => question ? [normalizeKnowledgeQuestion(question)] : []);
  keys.forEach((key, i) => { if (keys.indexOf(key) !== i) used.add(key); });
  let added = 0;
  for (const [index, block] of blocks.entries()) {
    const rows = facts.filter((fact) => fact.block === index).sort((a,b) => a.sentence - b.sentence);
    // Every source sentence must have exactly one role. Qualifiers must
    // point to primary facts in this section, never to another qualifier.
    if (rows.length !== block.sentences.length || rows.some((row, id) =>
      row.sentence !== id || (row.question === null) !== (row.qualifies.length > 0) ||
      row.qualifies.some((target) => !rows[target]?.question)
    )) continue;
    const additions: string[] = [];
    for (const row of rows) {
      if (!row.question) continue;
      const key = normalizeKnowledgeQuestion(row.question);
      if (!key || used.has(key) || row.question.length > 240 || /[\r\n]|=>|\sA:/i.test(row.question)) continue;
      const answer = rows.filter((other) => other === row || other.qualifies.includes(row.sentence))
        .map((other) => block.sentences[other.sentence]).join(" ");
      if (answer.length <= 1000) additions.push(`Q: ${row.question.trim()}${newline}A: ${answer}`);
    }
    if (additions.length && added + additions.length <= 12) {
      parts[block.endLine * 2] += newline + additions.join(newline);
      added += additions.length;
    }
  }
  return knowledgeTextSchema.parse(parts.join(""));
}
