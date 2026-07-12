# Chat Flow Builder Implementation Roadmap

This roadmap describes how Lia AI should evolve from the current SaaS action
builder into a robust visual flow builder for website widget, project chat,
WhatsApp, and future channels.

The roadmap has been revised after reviewing `docs/Flow Builder.docx`, which
lists the essential builder components seen in a competitor-style flow builder:

- Message types: text buttons, media buttons, list, catalogue message, single
  product, multiple product, template.
- Actions: request intervention, Meta Conversions API, condition, connect flow,
  ask address, ask location, ask question, ask media, set attribute, add tag,
  API request.

The key conclusion is that the UI should not move faster than the runtime. A
canvas can show these blocks today, but the product becomes robust only when
each block has a clear config schema, runtime behavior, channel formatter,
fallback behavior, validation, and tenant scoping.

## Current Baseline

Already implemented foundations:

- Multi-tenant company, workspace, and project scoping.
- Project-scoped knowledge base, RAG chat, OpenAI chat model, and embeddings.
- Project actions with trigger phrases and draft/active/archive status.
- Flow steps stored in project-scoped `action_flow_steps`.
- Branch rules stored in project-scoped `action_flow_branch_rules`.
- In-progress and submitted flow sessions stored in `action_submissions`.
- Submission event history in `action_submission_events`.
- Current generic step support for message, input, choice, date, date range,
  time, number, email, phone, location, display result, confirmation, submit,
  operation, handoff, connect-flow, and file-upload placeholder.
- Conditional branching with default next-step routing, branch rules, route
  validation, branch decision events, and loop protection.
- Vertical builder pages for action overview, step edit, branch rules,
  reorder, duplicate, enable/disable, publish readiness, preview, versions,
  import/export, restore, and analytics.
- React Flow visual canvas at `/projects/actions/[actionId]/canvas`.
- Canvas node layout persistence in step settings.
- Canvas creation and editing for common steps and operation selection.
- Canvas product shell with left block palette, center canvas, right inspector,
  toolbar metrics/actions, and validation panel.
- Flow component registry for enabled current blocks and planned DOCX blocks.
- Choice steps support buttons, list, and text fallback display modes in the
  builder, project chat, widget chat, and channel runtime payloads.
- WhatsApp choice replies send native interactive buttons or list messages
  when option counts fit WhatsApp limits, with automatic text fallback.
- Project-scoped contact, contact attribute, contact tag, and contact-tag
  assignment tables.
- Channel conversations automatically resolve and attach an active contact.
- Set Attribute and Add Tag action blocks are enabled in the builder and
  runtime, with project/widget/WhatsApp execution support.
- Contact management view at `/projects/contacts` for contact profiles,
  attributes, tags, linked conversations, channel transcripts, and linked flow
  submissions.
- Operation steps can opt into inline execution during live flows while keeping
  existing post-submit operation behavior as the default.
- Inline operation output mapping can save response/status values back into flow
  fields or contact attributes.
- Inline operation steps can create success/failure route presets that are
  stored as normal branch rules.
- API Request setup can create webhook/n8n providers and operations together
  with sensible defaults.
- Operation sandbox preview can run sample payloads without linking to a live
  submission and display request, response, and mapped outputs.
- Project-scoped media asset table and media library upload/archive UI.
- Media message steps can attach reusable project media assets and emit a
  structured runtime media reply with text fallback.
- WhatsApp can send configured Media message assets as native image, video,
  audio, or document messages when the media URL is publicly reachable.
- Ask Media file-upload steps can collect project/widget uploads and save the
  uploaded media reference into flow fields and submission events.
- WhatsApp inbound image, video, audio, and document messages can satisfy Ask
  Media steps by storing the WhatsApp media id and message metadata as an
  external media reference.
- Submission detail pages render collected media references with provider,
  mime type, file size, captions, open links for local media, and raw JSON for
  auditability.
