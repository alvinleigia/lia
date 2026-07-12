# Billing And Plans Design

Status date: 2026-07-12

This document starts Blueprint Hardening 4/6. The goal is to agree the data
shape before adding billing provider code, checkout screens or enforcement.

## Design Principles

- Billing belongs to the company tenant, not to individual projects or users.
- The app should support manual beta plans before any payment provider is wired.
- Plan limits should be enforced through one internal entitlement helper, so
  Stripe, Razorpay or manual admin changes can feed the same product rules.
- A disabled company remains a platform-admin action and is separate from
  subscription status.
- Billing records should be append-friendly for audits instead of only storing
  the latest provider payload.

## Company Subscription State

Recommended first data model:

```text
plans
  id
  code
  name
  description
  status
  limits
  features
  created_at
  updated_at

company_subscriptions
  id
  company_id
  plan_id
  status
  trial_ends_at
  current_period_starts_at
  current_period_ends_at
  cancel_at_period_end
  provider
  provider_customer_id
  provider_subscription_id
  metadata
  created_at
  updated_at

subscription_events
  id
  company_id
  subscription_id
  event_type
  provider
  provider_event_id
  payload
  created_at
```

Recommended subscription statuses:

- `trialing`
- `active`
- `past_due`
- `paused`
- `cancelled`
- `expired`

Recommended plan statuses:

- `draft`
- `active`
- `archived`

For internal beta, subscriptions can be created manually with provider set to
`manual`. Payment providers can be added later without changing the tenant
entitlement path.

## Plan Limit Shape

The `plans.limits` JSON should store explicit numeric limits:

```json
{
  "projects": 3,
  "documents": 100,
  "messagesPerMonth": 10000,
  "storageMb": 1024,
  "whatsappChannels": 1,
  "teamMembers": 3,
  "operations": 20
}
```

Use `null` only when a limit is intentionally unlimited. Avoid missing keys for
active plans because missing keys make enforcement ambiguous.

## Beta Plan Matrix

Recommended initial plans:

| Plan | Projects | Documents | Messages / Month | Storage | WhatsApp Channels | Team Members | Operations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Internal | 10 | 500 | 50000 | 5120 MB | 3 | 10 | 100 |
| Starter | 3 | 100 | 10000 | 1024 MB | 1 | 3 | 20 |
| Growth | 10 | 500 | 50000 | 5120 MB | 3 | 10 | 100 |
| Scale | 25 | 2000 | 250000 | 20480 MB | 10 | 25 | 500 |

Recommended first seed records:

```json
[
  {
    "code": "internal",
    "name": "Internal",
    "status": "active",
    "limits": {
      "projects": 10,
      "documents": 500,
      "messagesPerMonth": 50000,
      "storageMb": 5120,
      "whatsappChannels": 3,
      "teamMembers": 10,
      "operations": 100
    }
  },
  {
    "code": "starter",
    "name": "Starter",
    "status": "active",
    "limits": {
      "projects": 3,
      "documents": 100,
      "messagesPerMonth": 10000,
      "storageMb": 1024,
      "whatsappChannels": 1,
      "teamMembers": 3,
      "operations": 20
    }
  },
  {
    "code": "growth",
    "name": "Growth",
    "status": "active",
    "limits": {
      "projects": 10,
      "documents": 500,
      "messagesPerMonth": 50000,
      "storageMb": 5120,
      "whatsappChannels": 3,
      "teamMembers": 10,
      "operations": 100
    }
  },
  {
    "code": "scale",
    "name": "Scale",
    "status": "active",
    "limits": {
      "projects": 25,
      "documents": 2000,
      "messagesPerMonth": 250000,
      "storageMb": 20480,
      "whatsappChannels": 10,
      "teamMembers": 25,
      "operations": 500
    }
  }
]
```

Recommended counter mapping:

- `projects`: non-archived rows in `projects` for the company.
- `documents`: rows in `source_documents` for all company projects.
- `messagesPerMonth`: rows in chat/channel logs created during the current
  subscription period, counting project chat, widget and WhatsApp messages.
- `storageMb`: sum of uploaded source files and `media_assets.size_bytes`.
- `whatsappChannels`: active `project_channels` rows with channel type
  `whatsapp`.
- `teamMembers`: active rows in `company_memberships`.
- `operations`: active rows in `operations` for all company projects.

Recommended beta enforcement behavior:

- Hard-block new creates once a tenant reaches projects, documents, storage,
  WhatsApp channels, team members or operations limits.
- Soft-warn at 80% of any limit in the UI once the billing module exists.
- Hard-block runtime messages only after manual review during early beta; before
  that, surface overage in platform admin so real users are not interrupted
  unexpectedly.
- Platform admins can temporarily assign the `internal` plan for support,
  demos and migration testing.

The `plans.features` JSON should store boolean or named capabilities:

```json
{
  "widget": true,
  "whatsapp": false,
  "flowBuilder": true,
  "analytics": true,
  "customDomains": false
}
```

## Enforcement Points

When implementation starts, add an internal billing/entitlement helper before
touching UI:

```text
src/lib/billing/plans.ts
src/lib/billing/entitlements.ts
src/lib/billing/usage.ts
```

Current status: the provider-neutral helper module exists with beta plan
definitions, feature checks and pure usage-limit evaluation. It does not add
database tables, payment provider code, checkout, invoices or webhooks yet.

Expected checks:

- Project creation checks `projects`.
- Document upload checks `documents` and `storageMb`.
- Chat/widget/WhatsApp runtime counts toward `messagesPerMonth`.
- WhatsApp channel save checks `whatsappChannels`.
- Team invitation/member activation checks `teamMembers`.
- Operation creation checks `operations`.

## Platform Admin Surface

Initial platform billing controls should stay simple:

- View a tenant plan and subscription status.
- Assign or change a manual plan.
- Set trial end date.
- Pause, cancel or reactivate a manual subscription.
- Record every billing status change in audit logs.

Provider checkout, invoices and webhooks should wait until the internal model is
working with manual plans.

## Open Decisions

- Payment provider: Stripe, Razorpay or manual-only for first beta.
- Whether usage counters reset monthly by subscription period or calendar month.
- Whether WhatsApp message usage should count inbound, outbound or both.
