import { defineConfig, devices } from "@playwright/test";

// Explicit opt-in: this suite uses only the isolated staging UAT project.
export default defineConfig({
  testDir: "./tests/staging",
  testMatch: [
    "bike-enquiry.spec.ts",
    "ordinary-collection.spec.ts",
    "widget-collection.spec.ts",
    "observability.spec.ts",
  ],
  outputDir: "test-results/staging-bike-uat",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/staging-bike-report.json" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: "https://lia-staging.leigia.com",
    storageState: ".playwright-auth/staging.json",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
