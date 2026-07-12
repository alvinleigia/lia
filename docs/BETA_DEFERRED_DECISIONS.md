# Beta Deferred Decisions

Status date: 2026-07-12

This file records items that are intentionally accepted as non-blockers for
internal beta. These decisions are not removals from scope. They are explicit
deferrals so the app can be tested safely before paid SaaS operations begin.

## Billing Plans And Subscriptions

Decision: accepted as deferred for internal beta.

Current state:

- Billing plans are not modeled.
- Company subscription status is not modeled.
- Payment provider integration is not implemented.
- Platform plan management is not implemented.
- The app currently treats active companies as allowed to use the product,
  subject to existing tenant, project, and platform-admin controls.

Why this is acceptable for internal beta:

- Internal beta is focused on tenant safety, project setup, flow builder
  behavior, channel runtime behavior, document/RAG behavior, operations,
  auditability, and support readiness.
- No customer should be charged from this app during the beta deferral.
- Platform admins can still enable or disable tenant companies manually.

Operational guardrail:

- Do not sell paid subscriptions from this app until billing state exists.
- Do not promise automated plan enforcement during internal beta.
- If a beta tenant needs access removed, use platform tenant disable controls.

Before paid launch:

- Design company subscription state.
- Define trial and subscription lifecycle states.
- Define plan limits for projects, documents, messages, storage, WhatsApp
  channels, team members, operations, and seats.
- Add a billing module only after the data model is agreed.
- Integrate a payment provider and webhook verification.
- Add platform plan management and subscription audit events.

## Feature Limits

Decision: accepted as deferred for internal beta.

Current state:

- Project count limits are not enforced.
- Document, media, storage, and message-volume limits are not enforced.
- Team member, WhatsApp channel, operation, and flow-builder limits are not
  enforced.
- There is no plan-aware quota model yet.

Why this is acceptable for internal beta:

- Internal beta should use a small number of trusted tenants.
- Platform admins can disable a tenant if usage becomes unsafe or abusive.
- Manual operational review is acceptable until paid plan packaging is defined.

Operational guardrail:

- Do not promise automated usage caps during internal beta.
- Watch database size, uploaded media, failed jobs, operation attempts, and
  chat request volume manually during beta testing.
- Keep beta tenants small until production object storage and plan limits are
  designed.

Before paid launch:

- Define enforceable limits for each plan.
- Add quota checks at the write paths that create projects, documents, media,
  contacts, messages, channels, operations, team members, and flow entities.
- Add platform-visible usage reporting.
- Add user-facing limit messaging before rejecting writes.

## Custom Domains

Decision: accepted as deferred for internal beta.

Current state:

- Company subdomains are not implemented.
- Custom-domain mapping is not implemented.
- Domain ownership verification is not implemented.
- App routing does not resolve tenants by request host.
- Admin-on-custom-domain behavior is not designed yet.

Why this is acceptable for internal beta:

- Internal beta can run on the central app URL.
- Widget and webhook testing only need `NEXT_PUBLIC_APP_URL` to be a public
  HTTPS app URL.
- Deferring custom domains avoids introducing cookie, session, DNS, and tenant
  resolution risk before the core beta safety checks are finished.

Operational guardrail:

- Do not start DNS or subdomain setup during the current hardening step.
- Use the central staging or production app URL for beta testing.
- If a beta test specifically needs domain routing, first create a
  domain-resolution design note and test it on staging.

Before custom-domain launch:

- Design the domain table and verification state machine.
- Decide central app, company subdomain, and custom-domain routing behavior.
- Define session and cookie behavior for admin routes and public widget routes.
- Add domain resolution middleware/helper tests before enabling DNS changes.
- Add audit events for domain create, verify, activate, disable, and delete.

## PostgreSQL RLS

Decision: accepted as deferred for internal beta.

Current state:

- PostgreSQL Row Level Security policies are not enabled.
- Tenant isolation is enforced in application query helpers and route/context
  resolution.
- Tenant-owned tables use explicit scope columns such as company, workspace, or
  project identifiers.
- Static tenant-scope checks and database-backed tenant-isolation checks exist.

Why this is acceptable for internal beta:

- The current beta safety work verifies tenant scoping at the application and
  database-query level.
- Adding RLS too early would increase migration and debugging risk while the
  schema and runtime flows are still moving.
- The existing table shape and query patterns are being kept compatible with a
  future RLS migration.

Operational guardrail:

- Keep using explicit tenant scope in every query helper.
- Keep `npm run check:tenant-scope` and `npm run test:tenant-isolation` in the
  beta verification command set.
- Do not grant direct database access to beta tenants.
- Treat any unscoped tenant-owned query as a blocker.

Before enabling RLS:

- List tenant-owned tables and the intended RLS scope column for each table.
- Decide the first RLS policy group, likely company, workspace, project, and
  channel/runtime-owned tables.
- Design database roles or transaction/session variables for tenant scope.
- Test RLS policies against a staging database with the existing tenant
  isolation suite.
- Add rollback notes before applying RLS policies to production.

## Audit Log Export

Decision: accepted as deferred for internal beta.

Current state:

- Recent company-scoped audit events are available at `/projects/audit`.
- Audit logs are append-only records in the database.
- Downloadable audit export is not implemented.
- Platform-wide audit export is not implemented.

Why this is acceptable for internal beta:

- Internal beta support can review audit events through the read-only audit
  page.
- Downloadable audit evidence is not required until a customer, compliance, or
  support workflow needs it.
- Avoiding export for beta reduces data-exfiltration and access-control risk
  while the support model is still intentionally minimal.

Operational guardrail:

- Use `/projects/audit` for beta audit review.
- Do not add support impersonation or downloadable audit evidence until support
  access rules are designed.
- Treat audit export as a controlled support/compliance feature, not a casual
  table dump.

Before audit export launch:

- Decide company-level versus platform-level export scope.
- Add permission checks dedicated to audit export.
- Add date-range filtering and file format decisions, likely CSV and JSON.
- Write audit events for every audit export request.
- Add browser and database-backed tests proving cross-tenant export isolation.

## Production Object Storage For Media

Decision: accepted as deferred for internal beta.

Current state:

- Reusable project media assets are stored under `public/uploads/media`.
- Document and media upload flows are project-scoped, but local filesystem
  storage is not durable production object storage.
- Native WhatsApp outbound media still depends on public HTTPS URLs so Meta can
  fetch media assets.
- Backup and retention behavior for local uploaded files is not production
  grade.

Why this is acceptable for internal beta:

- Internal beta can use small test media sets.
- Media-heavy customer workloads are not part of the current beta acceptance
  target.
- The existing media smoke tests prove project-scoped upload and review
  behavior before storage is swapped.

Operational guardrail:

- Keep beta media usage small.
- Do not treat local `public/uploads` files as durable production storage.
- Use a public HTTPS `NEXT_PUBLIC_APP_URL` or `NEXTAUTH_URL` before testing
  WhatsApp outbound media fetches.
- Back up local/staging uploads manually if a beta test depends on them.

Before production media launch:

- Choose object storage, such as S3-compatible storage, Vercel Blob, or another
  managed bucket.
- Define bucket structure, access policy, retention, and backup behavior.
- Add signed upload/download or controlled public URL behavior as needed by
  widgets and WhatsApp.
- Migrate project media paths from filesystem URLs to object-storage URLs.
- Add tests for upload, render, WhatsApp fetchability, tenant isolation, and
  deletion/archive behavior.

## Full Browser E2E Coverage

Decision: accepted as deferred for internal beta.

Current state:

- Playwright browser E2E infrastructure exists.
- Core smoke coverage exists for signup, project creation, platform admin,
  tenant disable behavior, team invite, cross-tenant denial, widget token
  access, document processing, RAG chat, media, catalog/products, flows,
  branching, inline operation routing, contacts/transcripts, analytics, and
  audit review.
- Static tenant-scope and database-backed tenant-isolation checks exist.
- Exhaustive browser coverage for every page, validation branch, responsive
  viewport, browser, and edge case is not complete.

Why this is acceptable for internal beta:

- The beta risk focus is covered by smoke tests plus tenant-isolation checks.
- Exhaustive E2E would be expensive to maintain while builder, channel, and
  operations UX is still changing.
- The current suite is enough to catch major regressions in critical journeys.

Operational guardrail:

- Run `npm run test:e2e` before beta releases.
- Keep focused E2E tests for each newly added critical workflow.
- Keep `npm run check:tenant-scope` and `npm run test:tenant-isolation` as
  required beta checks.
- Treat failures in existing smoke coverage as release blockers.

Before production scale:

- Expand browser E2E coverage for visual flow builder editing, operation
  management, WhatsApp setup, handoff workflows, profile/team editing, and
  analytics/audit filters.
- Add focused negative-path tests for validation errors and permission denial.
- Add at least one mobile/responsive smoke path for high-traffic screens.
- Decide which tests run on every commit versus scheduled full regression.

## Live Business Operations

Decision: accepted as deferred for internal beta.

Current state:

- Generic operation providers and operation attempts exist.
- Webhook, n8n webhook, email-style webhook delivery, manual review,
  internal-save, and Meta Conversions style operations are available as
  reusable primitives.
- Turnkey availability, booking, quote, payment, order lookup, and status-check
  integrations are not implemented.
- Industry-specific provider contracts, credentials, payload schemas, retry
  expectations, and success/failure semantics must be configured per customer
  or vertical.

Why this is acceptable for internal beta:

- Internal beta can validate the flow builder, operation routing, retry/replay,
  auditability, and channel-independent runtime without connecting real
  revenue-impacting systems.
- Provider-specific operations are high-stakes because they can create bookings,
  charge customers, or expose external account data.
- Keeping them deferred prevents accidental production behavior while the core
  SaaS foundation is still being hardened.

Operational guardrail:

- Do not connect live payment, booking, quote, or availability systems during
  internal beta unless there is a written provider-specific test plan.
- Use manual review or sandbox webhook/n8n operations for beta demos.
- Label beta flows clearly when they collect intent but do not complete a live
  transaction.
- Review operation attempts and failures from `/projects/operations`.

Before live business operations launch:

- Pick the first vertical/provider integration deliberately.
- Define provider credentials, sandbox/live environments, payload contracts,
  validation rules, idempotency keys, retry rules, and rollback/manual-review
  behavior.
- Add provider-specific tests for success, failure, timeout, duplicate request,
  and cross-tenant isolation.
- Add user-facing confirmation and audit events for operations that create,
  modify, charge, cancel, or disclose business records.
