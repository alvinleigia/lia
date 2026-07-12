# Domains Strategy

Status date: 2026-07-12

This document starts Blueprint Hardening 5/6. DNS and subdomain setup remain
deferred until the domain-resolution model is designed and tested.

## Goals

- Keep the central SaaS app usable without domain routing.
- Prepare for company subdomains and custom company domains.
- Prevent one domain from resolving another company's tenant context.
- Keep admin login on custom domains deferred until auth cookie/session behavior
  is deliberately hardened.
- Make domain resolution testable before any DNS changes.

## Recommended Domain Model

Recommended future table:

```text
company_domains
  id
  company_id
  hostname
  domain_type
  status
  verified_at
  verification_token_hash
  metadata
  created_at
  updated_at
```

Recommended domain types:

- `central`: the main platform/app host.
- `subdomain`: a generated company subdomain under the platform root domain.
- `custom`: a customer-owned hostname pointed at the platform.

Recommended domain statuses:

- `pending`
- `active`
- `disabled`
- `failed_verification`

Rules:

- `hostname` must be normalized to lowercase without protocol, path, query,
  fragment or trailing dot.
- Active hostnames must be globally unique.
- Disabled domains must not resolve tenant context.
- Custom domains must require verification before activation.
- Domain mapping is not the same as widget allowed domains. Widget allowlists
  control where an embed can run; domain mapping controls which tenant a host
  resolves to.

## Resolution Inputs

The resolution helper should accept:

```text
host
centralHost
rootDomain
knownDomains
```

It should return:

```text
kind: central | company_subdomain | custom_domain | unknown
hostname
companyId
subdomain
matchedDomainId
reason
```

The helper should be pure and testable. Database lookup should happen before
calling the resolver, not inside the resolver itself.

## Behavior Decisions

Central platform domain:

- Example: `app.leigia.com`
- Hosts `/platform`, auth, profile, projects and tenant app screens.
- Platform admin access remains on the central domain.
- Cross-tenant switching remains intentional through signed-in company context.
- All authenticated admin/product routes stay central for now:
  - `/platform`
  - `/projects`
  - `/profile`
  - `/team`
  - `/account-disabled`

Company subdomain:

- Example: `tenant-slug.leigia.com`
- Resolves to one company when active.
- Should support public/customer surfaces before admin surfaces.
- Admin login on company subdomains remains deferred.
- First allowed surfaces should be public/runtime only:
  - public chatbot/widget landing surfaces, if added
  - public action/form surfaces, if added
  - future customer-facing booking/order/status pages

Custom company domain:

- Example: `support.customer.com`
- Resolves to one company only after verification.
- Should support public/customer surfaces before admin surfaces.
- Admin login on custom domains remains deferred until cookie/session behavior is
  reviewed for host-only and cross-subdomain rules.
- First allowed surfaces should match company subdomains: public/runtime pages
  only, not product administration.

Unknown domain:

- Must not guess a tenant.
- Should fall back to central behavior only when the host is the configured
  central host.
- Otherwise return no tenant context.

## Route Policy

| Surface | Central Domain | Company Subdomain | Custom Domain |
| --- | --- | --- | --- |
| Auth pages | Allowed | Deferred | Deferred |
| `/platform` | Allowed | Blocked | Blocked |
| `/projects` app | Allowed | Deferred | Deferred |
| `/profile` and `/team` | Allowed | Deferred | Deferred |
| Widget API/token runtime | Allowed by token | Allowed by token | Allowed by token |
| WhatsApp webhook | Central only | Not needed | Not needed |
| Future public pages | Allowed | Allowed when resolved | Allowed when verified |

This keeps the beta app simple: tenant users continue using the central app
domain, while future company/custom domains are prepared for customer-facing
experiences first.

Current status: `src/lib/domains.ts` encodes this as a pure helper. It can
normalize hostnames, resolve central/subdomain/custom/unknown domain context and
reject auth/admin/product surfaces on company/custom domains until routing is
explicitly enabled.

## Implementation Order

1. Add a pure domain normalization and resolution helper.
2. Add tests for central, subdomain, custom, disabled and unknown hosts.
3. Add database table/migration only when UI or runtime needs tenant domain
   routing.
4. Add platform admin domain management UI later under
   `/platform/companies/[companyId]/domains`.
5. Start DNS/subdomain testing only after the helper, table and safety tests are
   in place.

Current test command:

```bash
npm run check:domain-resolution
```
