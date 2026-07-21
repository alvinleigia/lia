import { spawnSync } from "node:child_process";

const full = process.argv.includes("--full");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCliPath = process.env.npm_execpath;
const gates = [
  { label: "Lint", script: "lint" },
  { label: "TypeScript", script: "typecheck" },
  { label: "Tenant-scope static analysis", script: "check:tenant-scope" },
  { label: "Cron configuration", script: "check:cron-config" },
  { label: "Channel contracts", script: "test:channel-certification" },
  ...(full
    ? [
        { label: "Production build", script: "build" },
        { label: "Database-backed E2E", script: "test:e2e" },
        {
          label: "Tenant-isolation database checks",
          script: "test:tenant-isolation",
        },
      ]
    : []),
];

for (const [index, gate] of gates.entries()) {
  console.log(`\n[${index + 1}/${gates.length}] ${gate.label}`);
  const command = npmCliPath ? process.execPath : npmCommand;
  const args = npmCliPath
    ? [npmCliPath, "run", gate.script]
    : ["run", gate.script];
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Could not start ${gate.label}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`${gate.label} failed with exit code ${result.status ?? 1}.`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nAutomated release certification passed.");
console.log(
  "Manual UAT sign-off is still required for widget embedding, project chat presentation, live WhatsApp credentials, phone-number ownership, approved templates, and device delivery.",
);
console.log(
  "Record those results in docs/UAT_TEST_PLAN.md before release approval.",
);
