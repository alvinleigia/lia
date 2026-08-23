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

Engineering channel pending live certification:

- Telnyx Voice

Contract-only extension target:

- `reference_future`

The reference adapter is not a production channel. It is not stored in the
database and has no navigation or customer-facing UI. It proves that a future
transport can preserve correlation, reply capability, text, fallback text,
structured payload, and envelope version through the public adapter contract.
Legacy Telnyx Programmable Voice is stored through the existing channel tables
and participates in the automated matrix, but it is not the active production
release target. The Telnyx-hosted AI Assistant path has a separate deployment
and tool boundary and does not become a certified production channel until its
hosted milestones and live UAT pass.

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
- `src/lib/channel-plugin-contract.ts` composes one provider inbound normalizer
  and one outbound `ChannelReplyAdapter`. Its channel name is generic, so a
  third-party adapter can normalize input without joining Lia's persisted
  `ChannelType` union. It deliberately has no credential, database, task-state,
  model, or tool-execution member.
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
- `src/lib/telnyx-voice.ts` is the first real external adapter. Final speech
  transcripts enter as universal text input; text replies use native speech,
  rich replies use readable speech fallback, and handoff uses transfer only
  when the project has an approved destination.
- `src/lib/telnyx-voice-provider.ts` and
  `src/app/api/telnyx/voice/webhook/route.ts` form the server-owned provider
  boundary. The route validates the provider envelope and Ed25519 signature
  before accepting a call event. It stores provider lifecycle IDs for
  idempotency, sends deterministic call-control command IDs, and forwards only
  final non-empty transcripts into the shared runtime. API credentials are
  encrypted in project channel configuration, used only in authorization
  headers, and excluded from provider error messages and persisted deliveries.
- `src/app/projects/channels/telnyx` is the authorized project configuration
  surface. The API key is write-only in the form and encrypted before storage;
  leaving it blank preserves the existing credential. Activation requires a
  connection ID, API key, and valid Ed25519 public key. Audit metadata records
  only configuration booleans, channel status, and project-owned identifiers.

### Hosted voice deployment contracts

- `src/lib/hosted-voice-contract.ts` owns `VoiceAgentDefinitionV1`, deterministic
  normalization and hashing, explicit required capabilities, compatibility
  reporting, and the hosted-provider compile and remote lifecycle interfaces.
- The canonical voice definition contains behavior, greeting, locale,
  immutable task/tool references, confirmation, identity, handoff, retention,
  and required capabilities. Provider assistant/version IDs, models, voices,
  transcription settings, credentials, URLs, and payload shapes are rejected.
- `compileHostedVoiceAgent` validates required capabilities before a provider
  compiler runs. A missing capability is a blocking compatibility error; an
  adapter must not silently replace or omit required behavior.
- `src/lib/telnyx-hosted-voice.ts` is the provider-owned compiler boundary for
  Telnyx model, voice, and transcription settings. It produces a deterministic
  telephony-enabled Assistant draft plan using the current Telnyx greeting,
  `voice_settings`, and transcription fields, but performs no remote calls and
  receives no credential in the Phase 18.9 contract milestone.
- `tests/e2e/hosted-voice-contract.spec.ts` proves that provider deployment
  details cannot enter the canonical definition, hashes are stable across
  unordered references, Telnyx and a fake second provider compile the same
  definition hash, missing capabilities block compilation, and remote IDs stay
  outside the definition.

Contract versions are explicit. Backward-compatible additions may extend a V1
schema only when existing consumers continue to validate and behave the same.
A breaking field, meaning, or lifecycle change requires a new exported version
and an explicit compatibility path; provider-specific data stays behind its
adapter rather than changing these universal contracts.

### Third-party adapter conformance

`tests/e2e/channel-adapter-conformance.spec.ts` is the executable contract for
a channel type that is not part of Lia's built-in `ChannelType` union. It
verifies that an adapter:

- declares all public reply capabilities, inbound support, and finite or
  unbounded provider limits;
- accepts every `RuntimeReplyV1` capability without mutating the source reply;
- returns only a delivery mode allowed by its declared support;
- preserves correlation, visitor-facing text, readable fallback text, and the
  V1 envelope version in its provider delivery;
- reports non-empty fallback warnings; and
- throws `ChannelDeliveryError` when delivery fails so runtime semantics remain
  unchanged and retryability stays explicit.