- Contact profiles include a channel-independent transcript view over stored
  widget, project chat, WhatsApp, and future channel messages, including media
  references found in message payloads.
- Admins can import submitted WhatsApp media references into the project media
  library, converting the field to a local reusable media asset and recording a
  submission event.
- Project-scoped product catalog and product records with a basic admin library
  at `/projects/catalog`.
- Shared channel tables for project channels, conversations, and messages.
- Website widget and project chat flow endpoints.
- WhatsApp Cloud API setup, webhook verification, inbound text handling,
  outbound text replies, and test send.
- Operation provider model with manual review, internal save, email, webhook,
  and n8n webhook providers.
- Operation attempts with signed webhook requests, immediate retry config,
  queued replay retry config, timeout handling, and attempt visibility.
- Industry template catalog, project custom templates, and template apply flow.
- Draft/publish versions, runtime version selection, diff, rollback, restore,
  import/export, and analytics.
- Dedicated handoff queue at `/projects/handoffs` with open/my/unassigned/queue
  filters, bulk claim/release, and bulk status actions.
- Connect Flow supports jump and return modes: admins can select an active
  sibling flow, runtime preserves collected fields, records the transition,
  starts the connected flow, prevents cross-flow loops, and can resume the
  parent flow after a connected subflow submits.

Important current limitations:

- Runtime replies now have a structured model with text fallback. Buttons,
  lists, media, template, and product/catalog payloads have initial structured
  support; native provider policy enforcement still needs dedicated adapters.
- WhatsApp service-window enforcement now blocks non-template runtime replies
  outside the 24-hour customer-service window. Proactive outbound campaigns are
  still not modeled as a separate product area.
- WhatsApp inbound media collection stores Cloud API media references first;
  admins can import available submitted media into the project media library
  while Meta's media URL remains accessible.
- Product/catalog messages are first-class message blocks with product snapshots
  and text fallback; Product Selection can collect one product or a
  multi-product cart into flow fields. Browser channels render configurable
  product cards, and WhatsApp product/catalog formatting is available when Meta
  catalog/product ids are configured.
- WhatsApp approved template sending has started, and runtime replies enforce
  the 24-hour customer-service window for regular outbound messages.
- Operation steps mostly execute after submission; inline operation execution
  and success/failure routing still need work.
- Inline operation mapping is still JSON-driven; friendlier mapping helpers can
  be added later.
- Connect Flow jump and return behavior are modeled with submission metadata;
  richer reusable-subflow reporting can be layered on later.
- Meta Conversions API is now a dedicated operation provider with guided setup,
  mapped event payloads, request/response attempts, and user-data hashing.

## Architecture Principles

- The flow builder is the source of truth for every channel.
- WhatsApp, widget, and project chat are channel adapters, not separate flow
  engines.
- A builder block must define:
  - config schema
  - validation rules
  - runtime behavior
  - channel-specific rendering
  - text fallback
  - event/audit logging
  - import/export/version behavior
- The database model should remain generic. Prefer `step_type`, `settings`,
  `options`, `operation_id`, `next_step_id`, and branch rules before adding a
  table.
- Add new tables only for durable domain concepts, such as contacts, tags,
  media assets, reusable subflows, or template approvals.
- All tenant-owned data must remain scoped to `project_id`.
- The visual canvas must edit the same database model as the vertical builder.
  It must not become a separate workflow engine.
- Every phase should leave the application usable.

## Target Builder Component Model

The builder should expose two user-facing groups.

### Message Components

- Text + Buttons
- Media
- List Message
- Catalogue Message
- Single Product Message
- Multiple Product Message
- Template Message

### Action Components

- Ask Question
- Ask Address
- Ask Location
- Ask Media
- Condition
- Connect Flow
- Request Intervention
- Set Attribute
- Add Tag
- API Request
- Meta Conversions API

## Capability Fit

