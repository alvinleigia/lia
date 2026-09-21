# Durable worker setup — prepared, inactive

Decision recorded 2026-09-22: retain Vercel Hobby and prepare the runner without
activating a scheduler. No cron entry, recurring process, environment variable or
hosting plan has been changed. Queued jobs will continue to require an authorized
worker invocation until scheduling is enabled separately.

## Validate the future runner

Use Node.js 20.9 or newer from the repository root. Supply these through the
future runner's environment/secret store, not a checked-in file:

| Variable | Value |
| --- | --- |
| `DURABLE_WORKER_URL` | `https://lia-staging.leigia.com/api/durable/process-next` for staging; use the corresponding deployment URL for production. |
| `DURABLE_QUEUE_SECRET` | The matching deployment's existing durable-worker secret. |
| `CRON_SECRET` | Optional fallback when `DURABLE_QUEUE_SECRET` is absent. |

The script reads process environment variables only; it does not load `.env.local`.
Keep staging and production credentials separate.

```text
npm run worker:durable
```

This default validates configuration locally, reports the target and whether a
secret is configured, and exits. It sends **no HTTP request** and cannot verify
server authentication or connectivity. It does not print the secret.

## Future activation (not performed)

After reviewing the pending queues and authorizing processing, an external
scheduler can invoke the following one-shot command:

```text
npm run worker:durable -- --execute
```

This sends one authenticated POST, with `maxProjects=1&maxItems=1`, then exits.
The limit is one item **per queue**, not one total job: the endpoint handles
operations, flow resumes, response policies, post-conversation work, hosted voice
tools and the outbox. It selects a due project automatically; the URL does not
restrict processing to the currently selected UI project. Outbox and operation
jobs can have external effects. Review those queues before first activation.

Choose a schedule appropriate to wait/retry requirements (for example, once per
minute on an external scheduler). Keep overlapping invocations disabled. Nothing
in this setup installs or enables that schedule. These conservative batch limits
must be assessed against actual backlog and throughput before production use;
project selection currently prioritizes ascending IDs and can delay later
projects while earlier projects continuously have work.

The runner refuses redirects, has a 60-second client timeout, and performs no
automatic retries. A timeout/network/HTTP failure does not prove that processing
never started. Inspect Execution Health before retrying. Existing worker leases
and idempotency rules remain authoritative. Failed jobs are not reset or replayed
by this setup.

Exit code 0 for `--execute` means the endpoint returned a valid success response,
not that every job succeeded. Output includes only idle status and project count;
inspect `/projects/operations` for job outcomes. Do not put raw worker response
bodies or credentials in scheduler logs. The existing `check:cron-config` command
checks the upload cron only and does not certify durable-worker scheduling.

## Verification and remaining gate

```text
npm run test:durable-worker-runner
```

Six offline tests verify the no-request default, target/secret validation, bounded
authenticated execution, no redirects/retries, safe error output and invalid
response rejection. Execution tests use mocked HTTP; the live worker has not
been invoked by this setup.

Keep `P15-UAT-01` open until recurring execution is enabled and observed to handle
due work and recover leases within the agreed timing, with failures reviewed.
Current evidence and the accepted inactive state are in `UAT_DEFERRED_ITEMS.md`.
