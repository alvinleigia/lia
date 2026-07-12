import { readFile } from "node:fs/promises";

const uploadQueuePath = "/api/upload/process-next";

async function main() {
  const rawConfig = await readFile("vercel.json", "utf8");
  const config = JSON.parse(rawConfig);
  const crons = Array.isArray(config.crons) ? config.crons : [];
  const uploadQueueCron = crons.find(
    (cron) =>
      cron?.path === uploadQueuePath && typeof cron.schedule === "string",
  );

  if (!uploadQueueCron) {
    throw new Error(
      `Missing Vercel cron entry for ${uploadQueuePath} in vercel.json.`,
    );
  }

  if (uploadQueueCron.schedule.trim().length === 0) {
    throw new Error(
      `Vercel cron entry for ${uploadQueuePath} has no schedule.`,
    );
  }

  console.log(
    `Cron config check passed: ${uploadQueuePath} scheduled as ${uploadQueueCron.schedule}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
