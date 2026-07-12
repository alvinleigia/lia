# SaaS Admin Readiness

Status date: 2026-07-12

This note reviews the current platform admin surface against
`LEIGIA_SAAS_BLUEPRINT.md` before extending SaaS owner workflows.

## Current Platform Surface

Implemented routes:

- `/platform`
- `/platform/companies/[companyId]`

Implemented SaaS admin capabilities:

- Platform admin access is restricted by `PLATFORM_ADMIN_EMAILS`.
- Tenant companies can be listed with owner, member count, project count and
  status.
- Tenant companies can be enabled or disabled.
- Tenant detail pages show status, owner and created date.
- Tenant members can be listed and enabled or disabled.
- Tenant invitations can be created and cancelled.
- Tenant projects can be listed for support visibility.

Current platform actions write audit events for:

- `platform.tenants_reviewed`
- `platform.tenant_reviewed`
- `platform.tenant_status_updated`
- `platform.company_invitation.created`
- `platform.company_invitation.cancelled`
- `platform.company_member.status_updated`

## Blueprint Comparison

The blueprint route standard separates dashboards from management screens:

- `/platform`
- `/platform/companies`
- `/platform/companies/new`
- `/platform/companies/[id]`
- `/platform/companies/[id]/users`
- `/platform/companies/[id]/domains`
- `/platform/users/memberships`
- `/audit-logs`

The current app intentionally keeps the first beta platform admin surface
smaller:

- `/platform` currently combines the dashboard and tenant list.
- `/platform/companies/[companyId]` combines tenant summary, members,
  invitations and project visibility.
- Company creation, domain management, platform-wide user membership browsing
  and audit-log export are not implemented yet.

This is acceptable for the current simple SaaS setup, but the combined views
should be split before the admin surface becomes busy.

## Confirmed Boundaries

- No support impersonation has been added.
- Platform admins can inspect tenant metadata and manage access, but they do not
  directly edit tenant chatbot content from the platform area.
- Custom domains and subdomain testing remain deferred until Blueprint
  Hardening 5/6.
- Billing, plans and feature limits remain deferred until the billing design
  phase.

## Gaps To Close Next

1. Decide whether `/platform/companies` should be split from `/platform` before
   beta or left as a post-beta usability improvement.

## E2E Coverage

`tests/e2e/auth-project.spec.ts` covers platform support workflows for:

- platform admin access
- tenant list visibility
- tenant disable behavior
- tenant detail project visibility
- tenant member disable/enable
- tenant invitation create/cancel
- disabled tenant app redirect
- disabled tenant widget runtime block
- disabled tenant API runtime block
- disabled tenant WhatsApp verification block
