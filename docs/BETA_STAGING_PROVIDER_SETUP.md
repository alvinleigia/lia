# Beta Staging And Provider Setup

Status date: 2026-07-12

This review follows completion of Blueprint Hardening 1/6 through 6/6. It
separates local confirmations from setup that needs a real staging environment,
database provider, public HTTPS URL, email provider and WhatsApp configuration.

## Local Preflight

Confirmed locally:

- Node.js is `v24.18.0`, which satisfies the Node.js 20+ requirement locally.
- `.env.local` exists.
- `.env.local` is not tracked by git.
- Local `.env.local` contains:
  - `DATABASE_URL`
  - `OPENAI_API_KEY`
  - `AUTH_SECRET`
  - `NEXT_PUBLIC_APP_URL`
  - `PLATFORM_ADMIN_EMAILS`
  - `CRON_SECRET`
  - `SMTP2GO_API_KEY`
  - `MAIL_FROM`

Local gaps fixed after this review:

- `NEXTAUTH_URL` was added to `.env.local`.
- `UPLOAD_QUEUE_SECRET` was generated and added to `.env.local`.
- Keep `.env.local` untracked.

Local preflight command:

```bash
npm run check:local-env
```

This command reports missing key names only. It does not print secret values.

## External Setup Still Required

Gate 1: Local and staging basics

- Create a staging app environment separate from local development.
- Create a staging Postgres database separate from production.
- Confirm pgvector is enabled in staging.
- Run migrations against staging.
- Run `npm run build` with staging environment values.
- Confirm deployment Node.js version is 20+.

Gate 3: Database and migration safety

- Confirm migrations apply to a clean database.
- Confirm migrations apply to an existing development or staging database with
  representative data.

Gate 4: Backups and restore

- Choose the production database provider backup policy.
- Confirm automated daily backups.
- Confirm point-in-time recovery availability if the provider supports it.
- Perform one restore drill into staging before production launch.
- Choose production media/object storage and confirm its backup strategy.

Gate 5: Environment and secrets

- Generate a strong production `AUTH_SECRET`.
- Use separate OpenAI keys for staging and production where possible.
- Use separate SMTP2GO credentials for staging and production where possible.
- Use separate WhatsApp app/phone/test credentials for staging where possible.
- Rotate any credentials that were exposed in screenshots or shared chats.
- Confirm `PLATFORM_ADMIN_EMAILS` contains only intended SaaS owner emails.
- Store secrets only in deployment environment variables.

Gate 7: Public URL and webhooks

- Confirm `NEXT_PUBLIC_APP_URL` is a public HTTPS staging/production URL.
- Confirm password reset links use the correct public URL.
- Confirm widget snippets use the correct public URL.
- Confirm WhatsApp media assets are reachable by Meta from public HTTPS.
- Confirm WhatsApp webhook verification works in Meta.
- Confirm inbound WhatsApp messages resolve the correct project channel.
- Confirm disabled tenant/project behavior blocks public widget access in
  staging.

## Recommended Next Actions

1. Run `npm run check:local-env` and fix local `.env.local` gaps without
   committing secrets.
2. Choose the staging host and staging Postgres provider.
3. Configure staging environment variables.
4. Run staging migrations and build.
5. Run the required beta command suite against staging.
6. Perform one backup/restore rehearsal before real customer data.