| DOCX Component | Current Fit | Required Work |
| --- | --- | --- |
| Text + Buttons | Partial | Structured button reply, channel formatter, button answer parsing. |
| Media | Partial | Media asset/upload model, media send/receive runtime, channel adapters. |
| List Message | Partial | Structured list reply, WhatsApp list formatting, text fallback. |
| Catalogue Message | Partial | Richer channel adapters and capability warnings. |
| Single Product | Partial | Richer selection handling and capability warnings. |
| Multiple Product | Partial | Native provider cart adapters and capability warnings. |
| Template | Partial | WhatsApp template config, approval metadata, 24-hour window logic. |
| Request Intervention | Partial | Handoff exists; needs assignment/status/team workflow integration. |
| Meta Conversions API | Good | Dedicated provider/action exists; richer event presets and replay UX can be layered later. |
| Condition | Good | Branch rules exist; UI should be more visual. |
| Connect Flow | Good | Jump and return modes exist; submissions show parent/child reporting. |
| Ask Address | Partial | Can collect text; needs structured address schema and validation. |
| Ask Location | Partial | Location step exists; needs structured lat/lng/channel location support. |
| Ask Question | Good | Existing input/choice/date/phone/email steps cover this. |
| Ask Media | Partial | File-upload placeholder exists; needs media upload/storage. |
| Set Attribute | Good | Expand contact editing and segmentation UI over time. |
| Add Tag | Good | Expand contact editing and segmentation UI over time. |
| API Request | Partial | Webhook/n8n providers exist; inline runtime execution needed. |

## Revised Implementation Plan

## Phase 1: Structured Runtime Reply Model

Goal: replace plain string-only replies with structured runtime messages while
keeping text fallback everywhere.

Deliverables:

- Introduce a `RuntimeReply` type, for example:
  - `text`
  - `buttons`
  - `list`
  - `media`
  - `template`
  - `catalog`
  - `handoff`
- Keep `text` as the baseline fallback for all channels.
- Update channel flow runtime to return structured replies.
- Update widget/project chat/WhatsApp senders to format structured replies.
- Store outbound channel message payloads as structured JSON.
- Preserve existing behavior for current flows.

Acceptance criteria:

- Existing flows behave the same as today.
- Runtime can emit text plus button/list metadata.
- WhatsApp can still send a text fallback if rich formatting is unsupported.

## Phase 2: Flow Component Registry

Goal: define every builder block centrally before building more UI.

Deliverables:

- Add a component registry for message and action blocks.
- Each block defines:
  - key
  - label
  - group
  - icon
  - default step/operation config
  - required settings
  - supported channels
  - fallback behavior
- Map current `ACTION_STEP_TYPES` into registry entries.
- Add initial entries for DOCX blocks, including unsupported entries marked as
  planned/disabled.
- Use the registry in canvas palette, vertical forms, validation, and docs.

Acceptance criteria:

- Builder UI reads block labels/options from one source.
- Unsupported future blocks can be shown as planned without corrupting flows.
- Adding a block later does not require scattered constants.

## Phase 3: Visual Canvas Product Shell

Goal: make the canvas feel like a proper flow builder, while still using the
existing database model.

Deliverables:

- Left block palette grouped into Message and Actions.
- Center React Flow canvas.
- Right inspector for selected node/edge.
- Top toolbar with save layout, validate, preview, publish, version status.
- Node cards styled by block type.
- Empty-state prompt to add the first node.
- Route warnings visible on nodes and in a validation panel.

Acceptance criteria:

- Admin can add DOCX-style block types from a palette.
- Existing steps still render and edit correctly.
- Vertical builder and canvas stay consistent.

## Phase 4: Text Buttons And List Messages

Goal: support richer choice UX without changing the underlying flow logic.

Deliverables:

- Add button/list settings to choice-like steps.
- Add structured `buttons` and `list` runtime replies.
- Parse button/list replies by id, label, or numeric fallback.
- Format buttons/lists in widget chat where possible.
- Format WhatsApp buttons/lists where allowed.
- Fall back to numbered text choices.

