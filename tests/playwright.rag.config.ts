import { defineConfig } from "@playwright/test";

export default defineConfig({
  projects: [{ name: "rag-benchmark" }],
  testDir: "./e2e",
  outputDir: "../tmp/rag-benchmark",
  testMatch: "knowledge-retrieval-db.spec.ts",
  workers: 1,
  timeout: 120_000,
});
