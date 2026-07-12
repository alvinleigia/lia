# Lia AI Chatbot Platform

Lia AI is a multi-project AI chatbot platform built with Next.js, Drizzle, Postgres, pgvector, and the Vercel AI SDK. It supports project-scoped document knowledge bases, RAG chat, embeddable website widgets, configurable action flows, and saved submissions.

## What Is Included

- User authentication with credentials, Google, and password reset.
- SaaS-style companies, company memberships, and default workspaces.
- Project management with active project selection, rename, archive, and unarchive.
- Project-scoped document upload for PDF, Markdown, and text files.
- Project-scoped media library for reusable images, videos, audio, PDFs, and
  common files.
- Project-scoped product catalog foundation, product message blocks,
  product-selection capture, and native WhatsApp product messages when Meta
  catalog ids are configured.
- WhatsApp template message blocks with template name, language, approval
  status, Meta body samples, body variable compatibility checks, text fallback,
  and native approved-template sends.
- Background document indexing with chunking and OpenAI embeddings.
- RAG chat over uploaded project documents.
- Public embeddable chat widget with token security and optional domain allowlist.
- Widget rate limiting.
- Project-scoped channel conversation/message foundation for widget, project
  chat, and future WhatsApp-style channels.
- Action builder for generic branched flows.
- Outbound Media action steps that can send reusable project media assets with
  text fallback and native WhatsApp media sends by public link.
- Ask Media/file-upload steps for project chat, widget flows, and WhatsApp
  inbound media references.
- Conditional branch rule data model, admin configuration, and runtime
  execution.
- Action templates with marketplace filtering, version metadata, and bundled
  spa/salon/hotel/restaurant/support/lead examples.
- Client-side action flow runtime with field validation and review/confirm.
- Server-side action flow validation, custom validation messages, and validation failure events.
- Submission saving, detail view, status workflow, operation attempts, and event logs.
- Generic operation/provider management with webhook and n8n webhook execution logs.
- Append-only audit logs for sensitive tenant, project, widget, document, action, and password reset changes.
- Read-only audit log view for recent company-scoped events.
- Basic chat analytics for request volume, latency, errors, and token usage.

## Tech Stack

- Next.js 15 App Router
- React 19
- TypeScript
- Drizzle ORM
- PostgreSQL with pgvector
- OpenAI through the AI SDK
- NextAuth v5 beta
- Tailwind CSS and shadcn/Radix UI
- SMTP2GO for password reset email

## Prerequisites

- Node.js 20 or newer
- npm
- PostgreSQL with the pgvector extension enabled
- OpenAI API key

## Environment Variables

Create `.env.local` in the project root.

```env
DATABASE_URL="postgres://USER:PASSWORD@HOST:PORT/DATABASE"
OPENAI_API_KEY="sk-..."

AUTH_SECRET="replace-with-a-long-random-secret"
NEXTAUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Comma-separated SaaS owner emails for /platform
PLATFORM_ADMIN_EMAILS="owner@example.com"

# Optional Google login
AUTH_GOOGLE_ID=""
AUTH_GOOGLE_SECRET=""

# Optional password reset email
SMTP2GO_API_KEY=""
MAIL_FROM="Lia AI <no-reply@example.com>"

# Optional upload queue endpoint protection
CRON_SECRET=""
UPLOAD_QUEUE_SECRET=""
```

Notes:

- `DATABASE_URL` is required by Drizzle and the app runtime.
- `OPENAI_API_KEY` is required for chat, embeddings, and document indexing.
- `NEXT_PUBLIC_APP_URL` is required for widget snippets and password reset links.
- `PLATFORM_ADMIN_EMAILS` controls who can access the lightweight SaaS admin area.
- SMTP variables are only needed if you want password reset emails to send.
- Google variables are only needed if you want Google sign-in to work.

## Install

```bash
npm install
```

## Database Setup

Make sure your Postgres database has pgvector enabled:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Apply migrations:

```bash
npx drizzle-kit migrate
```

Production and staging should also follow the database safety notes in
[`docs/OPERATIONS_READINESS.md`](docs/OPERATIONS_READINESS.md).

