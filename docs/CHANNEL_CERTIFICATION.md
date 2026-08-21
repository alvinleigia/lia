# Channel Certification Contract

This document defines what Lia proves automatically and what still requires
live UAT before a release is approved.

## Certified Runtime Boundary

One server runtime owns flow version selection, validation, routing, state
mutation, side effects, waits, and submissions. It emits versioned runtime
replies. Channel adapters may render those replies natively or use the supplied
readable fallback without changing the flow definition.

Production channels:

- Project Chat
- Website widget
- WhatsApp

Contract-only extension target:

- `reference_future`

The reference adapter is not a production channel. It is not stored in the
database and has no navigation or customer-facing UI. It proves that a future
transport can preserve correlation, reply capability, text, fallback text,
structured payload, and envelope version through the public adapter contract.

## Public Extension Contracts

These TypeScript modules are the supported extension boundary. Database rows,
server actions, provider payloads, and internal runtime-session objects are not
public contracts and must not be imported by an adapter or business-tool
integration.

### Conversational tasks

- `src/lib/conversation-contracts.ts` exports
  `conversationalTaskDefinitionV1Schema`, `ConversationalTaskDefinitionV1`,
  `conversationalTaskSnapshotV1Schema`, and `ConversationalTaskSnapshotV1`.
- Parse untrusted task definitions with the exported Zod schema. A published
  snapshot is immutable and includes the task, assistant policy, project
  conversation policy, and permitted tool definitions.
- A task declares fields, outcomes, return policy, degraded behavior, and tool
  bindings. It does not name a channel, provider credential, database query,
  or arbitrary URL.

### Runtime replies

- `src/lib/runtime-replies.ts` exports `RuntimeReplyV1`, its schema-version
  constant, reply constructors, and `normalizeRuntimeReply` for stored legacy
  values.
- Every new reply must contain `schemaVersion: 1`, an intent, a channel-neutral
  reply type, visitor-facing text, and readable `fallbackText`. Stable option
  values and project-resource identifiers must survive adapter rendering.
- An adapter may change presentation, but it must not change task state,
  validation, route selection, confirmation, or the business outcome.

### Business tools

- `src/lib/conversation-contracts.ts` exports `toolDefinitionV1Schema`,
  `ToolDefinitionV1`, tool bindings, input/output field schemas, and result
  mappings.
- A model may only propose a configured tool and arguments. Lia validates the
  proposal against the published allowlist, tenant/project scope, allowed
  stage, field types, visibility rules, and read/write access before execution.
- Tool credentials are server-owned references. They are never part of the
  task snapshot, adapter delivery, model proposal, export, or diagnostic text.

### Operations

- `src/lib/operation-contracts.ts` owns the public stable HTTP methods and
  outcome keys: `success`, `client_error`, `server_error`, `timeout`,
  `network_failure`, and configured `status_NNN` outcomes.
- External business behavior enters the runtime through an approved
  `ToolDefinitionV1` whose execution adapter resolves a project-owned
  operation. Extensions must not call Lia persistence directly or bypass
  confirmation, authorization, idempotency, retries, reconciliation, routing,
  or audit history.
- `src/lib/operations.ts` is the server implementation, not an extension
  contract. Provider responses, attempt records, and credentials stay inside
  that boundary; only approved mapped values and the deterministic outcome key
  may return through the configured tool mapping.

### Phase 12 / Flow Builder V2 channel adapters

“V2 adapter” in the roadmap names the upgraded adapter boundary delivered for
the Flow Builder V2 capability set. It does **not** mean the current envelopes
use `schemaVersion: 2`; the supported inbound and reply envelopes are V1 until
a separately defined breaking contract is introduced.

- `src/lib/channel-inbound-contract.ts` owns
  `NormalizedChannelInboundV1` and `normalizeChannelInboundV1` for text,
  selections, media, location, and product selections.
- `src/lib/channel-adapter-contract.ts` owns `ChannelAdapterProfile`,
  `ChannelReplyAdapter`, `AdaptedChannelReply`, declared native/fallback
  support, and provider limits.
- `src/lib/reference-channel-adapter.ts` is the minimal implementation example.
  A real adapter normalizes provider input before runtime execution, consumes
  only `RuntimeReplyV1` on output, preserves correlation, and returns either a
  native delivery or the reply's readable fallback.
- `ChannelDeliveryError` must preserve runtime semantics. A delivery failure
  may be retryable, but it must not advance, cancel, resubmit, or reinterpret
  the underlying task or flow.

Contract versions are explicit. Backward-compatible additions may extend a V1
schema only when existing consumers continue to validate and behave the same.
A breaking field, meaning, or lifecycle change requires a new exported version
and an explicit compatibility path; provider-specific data stays behind its
adapter rather than changing these universal contracts.

## Automated Evidence

Run the fast gate during development:

```bash
npm run certify:release:fast
```

It verifies:

- Every enabled flow step has one typed certification family.
- Every enabled step has an explicit project-chat, widget, WhatsApp, and future
  adapter certification cell.
- All nine reply capabilities cross the shared adapter boundary.
- Project Chat and widget preserve equivalent browser deliveries.
- WhatsApp native buttons, lists, media, templates, and product messages obey
  provider requirements and limits.
- Unsupported rich messages retain readable text fallbacks.
- Tenant-scope, TypeScript, lint, and cron checks pass.

Run the full automated release gate before UAT sign-off:

```bash
npm run certify:release
```

It additionally verifies:

- The production build completes.
- The complete browser and database E2E suite passes.
- Active flow runs remain pinned to their published version.
- A durable Wait job pauses, resumes, and submits once.
- Database-backed tenant isolation passes.

For a complete local run that does not call OpenAI while iterating, use:

```bash
npm run certify:release:offline
```

The offline gate runs the production build, deterministic browser and database
tests, and tenant isolation while excluding only scenarios tagged
`@live-openai`. Before release UAT, run the paid-provider smoke separately or
use the unchanged full release command:

```bash
npm run test:openai-smoke
```

The smoke command is serialized and covers document embedding plus one
grounded RAG answer. Passing the offline gate alone is not release approval.

## Live Sign-Off

Automation does not prove ownership or health of an external account, number,
domain, browser, or device. Record these checks in Phase 14 of
`docs/UAT_TEST_PLAN.md`:

- Project Chat visual and workflow acceptance.
- Widget embedding on the intended UAT origin.
- Live Meta credentials and webhook verification.
- WhatsApp Business phone-number ownership and device delivery.
- Approved-template delivery outside the service window.
- Native and fallback WhatsApp presentation.
- Media and catalog resources hosted and linked by the provider.
- Durable WhatsApp resume delivered exactly once through the outbox.

Automated certification passing means the release candidate is ready for live
UAT. It does not by itself mean the release is approved.
