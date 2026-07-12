# Leigia Blueprint Alignment Audit

Status date: 2026-07-11

This audit compares the current Lia AI chatbot platform against
`LEIGIA_SAAS_BLUEPRINT.md` after the 15 flow-builder phases. Its purpose is to
turn the blueprint into a concrete hardening backlog before beta or production
launch work begins.

## Summary

The app is broadly aligned with the Leigia SaaS blueprint for an early SaaS
product. It has a shared multi-tenant codebase, platform admin, companies,
memberships, hidden default workspaces, project-scoped chatbot data, tenant
disable behavior, invitations, audit logs, and a large project-scoped flow
builder/runtime.

The biggest remaining blueprint gaps are not more builder features. They are
production SaaS hardening:

- Browser E2E coverage for core tenant workflows.
- Expanded real database-backed tenant isolation tests.
- A formal production operations checklist.
- Domain mapping and custom-domain strategy.
- Billing/plans/subscription state.
- Optional PostgreSQL RLS planning.
- More consistent reusable SaaS module boundaries.

## Tenant Hierarchy

Blueprint target:

```text
Platform
  Company
    Workspace
      Location
```

Current Lia AI mapping:

```text
Platform
  Company / Account
    Workspace
      Project / Chatbot
```

Status: Partial, acceptable for current product scope.

Evidence:

- `src/lib/platform-admin.ts`
- `src/lib/companies.ts`
- `src/lib/workspaces.ts`
- `src/lib/projects.ts`
- `src/lib/auth-project.ts`
- `/platform`
- `/profile`
- `/projects`

Notes:

- The blueprint says Workspace is the main business unit. In this app, Project
  is the customer-visible chatbot/business unit.
- `SCOPE.md` intentionally says the existing workspace table should stay an
  internal default container unless a real customer need appears.
- This is a reasonable simplification for Lia AI. Do not expose "Workspace" in
  the UI yet.

Required next work:

- Keep documenting Project as the product-facing workspace equivalent.
- Avoid adding Location until there is a concrete operational endpoint need,
  such as store/branch/location-specific widgets, WhatsApp numbers, or teams.

## Roles And Permissions

Blueprint target:

- `PLATFORM_ADMIN`
- `COMPANY_OWNER`
- `WORKSPACE_MANAGER`
- `LOCATION_OPERATOR`

Current status: Partial, intentionally minimal.

Evidence:

- `src/lib/access-control.ts`
- `src/lib/companies.ts`
- `src/lib/platform-admin.ts`
- `src/lib/invitations.ts`

Current behavior:

- Platform access is controlled by `PLATFORM_ADMIN_EMAILS`.
- Customer tenant access is mostly `COMPANY_OWNER`.
- The permission matrix exists and checks permissions such as:
  - `company.project.manage`
  - `company.documents.manage`
  - `company.widget.manage`
  - `company.operations.manage`
  - `company.members.manage`
  - `audit.view`

Notes:

- This matches the blueprint's guidance to keep roles minimal until real
  workflows prove more are needed.
- Roles can be expanded later because access flows through membership and
  permission helpers.

Required next work:

- Add tests for the permission matrix.
- Defer manager/operator roles until the app has real staff workflows that need
  reduced permissions.

## Membership Rules

Blueprint target:

- Users can belong to multiple tenants.
- Membership belongs to one scope.
- Tenant switching should be deliberate.
- Do not hard-delete users when referenced by logs/reports.

Current status: Good foundation.

Evidence:

- `src/lib/companies.ts`
- `src/lib/invitations.ts`
- `src/lib/auth-project.ts`
- `/profile`
- `/team`
- `/team/invite`
- `/team/members/[membershipId]`

Current behavior:

- Users can belong to multiple active companies.
- Active company context is selected through a cookie and resolved centrally.
- Invitations create or update memberships.
- Member access can be enabled or disabled.

Required next work:

- Browser E2E tests for multi-company switching.
- Browser E2E tests for disabled member access.
- Decide whether historical membership reassignment needs a dedicated audit
  report before production.

## Domain Routing

Blueprint target:

- Central platform domain.
- Company subdomains.
- Custom company domains.
- Domain resolution with active/disabled status and purpose.

Current status: Deferred.

Evidence:

- Widget allowed-domain support exists in `src/lib/widget-keys.ts`.
- No dedicated `domains` model/module exists yet.
- `SCOPE.md` explicitly defers domain mapping and custom domains.

Notes:

- This is acceptable for current local/beta usage.
- Widget allowed domains are not the same thing as tenant domain routing.

Required next work:

- Create a domain strategy document before implementation.
- Add a `domains` module/table only when needed for custom company domains or
  tenant-specific public/admin hosts.
- Keep admin login on custom domains deferred until session/cookie behavior is
  deliberately hardened.

## Data Model And Tenant Scope

Blueprint target:

