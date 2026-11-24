import pdf from "pdf-parse";

// PDF.js accepts typed arrays. Its decoder expects slice() to copy bytes;
// Node Buffer.slice() returns a view and can corrupt cross-reference reads.
const parsePdf = pdf as (
  bytes: Uint8Array,
  options: pdf.Options,
) => Promise<pdf.Result>;

type TextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  dir: string;
};

// pdf-parse's default renderer joins every text item on the same baseline.
// Preserve visible gaps in horizontal text without splitting adjacent glyphs.
export async function extractPdfImportText(buffer: Buffer) {
  const bytes = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  const result = await parsePdf(bytes, {
    async pagerender(page: {
      getTextContent(): Promise<{ items: TextItem[] }>;
    }) {
      const { items } = await page.getTextContent();
      let text = "";
      let previous: TextItem | undefined;
      for (const item of items) {
        if (!item.str) continue;
        if (previous) {
          if (item.transform[5] !== previous.transform[5]) {
            text += "\n";
          } else if (
            item.dir === "ltr" &&
            previous.dir === "ltr" &&
            item.transform[1] === 0 &&
            previous.transform[1] === 0
          ) {
            const gap =
              item.transform[4] - (previous.transform[4] + previous.width);
            const height = Math.max(1, item.height, previous.height);
            if (gap >= height) text += "\t";
            else if (
              gap >= height / 4 &&
              !/\s$/.test(previous.str) &&
              !/^\s/.test(item.str)
            )
              text += " ";
          }
        }
        text += item.str;
        previous = item;
      }
      return text;
    },
  });
  return result.text;
}
