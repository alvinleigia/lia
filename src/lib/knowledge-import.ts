import { z } from "zod";
import { normalizeKnowledgeQuestion } from "@/lib/project-ai-settings";

export const MAX_KNOWLEDGE_TEXT_LENGTH = 200_000;
export const knowledgeTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_KNOWLEDGE_TEXT_LENGTH);
export const knowledgeImportReviewSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive(),
  originalText: knowledgeTextSchema,
  draftText: knowledgeTextSchema,
  publishedText: knowledgeTextSchema.nullable(),
  approvedByUserId: z.number().int().positive().nullable(),
  approvedAt: z.string().nullable(),
  publishedAnswers: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
      key: z.string(),
    }),
  ),
});
export type KnowledgeImportReview = z.infer<typeof knowledgeImportReviewSchema>;
export type KnowledgeIssue = {
  line: number;
  code: "wording" | "internal" | "uncertain" | "claim" | "conflict";
  message: string;
  excerpt: string;
};

export function createKnowledgeImportReview(
  text: string,
): KnowledgeImportReview {
  const originalText = knowledgeTextSchema.parse(text);
  return {
    schemaVersion: 1,
    revision: 1,
    originalText,
    draftText: originalText,
    publishedText: null,
    approvedByUserId: null,
    approvedAt: null,
    publishedAnswers: [],
  };
}

// Explicit Q&A only. Never manufacture facts or infer questions from prose.
export function extractKnowledgeAnswers(text: string) {
  const answers: Array<{ question: string; answer: string; key: string }> = [];
  const pattern = /^Q:\s*(.+?)\s+A:\s*(.+)$|^(.+?)\s*=>\s*(.+)$/i;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (
      /^Q:/i.test(line) &&
      !/\sA:/i.test(line) &&
      /^A:/i.test(lines[i + 1]?.trim() ?? "")
    ) {
      line += ` ${lines[++i].trim()}`;
    }
    const match = pattern.exec(line);
    if (!match) continue;
    const question = (match[1] ?? match[3]).trim();
    let answer = (match[2] ?? match[4]).trim();
    // Keep continuation lines, especially conditions and exclusions. Returning
    // just the first sentence could silently turn a qualified fact into a promise.
    while (
      i + 1 < lines.length &&
      lines[i + 1].trim() &&
      !/^Q:|=>/i.test(lines[i + 1].trim())
    ) {
      answer += ` ${lines[++i].trim()}`;
    }
    if (question.length > 240 || answer.length > 1_000) continue;
    const key = normalizeKnowledgeQuestion(question);
    if (key) answers.push({ question, answer, key });
  }
  return answers;
}

export function inspectKnowledgeImport(text: string): KnowledgeIssue[] {
  const issues: KnowledgeIssue[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const add = (code: KnowledgeIssue["code"], message: string) =>
      issues.push({
        line: index + 1,
        code,
        message,
        excerpt: line.slice(0, 1_200),
      });
    if (
      /\b(?:is|are)\s+(?:listed|mentioned|supplied)|\bnot\s+(?:supplied|provided)|\b(?:source|document|website)\s+(?:says|lists|mentions)\b/i.test(
        line,
      )
    )
      add(
        "wording",
        "Use the business's voice. Keep any factual limits when rewording.",
      );
    if (/\b(?:UAT|mock|test data|snapshot|source record)\b/i.test(line))
      add(
        "internal",
        "Separate internal notes from customer answers. Do not present test prices as live prices.",
      );
    if (
      /\b(?:unknown|unconfirmed|unresolved|not confirmed|not supplied|not provided|conflict|inconsistent|need[s]? confirmation)\b/i.test(
        line,
      )
    )
      add(
        "uncertain",
        "Confirm this detail or keep an explicit limitation. Do not turn missing information into a promise.",
      );
    if (
      /\b(?:guaranteed|guarantee|always|never|lowest price)\b|\b100%/i.test(line)
    )
      add(
        "claim",
        "Check that this claim or restriction is supported, including any exceptions.",
      );
  }
  const seen = new Map<string, string>();
  for (const answer of extractKnowledgeAnswers(text)) {
    if (seen.has(answer.key) && seen.get(answer.key) !== answer.answer)
      issues.push({
        line: 0,
        code: "conflict",
        message:
          "The same question has different answers. Resolve the conflict before publishing.",
        excerpt: answer.question,
      });
    seen.set(answer.key, answer.answer);
  }
  return issues;
}

// AI output is a draft only. Exact source matching prevents invented edits to
// unrelated passages. An owner still reviews every suggestion before publishing.
export function applyKnowledgeSuggestions(
  text: string,
  suggestions: Array<{ source: string; replacement: string }>,
) {
  let draft = text;
  for (const { source, replacement } of suggestions) {
    if (!source || !replacement || !text.split(/\r?\n/).includes(source))
      continue;
    const sourceNumbers = source.match(/\d+(?:[.,:/-]\d+)*/g) ?? [];
    const replacementNumbers = replacement.match(/\d+(?:[.,:/-]\d+)*/g) ?? [];
    if (JSON.stringify(sourceNumbers) !== JSON.stringify(replacementNumbers))
      continue;
    if (
      /\b(?:not|no|never|cannot|can't|without)\b/i.test(source) &&
      !/\b(?:not|no|never|cannot|can't|without|unconfirmed|unknown|need[s]? confirmation)\b/i.test(
        replacement,
      )
    )
      continue;
    // A missing fact must remain unconfirmed after rewriting.
    if (
      /\b(?:unknown|unconfirmed|unresolved|not confirmed|not supplied|not provided)\b/i.test(
        source,
      ) &&
      !/\b(?:unknown|unconfirmed|unresolved|not confirmed|cannot confirm|can't confirm|need[s]? (?:to be )?(?:confirm|check)|must (?:confirm|check)|can confirm|requires? confirmation)\b/i.test(
        replacement,
      )
    )
      continue;
    draft = draft
      .split(/\r?\n/)
      .map((line) => (line === source ? replacement : line))
      .join("\n");
  }
  return knowledgeTextSchema.parse(draft);
}
