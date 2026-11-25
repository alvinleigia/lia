import { expect, test } from "@playwright/test";
import { chunkContent, textSplitter } from "../../src/lib/chunking";

test("carries nested headings onto continuation passages and stops at siblings", async () => {
  const paragraphs = Array.from(
    { length: 35 },
    (_, i) => `Visitor instruction ${i + 1} applies throughout the day.`,
  );
  const chunks = await chunkContent(
    [
      "General notice.",
      "# Service Guide",
      "## Lake Hall",
      ...paragraphs,
      "Equipment hire costs 600.",
      "## Cove Hall",
      "Equipment hire is included.",
      "# Contacts",
      "Call the venue.",
    ].join("\r\n"),
  );
  expect(chunks[0]).toBe("General notice.");
  expect(chunks.length).toBeGreaterThan(4);
  const lake = chunks.slice(1, -2);
  expect(
    lake.every((c) => c.startsWith("# Service Guide\n## Lake Hall\n")),
  ).toBe(true);
  for (const sentence of [...paragraphs, "Equipment hire costs 600."]) {
    expect(lake.some((c) => c.includes(sentence))).toBe(true);
  }
  expect(chunks.slice(-2)).toEqual([
    "# Service Guide\n## Cove Hall\nEquipment hire is included.",
    "# Contacts\nCall the venue.",
  ]);
  expect(chunks.every((c) => c.length <= 900)).toBe(true);
});

test("keeps terms for separately labelled plain-text plans in separate passages", async () => {
  const plans = [
    "Standard Plan\nBreakfast inclusion is unconfirmed.",
    "Flexi Plan\nBreakfast is charged separately.",
  ];
  expect(await chunkContent(plans.join("\n\n"))).toEqual(plans);
});

test("retains the existing split for unstructured text, FAQ pairs and code examples", async () => {
  for (const source of [
    "The service is available\nduring posted hours.\n\nPlease call to reserve.",
    "Q: Can I park?\nA: Parking is free.\n\nQ: Is breakfast included?\nA: Yes.",
    "Example:\n```sh\n# Example heading\nprint hello\n```\n\nMore text.",
    "A single paragraph.".repeat(120),
  ]) {
    expect(await chunkContent(source)).toEqual(
      await textSplitter.splitText(source),
    );
  }
});
