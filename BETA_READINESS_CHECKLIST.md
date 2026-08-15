# Beta Readiness Checklist

Status date: 2026-08-14

This checklist turns `LEIGIA_BLUEPRINT_ALIGNMENT_AUDIT.md` into a practical
beta-readiness track. Use it before putting real customers or production-like
traffic on Lia AI.

## Document Authority

This file is the single source of truth for the overall beta release decision.
It tracks environment, security, operations, provider, staging, and final
approval gates without duplicating subsystem implementation plans.

- `FLOW_BUILDER_ROADMAP.md` is authoritative for flow builder, conversational
  task, tool, runtime, adapter, and flow-verification implementation status.
- `docs/UAT_TEST_PLAN.md` is the single concise manual checklist and test-run
  record for the remaining Phase 14-16 UI and release checks.
- `docs/OPERATIONS_READINESS.md` contains detailed operational procedures.
- `LEIGIA_BLUEPRINT_ALIGNMENT_AUDIT.md` is architectural background and does
  not control current status.

A completed UAT smoke test proves the tested behavior worked in that build; it
does not mark a later roadmap capability complete. This checklist may approve
beta only when its own gates and the referenced roadmap exit gates pass.

## Current Position

Overall beta status: Phase 14 is approved for continued single-tester staging
and internal beta testing. The restore limitation is tracked in
`docs/UAT_DEFERRED_ITEMS.md`. Real customer traffic is outside the current UAT
scope, and Phase 15 manual staging UAT is now active.

Authoritative product implementation status:

- Flow roadmap target: Priority 3, Phase 15 manual staging gate.
- Priority 1, Phase 1 implementation and manual UAT are complete.
- Priority 1, Phase 2 implementation and manual UAT are complete.
- Priority 1, Phase 3 implementation and manual UAT are complete.
- Priority 1, Phase 4 implementation and manual UAT are complete.
- Priority 1, Phase 5 implementation and manual UAT are complete.
- Priority 1, Phase 6 implementation and manual UAT are complete.
- Priority 1, Phase 7 implementation and focused manual UAT are complete.
- Priority 1, Phase 8 implementation and focused manual UAT are complete.
- Priority 2, Phases 9-13 implementation and focused manual UAT are complete.
- Priority 2, Phase 14 implementation and staging UAT are complete.
- Priority 3, Phases 15-16 are implementation-complete; Phase 15 manual UAT is
  active and Phase 16 manual UAT remains pending.
  Phases 17-18 remain incomplete. All four remain post-beta work unless an
  earlier beta requirement explicitly depends on them.

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

- [x] Confirm Node.js 20.9+ is used locally.
- [ ] Confirm Node.js 20.9+ is used in deployment.
- [ ] Confirm a clean `npm ci` succeeds without `--force` or
  `--legacy-peer-deps`.
