# Beta Staging Runbook

Status date: 2026-07-12

Use this runbook when the staging app and staging database are available. It is
intended for a pre-beta dry run before real customers or production-like traffic.

## Prerequisites

- Staging app host is created.
- Staging Postgres database is created.
- Staging database has pgvector enabled.
- Staging environment variables are configured outside the repo.
- `NEXT_PUBLIC_APP_URL` and `NEXTAUTH_URL` point to the public HTTPS staging URL.
- `PLATFORM_ADMIN_EMAILS` contains only intended SaaS owner emails.
- `CRON_SECRET` and `UPLOAD_QUEUE_SECRET` are set.
- Staging uses separate OpenAI, SMTP2GO and WhatsApp credentials where possible.

## Migration Dry Run

Run against a clean staging database first:

```bash
npx drizzle-kit migrate
npm run build
```

Then run against an existing staging database with representative data:

```bash
npx drizzle-kit migrate
npm run build
```

Do not use `db:push` for staging or production.

## Required Verification Commands

Run these before internal beta:

```bash
npm run check:local-env
npm run lint
npm run check:tenant-scope
npm run check:domain-resolution
npm run check:ops-health
npm run check:cron-config
npm run test:tenant-isolation
npm run test:e2e
npm run build
npx tsc --noEmit
```

Notes:

- `npm run check:local-env` checks local `.env.local`; staging env values must
  be checked in the deployment provider.
- `npm run test:e2e` should run against staging by setting `E2E_BASE_URL` to the
  staging URL.
- Database-backed tests must use a disposable or staging-safe database.

## Public URL Checks

After deploy:

- Open the staging URL in a browser.
- Sign up and sign in with a beta test account.
- Confirm password reset links use the staging URL.
- Create a project and generate a widget snippet.
- Confirm the widget snippet uses the staging URL.
- Confirm the upload worker endpoint rejects requests without
  `UPLOAD_QUEUE_SECRET`.
- Confirm platform admin can access `/platform`.
- Confirm non-platform users cannot access `/platform`.

## WhatsApp Checks

When WhatsApp staging credentials exist:

- Configure a staging WhatsApp channel.
- Verify the webhook in Meta.
- Send an inbound text message.
- Confirm the correct project channel receives the conversation.
- Confirm disabled tenant/project behavior blocks runtime use.
- Confirm public media URLs are reachable by Meta before testing media sends.

## Backup And Restore Checks

Before production launch:

- Confirm automated daily backups.
- Confirm point-in-time recovery availability if the provider supports it.
- Take a manual backup before a schema change.
- Restore one backup into staging.
- Point staging at the restored database.
- Run the required verification commands against the restored environment.

