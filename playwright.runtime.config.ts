import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  projects: [{ name: "task-runtime" }],
  reporter: [["list"]],
  testDir: "./tests/e2e",
  testMatch: [
    "knowledge-import-db.spec.ts",
    "action-delete-runtime-db.spec.ts",
    "channel-flow-entry-runtime-db.spec.ts",
    "conversational-task-runtime-db.spec.ts",
    "conversational-task-operation-runtime-db.spec.ts",
    "whatsapp-onboarding-db.spec.ts",
  ],
  timeout: 90_000,
  workers: 1,
});
