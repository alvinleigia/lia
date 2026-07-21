import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  projects: [{ name: "contracts" }],
  reporter: [["list"]],
  testDir: "./tests/e2e",
  testMatch: ["channel-adapter.spec.ts", "channel-certification.spec.ts"],
  timeout: 30_000,
});
