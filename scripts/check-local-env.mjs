import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.local");

const requiredKeys = [
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "AUTH_SECRET",
  "NEXTAUTH_URL",
  "NEXT_PUBLIC_APP_URL",
  "PLATFORM_ADMIN_EMAILS",
  "CRON_SECRET",
  "UPLOAD_QUEUE_SECRET",
];

function parseEnvKeys(content) {
  const keys = new Set();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([^=]+)=/);
    if (match?.[1]) {
      keys.add(match[1].trim());
    }
  }

  return keys;
}

if (!existsSync(envPath)) {
  console.error("Missing .env.local.");
  process.exit(1);
}

const keys = parseEnvKeys(readFileSync(envPath, "utf8"));
const missing = requiredKeys.filter((key) => !keys.has(key));

if (missing.length > 0) {
  console.error("Local env preflight failed. Missing keys:");
  for (const key of missing) {
    console.error(`- ${key}`);
  }
  process.exit(1);
}

console.log("Local env preflight passed.");
