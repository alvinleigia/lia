# Beta Readiness Checklist

Status date: 2026-07-12

This checklist turns `LEIGIA_BLUEPRINT_ALIGNMENT_AUDIT.md` into a practical
beta-readiness track. Use it before putting real customers or production-like
traffic on Lia AI.

## Current Position

Current hardening track:

- Blueprint Hardening 1/6: E2E and tenant isolation foundation.
- Blueprint Hardening 2/6: production operations readiness.
- Blueprint Hardening 3/6: SaaS admin readiness.
- Blueprint Hardening 4/6: billing and plans design.
- Blueprint Hardening 5/6: domains strategy.
- Blueprint Hardening 6/6: RLS readiness.

Completed foundations:

- Static tenant-scope guardrail: `npm run check:tenant-scope`
- Database tenant-isolation guardrail: `npm run test:tenant-isolation`
- Browser E2E foundation: `npm run test:e2e`
- First browser journey: sign up, sign in, create project.

Subdomain and custom-domain setup:

- Not required for the current hardening steps.
- Do not start DNS/subdomain setup yet.
- Revisit only when domain routing needs a staging test.

## Gate 1: Local And Staging Basics

- [ ] Confirm Node.js 20+ is used locally and in deployment.
- [ ] Confirm `npm install --legacy-peer-deps` is documented if peer
  resolution blocks fresh installs.
- [ ] Confirm `.env.local` is not committed.
- [ ] Confirm local `.env.local` has:
  - [ ] `DATABASE_URL`
  - [ ] `OPENAI_API_KEY`
  - [ ] `AUTH_SECRET`
  - [ ] `NEXTAUTH_URL`
  - [ ] `NEXT_PUBLIC_APP_URL`
  - [ ] `PLATFORM_ADMIN_EMAILS`
  - [ ] `CRON_SECRET`
  - [ ] `UPLOAD_QUEUE_SECRET`
- [ ] Create a staging environment separate from local development.
- [ ] Create a staging Postgres database separate from production.
- [ ] Confirm staging has pgvector enabled.
- [ ] Run migrations against staging.
- [ ] Run `npm run build` against staging env values.

## Gate 2: Tenant Safety

- [x] Static tenant-scope check exists.
- [x] Database-backed tenant-isolation check exists.
- [x] Database-backed tenant-isolation check covers later builder tables:
  - [x] branch rules
  - [x] flow versions
  - [x] project channels
  - [x] channel conversations/messages
  - [x] contacts, attributes, tags, assignments
  - [x] media assets
  - [x] product catalogs/products
- [x] Browser E2E foundation exists.
- [x] Browser E2E covers sign up, sign in, and project creation.
- [x] Browser E2E covers platform admin access.
- [x] Browser E2E covers tenant disable behavior.
- [x] Browser E2E covers team invite and accept.
- [x] Browser E2E covers cross-tenant route denial.
- [x] Browser E2E covers widget token access and allowed-domain behavior.
- [x] Browser E2E covers project chat action submission.
- [x] Browser E2E covers widget action submission.

Required commands before beta:

```bash
npm run lint
npm run check:tenant-scope
npm run test:tenant-isolation
npm run test:e2e
npm run build
npx tsc --noEmit
```

## Gate 3: Database And Migration Safety

- [ ] Confirm migrations apply to a clean database.
- [ ] Confirm migrations apply to an existing development database.
- [x] Confirm `drizzle-kit migrate` is the standard production migration path.
- [x] Document whether `db:push` is allowed only for local development.
- [x] Document rollback expectations.
- [x] Document how to verify pgvector extension.
- [x] Document how to restore from backup into staging.
- [x] Add migration smoke test notes to README or deployment docs.

## Gate 4: Backups And Restore

- [ ] Choose production database provider backup policy.
- [ ] Confirm automated daily backups.
- [ ] Confirm point-in-time recovery availability, if provider supports it.
- [x] Document manual backup command/provider UI path.
- [x] Document restore procedure into staging.
- [ ] Perform one test restore before production launch.
- [ ] Confirm media storage backup strategy once production media moves out of
  local `public/uploads`.

## Gate 5: Environment And Secrets

- [ ] Generate a strong production `AUTH_SECRET`.
- [ ] Use separate OpenAI keys for staging and production where possible.
- [ ] Use separate SMTP2GO credentials for staging and production where
  possible.
- [ ] Use separate WhatsApp app/phone/test credentials for staging where
  possible.
- [ ] Rotate any credentials that were used in screenshots or shared chats.
- [ ] Confirm `PLATFORM_ADMIN_EMAILS` only includes intended SaaS owner emails.
- [ ] Confirm secrets are stored in deployment environment variables only.

## Gate 6: Background Jobs And Cron

- [x] Confirm `/api/upload/process-next` is protected by
  `UPLOAD_QUEUE_SECRET`.
