# Product Architecture Instructions

This project is a multi-tenant AI chatbot platform. Keep future changes aligned
with the principles below so the product can support many business types without
rewrites.

## Product Direction

The app should become:

- a knowledge assistant powered by project documents and RAG
- a configurable action and flow engine for business tasks
- an integration-friendly platform where external automation tools can plug in

The same core system must support hotels, resorts, spas, salons, car rentals,
restaurants, clinics, service businesses, support teams, and future verticals.
Do not hardcode business-type-specific behavior into the core engine.

## Core Abstractions

Use generic platform primitives:

- Project: tenant/workspace boundary
- Knowledge Base: documents and embeddings scoped to a project
- Action: a user goal, such as book stay, rent car, reserve table, get quote
- Flow: the ordered or conditional steps needed to complete an action
- Field: structured data collected from the user
- Operation: a live or backend business task, such as check availability, get
  booking status, calculate quote, create booking, cancel booking, send payment
  link, notify staff, or create support ticket
- Integration Provider: how an operation runs, such as internal save, email,
  webhook, n8n webhook, external API, calendar, CRM, PMS, or payment provider
- Submission: the saved record of a completed or in-progress action
- Status: lifecycle state of a submission or operation

Actions, flows, fields, operations, and submissions should be generic and
project-scoped.

## Database Tenancy

Use one shared database by default. Scope project-owned records with
`project_id`.

Default model:

- one database
- many projects
- every tenant-owned table includes `project_id`
- every query that reads or mutates tenant data must be scoped to the selected
  project

Do not create a separate database per project for normal usage. Dedicated
databases may be considered later only for enterprise isolation, compliance,
region, or scale requirements.

## Action And Flow Engine

Build the action system around generic flow steps, not industry-specific flows.

Recommended step types:

- message
- collect_input
- choice
- date
- date_range
- time
- number
- email
- phone
- location
- file_upload
- branch
- operation
- display_result
- confirmation
- submit
- payment
- handoff

Start with simple linear flows. Add conditional branching later using
`next_step_id` and rule-based conditions. Keep the internal model compatible
with a node/edge graph even if the first admin UI is a simple vertical builder.

The chatbot should:

- answer knowledge questions from documents
- detect when a user wants an action
- start the matching action flow
- collect missing fields conversationally or through structured UI
- confirm before submission
- store submissions and operation events

The chatbot must not invent live business data. If a user asks about live
availability, booking status, pricing, cancellation state, or similar dynamic
data, the app should run an operation or hand off gracefully.

## Operations

Prefer a generic `operation` abstraction over one-off step types like only
`availability_check`.

Operations should cover read and write business tasks:

- check availability
- get booking status
- get order or rental status
- calculate quote
- fetch available services/resources
- create booking or request
- modify booking
- cancel booking
- create support ticket
- send payment link
- verify payment
- notify staff

Each operation should have:

- operation type
- provider
- input mapping from collected fields/context
- output mapping into flow fields/context
- success and failure routing
- execution logs

Initial providers can be internal save/email/manual review. Add n8n/webhook and
external API providers later without changing the flow engine.

## n8n Strategy

n8n should be optional and added later as an integration provider, not a hard
dependency and not the guest-facing flow engine.

Our app owns:

- chat UI
- RAG answers
- action detection
- flow state
- field collection
- validation
- templates and overrides
- submission records
- status shown to users

n8n may later handle:

- staff notifications
- email/SMS/WhatsApp
- calendar events
- CRM updates
- PMS or booking engine API calls
- payment workflows
- spreadsheets and other automations

Design operations so a future `n8n_webhook` provider can be added by storing a
webhook URL, secret, input mapping, output mapping, retry behavior, and delivery
logs.

## Templates And Overrides

Use industry templates as accelerators, not as hardcoded product branches.

Templates should create generic actions, flows, fields, operations, suggested
trigger phrases, suggested knowledge documents, and setup checklists.

Recommended MVP approach:

- copy template configuration into the project when selected
- let projects override copied actions and flows
- avoid live inheritance until template versioning is needed

Supported override areas should eventually include:

- action name and description
- active/inactive state
- trigger phrases
- field labels
- required/optional flags
- choices/options
- confirmation messages
- operation providers
- email recipients
- webhook URLs
- status labels

Do not write code like `if industry === "hotel"` for core behavior. A hotel
template should create configured generic actions like "Book Stay" and
"Check Booking Status".

## Development Phases

Preferred roadmap:

1. Generic actions with simple linear flows.
2. Chat-triggered action flows and structured field collection.
3. Save submissions, show admin submission list, and support manual statuses.
4. Add basic email/manual-review operation providers.
5. Add generic operation registry and operation step.
6. Add conditional branching and display-result steps.
7. Add industry templates with project overrides.
8. Add webhook/n8n provider.
9. Add live availability/status/quote operations through providers.
10. Add payments, native integrations, and advanced template versioning.

Keep each phase useful on its own. Avoid building a full n8n clone or visual
workflow canvas too early.

## Simple SaaS Development Scope

Keep the chatbot SaaS simpler than the POS app. The product should feel like:

```text
Platform Admin
  -> Companies / Tenants
      -> Users / Members
      -> Projects / Chatbots
```

Use the existing workspace table as an internal default container only. Do not
show workspace as a product concept unless real customer needs appear.

- [x] Keep `/profile` as the user's account and project hub.
- [x] Keep `/projects` focused on creating and managing chatbot projects.
- [x] Keep `/platform` as a lightweight SaaS owner area for tenant management.
- [x] Add tenant invitations next, with simple company-owner/member access.
- [x] Add account switching for users who belong to multiple active tenants.
- [x] Add a tenant detail page with company users, projects, status, and recent
  audit events.
- [x] Add tenant disable behavior everywhere protected app and public widget
  access can happen.
- [x] Keep customer-facing roles minimal for now: company owner/member only when
  invitations are added.
- [ ] Defer domain mapping, subscriptions, billing plans, custom domains, and
  PostgreSQL RLS until the core SaaS flow is stable.
- [ ] Add browser E2E tests for sign-up, project creation, tenant disable,
  cross-tenant access denial, widget access, and action submissions.

## Design Guardrails

- Keep guest-facing flows polished and simple.
- Keep admin configuration understandable for non-technical users.
- Prefer generic reusable primitives over business-specific one-offs.
- Treat reusable code as a first-class requirement. When adding features, look
  for shared components, server helpers, validation schemas, flow primitives,
  operation runners, and data access functions that can serve multiple business
  types and future phases.
- Avoid copy-pasted implementations across actions, industries, pages, widgets,
  and integrations. Extract common behavior into focused reusable modules once a
  pattern appears.
- Keep reusable abstractions small and practical. Do not overbuild frameworks
  before real usage exists, but do design new code so it can be extended without
  rewriting the same logic elsewhere.
- Persist flow runs, submissions, operation attempts, responses, errors, and
  status changes for debugging and auditability.
- Treat external checks and bookings as operations with explicit success/failure
  behavior.
- Make integrations optional. The product should still work with saved
  submissions and manual staff review.
- Use project scoping everywhere for tenant isolation.