New adapters must add their factory and provider-delivery reader to this
conformance pattern before they are added to the certification matrix.

### Model and business-tool conformance

`tests/e2e/model-tool-conformance.spec.ts` proves that extension providers stay
behind the existing public contracts:

- a `StructuredTurnProvider` receives bounded provider-neutral input and
  returns only a proposal plus usage metadata;
- the server rejects provider output that names fields or actions outside the
  immutable published task;
- business-tool input is rebuilt from canonical server state and rejects
  mismatched or undeclared proposed values;
- tool output retains only declared typed paths and approved result mappings;
  and
- provider URLs and credential material do not survive parsing into a
  published `ToolDefinitionV1`.

New model providers and business-tool adapters must pass equivalent fixtures
before they are selected by runtime configuration.

### Credentials and tool authorization

- Channel plugins receive provider events and runtime replies, never stored
  credentials. Server-owned transport code resolves the project channel and
  decrypts only the credential required for the authorized provider call.
- Operation-provider configuration passes through
  `prepareProviderConfig` in `src/lib/provider-secrets.ts`. Sensitive keys such
  as tokens, API keys, authorization headers, passwords, and private keys become
  encrypted project/provider-owned references before ordinary configuration is
  persisted.
- A business-tool extension supplies a published `ToolDefinitionV1` operation
  binding, not an arbitrary executable callback. The server rebuilds canonical
  input, verifies project and task-version ownership, enforces stage and
  confirmation rules, executes the project-owned operation, validates typed
  output, applies only approved mappings, and records the attempt and audit
  trail.
- These server authorization paths are not overridable members of
  `ChannelPluginContract`, `StructuredTurnProvider`, or `ToolDefinitionV1`.

## Automated Evidence

Run the fast gate during development:

```bash
npm run certify:release:fast
```

It verifies:

- Every enabled flow step has one typed certification family.
- Every enabled step has an explicit project-chat, widget, WhatsApp, and future
  adapter certification cell, with Telnyx Voice tracked as an additional
  engineering channel.
- All nine reply capabilities cross the shared adapter boundary.
- Project Chat and widget preserve equivalent browser deliveries.
- WhatsApp native buttons, lists, media, templates, and product messages obey
  provider requirements and limits.
- Unsupported rich messages retain readable text fallbacks.
- Tenant-scope, TypeScript, lint, and cron checks pass.
- Third-party adapter profiles and deliveries conform to the public adapter
  boundary.
- Model providers remain proposal-only, and business tools preserve canonical
  input, typed output, and secret-free published contracts.
- Telnyx webhooks reject missing, stale, or tampered signatures; final speech,
  call-control configuration, credential placement, and retryable delivery
  errors pass the provider-boundary contract tests.
- Telnyx lifecycle planning covers answer, greeting, speech interruption,
  cancellation delivery, transfer handoff, and hangup closure. Incomplete final
  transcript processing can resume on a provider retry without reinterpreting a
  completed turn.
- Database runtime certification completes one immutable task contract across
  all four persisted channels and executes one confirmed, project-scoped
  operation from Telnyx state without bypassing the operation attempt ledger.

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

For legacy Telnyx Programmable Voice sign-off, also record:

- Voice API application ownership, number assignment, connection ID, and
  verified webhook delivery on staging.
- Audible greeting, final-transcript turns, and interruption of active speech.
- One shared task cancellation and one approved handoff transfer.
- One confirmed project operation and its project-scoped attempt/diagnostic
  record, with no credential or raw provider response exposed.
- Remote hangup closes the channel conversation and a later new call starts a
  separate active conversation.

For the active Phase 18 hosted-assistant sign-off, record:

- The Lia voice definition hash, Telnyx Assistant candidate and main version
  IDs, promotion record, and verified rollback target.
- Native greeting, ordinary conversation, interruption, transfer, and hangup
  without Lia processing each speech turn.
- Availability and every appointment write through the authenticated Lia tool
  gateway, including explicit confirmation, duplicate delivery, a slot race,
  and verified final state.
- Fast, pending, provider-failure, and `outcome_unknown` behavior without a
  false spoken success or duplicate write.
- A direct Telnyx managed-field change that is detected as drift and blocks an
  accidental overwrite.
- Redacted correlated diagnostics plus normal-turn and tool P50/P95/P99
  latency, actual call cost, and estimated cost per verified booking.