If you need to inspect or generate schema changes later:

```bash
npx drizzle-kit studio
```

## Run The App

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

The signed-out home page is Lia branded and links to sign up, sign in, and the project workspace.

## SaaS Tenancy Model

The app now uses this ownership model:

```text
User
  -> Company / Account
      -> Membership
      -> Workspace
          -> Projects
          -> Documents
          -> Actions
          -> Operations
          -> Submissions
          -> Widget
          -> Analytics
```

Current behavior:

- Each user gets a default company/account.
- Each company has an active `COMPANY_OWNER` membership for its creator.
- Each company gets an internal default workspace that is hidden from the UI.
- Users manage projects directly under their account/company.
- Users who belong to multiple active accounts can switch account context from
  the header; project selection is then limited to that account.
- Each project represents one chatbot configuration and deployment unit.
- Chatbot-owned data remains scoped by `project_id`.
- Project access is resolved through centralized helpers so future permission checks can be added in one place.
- Sensitive changes are written to append-only audit logs with actor and tenant scope when available.

Roles are intentionally minimal in the UI. The database now has company memberships, so team access can be added later by expanding membership roles and checking permissions in the central tenant helpers. The project, document, action, submission, widget, and analytics layers should not need a major rewrite if access continues to flow through those helpers.

## Main Product Areas

### Profile

Go to `/profile`.

Use this area to:

- Review your user/account details.
- Switch accounts from the header if you belong to multiple tenants.
- See active chatbot projects.
- Create a new project/chatbot.
- Invite teammates to the account.
- Review members and pending invitations.
- Enable or disable member access.

### Projects

Go to `/projects`.

Use this area to:

- Create projects.
- Select the active project.
- Archive or unarchive projects.
- Rename a project from `/projects/[projectId]`.

Projects are the main chatbot units. A single user account can create multiple projects/chatbots inside their workspace.

### Documents

Go to `/projects/documents`.

Use this area to:

- Upload PDF, Markdown, or text files.
- See source documents and chunk counts.
- Process queued documents.
- Delete one document or all documents for the selected project.

Document flow:

1. Upload a supported file.
2. The app stores a source document and queued upload job.
3. Process the queue from the Documents page, or call the queue endpoint.
4. Text is chunked and embedded.
5. The project chat can retrieve matching chunks.

Manual queue endpoint:

```bash
curl -X POST http://localhost:3000/api/upload/process-next \
  -H "Authorization: Bearer YOUR_UPLOAD_QUEUE_SECRET"
```

On Vercel, `vercel.json` schedules this endpoint every minute.

### Media Library

Go to `/projects/media`.

Use this area to:

- Upload reusable media assets for the selected project.
- Store image, video, audio, PDF, text, CSV, JSON, and common Office files.
- Open uploaded assets for testing.
- Archive assets that should no longer be used.

Media assets are stored with `project_id` scope. The current development
storage path is `public/uploads/media/<project_id>/...`; production should move
this to object storage before large customer usage.

### Product Catalog

Go to `/projects/catalog`.

Use this area to:

- Create internal product catalogs for the selected project.
- Add reusable products with SKU, description, image URL, product URL, price,
  and currency.
- Optionally add a WhatsApp Catalog ID and per-product WhatsApp Retailer ID for
  native WhatsApp product messages.
- Archive catalogs or products that should no longer be used.

Catalog and product records are stored with `project_id` scope. They are the
foundation for catalogue, single product, multiple product, and product
selection flow blocks across widget, WhatsApp, and future channels.
Website widget and project chat render product cards from the same catalog
snapshots, with browser layout options for grid, compact list, or a featured
first item. WhatsApp product/catalog blocks send native commerce messages only
when the catalog has a Meta catalog id and products have a WhatsApp retailer id
or SKU; otherwise they use the channel-safe text fallback.

### Chat

Go to `/projects/chat`.

The chat can:

- Answer questions from uploaded project documents.
- Search the knowledge base before answering when relevant.
- Start configured action flows when the user message matches an active action trigger phrase.