Acceptance criteria:

- A choice step can be displayed as text buttons or a list.
- The same flow works in widget, project chat, and WhatsApp.
- Text fallback remains reliable.

## Phase 5: Contact Profile, Attributes, And Tags

Goal: support Set Attribute and Add Tag actions from the DOCX.

Deliverables:

- Add project-scoped contact/customer records linked to channel conversations.
- Add project-scoped contact attributes.
- Add project-scoped tags and contact-tag assignments.
- Resolve the active contact from widget/project chat/WhatsApp conversation.
- Add Set Attribute action block.
- Add Add Tag action block.
- Record contact mutations as submission/channel events.

Acceptance criteria:

- A flow can set a contact attribute from a collected field or static value.
- A flow can add one or more tags to the active contact.
- Contact data remains project-scoped.

## Phase 6: Inline Operation Execution

Goal: make API Request and Meta Conversions API usable inside the flow, not only
after submission.

Deliverables:

- Execute operation steps during runtime.
- Support success and failure routing.
- Store request/response attempt payloads.
- Allow operation input mapping from current fields/contact attributes.
- Allow operation output mapping back into fields/contact attributes.
- Add API Request block UI backed by webhook/n8n providers.
- Add operation preview/sandbox behavior in test mode.

Acceptance criteria:

- A flow can call an API before the final submit step.
- API success/failure can route to different next steps.
- Runtime continues gracefully when an operation fails.

## Phase 7: Media And File Handling

Goal: make Media and Ask Media real across supported channels.

Deliverables:

- Add project-scoped media/file asset model. [done: initial local media
  library]
- Add secure upload endpoint and storage abstraction. [partial: authenticated
  local development storage]
- Support image/video/audio/file metadata. [done: initial metadata]
- Add Media message block. [done: outbound media asset selection and runtime
  fallback, plus native WhatsApp media send by public link]
- Add Ask Media action block. [partial: project/widget upload collection]
- Store inbound media references from widget and WhatsApp. [done: local
  uploads and WhatsApp external media references]
- Add validation for required media and accepted media types. [partial: upload
  size/type and required field validation]

Acceptance criteria:

- Admin can send a configured media message.
- User can upload or send required media in a flow.
- Media references are stored with submissions/contact events.

## Phase 8: Address And Location

Goal: make Ask Address and Ask Location structured rather than plain text.

Deliverables:

- Add address field schema support.
- Add address validation and formatted summary.
- Extend location step to store lat/lng, label, and raw channel payload.
- Support WhatsApp location inbound messages.
- Add widget location capture where browser permissions allow it.

Acceptance criteria:

- Address is stored as structured fields.
- Location can store coordinates when the channel provides them.
- Text fallback remains available.

## Phase 9: Catalog And Product Messages

Goal: support catalogue, single product, and multiple product messages.

Deliverables:

- Decide whether catalog source is internal, provider-backed, or both. [done:
  internal source first, provider-backed later]
- Add project-scoped catalog/product records or catalog provider config. [done:
  initial internal catalog/product records and admin UI]
- Add catalogue message block. [done: message block with product snapshot and
  text fallback]
- Add single product message block. [done: message block with product snapshot
  and text fallback]
- Add multiple product message block. [done: message block with product
  snapshots and text fallback]
- Add Product Selection block for mapping selected products into flow fields.
  [done: single product selection and multi-product cart selection via runtime
  options and product metadata, with optional quantity capture and companion
  total fields]
- Support WhatsApp catalog/product message formatting where configured.
  [done: Cloud API product/product-list payloads when Meta catalog and product
  retailer ids are configured]
- Render catalog/single-product/multiple-product blocks as product cards in
  browser channels. [done: project chat and widget]
- Add browser product card layout controls. [done: grid, compact list, and
  featured first item]