- [x] Confirm Vercel cron or equivalent calls upload processing.
- [x] Confirm `CRON_SECRET` is configured where needed.
- [x] Decide how operation retry queues are processed in production.
- [x] Decide whether operation retry processing remains manual during beta.
- [x] Add monitoring for failed upload jobs and failed operation attempts.

## Gate 7: Public URL And Webhooks

- [ ] Confirm `NEXT_PUBLIC_APP_URL` is public HTTPS in staging/production.
- [ ] Confirm password reset links use the correct public URL.
- [ ] Confirm widget snippets use the correct public URL.
- [ ] Confirm WhatsApp media assets are reachable by Meta from public HTTPS.
- [ ] Confirm WhatsApp webhook verification works.
- [ ] Confirm inbound WhatsApp messages resolve the correct project channel.
- [ ] Confirm disabled tenant/project behavior blocks public widget access.

Subdomain note:

- Company subdomain and custom-domain routing are deferred.
- Do not set up subdomains yet unless a beta test specifically requires domain
  routing.
- When needed, start with a staging subdomain and a domain-resolution design
  document before DNS changes.

## Gate 8: Platform Admin And Support

- [x] Confirm `/platform` is only accessible to `PLATFORM_ADMIN_EMAILS`.
- [x] Confirm platform admin can see tenant companies.
- [x] Confirm platform admin can enable/disable tenants.
- [x] Confirm disabled tenants cannot use protected app routes.
- [x] Confirm disabled tenants cannot use public widget routes.
- [x] Add browser E2E for platform admin login/access.
- [x] Add browser E2E for tenant disable behavior.
- [x] Decide whether platform audit-log view/export is needed for beta.
- [x] Do not add support impersonation until support-access audit rules exist.

## Gate 9: Core Product Smoke Test

- [x] Sign up as a new company owner.
- [x] Create a project.
- [x] Upload and process a document.
- [x] Ask a RAG question from project chat.
- [x] Apply a template.
- [x] Run a flow from project chat.
- [x] Run a flow from widget.
- [x] Create a media asset.
- [x] Create a product catalog/product.
- [x] Run a flow with branching.
- [x] Run a flow with inline operation success/failure routing.
- [x] Review submissions and submission events.
- [x] Review contacts and channel transcript.
- [x] Review analytics.
- [x] Review audit logs.

## Gate 10: Known Deferred Items

These are not blockers for internal beta, but they must be explicitly accepted:

- [x] Billing plans and subscriptions are not implemented.
- [x] Feature limits are not implemented.
- [x] Custom domains are not implemented.
- [x] PostgreSQL RLS is not implemented.
- [x] Audit log export is not implemented.
- [x] Production object storage is not implemented for media.
- [x] Full browser E2E coverage is not complete.
- [x] Live business operations such as availability, booking, quote, payment,
  and status checks need provider-specific setup.

## Gate 11: SaaS Admin Readiness

- [x] Review `/platform` tenant management against blueprint routes.
- [x] Add missing platform audit events.
- [x] Add tenant detail action coverage for support workflows.
- [x] Confirm disabled tenant behavior across app, widget, API and WhatsApp.

## Gate 12: Billing And Plans Design

- [x] Design company subscription state.
- [x] Define plan limits for projects, documents, messages, storage, WhatsApp
  channels, team members and operations.
- [x] Add billing module only after the data model is agreed.

## Gate 13: Domains Strategy

- [x] Design domain table and resolution helper.
- [x] Decide central, subdomain and custom-domain behavior.
- [x] Keep admin-on-custom-domain deferred until cookies/session rules are safe.
- [x] Add domain resolution tests before enabling.

## Gate 14: RLS Readiness

- [x] List tenant-owned tables and current scope columns.
- [x] Decide which tables should get RLS first.
- [x] Ensure query helpers already pass scope in a way compatible with RLS.
- [x] Defer actual RLS migration until testing and deployment process are
  mature.

## Gate 15: Staging And Provider Setup Review

- [x] Classify remaining beta-readiness items by local, staging, provider and
  production setup.
- [x] Add local `.env.local` preflight without printing secret values.
- [x] Document staging migration, build and beta verification runbook.
- [x] Document provider checklist for database, hosting, email, WhatsApp,
  storage and secrets.
- [x] Fix local `.env.local` gaps without committing secrets.
- [ ] Create staging app and database environments.
- [ ] Run staging migrations, build and required beta command suite.
- [ ] Complete provider backup, restore, public URL, email and WhatsApp checks.

## Recommended Next Implementation Order

1. Run `npm run check:local-env` and fix local `.env.local` gaps without
   committing secrets.
2. Create staging app and database environments.
3. Run staging migrations, build and required beta command suite.
4. Complete provider backup, restore, public URL, email and WhatsApp checks.
5. Defer actual RLS migration until testing and deployment process is mature.
6. Defer DNS/subdomain setup until domain routing needs a staging test.
7. Keep provider checkout, invoices and webhooks deferred until manual plans
   work.