If no documents are indexed, the assistant will say that project documents need to be uploaded first.

### Actions

Go to `/projects/actions`.

Use this area to:

- Create a custom action.
- Search and filter bundled action templates by industry or use case.
- Review template version, channel coverage, required fields, and flow preview.
- Apply a template while preserving source template key/version metadata.
- Add or edit flow steps.
- Reorder, duplicate, enable, disable, or delete flow steps.
- Configure default next-step routes and conditional branch rules with canvas
  edge labels, condition previews, and guided field/operator/target editing.
- Review publish readiness warnings for missing prompts, duplicate field keys,
  invalid routes, and missing confirmation/submit paths.
- Configure trigger phrases.
- Mark actions as draft, active, or archived.
- Preview an action flow in the browser without creating a live submission.
- Create a test submission.

Current supported step behavior:

- `message`
- `collect_input`
- `choice`
- `date`
- `date_range`
- `address`
- `time`
- `number`
- `email`
- `phone`
- `location`
- `file_upload`
- `media`
- `template_message`
- `catalog_message`
- `single_product`
- `multiple_products`
- `product_selection`
- `display_result`
- `handoff`
- `connect_flow`
- `confirmation`
- `submit`
- `operation`

Current supported input types:

- `text`
- `email`
- `phone`
- `date`
- `time`
- `int`
- `float`

The runtime can display message/result/handoff text, attach reusable media
assets as media messages with text fallback, send configured media natively on
WhatsApp when the asset URL is publicly reachable, present configured product
messages as browser product cards and native WhatsApp product formatting when
provider ids are present, collect typed answers, product selections, and media
uploads, show choice buttons, pause for confirmation, auto-submit on submit
steps, send approved WhatsApp template messages with configured body variables,
run post-submission operations, and connect one active flow to another with
Connect Flow blocks. Product blocks can choose grid, compact list, or featured browser layouts. Product Selection blocks can
optionally collect quantity or a multi-product cart and store companion
item/quantity/line-total/cart-total fields plus provider checkout handoff
metadata when a native cart checkout adapter is ready. WhatsApp order messages
are normalized into the shared cart answer format. It validates common field
types, structured address/location values, media references, product
selections, and configured product snapshots before saving submissions.
Connect Flow supports
jump mode and return mode, preserves collected fields, records transitions in
submission events, prevents cross-flow loops, and can merge a connected
subflow's fields back into the parent flow before continuing. Flow JSON imports
clear environment-specific Connect Flow action IDs and preserve reconnect
context so admins can choose a valid active flow in the destination project.

Branching configuration:

- Each step can store a default next step.
- Each step can store ordered branch rules with source field, operator,
  comparison value, target step, and enabled flag.
- Disabled steps and disabled branch rules are ignored by live routing.
- The action detail page reports broken default routes, disabled route targets,
  missing prompts, duplicate field keys, and missing terminal paths.
- Project chat and widget chat evaluate branch rules after answers, fall back to
  the default route when no rule matches, and then fall back to step order.
- Submission events include route decisions as `flow.branch_decision`.
- Runtime loop protection stops circular routes with a setup warning.
- The action detail preview runner shows the current step, collected fields,
  branch decisions, reset/replay, and enabled operation steps that would run
  after a real submission.

Channel behavior:

- Project chat and widget action-flow sessions now share a normalized channel
  foundation.
- Action-flow start/progress/submit/cancel events record project-scoped channel
  conversations and messages using the existing conversation id.
- WhatsApp uses the same flow builder/runtime for text, interactive choices,
  approved templates, inbound media references, inbound location messages, and
  service-window enforcement rather than a separate flow engine.
- Request Intervention/Handoff steps move live submissions to Under Review and
  store handoff priority/queue metadata for admin follow-up. They can also run
  a selected operation as the staff notification action.
- Handoff submissions can be claimed/released from the submission detail page,
  and the submissions list includes handoff, queue, assigned-to-me, and
  unassigned filters. `/projects/handoffs` provides a dedicated handoff queue
  with bulk claim/release and status actions.

