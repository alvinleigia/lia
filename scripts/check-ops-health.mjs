#!/usr/bin/env node

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to check operations health.");
}

const failOnAlert = process.argv.includes("--fail-on-alert");
const sql = postgres(databaseUrl, { max: 1, prepare: false });

function toNumber(value) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function formatRecentRows(rows, formatter) {
  if (rows.length === 0) {
    return ["  none"];
  }

  return rows.map((row) => `  - ${formatter(row)}`);
}

async function main() {
  const [uploadSummary] = await sql`
    select
      count(*) filter (where status = 'failed')::int as failed_total,
      count(*) filter (
        where status = 'failed'
          and updated_at >= now() - interval '24 hours'
      )::int as failed_last_24h
    from upload_jobs
  `;
  const [operationSummary] = await sql`
    select
      count(*) filter (where status = 'failed')::int as failed_total,
      count(*) filter (
        where status = 'failed'
          and created_at >= now() - interval '24 hours'
      )::int as failed_last_24h
    from operation_attempts
  `;
  const recentUploadFailures = await sql`
    select id, project_id, source_document_id, error_message, updated_at
    from upload_jobs
    where status = 'failed'
    order by updated_at desc, id desc
    limit 5
  `;
  const recentOperationFailures = await sql`
    select
      id,
      project_id,
      operation_id,
      provider_id,
      submission_id,
      error_message,
      created_at
    from operation_attempts
    where status = 'failed'
    order by created_at desc, id desc
    limit 5
  `;

  const failedUploadsLast24h = toNumber(uploadSummary?.failed_last_24h);
  const failedOperationsLast24h = toNumber(operationSummary?.failed_last_24h);
  const hasAlert = failedUploadsLast24h > 0 || failedOperationsLast24h > 0;

  console.log("Operations health check:");
  console.log(
    `- Failed upload jobs: ${toNumber(
      uploadSummary?.failed_total,
    )} total, ${failedUploadsLast24h} in the last 24h`,
  );
  console.log(
    `- Failed operation attempts: ${toNumber(
      operationSummary?.failed_total,
    )} total, ${failedOperationsLast24h} in the last 24h`,
  );

  console.log("- Recent failed upload jobs:");
  console.log(
    formatRecentRows(
      recentUploadFailures,
      (row) =>
        `#${row.id} project=${row.project_id} sourceDocument=${row.source_document_id} updated=${row.updated_at?.toISOString?.() ?? row.updated_at} error=${row.error_message ?? "n/a"}`,
    ).join("\n"),
  );

  console.log("- Recent failed operation attempts:");
  console.log(
    formatRecentRows(
      recentOperationFailures,
      (row) =>
        `#${row.id} project=${row.project_id} operation=${row.operation_id} provider=${row.provider_id} submission=${row.submission_id ?? "n/a"} created=${row.created_at?.toISOString?.() ?? row.created_at} error=${row.error_message ?? "n/a"}`,
    ).join("\n"),
  );

  if (failOnAlert && hasAlert) {
    throw new Error(
      "Operations health alert: failures were recorded in the last 24 hours.",
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 1 }).catch(() => {});
  });