- Add channel capability warnings for product, template, and media blocks.
  [partial: media/product diagnostics now warn about WhatsApp public media URLs,
  Meta catalog ids, product retailer ids/SKUs, and native cart checkout
  readiness]
- Add native provider cart checkout adapters where supported by commerce
  channels. [partial: Product Selection cart fields now include a WhatsApp
  checkout handoff payload when catalog/product ids are native-ready, and
  WhatsApp order webhooks normalize into the shared cart answer format]
- Keep text/list fallback for non-commerce channels.

Acceptance criteria:

- A project can configure products/catalog items.
- A flow can present and collect product selections.
- Product selections can feed API requests and submissions.

## Phase 10: WhatsApp Template And Policy Layer

Goal: support approved WhatsApp templates and prevent policy-breaking sends.

Deliverables:

- Add template message block. [done: initial Template block]
- Store WhatsApp template name, language, variables, category, approval status,
  and Meta body sample. [done: stored in step settings]
- Track service window status per WhatsApp conversation. [done: inbound
  WhatsApp messages record `lastInboundMessageAt` conversation metadata]
- Enforce template requirement outside the 24-hour customer service window.
  [done: runtime WhatsApp sender blocks non-template replies when the window is
  closed]
- Add admin warnings for unsupported interactive formats. [partial: unapproved
  template warning, Meta body variable compatibility checks, and native
  fallback behavior]
- Log WhatsApp delivery errors in channel messages. [done: existing WhatsApp
  reply logging captures delivery errors]

Acceptance criteria:

- Admin can configure a WhatsApp template message.
- Runtime blocks non-template outbound messages outside the allowed window.
- Template variables can be filled from fields.
- Template body placeholders can be checked against configured body variables.

## Phase 11: Request Intervention And Team Workflow

Goal: make human handoff operational.

Deliverables:

- Expand handoff/request-intervention block settings. [done: priority, queue,
  and notify-team intent]
- Add assignment/status metadata to submissions or contact conversations.
  [done: handoff metadata is stored on submissions and channel
  conversations, submissions move to Under Review, and admins can claim/release
  handoff ownership]
- Notify internal staff through configured operation/provider. [done: Handoff
  steps can run their selected operation as the notification action]
- Add admin queue filters for under-review/handoff items. [partial: handoff
  metadata appears in submission list/detail views with handoff, queue,
  assigned-to-me, and unassigned filters; `/projects/handoffs` provides a
  dedicated work queue with bulk assignment/status actions]
- Preserve the existing manual review operation.

Acceptance criteria:

- A flow can mark a conversation/submission for staff intervention.
- Admins can see and act on intervention requests.
- Handoff works from widget and WhatsApp.

## Phase 12: Connect Flow And Reusable Subflows

Goal: support competitor-style Connect Flow without duplicating steps.

Deliverables:

- Add reusable subflow or callable action concept.
- Define jump-only vs return-to-parent behavior. [done: editors expose jump or
  return behavior]
- Add recursion/loop protection across flows. [done for jump and return
  transitions]
- Add canvas node for Connect Flow. [done: Connect Flow is selectable in the
  canvas and vertical editor]
- Support import/export/version snapshots for connected flows. [partial: JSON
  imports clear environment-specific connected action ids and preserve the
  original action name/id as reconnect context]

Acceptance criteria:

- Admin can route into another flow safely.
- Runtime prevents infinite cross-flow loops.
- Return-mode subflows merge child fields back into the parent and continue the
  parent route after the Connect Flow step.
- Published versions remain deterministic.
- Imported flows do not silently keep invalid connected-flow ids.

## Phase 13: Meta Conversions API Provider

Goal: make Meta CAPI a first-class automation action.

Deliverables:

- Add Meta provider config for pixel/dataset id and token reference. [done:
  guided Operations setup creates a `meta_conversions_api` provider]
- Add event mapping UI. [done: guided input mapping supports `user_data.*`,
  `custom_data.*`, event fields, and test event code]