Validation behavior:

- Supported validations include required fields, email, phone, date, time, whole numbers, decimal numbers, names, and configured options.
- Step settings can define custom required and invalid-value messages.
- Both project chat and widget chat log validation failures on saved in-progress submissions.
- The server revalidates progress and final submission payloads before saving them.
- Flow diagnostics separate blocking errors from non-blocking channel capability warnings, such as WhatsApp media URL and product catalog requirements.

### Contacts

Go to `/projects/contacts`.

Use this area to:

- Review contacts captured from project chat, widget, WhatsApp, and future
  channels.
- Inspect contact attributes and tags created by flows.
- Review linked channel conversations.
- Read the channel-independent message transcript.
- Inspect media references found in stored channel message payloads.
- Open linked flow submissions.

### Operations

Go to `/projects/operations`.

Use this area to:

- Create integration providers.
- Create generic operations.
- Create guided API Request and Meta Conversions operations.
- Enable or disable providers.
- Enable or disable operations.

Current provider types:

- `manual_review`
- `internal_save`
- `email`
- `webhook`
- `n8n_webhook`
- `meta_conversions_api`

Action flow `operation` steps can run inline during a conversation or after a submission is confirmed. Each run is saved as an operation attempt and added to the submission event timeline. Webhook and n8n webhook providers can post submitted payloads to external automation endpoints. Meta Conversions providers post mapped events to the Graph API using project-scoped dataset/token configuration and hash common customer data fields before delivery. Recent attempts can be replayed from the Operations page; failed attempts show as Retry and successful attempts show as Replay.

### Submissions

Go to `/projects/submissions`.

Use this area to:

- Review saved action submissions.
- Inspect collected fields, including media upload/reference details.
- Import submitted WhatsApp media references into the project media library when
  the configured WhatsApp channel can still fetch the media from Meta.
- View submission events.
- Review Connect Flow parent/child relationships, including jump vs return
  mode counts and linked child submissions.
- Update submission status.

Current submission statuses:

- `in_progress`
- `submitted`
- `under_review`
- `completed`
- `rejected`
- `cancelled`

### Widget

Go to `/projects/widget`.

Use this area to:

- Generate or rotate a widget token.
- Enable or disable a token.
- Configure allowed domains.
- Copy the embed snippet.

Example snippet:

```html
<script
  src="http://localhost:3000/widget.js"
  data-token="YOUR_WIDGET_TOKEN"
  data-base-url="http://localhost:3000"
></script>
```

The widget loads `/widget/embed?token=...` inside an iframe and sends chat requests to `/api/widget/chat`.

### Analytics

Go to `/projects/analytics`.

The analytics page shows:

- Last 24 hours
- Last 7 days
- Last 30 days
- Route breakdown for chat and widget requests

Metrics come from `chat_request_logs`.

### Audit Logs

Go to `/projects/audit`.

The audit page shows recent company-scoped events for sensitive changes,
including project changes, document management, widget configuration, action
builder changes, and password reset events.

### Platform Admin

Go to `/platform`.

Access is controlled by `PLATFORM_ADMIN_EMAILS`.

Use this area to:

- Review tenant companies.
- See tenant owner, member count, and project count.
- Enable or disable a tenant.
- Open a tenant detail page.
- Review tenant members, projects, and pending invitations.
- Create or cancel tenant invitations.
- Enable or disable tenant member access.

Disabled tenants cannot resolve as active accounts and public widgets for their
projects are blocked.

## Suggested Smoke Test

1. Start the app with `npm run dev`.
2. Sign up with email and password.
3. Create a project.
4. Go to Documents and upload a small `.txt` or `.md` file.
5. Process queued documents.
6. Go to Chat and ask a question answered by the uploaded file.
7. Go to Actions and apply the Salon Service Booking template.
8. Return to Chat and type `book salon`.
9. Complete the flow and confirm the request.
10. Go to Media Library and upload a small image or PDF.
11. Go to Product Catalog and create a sample catalog with one product.
12. Try an invalid answer during another flow and verify a validation failure event is logged.
13. Go to Submissions and verify the saved submission, events, and operation attempts.
14. Go to Operations and verify the default Manual Review provider/operation.
15. Go to Widget, generate a token, and copy the embed snippet into a local HTML page.
16. Open that HTML page and test widget chat.
17. Go to Analytics and confirm chat requests are logged.

