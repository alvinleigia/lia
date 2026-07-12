# Leigia SaaS Blueprint

This file defines the reusable architecture standard for Leigia SaaS products. Use it when starting a new multi-tenant app, reviewing an existing one, or deciding whether a feature belongs in the shared SaaS foundation or in a product-specific module.

The goal is consistency: every SaaS product should feel familiar to build, test, deploy and support.

## Core Principles

- One codebase should serve many tenants unless a product has strong legal, data residency or enterprise isolation requirements.
- Tenant isolation must be explicit at every layer: route, session, API, service and database query.
- Roles should stay minimal until real workflows prove more are needed.
- Admin flows should use focused pages: dashboards for summaries, separate routes for create/edit/manage actions.
- Shared logic should be extracted only when a pattern appears more than once and the abstraction makes the code easier to read.
- Production safety beats feature speed: auditability, scoped access, backups and predictable deployment flow are part of the product.

## Standard Tenant Hierarchy

Use this hierarchy as the default mental model.

```text
Platform
  Company
    Workspace
      Location
```

Product-specific naming can vary, but the meaning should stay stable.

- `Platform`: the SaaS owner layer. It manages all tenants, plans, domains, platform health and support access.
- `Company`: the customer tenant or parent account. Examples: a restaurant group, agency client, school, clinic or merchant.
- `Workspace`: the main business unit under a company. In Foodie this is a restaurant. In another app it could be a project, store, site, branch group or department.
- `Location`: an operational endpoint under a workspace. In Foodie this is a restaurant location, counter, QR ordering point or service area.
- `Membership`: a user's access assignment to one scope in the hierarchy.
- `Domain`: a host name mapped to a company or public/customer surface.

## Standard Roles

Start with the smallest role set that supports the product.

- `PLATFORM_ADMIN`: manages the SaaS platform, tenants, subscriptions, domains and support views.
- `COMPANY_OWNER`: manages one company and its child workspaces, locations and users.
- `WORKSPACE_MANAGER`: manages a workspace and its operational settings.
- `LOCATION_OPERATOR`: performs day-to-day operational work at a location.

Product-specific aliases are allowed, but keep the underlying permission model consistent. For example, Foodie uses `RESTAURANT_MANAGER` and `ORDER_OPERATOR`.

Avoid adding roles such as `COMPANY_MANAGER`, `SUPPORT_AGENT` or `BILLING_ADMIN` until the app has a real workflow for them.

## Membership Rules

- A user account can have multiple memberships.
- A membership belongs to exactly one scope: platform, company, workspace or location.
- A user should not need multiple accounts for multiple tenants.
- On a company/custom domain, show only memberships that belong to that domain's company.
- On the central platform domain, show only platform access by default. Broader cross-tenant switching should be intentionally designed, not accidental.
- Reassigning a user should disable or replace future access without changing historical orders, logs or reports.
- Do not hard-delete users if their activity is referenced by orders, audit logs or reports.

## Domain Routing Standard

Use this domain strategy unless a product needs something stricter.

```text
Central platform:
  app.leigia.com

Company subdomain:
  {company}.app.leigia.com

Custom company domain:
  customer-domain.com
```

Domain resolution should return:

- matched domain
- company id
- purpose: admin, ordering/public, or both
- active/disabled status
- primary/fallback status

Rules:

- Disabled domains should not resolve tenant context.
- A company domain must never expose another company's context.
- Public ordering can run on custom domains earlier.
- Admin login on custom domains should wait until auth cookie/session behavior is deliberately hardened.
- A missing tenant context should show a helpful "open the correct link" state, not a generic crash.

## Data Model Standard

Every tenant-owned table should include the scope columns needed to enforce access.

Recommended columns:

```text
id
organization_id / company_id
workspace_id
location_id
created_by_user_id
updated_by_user_id
created_at
updated_at
status / is_active
```

Rules:

- Use `company_id` or `organization_id` consistently inside each app.
- Add `workspace_id` only when data belongs below company level.
- Add `location_id` only when operations differ by physical or public endpoint.
- Never query tenant-owned data without an explicit tenant scope.
- Prefer soft-disable for tenant, user and operational records that can have historical references.
- Use indexes on tenant scope columns used in filtering.
- Keep audit logs append-only.

## Access Control Standard

Every protected flow should pass through the same layers.

1. Resolve session.
2. Resolve domain context if the request depends on host name.
3. Resolve active membership.
4. Check role permission.
5. Apply tenant scope to the query.
6. Write audit log for sensitive changes.

Avoid route-specific custom auth code when a shared helper can express the rule clearly.

Example permission names:

```text
platform.company.create
platform.company.update
company.workspace.create
company.user.invite
workspace.menu.manage
location.orders.manage
location.inventory.manage
audit.view
```

## Database Isolation Standard

Minimum production baseline:

- Application-level tenant scoping.
- API-level membership checks.
- Foreign keys for tenant hierarchy.
- Unique indexes that include tenant scope.
- Tests that prove cross-tenant access is blocked.

Defense-in-depth target:

- PostgreSQL Row Level Security for key tenant-owned tables.
- Database roles or session variables for tenant scope.
- Dedicated support-access audit logs.
- Periodic tenant-isolation regression tests.

RLS can be added later, but it is safest to design table columns and query patterns as if RLS will eventually exist.

## Shared Module Boundaries

A reusable SaaS app should have these modules.

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

Recommended responsibilities:

- `tenant-context`: resolve tenant from domain, route, QR slug or session.
- `access-control`: roles, permissions and allowed navigation.
- `auth`: login, session, invite and password reset flows.
- `audit`: append-only audit events and scoped audit views.
- `domains`: company subdomains, custom domains and disabled domain behavior.
- `billing`: plans, trial state, subscription status and feature limits.
- `forms`: shared form state, pending state, inline errors and submit/cancel behavior.
- `validation`: schema validation shared by forms and APIs.
- `money`: currency and price formatting.
- `dates`: tenant timezone and display formatting.
- `reports`: summary cards, CSV/PDF exports and scoped reporting queries.
- `app-shell`: global header, account menu, context switcher and route chrome.
- `action-menu`: consistent quick actions and full dropdown actions.
- `status`: reusable badges for users, tenants, orders, inventory and subscriptions.

## Route Design Standard

Dashboards and management screens should be separate.

```text
/platform
/platform/companies
/platform/companies/new
/platform/companies/[id]
/platform/companies/[id]/users
/platform/companies/[id]/domains
/platform/users/memberships
/audit-logs

/company
/company/restaurants
/company/restaurants/new
/company/users

/restaurant
/restaurant/locations
/restaurant/locations/new
/restaurant/staff

/operations/orders
/operations/menu
/operations/inventory

/order
/order/status
```

Rules:

- A dashboard route should show summary cards and reporting only.
- Create/edit forms should live on focused routes.
- Back/cancel should return to the nearest workflow context.
- Do not hide major workflows behind unrelated dashboard cards.
- Navigation options should be role-aware.

## UI Standard

Use the same design system across all SaaS apps.

- Tailwind for layout and styling.
- shadcn/ui as the base component library.
- Reusable wrappers for buttons, forms, action menus, badges, dialogs and page shells.
- Icons on action buttons where they improve scanability.
- Tooltips for icon-only actions.
- Inline validation near the invalid field.
- Loading states on buttons that submit or mutate data.
- Avoid duplicate controls for the same action unless one is a desktop quick action and the dropdown still contains the full action list.

## Form Standard

Every form should follow the same flow.

1. Validate client-side where practical.
2. Submit through a typed action/API payload.
3. Validate server-side with the same rules.
4. Return field-level errors where possible.
5. Show non-field errors only for global failures.
6. Disable submit while pending.
7. Return to the correct route context on success.

Do not show validation errors in the page header if the error belongs to a specific input.

## Audit And Compliance Standard

Audit these actions by default:

- user invitation
- user reassignment
- user access disable/enable
- password reset link creation
- tenant creation/update/disable
- domain creation/update/disable
- subscription status changes
- menu and inventory changes
- order status transitions
- data export
- audit-log view/export by platform users

Audit logs should include:

- actor user id
- actor role/membership id when available
- company/workspace/location scope
- action name
- target entity
- safe metadata
- timestamp

Avoid storing secrets, passwords, raw tokens, payment data or sensitive customer data in audit metadata.

## Testing Standard

Every SaaS product should have these tests before real customer traffic.

Minimum E2E tests:

- platform admin can log in
- platform admin can create a company
- company owner can create workspace/location
- company owner can invite or assign users
- manager/operator can access only permitted routes
- tenant A cannot access tenant B data
- domain A cannot show domain B context
- customer/public flow works for the intended domain or link

Minimum unit/integration tests:

- role permission matrix
- tenant context resolution
- domain resolution
- form validation
- money/date formatting

## Operational Standard

Before production, confirm:

- database migrations are repeatable
- production database backups exist
- staging database is separate from production
- rate limiting uses a shared store if traffic may scale
- deployment branch rules prevent accidental production pushes
- environment variables are documented but not committed
- Vercel domains are intentionally mapped
- tenant isolation tests pass
- restore procedure is documented

## New SaaS App Checklist

Use this checklist when starting another SaaS product.

- [ ] Define tenant hierarchy names.
- [ ] Decide central platform domain.
- [ ] Decide company subdomain pattern.
- [ ] Define the smallest role set.
- [ ] Create membership model.
- [ ] Create domain mapping model.
- [ ] Create audit log model.
- [ ] Create invite and password reset flow.
- [ ] Create app shell and account menu.
- [ ] Create tenant-scoped query helpers.
- [ ] Create permission matrix.
- [ ] Create first platform dashboard.
- [ ] Create company dashboard.
- [ ] Create focused management routes.
- [ ] Add tenant isolation E2E tests.
- [ ] Add production migration and backup plan.

## Anti-Patterns To Avoid

- Hidden default tenants that appear in real customer UI.
- Hard deletes for users, companies, orders or audit-linked records.
- Route handlers that query tenant data without a scope.
- Role names that are too specific for the underlying permission.
- Forms that show all validation errors in a global banner.
- Admin dashboards that also contain create/edit forms.
- Duplicate navigation paths for the same user-management task.
- Custom one-off UI when a shared shadcn wrapper exists.
- Production and staging sharing the same database.
- Direct pushes to production branches.

## How Foodie Maps To This Blueprint

```text
Platform  -> Foodie Platform
Company   -> Parent company / restaurant group
Workspace -> Restaurant
Location  -> Restaurant location / QR ordering point
Operator  -> Order operator
Manager   -> Restaurant manager
```

Foodie-specific modules such as orders, menu, inventory, modifiers and offers should stay outside the generic SaaS core unless another product needs the same capability.

Shared SaaS modules such as tenant resolution, auth, access control, domains, memberships, audit logs, forms, money formatting and app shell behavior should be reusable across future Leigia SaaS products.