- [x] Confirm `.env.local` is not committed.
- [ ] Confirm local `.env.local` has non-empty values for:
  - [x] `DATABASE_URL`
  - [x] `OPENAI_API_KEY`
  - [x] `AUTH_SECRET`
  - [x] `NEXTAUTH_URL`
  - [x] `NEXT_PUBLIC_APP_URL`
  - [x] `PLATFORM_ADMIN_EMAILS`
  - [x] `CRON_SECRET`
  - [x] `UPLOAD_QUEUE_SECRET`
  - [x] `DURABLE_QUEUE_SECRET`
  - [x] `PROVIDER_SECRETS_ENCRYPTION_KEY`
  - [x] `PROVIDER_SECRETS_KEY_VERSION`
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
npm run check:local-env
npm run lint
npm run typecheck
npm run check:tenant-scope
npm run test:tenant-isolation
npm run test:channel-certification
npm run test:e2e
npm run build
npm run certify:release
```

Local evidence on 2026-08-05: `npm run certify:release:offline` passed the
environment preflight, lint, TypeScript, tenant scope, cron, 154 channel
contracts, production build, 285 offline browser/database scenarios, and tenant
isolation. The unchecked online commands above remain release gates because
the paid live-model fixtures and intended staging deployment were not exercised
by the offline command.

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

## Gate 9: Flow Builder Product Readiness

- [x] Existing deterministic product baseline has completed its historical
  smoke test.
- [x] Shared server-action form handling keeps validation errors beside the
  relevant form and preserves non-file user input across account, project,
  channel, catalog, operation, builder, and task configuration screens.
- [x] Trusted context uses immutable keys, explicit references, protected
  system variables, visible dependency locations, blocked referenced-variable
  deletion, and no automatic cascading changes.
- [x] Conversational-task publication rejects unresolved trusted-context
  references.
- [x] Pass a cross-cutting form UX regression against the local release candidate.
- [x] Complete Priority 1, Phases 1-8 in `FLOW_BUILDER_ROADMAP.md`.
- [x] Complete Priority 2, Phases 9-14 in `FLOW_BUILDER_ROADMAP.md`.
- [x] Create and pass the Phase 14 checks in `docs/UAT_TEST_PLAN.md`.
- [ ] Complete the active Phase 15 and pending Phase 16 manual UAT.
- [x] Verify anonymous sessions, verified contact association, and cross-channel identity linking cannot expose another visitor's state locally.
- [x] Verify configured retention, export, and deletion behavior for messages, task fields, model traces, and operation records locally.
- [x] Verify duplicate, delayed, out-of-order, and concurrent events cannot repeat operations or overwrite newer state locally.
- [x] Verify model, retrieval, business-tool, and outbound-channel outages use the approved degraded behavior locally.
- [x] Verify human takeover stops automated replies and authorized release resumes the correct published target locally.
- [x] Verify uncertain external-operation results enter reconciliation and never produce a false success response locally.
- [x] Execute the Phase 14 UAT against the intended beta deployment and record
  its commits.
- [x] Pass project chat, website widget, and WhatsApp live channel
  certification within the declared non-voice scope.
- [x] Pass `npm run certify:release`.
- [x] Confirm no unresolved Critical or High flow-builder, conversational-task,
  tenant-safety, or channel defect.

## Gate 10: Known Deferred Items

These are not blockers for internal beta, but they must be explicitly accepted:

- [x] Billing plans and subscriptions are not implemented.
- [x] Feature limits are not implemented.
- [x] Custom domains are not implemented.
- [x] PostgreSQL RLS is not implemented.
- [x] Audit log export is not implemented.
- [x] Automated media retention, lifecycle deletion, and storage quotas are
  not implemented.
- [x] Full browser E2E coverage is not complete.
- [x] Live business operations such as availability, booking, quote, payment,
  and status checks need provider-specific setup.
- [x] Telnyx telephony-network parity, PSTN, SIP, DTMF, transcription,
  voice interruption, call transfer, and hang-up controls are outside the
  non-voice beta scope.
- [x] Advanced Priority 3 roadmap capabilities remain post-beta unless promoted
  through an explicit beta-scope decision.

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
- [x] Document detailed staging and recovery procedures in
      `docs/OPERATIONS_READINESS.md` and keep their tester-facing acceptance
      checks in `docs/UAT_TEST_PLAN.md`.
- [x] Document provider requirements for database, hosting, email, WhatsApp,
      storage, and secrets in this checklist, `docs/OPERATIONS_READINESS.md`,
      and the Phase 14 UAT.
- [x] Fix local `.env.local` gaps without committing secrets.
- [ ] Create staging app and database environments.
- [ ] Run staging migrations, build and required beta command suite.
- [ ] Complete provider backup, restore, public URL, email and WhatsApp checks.

## Recommended Next Implementation Order

1. Complete the active Phase 15 manual staging UAT.
2. Keep local environment, tenant-safety, migration, and operations checks
   passing while product implementation proceeds.
3. Create or refresh staging app and database environments before live channel
   certification.
4. Run staging migrations, the complete UAT plan, and the required beta command
   suite against the exact release candidate.
5. Complete provider backup, restore, public URL, email, and WhatsApp checks.
6. Defer DNS/subdomain setup until domain routing needs a staging test.
7. Keep RLS activation and provider billing checkout deferred until their
   documented prerequisites are approved.
