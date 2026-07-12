import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const devCommand =
  process.platform === "win32" ? "npm.cmd run dev" : "npm run dev";
const e2ePlatformAdminEmail =
  process.env.E2E_PLATFORM_ADMIN_EMAIL ?? "e2e-platform-admin@example.test";
const platformAdminEmails = [
  process.env.PLATFORM_ADMIN_EMAILS,
  e2ePlatformAdminEmail,
]
  .filter(Boolean)
  .join(",");

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: [["list"]],
  retries: process.env.CI ? 2 : 0,
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: devCommand,
        env: {
          ...process.env,
          MAIL_FROM: "",
          NEXT_PUBLIC_APP_URL: baseURL,
          PLATFORM_ADMIN_EMAILS: platformAdminEmails,
          SMTP2GO_API_KEY: "",
        },
        reuseExistingServer: false,
        timeout: 120_000,
        url: baseURL,
      },
});