- Map fields/contact attributes to CAPI payload. [done: operation input mapping
  feeds the Meta event payload]
- Add hashing/normalization for customer data where required. [done: common
  user data keys such as `em` and `ph` are normalized and hashed before send]
- Store request/response attempts. [done: operation attempts capture request
  payload, response payload, status, and errors]
- Allow retry and failure routing. [partial: inline operation success/failure
  routing works through existing operation branches; dedicated retry/replay UI
  remains later]

Acceptance criteria:

- A flow can fire configured Meta conversion events.
- CAPI attempts are visible and auditable.
- Failures do not break unrelated flow execution.

## Phase 14: Advanced Validation And Rules

Goal: move beyond basic typed validation.

Deliverables:

- Add min/max length, regex, min/max number, date constraints, allowed file
  types, and custom error messages. [done: settings save/edit and runtime
  enforcement for text/number/date constraints; upload-specific file type
  enforcement]
- Add route validation for required block settings. [done: publish diagnostics
  now catch stale/imported missing field, prompt, operation, option-source, and
  product config]
- Add publish blockers for incomplete rich-message/action config. [partial:
  validation constraint integrity and product/action config blockers]
- Add test-mode diagnostics for validation and routing. [done: preview test
  mode records validation failures, route decisions, loop stops, and completion
  in a diagnostics timeline]

Acceptance criteria:

- Admin can define richer validation without code changes.
- Publish readiness catches incomplete or broken block configs.

## Phase 15: Templates, Marketplace, And Analytics

Goal: turn the builder into a reusable SaaS setup engine.

Deliverables:

- Template versioning. [partial: bundled and project templates expose version
  metadata, and admins can set project-template versions from action settings]
- Marketplace-style template catalog. [partial: bundled and project templates
  share `/projects/templates`, with project adoption and applied-version
  visibility]
- Template block compatibility checks. [partial: template cards surface setup
  errors/warnings for project operations, connected flows, media, products, and
  WhatsApp template approval]
- Flow-level and block-level analytics. [partial: action detail shows
  step-level metrics, and `/projects/analytics` now shows project-level flow
  totals by action]
- Drop-off reporting by node. [partial: flow detail shows per-step drop-offs,
  and `/projects/analytics` surfaces the highest project-wide drop-off nodes]
- A/B flow variants. [partial: action settings can mark a flow as an
  experiment variant with key, variant label, and traffic weight metadata;
  `/projects/actions` groups variants with starts, submissions, completion
  rate, and configured weight; runtime traffic allocation remains later work]
- Reusable fields. [partial: step editors derive reusable field-key
  suggestions from existing project flows, and `/projects/actions` now exposes
  a reusable field-key library]
- Custom template authoring from existing flows. [partial: admins can save a
  project flow as a reusable project template, manage its catalog visibility
  and version from action settings, and apply it back into the same project
  with steps and branch rules copied]

Acceptance criteria:

- Templates can evolve without breaking applied flows.
- Admins can understand performance and improve flows over time.

## Recommended Immediate Next Steps

1. Add route validation and publish blockers for incomplete rich block settings.
2. Add automated operation retry queues. [partial: providers can opt into
   queued retries, and `/projects/operations` can process due failed attempts
   for the selected project; background scheduling remains later work]
3. Add marketplace template duplication/custom-template authoring. [partial:
   project flows can be saved as reusable project templates and reapplied with
   step routes/branch rules copied; action settings can now manage whether a
   flow is exposed as a project template and which template version it uses]

## Current Phase Boundary

The product has started Phase 7. Phase 5 is complete enough for the current
roadmap: contacts are persisted, channel conversations attach to contacts, Set
Attribute and Add Tag execute across channels, and admins can inspect contacts
from `/projects/contacts`.

