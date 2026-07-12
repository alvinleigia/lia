# Operations Readiness

This document captures the database, migration, environment, backup, restore,
cron, and webhook checks needed before Lia AI is used with real beta customers.

Subdomain and custom-domain setup is intentionally deferred until the later
public URL/domain hardening gate.

## Environment Separation

Use separate infrastructure for each environment.

| Area | Local | Staging | Production |
| --- | --- | --- | --- |
| Database | Developer-only Postgres | Separate staging Postgres | Separate production Postgres |
| `DATABASE_URL` | `.env.local` only | Deployment env vars | Deployment env vars |
| OpenAI key | Local/dev key | Staging key where possible | Production key |
| Auth secret | Local generated value | Strong staging secret | Strong production secret |
| Public URL | `http://localhost:3000` | Public HTTPS staging URL | Public HTTPS production URL |
| Upload queue secret | Local generated value | Staging secret | Production secret |
| Cron secret | Local generated value | Staging secret | Production secret |

Never point staging and production at the same database.

## Required Environment Variables

Minimum required runtime variables:

```env
DATABASE_URL="postgres://USER:PASSWORD@HOST:PORT/DATABASE"
OPENAI_API_KEY="sk-..."
AUTH_SECRET="long-random-secret"
NEXTAUTH_URL="https://your-app.example.com"
NEXT_PUBLIC_APP_URL="https://your-app.example.com"
PLATFORM_ADMIN_EMAILS="owner@example.com"
CRON_SECRET="long-random-secret"
UPLOAD_QUEUE_SECRET="long-random-secret"
```

Optional integrations:

```env
AUTH_GOOGLE_ID=""
AUTH_GOOGLE_SECRET=""
SMTP2GO_API_KEY=""
MAIL_FROM="Lia AI <no-reply@example.com>"
```

Keep all secrets in local `.env.local` or deployment environment variables.
Do not commit environment files.

## Migration Policy

`npx drizzle-kit migrate` is the standard migration command for staging and
production.

Use this flow for every deployment with schema changes:

1. Review generated migration files in `migrations/`.
2. Take or confirm a recent database backup.
3. Apply migrations to a clean staging database.
4. Apply migrations to an existing staging database with representative data.
5. Run the beta readiness commands against staging.
6. Deploy the application build that matches those migrations.
7. Apply migrations to production during the agreed release window.
8. Verify the application and core smoke tests.

`npm run db:push` or `drizzle-kit push` must be treated as local-development
only. Do not use push commands against staging or production because they skip
the explicit migration review trail.

## Migration Smoke Checks

Clean database check:

```bash
npx drizzle-kit migrate
npm run build
npm run test:tenant-isolation
```

Existing database check:

```bash
npx drizzle-kit migrate
npm run build
npm run check:tenant-scope
npm run test:tenant-isolation
npm run test:e2e
```

Before beta, run both checks against staging. The clean database check proves a
new environment can be created from migrations alone. The existing database
check proves customer-like data survives the migration path.

## pgvector Verification

The app requires pgvector for document embeddings.

Enable it once per database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Verify it:

```sql
SELECT extname, extversion
FROM pg_extension
WHERE extname = 'vector';
```

The query should return one row for `vector`.

## Rollback Expectations

Drizzle migrations in this project are forward migrations. Do not assume an
automatic down migration exists.

Rollback options:

1. Prefer a forward fix migration for non-destructive schema issues.
2. Restore the latest verified backup into staging to validate data recovery.
3. Restore production from the provider backup only if the release cannot be
   safely fixed forward.

Before any destructive migration, write a manual rollback note in the release
plan that names the backup snapshot and the expected restore target.

## Backup And Restore

Minimum backup policy before production:

- Automated daily database backups.
- Point-in-time recovery if the provider supports it.
- Manual backup before schema changes.
- A tested restore into staging before production launch.

Provider decision record:

```text
Production database provider:
Backup tier/policy:
Automated backup frequency:
Retention period:
Point-in-time recovery available:
Manual backup UI path or CLI command:
Restore target used for rehearsal:
Last restore rehearsal date:
```

Manual backup command fallback:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=lia-ai-backup.dump
```

For managed Postgres providers, prefer the provider backup snapshot feature
when it is available. Record the exact provider UI path or CLI command in the
decision record before launch.

Restore smoke procedure:

1. Create or select an empty staging restore database.
2. Restore the chosen backup through the provider UI or CLI.
3. Point staging `DATABASE_URL` at the restored database.
4. Run:

```bash
npm run build
npm run check:tenant-scope
npm run test:tenant-isolation
```

5. Sign in as a staging test user and confirm projects, actions, submissions,
   contacts, and audit logs load.

Media backup note:

Development media currently lives under `public/uploads`. Before production
media usage, move uploaded media to object storage and confirm that storage has
versioning, retention, or provider backups enabled. Do not treat local
filesystem uploads as durable production storage.

## Cron And Queue Checks

The upload queue endpoint is protected by `UPLOAD_QUEUE_SECRET`:

```text
POST /api/upload/process-next
Authorization: Bearer <UPLOAD_QUEUE_SECRET>
```

Before beta:

- Confirm `UPLOAD_QUEUE_SECRET` is set outside the repo.
- Confirm `CRON_SECRET` is set if the deployment platform requires it.
- Run `npm run check:cron-config` to confirm Vercel cron calls the upload
  queue endpoint.
- Keep operation retry processing manual during beta.
- Review and replay failed operation attempts from `/projects/operations` or
  the linked submission detail page.
- Revisit automated retry workers after beta traffic shows the needed retry
  policy, backoff rules, provider limits, and alert thresholds.
- Run `npm run check:ops-health` to report failed upload jobs and failed
  operation attempts.
- Use `npm run check:ops-health -- --fail-on-alert` from a scheduler or
  monitoring service when failures in the last 24 hours should raise an alert.

## Webhook And Public URL Checks

Before testing public channels:

- `NEXT_PUBLIC_APP_URL` must be a public HTTPS URL.
- Password reset links should use that same public URL.
- Widget snippets should use that same public URL.
- WhatsApp media assets must be reachable from public HTTPS.
- WhatsApp webhook verification must pass in Meta.

Custom domains and tenant subdomains are not required for these checks.

## Platform Support Decisions

For beta, the existing project/company audit-log view is enough for basic
operational review. Platform-wide audit export is deferred until there is a
clear customer, compliance, or support workflow that needs downloadable audit
evidence.

Support impersonation must not be added during beta. Add it only after the
support-access model includes:

- explicit support permission grants
- reason-for-access capture
- tenant-visible support access events
- immutable audit logs for every impersonated action
- expiry or revocation of support access
