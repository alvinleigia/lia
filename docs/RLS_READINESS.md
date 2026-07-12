# RLS Readiness

Status date: 2026-07-12

This document starts Blueprint Hardening 6/6. It prepares the app for future
PostgreSQL row-level security without enabling RLS yet.

## Current Decision

RLS migration remains deferred until the test, migration and deployment process
is mature. For now, the app continues to enforce tenant isolation through scoped
query helpers, static checks and database-backed isolation tests.

## Scope Model

Current tenant hierarchy:

```text
companies
  -> workspaces
    -> projects
      -> project-owned runtime and builder tables
```

Scope columns currently used:

- Company scope: `company_id`
- Workspace scope: `workspace_id`
- Project scope: `project_id`
- User-owned auth/support scope: `user_id`

## Tenant-Owned Tables

Company-scoped tables:

| Table | Scope Column | Notes |
| --- | --- | --- |
| `companies` | `id` | Tenant root. |
| `company_memberships` | `company_id` | Company user access. |
| `company_invitations` | `company_id` | Pending tenant invites. |
| `workspaces` | `company_id` | Current app usually creates one default workspace. |
| `audit_logs` | `company_id` | May also include workspace/project scope. |

Workspace-scoped tables:

| Table | Scope Column | Notes |
| --- | --- | --- |
| `projects` | `workspace_id` | Project tenant boundary comes through workspace. |

Project-scoped tables:

| Table | Scope Column | Notes |
| --- | --- | --- |
| `project_widget_keys` | `project_id` | Public widget token configuration. |
| `integration_providers` | `project_id` | External provider configuration. |
| `operations` | `project_id` | Business operation definitions. |
| `project_actions` | `project_id` | Flow/action definitions. |
| `action_flow_steps` | `project_id` | Flow nodes/steps. |
| `action_flow_branch_rules` | `project_id` | Flow branching. |
| `action_flow_versions` | `project_id` | Published flow snapshots. |
| `action_submissions` | `project_id` | Runtime submissions. |
| `action_submission_events` | `project_id` | Submission event log. |
| `project_channels` | `project_id` | Widget/WhatsApp/project chat channel config. |
| `channel_conversations` | `project_id` | Channel conversation records. |
| `contacts` | `project_id` | Channel/contact identity. |
| `contact_attributes` | `project_id` | Contact profile values. |
| `contact_tags` | `project_id` | Tenant-defined tags. |
| `contact_tag_assignments` | `project_id` | Tag/contact join rows. |
| `channel_messages` | `project_id` | Channel transcript. |
| `media_assets` | `project_id` | Uploaded media assets. |
| `product_catalogs` | `project_id` | Product catalog definitions. |
| `catalog_products` | `project_id` | Products in a catalog. |
| `operation_attempts` | `project_id` | Operation execution attempts. |
| `chat_request_logs` | `project_id` | Chat/widget request analytics. |
| `source_documents` | `project_id` | Uploaded source files. |
| `upload_jobs` | `project_id` | Upload processing queue. |
| `documents` | `project_id` | Vector chunks / indexed document content. |

User/auth-owned tables:

| Table | Scope Column | Notes |
| --- | --- | --- |
| `users` | `id` | Global identity record, not tenant-owned by itself. |
| `password_reset_tokens` | `user_id` | Auth support table. |

Global/non-tenant tables:

| Table | Scope Column | Notes |
| --- | --- | --- |
| `widget_rate_limits` | token/ip/window | Runtime throttling, not tenant-owned directly. |

## Current Gaps Before RLS

- Most project-owned tables have direct `project_id`, which is RLS-friendly.
- `projects` need policies that join or derive company through `workspaces`.
- `companies`, `workspaces`, memberships and invitations need company-level
  policies.
- Public runtime paths such as widget and WhatsApp need carefully designed
  service-role or token-aware policies before RLS can be enabled.
- Background jobs such as upload processing need a deliberate database role or
  transaction setting strategy.

## Recommended RLS Waves

Wave 1: tenant roots and low-risk project-owned data.