The current Phase 6 foundation lets operation steps opt into inline execution
during live project/widget/WhatsApp flows. Inline operation attempts are saved,
submission events are recorded, and operation output mapping can write response
values into flow fields or contact attributes. The operation status is also
written to a flow field so existing branch rules can route on `completed` or
`failed`.

The Phase 7 foundation now includes project-scoped `media_assets`, a media
library at `/projects/media`, outbound Media message steps, native WhatsApp
media sending by public link, Ask Media uploads for project chat and widget
flows, WhatsApp inbound media references, admin-side media rendering on
submission detail pages, and channel-independent contact transcripts with media
payload rendering. Submitted WhatsApp media references can also be imported into
the project media library.

The Phase 8 foundation has started: Address is now an enabled flow step,
browser channels can collect structured address and location values, text
channels can still provide text fallbacks, and WhatsApp location messages are
normalized into the same shared location value shape.

The Phase 9 foundation now includes internal `product_catalogs` and
`catalog_products`, a `/projects/catalog` admin library, enabled Catalogue
Message, Single Product, Multiple Products, and Product Selection blocks. These
blocks snapshot project-scoped product data into step settings and emit
channel-independent catalog replies/options with text fallback. Product
Selection writes the chosen product id or selected cart product ids plus
companion metadata into flow fields. WhatsApp sends native
product/product-list messages when the catalog has a Meta catalog id and
products have WhatsApp retailer ids or SKUs. Product Selection can optionally
collect quantity and can collect a multi-product cart with companion item,
quantity, line-total, cart-total, and provider checkout fields. WhatsApp order
webhooks now normalize native cart replies into the same shared cart answer
format, and cart fields include a WhatsApp checkout handoff payload when
catalog/product ids are native-ready. Browser channels now render product cards
for product message blocks and product-selection cards for Product Selection
steps. Product blocks can choose grid, compact list, or featured browser
layouts. Flow diagnostics now separate blocking errors from non-blocking
channel capability warnings for WhatsApp media/product requirements and native
cart checkout readiness.

The Phase 10 foundation has started: Template is now an enabled message block,
with WhatsApp template name, language, category, approval status, Meta body
sample, and body variables stored in step settings. Runtime emits structured
template replies with text fallback, resolves `{{fieldKey}}` body variables
from collected flow fields, can render a body preview from `{{1}}` Meta
placeholders, and WhatsApp sends native approved template messages through the
Cloud API. Inbound WhatsApp messages now update conversation service-window
metadata, and the WhatsApp runtime sender blocks regular flow replies outside
the 24-hour customer-service window unless the reply is an approved template.
Flow diagnostics warn when a template is not marked approved and when the Meta
body placeholder count does not match configured body variables.

The Phase 13 foundation now includes a `meta_conversions_api` integration
provider, guided Meta Conversion operation creation, mapped event payloads,
customer data normalization/hashing, and operation attempt logging. These
conversion events run through the existing Operation block, so they remain
channel-independent across widget, project chat, WhatsApp, and future channels.

The canvas condition editor now supports optional branch labels, clearer
When/Then previews, guided source-field/operator/target selection, operator
hints, and operation status fields in the source-field picker. Branch labels
are stored on rule settings, so the runtime condition stays unchanged while the
visual canvas becomes easier to read.

The Phase 15 template foundation has started: bundled and project custom
templates now expose computed version/status/channel/field summaries,
`/projects/templates` supports search and industry filtering, and applied
actions store source template key, version, source, and applied timestamp
metadata. Admins can save an existing project flow as a reusable project
template, then apply it back into the same project with steps, default routes,
and branch rules copied. Template cards now include setup compatibility checks
for project-specific operations, connected flows, media assets, product
catalogs, and WhatsApp template approval so admins know what to verify after
applying a flow.

Template marketplace adoption visibility has started: `/projects/templates`
now counts how many times each template was applied in the selected project,
shows the latest applied date, and lists the applied template versions so admins
can spot whether a newer marketplace/custom template version has not yet been
used.

