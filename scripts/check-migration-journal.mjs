import { readdir, readFile } from "node:fs/promises";

async function main() {
  const migrationFiles = (await readdir("migrations"))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .map((name) => name.slice(0, -4));
  const journal = JSON.parse(
    await readFile("migrations/meta/_journal.json", "utf8"),
  );
  const journalTags = journal.entries.map((entry) => entry.tag);
  const journalTagSet = new Set(journalTags);
  const migrationFileSet = new Set(migrationFiles);
  const unregistered = migrationFiles.filter((tag) => !journalTagSet.has(tag));
  const missingFiles = journalTags.filter((tag) => !migrationFileSet.has(tag));
  const duplicateTags = journalTags.filter(
    (tag, index) => journalTags.indexOf(tag) !== index,
  );

  if (unregistered.length > 0) {
    throw new Error(
      `Migration SQL files missing from the journal: ${unregistered.join(", ")}.`,
    );
  }

  if (missingFiles.length > 0) {
    throw new Error(
      `Migration journal entries missing SQL files: ${missingFiles.join(", ")}.`,
    );
  }

  if (duplicateTags.length > 0) {
    throw new Error(
      `Duplicate migration journal entries: ${[...new Set(duplicateTags)].join(", ")}.`,
    );
  }

  console.log(
    `Migration journal check passed: ${migrationFiles.length} SQL files registered.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
