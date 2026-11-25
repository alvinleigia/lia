export type RequestedDocumentSection = { name: string; excerptIds: string[] };

export function requestedDocumentSections(
  question: string,
  excerpts: ReadonlyArray<{ id: string; sectionHeadings?: string[] }>,
): RequestedDocumentSection[] {
  const byName = new Map<string, RequestedDocumentSection>();
  for (const { id, sectionHeadings } of excerpts) {
    for (const name of sectionHeadings ?? []) {
      const key = name.normalize("NFKC").toLowerCase();
      const section = byName.get(key);
      if (section) section.excerptIds.push(id);
      else byName.set(key, { name, excerptIds: [id] });
    }
  }
  if (!byName.size) return [];
  // Longest first makes "Standard Plus" distinct from "Standard" while
  // still matching both when the visitor asks for a comparison.
  const alternatives = [...byName.keys()]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}_])`,
    "gu",
  );
  const matches = new Set(
    question.normalize("NFKC").toLowerCase().match(pattern),
  );
  return [...byName]
    .filter(([key]) => matches.has(key))
    .map(([, section]) => section);
}