The reusable-fields foundation has started: new/edit step pages now derive a
project-scoped field-key library from existing flow steps and surface common
field keys as suggestions in the Field Key input. This keeps field reuse simple
for now while still nudging admins toward consistent keys for routing,
operation mappings, templates, and submissions. `/projects/actions` now also
shows the reusable field-key library with usage counts, labels, step types, and
the actions where each field appears.

Project custom template authoring now has a management surface: action settings
can expose or hide a flow from the project template catalog and set the template
version used by `/projects/templates`. This keeps template publishing simple
for now while preserving a versioned metadata path for later marketplace
approval, lifecycle, and compatibility workflows.

The A/B flow variant foundation has started: action settings now preserve
existing action metadata while optionally storing `settings.experiment` with an
experiment key, variant label, and traffic weight. The action list and flow
detail pages surface this metadata so admins can organize variants before the
runtime allocator is added. `/projects/actions` also groups matching experiment
keys and shows basic comparison metrics for each variant using existing flow
analytics.

The project flow analytics foundation has started: `/projects/analytics` now
combines chat request analytics with action-flow totals, including project
starts, submitted flows, completion rate, drop-offs, validation failures,
branch decisions, and a per-flow comparison table that links back to each flow.
The same view now highlights the highest drop-off nodes across the selected
project, using each in-progress submission's current step as the drop-off
signal.

The operation management foundation now includes manual attempt replay and a
project-scoped retry queue processor. Admins can retry failed attempts or
replay completed attempts from `/projects/operations`. Replays create a fresh
operation attempt using the original request payload, record the source attempt
id, and add replay completion/failure events when the attempt is linked to a
submission. API Request providers can opt into queued retries with a retry
limit and delay. The Operations page can process due failed attempts for the
selected project and can filter attempt history by operation, status, and
replay/original attempts. Background cron scheduling remains later work.

The Phase 11 foundation has started: Request Intervention/Handoff steps can
store priority, queue, and notify-team intent. When a live flow reaches a
handoff step, the submission moves to `under_review`, handoff metadata is saved
on the submission and channel conversation, and the submission list/detail pages
surface the handoff context. Handoff steps can also run their selected
operation as the staff notification action, so existing email/webhook/n8n
providers can be used without a separate notification engine. `/projects/handoffs`
now provides the dedicated work queue with open/my/unassigned/queue filters,
bulk claim/release, and bulk status actions.

The Phase 12 foundation has started: Connect Flow is enabled in the vertical
editor and visual canvas with jump or return behavior. Admins can connect to
another active flow in the same project, route diagnostics block
missing/self/inactive targets, and the shared runtime starts the connected flow
while preserving collected fields and preventing cross-flow loops. Return mode
uses submission metadata as a lightweight call stack, merges child fields back
into the parent submission, and continues the parent route after the Connect
Flow step. Export/import treats connected action ids as environment-specific:
exported JSON preserves reconnect context, and imported Connect Flow blocks
require the admin to select a valid active action in the destination project.
Submission reporting now shows Connect Flow parent/child counts, a connected
flow filter, and linked parent/child submission details.

The Phase 14 validation foundation has started: step editors and the visual
canvas can save custom required/invalid messages plus min/max length, regex,
min/max number, min/max date, and allowed file type settings. Runtime answer
validation now enforces text, number, and date constraints across channels
before normalizing collected fields. Ask Media uploads now enforce configured
file type settings server-side for project chat and widget uploads, and the
browser file picker reflects the same accepted file types.

Publish readiness now also checks richer block configuration before a flow can
go live. It blocks missing field/prompt labels on input steps, missing operation
links, invalid choice option sources, incomplete product blocks, and malformed
validation constraints, including bad regex/date ranges and invalid file type
tokens.

Preview And Test Mode now includes a diagnostics timeline. While admins test a
draft flow, the preview records validation failures, selected routes, possible
route loops, and completion without creating a live submission.