- Tenant-owned records include company/workspace/project scope.
- Queries always apply explicit tenant scope.
- Unique indexes include tenant scope where needed.
- Audit logs are append-only.

Current status: Good foundation, needs audit completion.

Evidence:

- `src/lib/db-schema.ts`
- `src/lib/auth-project.ts`
- `scripts/check-tenant-scope.mjs`
- `scripts/test-tenant-isolation.mjs`

Current behavior:

- Company-owned tables use `company_id`.
- Project-owned tables use `project_id`.
- Projects belong to workspaces; workspaces belong to companies.
- Tenant-scope static scan exists.
- Database-backed isolation script exists.
- Audit logs include user, membership, company, workspace, and project scope.

Required next work:

- Expand `scripts/test-tenant-isolation.mjs` to cover newer Phase 7-15 tables:
  media assets, product catalogs/products, contacts/tags, channel
  conversations/messages, flow versions, branch rules, templates/adoption
  metadata, and handoff-related records.
- Review unique indexes for tenant-scoped uniqueness.
- Add a short RLS readiness note that lists tables suitable for future RLS.

## Access Control Flow

Blueprint target:

1. Resolve session.
2. Resolve domain context if needed.
3. Resolve active membership.
4. Check role permission.
5. Apply tenant scope to the query.
6. Write audit log for sensitive changes.

Current status: Good foundation, with domain context deferred.

Evidence:

- `src/lib/auth-project.ts`
- `src/lib/access-control.ts`
- `src/lib/audit.ts`
- Project route actions under `src/app/projects/**/actions.ts`
- Platform actions under `src/app/platform/**`

Required next work:

- Browser E2E test protected-route behavior for unauthenticated, disabled
  tenant, disabled member, and wrong-tenant access.
- Continue avoiding route-specific custom auth where shared helpers exist.

## Shared Module Boundaries

Blueprint target modules:

```text
lib/tenant-context
lib/access-control
lib/auth
lib/audit
lib/domains
lib/billing
lib/forms
lib/validation
lib/money
lib/dates
lib/reports
components/app-shell
components/action-menu
components/forms
components/status
tests/e2e
```

Current status: Partial.

Existing equivalents:

- `lib/access-control`: `src/lib/access-control.ts`
- `lib/auth`: split across NextAuth config and `src/lib/auth-project.ts`
- `lib/audit`: `src/lib/audit.ts`
- `lib/tenant-context`: partly `src/lib/auth-project.ts`,
  `src/lib/companies.ts`, and `src/lib/workspaces.ts`
- `lib/reports`: partly analytics/reporting helpers
- `lib/validation`: product-specific validation modules exist for flow/runtime
  validation
- `components/forms`: partial, including `FormSubmitButton`
- `components/status`: partial, currently mostly inline badges/status UI

Missing or deferred:

- `lib/domains`
- `lib/billing`
- `lib/money`
- `lib/dates`
- `components/app-shell` as a fully reusable shell boundary
- `components/action-menu` as a consistent dropdown/action pattern
- `tests/e2e`

Required next work:

- Do not rename modules immediately. First document equivalences and add tests.
- Add `lib/domains` and `lib/billing` only when the product needs those
  capabilities.
- Extract shared app shell/action menu/status components only when duplicate UI
  starts slowing implementation.

## Route Design

Blueprint target:

- Dashboards and management screens are separate.
- Create/edit routes are focused.
- Navigation is role-aware.

Current status: Good foundation, needs polish.

Evidence:

- `/platform`
- `/platform/companies/[companyId]`
- `/profile`
- `/team`
- `/team/invite`
- `/projects`
- `/projects/[projectId]`
- `/projects/[projectId]/settings`
- `/projects/actions/**`
- `/projects/templates`

Notes:

- The app has improved route separation.
- Some project pages still combine list, create, and management workflows where
  early speed was useful.

Required next work:

- During beta hardening, review high-traffic pages for "dashboard plus form"
  clutter.
- Keep creation/editing on focused routes for new business-critical features.

## UI And Form Standards

Blueprint target:

- Tailwind and shadcn/Radix.
- Reusable form/action/status components.
- Inline validation near fields.
- Loading state on mutating buttons.

Current status: Partial to good.

Evidence:

- `src/components/ui/**`
- `src/components/ui/form-submit-button.tsx`
- Existing Radix/shadcn dependency set in `package.json`

Required next work:

- Audit forms for global-only error messages where field-level errors would be
  clearer.
- Add a reusable action menu/status badge pattern before more admin pages are
  added.
- Avoid broad UI refactors until beta flows are verified.

## Audit And Compliance

Blueprint target:

- Audit invitations, membership changes, password reset, tenant changes,
  domain changes, subscription changes, data export, and audit access/export.

Current status: Good foundation, with known gaps.

Evidence:

- `src/lib/audit.ts`
- `src/app/projects/audit`
- Widespread `writeAuditLog` usage in tenant/project actions.

Known gaps:

- Domain actions are deferred, so domain audit is not applicable yet.
- Billing/subscription actions are deferred.
- Audit log export UI is missing.
- Audit log view/export by platform users should get explicit events before
  production.

Required next work:

- Add audit events for audit-log viewing/export once export exists.
- Add platform support-access audit rules before adding support impersonation or
  broader cross-tenant support tools.

## Testing Standard

Blueprint target:

Minimum E2E:

- Platform admin can log in.
- Platform admin can create a company.
- Company owner can create workspace/location.
- Company owner can invite or assign users.
- Manager/operator can access only permitted routes.
- Tenant A cannot access tenant B data.
- Domain A cannot show domain B context.
- Customer/public flow works for the intended domain or link.

Current status: Partial.

Evidence:

- `scripts/check-tenant-scope.mjs`
- `scripts/test-tenant-isolation.mjs`
- No browser E2E test suite exists yet.

Required next work:

- Add browser E2E infrastructure.
- Add tests for:
  - sign-up and default company/project creation
  - platform admin access
  - tenant disable behavior
  - team invite/accept
  - cross-tenant route denial
  - widget token access and domain allowlist
  - project chat action submission
  - widget action submission
- Keep `scripts/test-tenant-isolation.mjs` as a fast database guardrail, but do
  not treat it as a full E2E substitute.

## Operational Standard

Blueprint target:

- Repeatable migrations.
- Production backups.
- Separate staging database.
- Shared-store rate limiting if needed.
- Deployment branch rules.
- Documented env vars.
- Intentional Vercel domains.
- Tenant isolation tests.
- Restore procedure.

Current status: Partial.

Evidence:

- Migrations exist.
- README documents local env vars.
- Widget rate limiting exists.
- `vercel.json` exists.
- Tenant checks exist.

Required next work:

- Create `BETA_READINESS_CHECKLIST.md`.
- Add production/staging environment checklist.
- Document backup and restore procedure.
- Decide where rate limiting state should live for production scale.
- Document WhatsApp webhook, upload queue, cron, OpenAI, SMTP, and public media
  URL requirements.

## Deferred Business SaaS Work

These are intentionally not blockers for internal beta, but they are blockers
for running a paid SaaS business:

- Billing plans and subscriptions.
- Trial state and feature limits.
- Subscription status on companies.
- Platform plan management.
- Payment provider integration.
- Domain/custom-domain management.
- Production support-access model.

## Recommended Implementation Backlog

### Blueprint Hardening 1: E2E And Isolation Foundation

Priority: Highest

Why:

Tenant isolation is the SaaS trust boundary. Feature completeness does not
matter if cross-tenant leakage is possible.

Deliverables:

- Expand `scripts/test-tenant-isolation.mjs` for all major tenant-owned tables.
- Add browser E2E infrastructure.
- Add E2E tests for signup, project creation, tenant disable, invite, widget,
  and action submission.
- Keep `npm run check:tenant-scope`, `npm run test:tenant-isolation`, and E2E
  commands documented together.

### Blueprint Hardening 2: Production Operations Checklist

Priority: High

Deliverables:

- Create `BETA_READINESS_CHECKLIST.md`.
- Document env vars by local/staging/production.
- Document backup and restore.
- Document deployment and migration flow.
- Document webhook/cron/public URL requirements.

### Blueprint Hardening 3: SaaS Admin Readiness

Priority: High

Deliverables:

- Review `/platform` tenant management against blueprint routes.
- Add missing platform audit events.
- Add tenant detail action coverage for support workflows.
- Confirm disabled tenant behavior across app, widget, API, and WhatsApp.

### Blueprint Hardening 4: Billing And Plans Design

Priority: Medium before paid launch

Deliverables:

- Design company subscription state.
- Define plan limits for projects, documents, messages, storage, WhatsApp
  channels, team members, and operations.
- Add billing module only after the data model is agreed.

### Blueprint Hardening 5: Domains Strategy

Priority: Medium before custom-domain launch

Deliverables:

- Design domain table and resolution helper.
- Decide central, subdomain, and custom-domain behavior.
- Keep admin-on-custom-domain deferred until cookies/session rules are safe.
- Add domain resolution tests before enabling.

### Blueprint Hardening 6: RLS Readiness

Priority: Medium

Deliverables:

- List tenant-owned tables and current scope columns.
- Decide which tables should get RLS first.
- Ensure query helpers already pass scope in a way compatible with RLS.
- Defer actual RLS migration until testing and deployment process are mature.

## Decision

The app should enter a new "Blueprint Hardening" track before adding more
builder features. The first implementation target should be testing and tenant
isolation, followed by production operations readiness. Billing, domains, and
RLS should remain planned but not started until the core beta safety checks are
in place.
