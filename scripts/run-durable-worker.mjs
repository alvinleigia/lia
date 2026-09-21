#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export function readWorkerConfig(env, args) {
  if (args.some((arg) => arg !== "--execute")) {
    throw new Error(
      "Only --execute is supported; omit it to validate without processing jobs.",
    );
  }
  let url;
  try {
    url = new URL(env.DURABLE_WORKER_URL);
  } catch {
    throw new Error(
      "Set DURABLE_WORKER_URL to the HTTPS /api/durable/process-next endpoint.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/api/durable/process-next" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "DURABLE_WORKER_URL must be HTTPS with the exact worker path and no credentials, query or fragment.",
    );
  }
  const secret = env.DURABLE_QUEUE_SECRET || env.CRON_SECRET;
  if (!secret || secret.trim() !== secret || /[\r\n]/.test(secret)) {
    throw new Error(
      "Set DURABLE_QUEUE_SECRET or CRON_SECRET to a valid worker secret.",
    );
  }
  // One project and one item per queue keeps the first activation bounded.
  url.searchParams.set("maxProjects", "1");
  url.searchParams.set("maxItems", "1");
  return { url: url.toString(), secret, execute: args.includes("--execute") };
}

export async function runWorker({
  env = process.env,
  args = process.argv.slice(2),
  fetchImpl = fetch,
} = {}) {
  const config = readWorkerConfig(env, args);
  if (!config.execute) {
    return {
      mode: "validation-only",
      method: "POST",
      url: config.url,
      secretConfigured: true,
      message:
        "No request sent. No scheduler activated. Use --execute only when ready to process jobs.",
    };
  }
  let response;
  try {
    response = await fetchImpl(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.secret}` },
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error(
      "Worker request failed or timed out. Processing may have started; inspect Execution Health before retrying.",
    );
  }
  if (!response.ok) {
    throw new Error(
      `Worker returned HTTP ${response.status}. Inspect Execution Health before retrying.`,
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "Worker returned an invalid response. Inspect Execution Health before retrying.",
    );
  }
  if (
    typeof result?.idle !== "boolean" ||
    !Number.isSafeInteger(result.processedProjects) ||
    result.processedProjects < 0 ||
    result.processedProjects > 1
  ) {
    throw new Error(
      "Worker returned an unexpected response. Inspect Execution Health before retrying.",
    );
  }
  // Never print job payloads, provider errors, credentials or personal details.
  return {
    mode: "executed",
    idle: result.idle,
    processedProjects: result.processedProjects,
    message:
      "Worker request completed. Review Execution Health for individual job outcomes.",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runWorker()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
