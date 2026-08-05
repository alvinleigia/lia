import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  projects: [{ name: "task-runtime" }],
  reporter: [["list"]],
  testDir: "./tests/e2e",
  testMatch: [
    "action-delete-runtime-db.spec.ts",
    "conversational-task-runtime-db.spec.ts",
    "conversational-task-operation-runtime-db.spec.ts",
  ],
  timeout: 90_000,
  workers: 1,
});