| Table | Reason |
| --- | --- |
| `companies` | Root tenant table. |
| `company_memberships` | Controls tenant access. |
| `company_invitations` | Invite data must stay company-scoped. |
| `workspaces` | Bridges company scope to projects. |
| `projects` | Main project boundary. |
| `project_actions` | Direct `project_id`; core builder data. |
| `action_flow_steps` | Direct `project_id`; builder data. |
| `action_flow_branch_rules` | Direct `project_id`; builder data. |
| `action_flow_versions` | Direct `project_id`; published builder data. |
| `source_documents` | Direct `project_id`; uploaded tenant knowledge. |
| `documents` | Direct `project_id`; vector/indexed content. |
| `media_assets` | Direct `project_id`; tenant media. |
| `product_catalogs` | Direct `project_id`; catalog data. |
| `catalog_products` | Direct `project_id`; catalog item data. |

Wave 2: runtime records and analytics.

| Table | Reason |
| --- | --- |
| `action_submissions` | Runtime data; direct `project_id`. |
| `action_submission_events` | Runtime event log; direct `project_id`. |
| `channel_conversations` | Runtime contact conversation data. |
| `contacts` | Runtime identity data. |
| `contact_attributes` | Contact profile data. |
| `contact_tags` | Project-defined tags. |
| `contact_tag_assignments` | Contact/tag join rows. |
| `channel_messages` | Transcript data; higher sensitivity. |
| `chat_request_logs` | Analytics data. |
| `audit_logs` | Company/workspace/project scoped audit data. |

Wave 3: integrations, operations, public runtime and background work.

| Table | Reason |
| --- | --- |
| `project_widget_keys` | Public token runtime needs careful policy design. |
| `project_channels` | Widget/WhatsApp runtime needs service access. |
| `integration_providers` | Provider secrets/config require extra care. |
| `operations` | External operation definitions. |
| `operation_attempts` | Runtime retry/audit data. |
| `upload_jobs` | Background worker access needs a service-role strategy. |

Deferred or separate policy design:

- `users`
- `password_reset_tokens`
- `widget_rate_limits`

These are not company-owned in the same direct way and should be handled as
auth/global service tables.

## Query Helper Compatibility

Current status: compatible as a pre-RLS foundation.

Verification command:

```bash
npm run check:tenant-scope
```

Latest result:

- Schema scope checks passed for 29 tenant-owned tables.
- Critical resolver/API/helper checks passed.
- Direct scoped table access scan passed.

The current app already follows the shape future RLS policies will need:

- Signed-in app routes resolve `company`, `workspace` and `project` through
  `resolveUserAndProject`.
- Project helpers generally require `workspace_id` or `project_id`.
- Company helpers require `company_id`.
- Public widget access resolves project context from the widget token first.
- WhatsApp access resolves project context from active channel configuration.
- Background upload processing carries `project_id` from the claimed job.

Known exceptions that need explicit RLS policy/service-role design later:

- Invitation acceptance resolves company context from a one-time token hash.
- Widget token lookup resolves project context from a token hash.
- WhatsApp webhook lookup resolves project context from Meta phone number id or
  verify token.
- Upload queue workers claim queued jobs across projects and then carry
  `project_id` forward.
- Chat log retention/error logging can operate across projects.

These exceptions are acceptable before RLS because they are intentional runtime
entry points, but they should not be covered by the first RLS migration wave
without a service-role or token-aware policy design.

## RLS Migration Deferral

Actual RLS migration is deferred.

Do not enable PostgreSQL RLS until all of the following are ready:

- A staging database that mirrors production schema and data shape.
- Repeatable migration smoke tests against a clean database.
- Repeatable migration smoke tests against an existing populated database.
- A rollback/restore drill has been performed against staging.
- Runtime service-role strategy is documented for:
  - widget token access
  - WhatsApp webhook access
  - upload queue processing
  - chat analytics/log retention
  - invitation acceptance by token
- E2E coverage passes for:
  - sign up/sign in/project creation
  - tenant disable behavior
  - cross-tenant route denial
  - widget token access
  - project chat runtime
  - widget flow runtime
  - WhatsApp webhook runtime, once live webhook tests exist
- The tenant-scope check and database tenant-isolation test both pass in CI or
  the chosen staging deployment process.

When RLS starts, use a dedicated branch and enable policies in waves. Do not
combine RLS with billing, custom-domain routing or provider-webhook rollout in
the same release.
