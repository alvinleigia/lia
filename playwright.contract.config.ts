import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  projects: [{ name: "contracts" }],
  reporter: [["list"]],
  testDir: "./tests/e2e",
  testMatch: [
    "channel-adapter.spec.ts",
    "channel-certification.spec.ts",
    "conversation-turn-contracts.spec.ts",
    "conversation-turn-engine.spec.ts",
    "conversational-task-runtime.spec.ts",
    "conversational-task-schema.spec.ts",
  ],
  timeout: 30_000,
});