## Useful Commands

```bash
npm run dev
npm run check:cron-config
npm run check:ops-health
npm run check:tenant-scope
npm run test:tenant-isolation
npm run test:e2e
npm run build
npm run lint
npm run format
npx drizzle-kit migrate
npx drizzle-kit studio
```

Operations notes:

- Use `npx drizzle-kit migrate` for staging and production migrations.
- Treat schema push commands as local-development only.
- Use `npm run check:cron-config` to confirm Vercel cron still points at the
  upload queue worker endpoint.
- Use `npm run check:ops-health` to report failed upload jobs and failed
  operation attempts. Add `-- --fail-on-alert` when wiring it to alerting.
- Keep deployment, backup, restore, cron, and webhook readiness notes in
  [`docs/OPERATIONS_READINESS.md`](docs/OPERATIONS_READINESS.md).

## Current Limitations

- The public home page still uses default starter content.
- Granular role-management UI is not implemented yet.
- Invitation emails use SMTP2GO and still show a manual link as fallback.
- Roles are still intentionally minimal.
- Platform admin is intentionally minimal and uses an email allowlist.
- Billing plans and subscriptions are deferred for internal beta; see
  [`docs/BETA_DEFERRED_DECISIONS.md`](docs/BETA_DEFERRED_DECISIONS.md).
- Feature limits are also deferred for internal beta; beta tenants should stay
  small and manually monitored until quotas are designed.
- Custom domains and company subdomains are deferred for internal beta; use the
  central app URL until domain routing is designed and tested.
- PostgreSQL RLS is deferred for internal beta; tenant safety currently relies
  on scoped query helpers plus static and database-backed isolation checks.
- Audit log export is deferred for internal beta; use the read-only
  `/projects/audit` review page.
- Production object storage is deferred for internal beta; local
  `public/uploads` media is only suitable for small test usage.
- Browser E2E has critical smoke coverage, but exhaustive browser/device
  coverage is deferred for internal beta.
- Operation success/failure routing is available for inline operation steps, and
  recent attempts can be manually replayed. Automated retry queues are not
  implemented yet.
- Action detection is simple trigger phrase matching in the client.
- Operation/provider management is intentionally basic; webhook, n8n webhook,
  and Meta Conversions delivery exists, but advanced delivery management is not
  implemented yet.
- Live availability, quote, booking, payment, and status operations are
  deferred for internal beta and need provider-specific setup before real use.
- WhatsApp inbound media collection currently stores Cloud API media references
  for Ask Media steps; downloading those files into project storage is still a
  future enhancement.
- WhatsApp outbound media requires `NEXT_PUBLIC_APP_URL` or `NEXTAUTH_URL` to
  point to a public HTTPS app URL so Meta can fetch project media assets.
- Native WhatsApp catalog/product messages require the Meta catalog id and
  product retailer ids to match the catalog connected to the WhatsApp Business
  account; otherwise the runtime uses text fallback.
- Native WhatsApp template messages require the template to be approved in Meta
  and marked approved in the block settings; otherwise the runtime uses text
  fallback inside the 24-hour service window. Template body samples are checked
  against configured body variables before publishing.
- WhatsApp runtime replies now enforce the 24-hour customer-service window:
  regular replies are blocked outside the window, while approved template
  messages can still be sent.
- Each company currently has one owner membership created automatically; the schema is prepared so more roles can be added later through company memberships.
- Connect Flow supports jump and return transitions. JSON imports require
  reconnecting Connect Flow targets in the destination project.

## Architecture Direction

Keep future changes generic and project-scoped. Prefer reusable primitives such as projects, knowledge bases, actions, flows, fields, operations, integration providers, submissions, events, and statuses. Avoid hardcoding business-specific behavior into the core runtime.
