// src/lib/chunking.ts
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const chunkSize = 900;

function splitter(size: number) {
  return new RecursiveCharacterTextSplitter({
    chunkSize: size,
    chunkOverlap: Math.min(120, Math.floor(size / 2)),
    separators: ["\n\n", "\n", ". ", " ", ""],
  });
}

export const textSplitter = splitter(chunkSize);

type Section = { heading: string; body: string };

function documentSections(text: string): Section[] {
  // A heading inside a code example must never become a policy label.
  if (/^[ \t]*(?:`{3,}|~{3,})/m.test(text)) return [];
  const headings = [...text.matchAll(/^ {0,3}(#{1,6})[ \t]+\S[^\n]*$/gm)];
  if (headings.length) {
    const sections: Section[] = [
      { heading: "", body: text.slice(0, headings[0].index) },
    ];
    const path: { level: number; label: string }[] = [];
    for (const [i, match] of headings.entries()) {
      const level = match[1].length;
      while (path.length && path[path.length - 1].level >= level) path.pop();
      path.push({ level, label: match[0].trim() });
      const next = headings[i + 1];
      const body = text
        .slice(match.index + match[0].length, next?.index)
        .trim();
      if (body || !next || next[1].length <= level) {
        sections.push({
          heading: path.map((entry) => entry.label).join("\n"),
          body,
        });
      }
    }
    return sections;
  }

  // Plain-text exports sometimes use a title on the first line of every block.
  // Require that repeated layout throughout; a wrapped sentence is ambiguous.
  const blocks = text.split(/\n[ \t]*\n+/);
  if (blocks.length < 2) return [];
  const sections: Section[] = [];
  for (const block of blocks) {
    const newline = block.indexOf("\n");
    if (newline < 1) return [];
    const heading = block.slice(0, newline).trim();
    if (!/^[A-Z][a-zA-Z0-9-]*(?: [A-Z0-9][a-zA-Z0-9-]*){0,7}$/.test(heading)) {
      return [];
    }
    sections.push({ heading, body: block.slice(newline + 1).trim() });
  }
  return sections;
}

export async function splitKnowledgeDocument(content: string) {
  const headingsByContent = new Map<string, string[]>();
  const text = content.trim();
  const sections = documentSections(text.replace(/\r\n/g, "\n"));
  if (
    !sections.length ||
    sections.some(({ heading }) => heading.length > chunkSize / 2)
  ) {
    return { chunks: await textSplitter.splitText(text), headingsByContent };
  }
  const chunks: string[] = [];
  for (const { heading, body } of sections) {
    if (!body.trim()) {
      if (heading) chunks.push(heading);
      continue;
    }
    const prefix = heading ? `${heading}\n` : "";
    const sectionSplitter = prefix
      ? splitter(chunkSize - prefix.length)
      : textSplitter;
    const parts = await sectionSplitter.splitText(body);
    const labels = heading
      .split("\n")
      .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/\s+#+$/, ""));
    for (const part of parts) {
      const chunk = prefix + part;
      chunks.push(chunk);
      if (heading) headingsByContent.set(chunk, labels);
    }
  }
  return { chunks, headingsByContent };
}

export async function chunkContent(content: string) {
  return (await splitKnowledgeDocument(content)).chunks;
}
