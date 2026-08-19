# Lia Conversational Flow Roadmap

Status date: 2026-08-18

## Document Authority

This file is the single source of truth for implementation status across Lia's
flow builder, conversational tasks, tool system, execution runtime, channel
adapters, and flow-specific verification.

- Update capability and phase checkboxes only in this file.
- `BETA_READINESS_CHECKLIST.md` owns the overall beta release decision and
  references this roadmap's exit gates instead of duplicating implementation
  tasks.
- `docs/UAT_TEST_PLAN.md` owns manual test instructions and individual test-run
  evidence. Passing one UAT item does not mark an unfinished roadmap capability
  complete.
- `LEIGIA_BLUEPRINT_ALIGNMENT_AUDIT.md` is architectural background, not an
  active implementation tracker.

When documents disagree about whether a flow capability is implemented, this
roadmap controls. When they disagree about whether Lia may be released to beta,
`BETA_READINESS_CHECKLIST.md` controls.

This is the active implementation roadmap for Lia's universal conversational
automation platform. Lia will use a hybrid model:

- Goal-driven conversational tasks let an LLM conduct natural interactions,
  collect several required details from one message, ask only for missing or
  invalid information, accept corrections, and use approved business tools.
- Deterministic flow nodes remain available for exact messages, menus,
  compliance, routing, transactions, fallbacks, handoff, and channel-specific
  presentation.
- The server, not the LLM, remains responsible for validation, business truth,
  permissions, side effects, routing, versioning, and audit history.

The primary canvas unit therefore becomes a business task such as `Book an
appointment`, not necessarily one node per question. Explicit question and
content nodes remain available when a business needs a tightly scripted
journey.

`docs/Flow Builder v2.pdf` remains the minimum functional reference for
deterministic content types and actions. Its examples define capabilities Lia
must support, but they do not force every interaction to use a long
question-by-question canvas.

WhatsApp remains the strongest initial standards reference and live
certification channel. Persisted task, flow, state, and tool contracts must
remain channel-independent so the same published automation works in project
chat, the website widget, WhatsApp, and future channels.

`docs/UAT_TEST_PLAN.md` contains detailed manual test instructions.
`BETA_READINESS_CHECKLIST.md` continues to track the broader SaaS, deployment,
database, backup, and provider readiness work.

## Status Rules

- `[x]` means the capability or architecture decision is complete in the current repository.
- `[ ]` means implementation, migration, automated verification, live UAT, or approval remains.
- A similarly named feature does not count as complete when its runtime, persistence, validation, routing, security, or editor behavior is partial.
- A major roadmap item is complete only after implementation, focused tests, and the relevant UAT instructions are updated.
- Create a commit at each stable contract, migration, runtime, tool, editor, adapter, and verification boundary.

## Current Position

- [x] The original 15-phase flow-builder foundation is complete.
- [x] The later 10-phase runtime modernization program is engineering-complete.
- [x] One shared server runtime executes project chat, widget, WhatsApp, and future-adapter flows.
- [x] Active runs are pinned to immutable published flow versions.
- [x] The current runtime supports 32 executable deterministic step types.
- [x] Current nodes persist ordered text, choice, media, and catalog content blocks.
- [x] Current content blocks can be added, edited, reordered, duplicated, and removed.
- [x] Friendly message, input, and action editor families exist.
- [x] The React Flow canvas supports saved layout, routes, diagnostics, compact editing, and advanced editing.
- [x] Typed conditions support AND/OR groups, value checking, reachability, cycle detection, and terminal-path validation.
- [x] Durable jobs support retries, idempotency, leases, outbox delivery, encrypted secrets, tracing, and Wait resumption.
- [x] Shared channel adapters declare native, conditional, fallback, and unsupported delivery.
- [x] A 108-cell matrix covers 27 step types across project chat, widget, WhatsApp, and the reference future adapter.
- [x] Twenty-three focused editor/compiler tests and eleven channel contract tests passed on 2026-07-23.
- [x] A first-class goal-driven Conversational Task exists.
- [x] Durable conversational field collection, correction, and confirmation exist.
- [x] The LLM has a constrained, proposal-only turn and tool-request protocol.
- [x] Grounded Q&A can enter a bounded task and return to Q&A within one version-pinned conversation.
- [x] Deterministic canvas actions can answer a grounded side question and repeat the exact pending prompt without advancing or losing flow state.
- [x] One bounded, negation-safe cancellation classifier is shared by conversational tasks and deterministic canvas actions.
- [ ] Full rich-content parity with `docs/Flow Builder v2.pdf` is not complete.
- [x] Direct button, list-row, product, and result-to-node mapping is complete.
- [x] Phase 14 staging cross-channel UAT passed under the single-tester scope on 2026-08-15.
- [x] Priority 2 release approval is complete for continued internal testing.

Active delivery gate: Priority 3, Phase 17 of 18. Engineering implementation
and manual staging UAT are complete through Phase 16 under the single-tester
scope as of 2026-08-18. Phase 17 diagnostics and automated conversation
scenarios have passed staging UAT.

Current target: validate project-scoped tester findings and reusable regression
promotion on staging, then continue the remaining Phase 17 evaluation and
optimization milestones.

### Phase Tracking Snapshot

| Phase | Implementation status | Manual verification or release status | Remaining work |
| --- | --- | --- | --- |
| 1-7 | Complete | Passed | None. |
| 8 | Priority 1 exit gate complete | Passed on 2026-08-03 | One deferred enhancement remains: map typed-input requests to a configured native WhatsApp Flow control. |
| 9-13 | Complete | Passed by 2026-08-05 | None. |
| 14 | Complete | Passed on staging under the single-tester scope on 2026-08-15; the missing disposable restore environment is tracked in `docs/UAT_DEFERRED_ITEMS.md` | None for this gate. |
| 15 | Complete | Passed on staging under the single-tester scope on 2026-08-16; automatic durable-worker scheduling is tracked in `docs/UAT_DEFERRED_ITEMS.md` | None for this gate. |
| 16 | Complete | Passed on staging under the single-tester scope; post-gate deterministic interruption regression passed on 2026-08-18 | None. |
| 17 | Foundation, deterministic operation fixtures, project-scoped conversation diagnostics, tester findings, and regression promotion | Milestones 17.1-17.2 passed; 17.3 ready for staging UAT | Reuse, evaluations, analytics, optimization, version comparison, experiments, and cloning. |
| 18 | Future-adapter foundation only; 11 implementation items remain unchecked | Not started | Public extension contracts, conformance tests, a real external channel, plugin boundaries, and extension proofs. |

## Product Direction

- [x] Make bounded business tasks the primary abstraction for natural conversations.
- [x] Keep explicit deterministic nodes as a complementary precision mode.
- [x] Let one visitor message populate several task fields.
- [x] Ask only for information that is still required, invalid, ambiguous, or stale.
- [x] Let visitors correct or clear previously collected information.
- [x] Keep task completion deterministic even when conversation wording is generated by an LLM.
- [x] Keep validation and business rules outside the model.
- [x] Keep prices, availability, catalog entries, policies, and booking results grounded in approved tools or project data.
- [x] Require explicit confirmation before a task performs a consequential write operation.
- [x] Keep one channel-independent task and flow definition.
- [x] Keep one server-owned execution engine.
- [x] Preserve immutable published versions and deterministic active runs.
- [x] Use WhatsApp interaction standards without making persisted contracts WhatsApp-specific.
- [x] Treat every functional example in `docs/Flow Builder v2.pdf` as a required capability, not a required graph topology.
- [x] Use the existing project retrieval pipeline as a controlled knowledge capability without replacing document ingestion or chunking.
- [x] Let ordinary Q&A enter a bounded task and return to Q&A without making the visitor choose between separate bot modes.
- [x] Give the active task ownership of required field collection while allowing bounded side questions to return to the same task.
- [x] Transfer only explicitly reusable, validated values across Q&A and task boundaries, with provenance preserved.

## External Capability Benchmark

The non-voice functional benchmark combines the strongest relevant patterns
from Telnyx AI Assistants and the previously reviewed WhatsApp flow-builder
references.

- Assistant-level identity, greeting, behavior, model policy, context,
  knowledge, tools, testing, versions, and observability.
- Goal-driven prompt stages for natural intake, qualification, booking,
  verification, support, and escalation.
- Deterministic exact-message stages for disclosures, compliance text,
  confirmations, and other wording that must not be generated.
- Reusable shared tools attached by stable versioned references.
- Per-task and per-stage tool permissions.
- Typed runtime context variables with declared sources and safe defaults.
- Semantic conditions for meaning-based decisions and deterministic conditions
  for structured business rules.
- Asynchronous tool execution with typed result delivery back into an active
  task.
- Rich message composition, direct option-to-node routing, deterministic
  actions, and channel-aware rendering based on the WhatsApp builder
  references.
- Immutable publication, realistic test scenarios, traceable runtime
  decisions, and rollback.

Lia is not targeting Telnyx telephony-network parity. PSTN, SIP, DTMF,
transcription, voice interruption, call transfer, and hang-up controls remain
future adapter capabilities and are not required for the non-voice beta.
Provider ecosystem size and years of production scale are also not capability
checkboxes.

The target is:

- Phase 8: safe goal-driven conversational core.
- Phase 14: beta-level functional parity for project chat, website widget, and
  WhatsApp within the declared non-voice scope.
- Phase 18: documented extension parity for new channels, models, and tools.

## Runtime Responsibility Boundary

The LLM may:

- Interpret the visitor's current message in conversation context.
- Extract candidate values for allowed task fields.
- Recognize corrections, cancellation, uncertainty, and requests for clarification.
- Request an approved read-only tool when current business information is needed.
- Propose the next conversational action from a closed set.
- Compose a concise visitor-facing response within the published task policy.
- Recommend handoff when confidence or policy requires it.

The LLM must not:

- Change which fields or rules are required by the published task.
- Mark an invalid value as valid.
- Invent project resources, identifiers, prices, availability, policies, or operation results.
- Directly read or write tenant data.
- Directly call an arbitrary URL, database, provider, or operation.
- Perform a consequential write before deterministic confirmation and authorization.
- Change graph routes, publish flows, or modify the active task contract.
- Treat retrieved documents, visitor messages, or tool results as higher-priority instructions.

The Lia server must:

- Validate every model response against a versioned structured schema.
- Validate and normalize every candidate field value.
- Resolve every resource and tool inside the current tenant and project.
- Decide which fields remain required.
- Authorize and execute approved tools.
- Generate the canonical confirmation summary.
- Apply idempotency, retry, timeout, secret, and audit controls.
- Decide the final task outcome and graph route.
- Provide a deterministic fallback when the model is unavailable or unsafe.

## Reference Conversational Task

The first complete reference task will be `Book Spa Service`.

It will collect and maintain canonical values for:

- Service category.
- Service.
- Preferred date.
- Preferred time.
- Guest name.
- Guest email.
- Guest phone.

It will use project-owned resources and tools for:

- Service and category discovery.
- Price and duration lookup.
- Date and time validation.
- Current availability lookup.
- Confirmed booking submission.

It will expose named graph outcomes for:

- `completed`
- `cancelled`
- `unavailable`
- `validation_failed`
- `timeout`
- `provider_failed`
- `handoff`

# Priority 1: Goal-Driven Conversational Core

Priority 1 proves that Lia can safely complete a real business task through a
natural conversation. The LLM controls wording and interpretation inside a
bounded task; the existing graph, runtime, tools, and published versions
control business behavior.

## Phase 1: Versioned Conversational Task Contract

Goal: define the universal task model before implementing model-driven runtime
behavior.

- [x] Define `ConversationalTaskV1` as a versioned, channel-independent contract.
- [x] Define `KnowledgeConversationV1` as the versioned, channel-independent contract for grounded ordinary Q&A.
- [x] Define `ConversationEntryPolicyV1` for knowledge-first, task-first, or deterministic-node entry using published configuration.
- [x] Define `ConversationIdentityV1` for project-scoped anonymous visitors, sessions, channel identities, and verified contact association.
- [x] Require an explicit verified rule before identities or conversation state can be linked across channels.
- [x] Define `DataHandlingPolicyV1` for field sensitivity, consent, retention, expiry, model/tool/log visibility, export, and deletion.
- [x] Define `AssistantPolicyV1` for shared identity, greeting strategy, base behavior, global constraints, and model policy.
- [x] Keep assistant policy separate from task-specific objectives, fields, tools, and outcomes.
- [x] Give every task a stable ID, name, objective, description, and schema version.
- [x] Define `TaskIntentRecommendationV1` so Q&A can recommend only an allowlisted published task and optional candidate field mappings.
- [x] Define `ConversationReturnPolicyV1` for completed, cancelled, failed, no-answer, and handoff task outcomes.
- [x] Define named knowledge outcomes for answered, task-recommended, no-answer, handoff, and cancelled.
- [x] Define one active response-owner rule across knowledge, task, deterministic graph nodes, and authorized humans.
- [x] Limit V1 to one active conversational task and prohibit recursive task calls.
- [x] Define bounded task-switch, connected-flow, and handoff depth with deterministic cycle fallback.
- [x] Define an explicit field-transfer whitelist with source, validation state, freshness, sensitivity, and provenance requirements.
- [x] Define a versioned task-field contract with a stable field ID and field key.
- [x] Keep visitor-facing labels separate from field keys and canonical values.
- [x] Define `ContextVariableDefinitionV1` with a stable key, type, source, default, sensitivity, expiry, and model/tool visibility.
- [x] Reserve a `lia_` namespace for system context such as channel, current time, conversation ID, project, locale, and timezone.
- [x] Distinguish trusted initialization context from visitor-collected task fields and transient model output.
- [x] Define deterministic precedence for system, tenant, project, contact, channel, webhook, and default context sources.
- [x] Keep context-variable keys immutable after creation while allowing user-managed source and type metadata to be edited.
- [x] Use explicit `{{context.variableKey}}` references so trusted context cannot be confused with visitor fields or WhatsApp positional variables.
- [x] Centralize context dependency discovery for task messages, field rules, and outcome conditions.
- [x] Show every discovered dependency beside the context variable in the task editor.
- [x] Protect `lia_` and system-sourced context from user editing and deletion.
- [x] Block deletion of referenced context without cascading changes into dependent configuration.
- [x] Block publication when a task contains an unresolved context reference.
- [x] Support text, email, phone, integer, decimal, boolean, date, time, date range, address, location, media, enum, and project-resource field types.
- [x] Support single-value and repeatable task fields without adding industry-specific field types.
- [x] Keep an optional visitor-facing prompt separate from the field label, key, and canonical value.
- [x] Define channel-independent static-choice and project-resource option sources, including dependent resource filtering.
- [x] Define required and conditionally required fields.
- [x] Define field validation, normalization, sensitivity, and confirmation policies.
- [x] Define field source priority for visitor input, trusted profile data, project resources, and tool results.
- [x] Define field dependencies such as category before service and service before availability.
- [x] Define `ToolDefinitionRefV1` and `ToolBindingV1` so tasks reference stable versioned tools instead of embedding provider configuration.
- [x] Define allowed read tools and allowed write operations separately.
- [x] Define default-deny tool permissions at assistant, task, and conversational-stage boundaries.
- [x] Define task-level wording, brevity, language, fallback, and handoff policies.
- [x] Define task-level verified-contact, authenticated-user, and consent requirements independently from project defaults.
- [x] Define a degraded-mode policy for model, retrieval, business-tool, and outbound-channel unavailability.
- [x] Define model policy separately from business task data.
- [x] Define named task outcomes and stable output ports.
- [x] Define deterministic task completion and cancellation conditions.
- [x] Define the order of extraction, validation, lookup, clarification, confirmation, operation, and routing.
- [x] Embed the complete task contract in immutable published versions.
- [x] Pin assistant policy, context definitions, tool versions, and bindings in immutable published versions.
- [x] Pin normalized project AI behavior in each immutable task version so later project-setting edits cannot change published behavior.
- [x] Keep existing V1 deterministic flow definitions readable and executable.
- [x] Add assistant-policy, task, field, context, tool-binding, and outcome fixtures.
- [x] Add focused schema and compatibility tests.
- [x] Block publication for duplicate identifiers, invalid choice references, cyclic field dependencies, malformed tool bindings, and invalid lifecycle order.
- [x] Expose the advanced Phase 1 identity, consent, context, choice, resilience, and data-handling settings without mixing in provider-specific configuration.

Phase 1 exit gate: the versioned contracts can describe the complete reference
booking task, grounded Q&A entry, approved task recommendation, return
behavior, identity, data handling, degraded behavior, trusted context, and
allowed tools without embedding channel or provider-specific logic.

Phase 1 status: Complete. Manual UAT and the closure addendum passed on
2026-07-25.

## Phase 2: Durable Task State And Field Lifecycle

Goal: persist everything needed to collect, validate, correct, confirm, pause,
and resume a conversational task safely.

- [x] Add project-scoped task-run state pinned to the active published version.
- [x] Persist the active conversation owner and mode as knowledge, task, deterministic graph node, or authorized human.
- [x] Persist the active node, active task, suspended return target, and published version as one coherent execution position.
- [x] Persist anonymous visitor, session, channel identity, and verified contact references without silently merging them.
- [x] Apply session expiry and rotation without losing an active durable task that policy allows to resume.
- [x] Define `InboundEventV1` with a stable event ID, channel identity, conversation ID, occurred time, received time, and provider sequence when available.
- [x] Persist a resolved initialization-context snapshot separately from task fields and conversation messages.
- [x] Store task field values separately from transient model messages.
- [x] Track each field as missing, candidate, valid, invalid, confirmed, or cleared.
- [x] Track value provenance without exposing hidden model reasoning.
- [x] Track validation results, update time, attempt count, and last requested field.
- [x] Accept several field candidates from one visitor message.
- [x] Support explicit and contextual corrections.
- [x] Support clearing a previously collected value.
- [x] Revalidate dependent fields when an upstream value changes.
- [x] Recalculate conditionally required fields after every valid update.
- [x] Preserve canonical values while allowing natural visitor wording.
- [x] Support cancellation, restart, pause, no-reply, and resume.
- [x] Support answering a bounded side question and resuming the same task without losing its requested field.
- [x] Support explicit task cancellation or switching according to the published return policy.
- [x] Ensure only the active response owner can consume and mutate state for an inbound turn.
- [x] Preserve task state through Wait and connected-flow boundaries where permitted.
- [x] Track pending synchronous and asynchronous tool requests against the current task run and published version.
- [x] Accept authenticated typed external-result events without allowing arbitrary system-prompt injection.
- [x] Prevent duplicate inbound events from applying the same update twice.
- [x] Prevent stale concurrent turns from overwriting newer state.
- [x] Serialize state mutation per conversation and handle delayed or out-of-order events deterministically.
- [x] Quarantine or safely ignore events that cannot be reconciled with the active version and execution position.
- [x] Redact sensitive values from routine logs and diagnostics.
- [x] Enforce configured field and message expiry, export, and deletion without breaking tenant isolation.
- [x] Record a readable, tenant-scoped task audit trail.
- [x] Add migration and cleanup behavior for abandoned task runs.
- [x] Add database-backed task-state isolation and concurrency tests.

Phase 2 exit gate: an isolated conversation can move between grounded Q&A and
one active task, answer a side question, and resume, correct, cancel, or
complete the task without losing values or applying duplicate, stale, or
out-of-order updates.

Phase 2 status: Complete. All 33 implementation items and all ten manual UAT
steps passed on 2026-07-25.

## Phase 3: Structured LLM Turn Engine

Goal: let an LLM interpret and continue a task through a narrow, validated
protocol rather than unrestricted agent behavior.

- [x] Define one server-owned model-provider interface.
- [x] Compile model instructions from the versioned assistant policy, active task or stage, allowed tools, resolved context, and current validated state.
- [x] Define a strict turn-result schema for grounded reply, field candidates, task-intent recommendation, requested tool, next action, and outcome recommendation.
- [x] Restrict next actions to ask, clarify, lookup, confirm, complete, cancel, handoff, or fail.
- [x] Build model instructions from the published task contract and current validated state.
- [x] Ground ordinary Q&A through the existing project retrieval interface and the published answer and no-answer policy.
- [x] Treat every task-intent result as a recommendation that the server validates against published, reachable, and allowed task IDs.
- [x] Require deterministic confirmation or one focused clarification before an ambiguous semantic task switch.
- [x] Treat values inferred during Q&A as candidates until the target task validates and accepts them.
- [x] During an active task, distinguish a field answer or correction from a side question, cancellation, or explicit task switch.
- [x] Support wait-for-visitor, exact configured greeting, and policy-generated greeting modes.
- [x] Define versioned default-model and fallback-model behavior with bounded time and cost.
- [x] Keep per-stage model overrides in advanced configuration and pin them to the published version.
- [x] Send only the task context and tenant data required for the current turn.
- [x] Keep system and task policy above visitor, document, and tool content.
- [x] Treat retrieved text as untrusted knowledge content that cannot start a task, grant a tool, or change graph policy.
- [x] Apply published input and output safety policy before visitor content reaches the model and before generated content is delivered.
- [x] Define deterministic refuse, clarify, safe-fallback, and human-handoff behavior for blocked content.
- [x] Apply project and platform abuse, turn-rate, token, and cost limits before model or tool execution.
- [x] Ensure moderation and abuse decisions cannot silently mutate task fields, invoke tools, or advance routes.
- [x] Validate every model result before applying any field or action.
- [x] Reject unknown fields, tools, actions, outputs, and resource identifiers.
- [x] Add bounded repair attempts for malformed structured output.
- [x] Add confidence and ambiguity handling without trusting confidence as validation.
- [x] Treat semantic route recommendations as proposals that require server validation before the graph advances.
- [x] Ask one focused clarification when several interpretations remain valid.
- [x] Support multilingual visitor messages while retaining canonical field values.
- [x] Prevent the assistant from repeatedly introducing itself during one conversation.
- [x] Keep responses concise and avoid unsolicited offers or contact details.
- [x] Add deterministic wording fallbacks when model generation fails.
- [x] Add model timeout, retry, rate, token, cost, and latency controls.
- [x] Store safe decision summaries rather than private chain-of-thought.
- [x] Add adversarial prompt-injection and malformed-output tests.
- [x] Add model-independent fixtures so core runtime tests do not require a live provider.

Phase 3 exit gate: the model can answer grounded Q&A and propose a safe task
transition or conversational turn but cannot change state, call a tool, or
route the graph without server approval.

Phase 3 status: Complete. Implementation verification passed and all eight
manual UAT steps were approved on 2026-07-26.

## Phase 4: Deterministic Validation And Business Tools

Goal: ground every task field and business fact in project-owned validation,
resources, or approved tools.

- [x] Build one typed validator registry for every supported task-field type.
- [x] Normalize phone, email, number, date, time, date-range, address, location, and media values.
- [x] Apply project timezone and locale consistently.
- [x] Support fixed choices and dynamic project-resource choices.
- [x] Resolve catalog categories, services, products, and other resources by stable project ID.
- [x] Add a typed, tenant-scoped tool registry with versioned input and output schemas.
- [x] Add a company/project-scoped reusable Tool Library with stable tool IDs and immutable tool versions.
- [x] Keep reusable tool definitions separate from assistant, task, and stage bindings.
- [x] Require a clear model-facing description and server-facing execution policy for every tool.
- [x] Separate read tools from consequential write operations.
- [x] Default every task and stage to no model-callable tools until tools are explicitly allowed.
- [x] Validate every requested tool against the published task allowlist.
- [x] Validate tool arguments against current canonical task state.
- [x] Reject resources that do not belong to the current project.
- [x] Add service detail, price, duration, and availability lookup tools for the reference task.
- [x] Support versioned synchronous and asynchronous execution modes, timeouts, retries, and cancellation behavior.
- [x] Define `ToolResultEventV1` for validated success, no-result, rejected, timeout, provider-failure, and cancelled outcomes.
- [x] Map only approved tool-result paths into canonical context or task state.
- [x] Store current business facts from tool results rather than model assertions.
- [x] Mark stale or failed lookups for refresh before confirmation.
- [x] Present tool errors in plain language without exposing credentials or provider payloads.
- [x] Define deterministic no-result, ambiguous-result, timeout, and provider-failure behavior.
- [x] Add safe test fixtures for every tool outcome.
- [x] Add tenant-isolation tests for resources, tools, results, and task mappings.

Phase 4 exit gate: the task can collect natural language while every canonical
value and current business fact remains deterministic and tenant-safe.

Phase 4 status: Complete. Type checking, contract tests, database-backed
runtime tests, tenant-isolation scenarios, lint, and all eight manual UAT steps
passed on 2026-07-26.

## Phase 5: Confirmation, Operations, And Outcomes

Goal: complete consequential business tasks without allowing the LLM to perform
or fabricate side effects.

- [x] Generate the confirmation summary from canonical validated values.
- [x] Require confirmation for every configured consequential write operation.
- [x] Let the visitor correct any value from the confirmation step.
- [x] Revalidate changed and dependent values before showing confirmation again.
- [x] Prevent the model from treating conversational agreement as confirmation when policy requires an explicit answer.
- [x] Map confirmed fields into approved operation inputs.
- [x] Authorize the operation against the published task and current project.
- [x] Re-read volatile price, availability, eligibility, and authorization facts immediately before a consequential write.
- [x] Derive a stable operation idempotency key from the task run, published version, and operation definition.
- [x] Use existing encrypted secrets, timeout, retry, idempotency, job, and trace infrastructure.
- [x] Prevent double submission after retries, duplicate messages, refreshes, or resumed runs.
- [x] Treat a lost or ambiguous provider response as `outcome_unknown` instead of assuming success or failure.
- [x] Add reconciliation and, where supported, compensating behavior for partial or uncertain external outcomes.
- [x] Do not tell the visitor an operation succeeded until the authoritative result is persisted.
- [x] Store sanitized operation outputs and map approved values back into task state.
- [x] Route successful completion through the `completed` output.
- [x] Route unavailable, validation, timeout, provider failure, outcome unknown, cancellation, and handoff independently.
- [x] Add a deterministic human-handoff boundary.
- [x] Keep the task open when a recoverable operation fails.
- [x] Close the task only after a terminal outcome is persisted.
- [x] Add operation audit events without exposing credentials or unnecessary PII.
- [x] Add end-to-end operation tests for every named outcome.

Phase 5 exit gate: a confirmed reference task executes exactly once, routes
according to the persisted business result, and reconciles an uncertain
external outcome without reporting false success.

Phase 5 status: Complete. Type checking, lint, four focused operation database
tests, all 17 shared conversational-runtime database tests, and all eight
focused manual UAT steps passed on 2026-07-26.

## Phase 6: Conversational Task Builder Experience

Goal: let a non-technical business user configure a bounded conversational task
without writing prompts, JSON, or one question node per field.

- [x] Add a first-class Business Task entry point to the builder palette; actual graph placement is Phase 7.
- [x] Offer task templates for booking, lead capture, support intake, and custom collection.
- [x] Organize assistant and task setup into Behavior, Context, Tools, Knowledge, Workflow, Test, and Versions views.
- [x] Use task name, objective, and completion action as the primary setup.
- [x] Present required information as friendly field cards.
- [x] Add, remove, duplicate, and reorder task fields.
- [x] Configure field type, required state, validation, and visitor-facing description without technical terminology.
- [x] Configure conditional requirements through a guided rule editor.
- [x] Select catalogs, services, tools, operations, and reusable fields by name.
- [x] Add a reusable Tool Library view and select pinned tool versions by friendly name.
- [x] Show inherited and task/stage-specific tools with explicit default-off permissions.
- [x] Add typed context-variable setup with source, fallback, sensitivity, and autocomplete in supported text fields.
- [x] Show missing project resources as `Needs setup` instead of inventing defaults.
- [x] Configure confirmation, cancellation, retry, fallback, and handoff policies.
- [x] Prepare named outcome destinations and friendly post-outcome selectors; canvas handles and compiled graph routes are Phase 7.
- [x] Keep exact wording optional and separate from the business field definition.
- [x] Keep raw prompt overrides and model settings out of the primary editor.
- [x] Keep provider-specific and voice-only controls out of the non-voice primary editor.
- [x] Place allowed advanced controls inside collapsed sections with safe defaults.
- [x] Add a task test chat that shows canonical fields, validation, requested tools, and outcome decisions.
- [x] Distinguish visitor-visible replies from developer diagnostics.
- [x] Add per-channel preview without changing the universal task.
- [x] Preserve keyboard, responsive, and screen-reader usability through shared labeled controls and responsive layouts.
- [x] Confirm a non-technical tester can configure the reference booking task.

Phase 6 exit gate: a business user can create and test the reference task from
one focused editor without constructing seven separate collection nodes.

Phase 6 status: Complete. Type checking, lint, 24 focused task schema and
builder tests, all 69 channel and conversational contract tests, and focused
manual UAT passed on 2026-07-26.

## Phase 7: Hybrid Graph Compiler And Runtime Integration

Goal: allow deterministic nodes and conversational tasks to coexist in one
versioned graph with predictable routing.

Phase 7 execution checkpoints:

- [x] Step 1 of 6: graph contracts and compiler.
- [x] Step 2 of 6: builder controls and simulator.
- [x] Step 3 of 6: persisted boundaries and published-version pinning.
- [x] Step 4.1 of 6: shared single-owner hybrid-boundary dispatcher.
- [x] Step 4.2 of 6: knowledge-to-task entry and whitelisted value transfer.
- [x] Step 4.3 of 6: task outcome return and deterministic-flow resume.
- [x] Step 4.4 of 6: project-chat and widget integration.
- [x] Step 4.5 of 6: WhatsApp integration and response-ownership enforcement.
- [x] Step 5 of 6: combined cross-channel verification and documentation.
- [x] Step 6 of 6: focused manual UAT and phase closure.

Step 4.2 status: the shared entry service now resolves the exact published task
version, verifies the graph-approved recommendation, intersects graph and task
transfer policies, initializes only declared context, and submits approved
visitor values through the existing deterministic field-validation runtime.

Step 4.3 status: completed, cancelled, failed, and handed-off task events now
resolve one immutable named output route inside the durable task transaction.
The transaction restores the configured published node and response owner, or
closes the graph, without executing the resumed node during the same event.

Step 4.4 status: project chat and the website widget now enter the same
project-scoped hybrid boundary runtime after deterministic execution. The
runtime uses the pinned action and task versions, preserves one response owner,
applies task field and outcome events through the authoritative durable task
runtime, and resumes deterministic nodes through the existing channel-flow
executor.

Step 4.5 status: the signed WhatsApp webhook now enters that same shared
post-boundary runtime before replies are adapted and queued through the existing
WhatsApp outbox. All three live channels resolve the active project-scoped
submission and pinned action version through one helper, while the boundary
dispatcher suppresses automated execution whenever a human owns the response.

Step 5 status: `npm run test:channel-certification` passed all 87 contract
tests on 2026-07-27. The automated gate covers project-chat and widget reply
parity, WhatsApp native and fallback delivery rules, every hybrid node across
all declared adapters, immutable task-version boundaries, one-owner dispatch,
and human-response suppression. The production build also passed at the Step
4.5 checkpoint. Step 6 manually verifies the published hybrid graph, local
project-chat boundary, response ownership, and universal channel entry rules.
The task boundary now reloads authoritative field state after every model
proposal and replaces false progress or confirmation wording with the next
server-required correction. Cancellation and grounded side questions remain
available while fields are unresolved. As soon as the service, date, and time
inputs required by the bound availability lookup are valid, the live task
boundary refreshes availability before collecting contact details or showing
confirmation wording. Unavailable, missing, stale, or failed availability
blocks confirmation, and the operation boundary independently requires
canonical availability to be `true`.
Live widget and WhatsApp provider delivery remain the Phase 13 certification
gate, while the complete reference booking journey remains Phase 8 work.

- [x] Extend the universal graph contract with conversational-task nodes.
- [x] Add a first-class knowledge-conversation node backed by the existing project retrieval interface.
- [x] Represent goal-driven prompt stages and deterministic exact-message stages through one versioned graph contract.
- [x] Resolve the published entry policy for normal sessions, approved deep links, campaigns, and channel entry points.
- [x] Keep the knowledge node active after an answered outcome unless an approved route explicitly changes ownership.
- [x] Allow a server-approved task recommendation to enter an allowlisted published conversational task.
- [x] Return completed, cancelled, failed, and handed-off tasks to their configured knowledge or deterministic target.
- [x] Answer an allowed side question and resume the suspended task without a graph transition.
- [x] Give explicit button, list-row, product, and deterministic routes precedence over semantic task recommendations.
- [x] Transfer only whitelisted validated fields and approved context across knowledge and task boundaries.
- [x] Compile every task outcome as a named source output port.
- [x] Keep task-internal clarification turns inside the active task node.
- [x] Advance the graph only after the server records a task outcome.
- [x] Allow deterministic content before and after a conversational task.
- [x] Allow deterministic conditions to route into and out of a task.
- [x] Allow Wait, handoff, approved operations, and connected flows at task boundaries.
- [x] Prevent two active response collectors from competing for one inbound message.
- [x] Transfer response ownership atomically when a human accepts a handoff and suppress automated replies while human-owned.
- [x] Record inbound messages during human ownership without model or task mutation unless an explicit policy permits it.
- [x] Resume automation only through an authorized release action and a valid published return target.
- [x] Preserve branch precedence and explicit default routes.
- [x] Support semantic, deterministic variable, default, tool-result, and named task-outcome transitions.
- [x] Restrict semantic conditions to meaning-based decisions and require deterministic conditions for structured business rules.
- [x] Persist per-stage tool bindings and advanced model overrides in the published graph.
- [x] Validate required task outcomes, tool mappings, resources, and operations at publish time.
- [x] Block publication when a task recommendation target, return target, no-answer route, handoff route, or fallback is missing.
- [x] Detect unreachable tasks, orphan outputs, cycles, and paths without terminal outcomes.
- [x] Reject recursive task entry and task-switch or connected-flow paths that exceed the published depth limit.
- [x] Pin task behavior, fields, tools, prompts, and routes to the published version.
- [x] Resume the correct task and version after delayed or asynchronous work.
- [x] Normalize inbound free text, button, list, product, location, and media responses before task interpretation.
- [x] Emit channel-neutral reply intents from the shared runtime.
- [x] Preserve existing deterministic V1 flows without forced conversion.
- [x] Add import and export support for task contracts and named routes.
- [x] Add compiler, runtime, migration, and version-pinning tests.

Phase 7 exit gate: one published graph can safely move between grounded Q&A,
natural conversational tasks, and exact deterministic steps across the shared
runtime while keeping exactly one response owner.

## Phase 8: Reference Booking Task And Priority 1 Verification

Goal: prove the new architecture through the complete `Book Spa Service`
journey before broadening task types or channel certification.

Phase 8 execution checkpoints:

- [x] Step 1 of 6: temporal normalization and channel-adaptive typed inputs.
- [x] Step 2 of 6: reference catalog dependencies and deterministic lookups.
- [x] Step 3 of 6: corrections, side questions, cancellation, confirmation,
  and completion.
- [x] Step 4 of 6: provider operations, outcomes, idempotency, and interruption
  recovery.
- [x] Step 5 of 6: tenant safety, security, degraded behavior, retention, and
  observability.
- [x] Step 6 of 6: complete scenario verification, manual UAT, and Priority 1
  closure.

Checkpoint 6 closure verification passed on 2026-08-03: all eight release
gates, 110 channel and conversation contract tests, the production build, 205
post-UAT offline database-backed browser scenarios, two serialized live OpenAI
scenarios for document ingestion and grounded Q&A, and tenant-isolation
database checks completed successfully. All six focused manual UAT steps passed
and are signed off in `docs/UAT_TEST_PLAN.md`.

- [x] Build the reference task using the project service catalog.
- [x] Keep the Lia project catalog as the channel-independent source of truth.
- [x] Treat WhatsApp catalog and retailer identifiers as optional channel
  mappings instead of core catalog identities.
- [x] Manage catalogs and products through create, edit, archive, restore, and
  permanent-delete controls.
- [x] Block permanent deletion while a catalog or product is still referenced
  by a draft or immutable published flow or task version.
- [x] Keep every catalog lifecycle read, write, dependency scan, and audit
  event explicitly project-scoped.
- [x] Start the reference journey in grounded Q&A, answer a normal project question, and then recognize a booking request.
- [x] Enter `Book Spa Service` only after the server approves the task recommendation.
- [x] Carry only fresh, whitelisted candidate values into the task and validate them before use.
- [x] Collect all seven reference fields through one task node.
- [x] Accept several valid details in one visitor message.
- [x] Ask only for missing, invalid, ambiguous, or stale details.
- [x] Resolve supported relative dates such as `today` and `tomorrow` from the trusted turn timestamp and project timezone.
- [x] Store accepted dates and times in canonical channel-independent formats.
- [x] Ask for clarification when a relative date or time cannot be resolved unambiguously.
- [x] Emit a channel-neutral typed-input request for the next unresolved field.
- [x] Render native date and time controls in project chat and the website widget when the channel supports them.
- [ ] Map typed-input requests to a native WhatsApp Flow control when configured, with a clear text fallback otherwise.
- [x] Verify unsupported channel capabilities fall back without changing the task contract or collected value.
- [x] Resolve category and service dependencies.
- [x] Look up current price, duration, and availability.
- [x] Correct one field without restarting the task.
- [x] Answer a project side question during booking and resume the same requested field.
- [x] Cancel the task and return to ordinary Q&A without ending the conversation.
- [x] Complete the task and return to the configured Q&A or deterministic continuation.
- [x] Clarify an ambiguous task request instead of choosing a task silently.
- [x] Verify an explicit button or list route enters its mapped task without semantic rerouting.
- [x] Invalidate and refresh dependent availability after date, time, or service changes.
- [x] Show a canonical confirmation summary.
- [x] Submit one idempotent booking operation after confirmation.
- [x] Exercise completed, cancelled, unavailable, validation-failed, timeout, provider-failed, and handoff outcomes.
- [x] Resume the correct task after refresh, Wait, and a simulated worker interruption.
- [x] Verify model failure uses the deterministic fallback.
- [x] Verify prompt injection cannot change fields, tools, operations, or routes.
- [x] Verify tool data cannot override task instructions.
- [x] Verify retrieved content cannot start a task, invoke a tool, or change the configured return target.
- [x] Verify anonymous sessions remain isolated and contact or cross-channel state links only after the configured verification rule.
- [x] Verify duplicate, delayed, and out-of-order inbound events cannot overwrite newer task state or repeat an operation.
- [x] Verify retention, export, and deletion policies cover conversation messages, task fields, model traces, and operation records.
- [x] Verify blocked or abusive content follows the published safety outcome without mutating business state.
- [x] Verify an ambiguous provider response enters reconciliation and never produces a false success message.
- [x] Verify human takeover prevents dual replies and authorized release resumes the correct version-pinned target.
- [x] Verify recursive task entry and excessive task-switch or connected-flow depth are rejected.
- [x] Exercise deterministic degraded behavior for model, retrieval, business-tool, and outbound-channel outages.
- [x] Verify logs and diagnostics do not expose secrets or unnecessary PII.
- [x] Add deterministic model fixtures and live-provider smoke tests.
- [x] Add scenario tests with explicit success criteria for expected fields, tool calls, routes, replies, and terminal outcomes.
- [x] Add safe mocked outcomes for synchronous, asynchronous, timeout, rejected, provider-failed, outcome-unknown, and reconciled tools.
- [x] Trace assistant policy version, conversation-owner transitions, task/stage, return reason, field changes, tool calls, routes, model usage, latency, and cost with PII redaction.
- [x] Add database-backed cross-tenant tests.
- [x] Update the conversational-task phases in `docs/UAT_TEST_PLAN.md` for
  completed Phase 8 checkpoints.
- [x] Record no unresolved Critical or High Priority 1 defect.

Priority 1 exit gate: Lia can complete a real booking through a bounded,
versioned, resumable, and tenant-safe natural conversation.

Phase 8 status: Complete. The final reference booking journey, safety boundary,
seven-field persistence and correction, exactly-once operation, safe audit, and
cleanup passed manual UAT on 2026-08-03.

# Priority 2: Deterministic Controls And Channel Readiness

Priority 2 retains the precision of the existing builder, completes the PDF
capability baseline, and certifies both conversational tasks and explicit flows
across production channels.

## Phase 9: Composed Content And Explicit Interaction Controls

Goal: preserve a complete deterministic authoring mode for exact messages and
structured interactions.

- [x] Existing nodes can combine ordered text, choice, media, and catalog content.
- [x] Existing content can be reordered, duplicated, edited, and removed.
- [x] Finalize the versioned universal node and ordered-content contracts.
- [x] Allow several compatible presentation blocks and one response collector in a node.
- [x] Prevent incompatible or ambiguous response collectors.
- [x] Show every universal Add Content option in one menu.
- [x] Keep inapplicable content visible with a plain-language disabled reason.
- [x] Complete Text and Buttons.
- [x] Complete Media and Buttons.
- [x] Complete structured lists with sections and rows.
- [x] Complete Catalog, Single Product, and Multiple Product messages.
- [x] Complete media for image, video, audio, and documents.
- [x] Complete typed template components and variable mappings.
- [x] Keep visible labels separate from stable IDs and stored values.
- [x] Preserve content order through save, reload, preview, publish, export, import, and runtime.
- [x] Keep provider identifiers and channel restrictions out of primary universal fields.
- [x] Add publish blockers for incomplete content.
- [x] Confirm every deterministic message example in `docs/Flow Builder v2.pdf` can be authored without raw JSON.

Phase 9 Checkpoint 1 status: Complete on 2026-08-03. Ordered node content now
uses a version 1 `contentDocument` envelope with stable block IDs and normative
array order. Existing `contentBlocks` arrays remain readable, edited content is
migrated on save, and unsupported explicit document versions cannot silently
fall through to stale legacy content. Six focused content-contract tests, three
catalog dependency checks, the existing canvas save/reload scenario, and the
119-test fast release certification passed.

Phase 9 Checkpoint 2 status: Complete on 2026-08-03. Text, media, and catalog
blocks now share an explicit presentation role, while buttons and lists share
one response-collector role. The authoritative composition contract accepts
several presentations plus one collector and rejects a second collector; both
editor menus and the server save boundary use the same rule. Thirteen focused
content/menu checks, the canvas save/reload scenario, and the 126-test fast
release certification passed.

Phase 9 Checkpoint 3 status: Complete on 2026-08-03. One shared compatibility
rule now rejects response collectors on presentation-only nodes and nodes that
already collect from manual or dynamic choices, while preserving edits to
stored legacy collectors. Both editor menus continue to show every registered
option and now expose the specific incompatibility reason. Fifteen focused
content/menu checks, the canvas save/reload scenario, and the 128-test fast
release certification passed.

Phase 9 Checkpoint 4 implementation status: Complete on 2026-08-03. Choice
content now preserves separate labels, stable IDs, stored values, descriptions,
sections, headers, and footers. Media, catalog, and typed WhatsApp template
content use universal structured contracts; ordered content is preserved through
save, reload, preview, publish, export, import, and runtime. Publish validation
blocks incomplete resources and conflicting stable identifiers. The focused
canvas save/reload scenario and the 137-test fast release certification passed.

Phase 9 Checkpoint 5 automated status: Complete on 2026-08-03. The production
build, 138 contract tests, 225 offline browser and database tests, tenant
isolation checks, and both serialized live OpenAI smoke scenarios passed. The
focused six-step manual plan was prepared in `docs/UAT_TEST_PLAN.md`; its
sign-off was the remaining Phase 9 exit requirement at this checkpoint.

Phase 9 Checkpoint 6 status: Complete on 2026-08-03. All six focused manual
UAT steps passed. Defects found during UAT were corrected so structured choices
show visitor labels while retaining stable stored values, export downloads do
not enter client navigation, and React owns file-import form encoding. Focused
browser regressions cover those fixes, and no unresolved Critical or High
Phase 9 defect remains.

Phase 9 exit gate: explicit nodes provide complete composed-content control
when a business needs exact interaction wording or presentation.

## Phase 10: Per-Option Routing And Response Policies

Goal: complete exact routing and deterministic collection behavior around the
new task-first model.

- [x] Existing choice values can route through branch rules.
- [x] Ask Question supports common text, contact, date, time, and number formats.
- [x] Ask Address, Ask Location, and Ask Media store structured values.
- [x] Give every button, list row, product, and selectable result a stable option ID and output port.
- [x] Add route, URL, and phone button behavior where supported.
- [x] Connect each routable option through a canvas handle or `Go to` selector.
- [x] Make both routing controls write the same graph edge.
- [x] Preserve routing when labels change or are translated.
- [x] Add documented default and no-match outputs.
- [x] Warn before deleting a connected option.
- [x] Block duplicate, conflicting, missing, or invalid option routes.
- [x] Add a first-class boolean input.
- [x] Add retry count, retry message, and retry-exhausted output.
- [x] Add no-reply reminder, timeout, and output.
- [x] Add cancellation and validation-failure outputs.
- [x] Keep retry, no-reply, cancellation, and collection state durable.
- [x] Keep deterministic response policies pinned to the active published version.
- [x] Confirm every deterministic input example in `docs/Flow Builder v2.pdf` has complete success and failure behavior.

Phase 10 Checkpoint 1 status: Complete on 2026-08-03. One shared option
identity contract now gives composed buttons and list rows, manual and dynamic
choices, and selectable products a stable ID with a deterministic
`option:<id>` output port. Manual option edits preserve existing identities and
stored values when labels change or options are reordered, while legacy values
remain readable and receive persistent IDs on their next save. No database
migration was required. Nine focused option/runtime checks, TypeScript, lint,
tenant-scope analysis, cron validation, and all 139 channel contracts passed.

Phase 10 Checkpoint 2 status: Complete on 2026-08-03. Every runtime-resolvable
choice or product option now exposes a stable canvas handle and a `Go to`
selector; both controls upsert the same option-tagged branch-rule edge. The
compiler blocks malformed identity metadata, missing or stale options, value
mismatches, duplicate routes, and conflicting destinations. Route labels are
resolved from the current option label, the fallback edge is explicitly shown
as `default / no match`, and connected options must have their route cleared
before removal. No database migration was required. TypeScript and 21 focused
compiler/canvas checks passed.

Phase 10 Checkpoint 3 status: Complete on 2026-08-03. Composed choice rows now
support deterministic reply, website, and phone behavior. Browser channels
render safe website and telephone links without advancing the flow, while
channels that cannot express those calls to action receive a readable fallback
containing the destination. Only reply options expose routes or satisfy answer
validation. A first-class Yes / No input now stores typed booleans and exposes
stable `boolean-true` and `boolean-false` output ports. Legacy composed-content
JSON continues to round-trip without acquiring new default fields. No database
migration was required. TypeScript, lint, and 55 focused content, runtime,
compiler, adapter, input-family, and channel-certification checks passed.

Phase 10 Checkpoint 4 implementation status: Complete on 2026-08-03. Every
deterministic input now stores a versioned response policy with bounded retry
count and message, validation-failure, retry-exhausted, cancellation, and
no-reply-timeout destinations. Awaited-response state, attempt counts, pinned
action-version identity, reminder deadlines, and timeout deadlines are stored
durably on the submission; reminder and timeout work is scheduled through the
existing leased job queue. Stale scheduled work is skipped after any visitor
answer or route change, and browser and WhatsApp delivery share the same
scheduled-reply boundary. Named policy routes are visible on the canvas and
invalid destinations block publication. No database migration was required
because the versioned policy and state use existing JSON contracts and the job
type column is already extensible. TypeScript, lint, and 43 offline focused
checks passed. The database-backed retry, cancellation, reminder, timeout, and
published-version-pinning lifecycle regression also passed.

Phase 10 Checkpoint 5 status: Complete on 2026-08-03. The deterministic input
examples in the supplied Flow Builder v2 reference were audited against the
implemented contracts: Ask Address and Ask Location store validated structured
values; Ask Question covers free text, numbers, dates, booleans, email, and
custom regex; and Ask Media covers image, audio, video, and file input with
allowed-type validation. Every family now shares the same required, invalid,
retry, exhausted, cancellation, reminder, and timeout behavior. The reference's
previously unclear media "attempts" concept is represented explicitly as the
bounded retry count rather than an implicit channel-specific counter.

Phase 10 Checkpoint 6 status: Complete on 2026-08-03. The production build, 142
channel and universal-content contracts, all 244 offline browser and database
scenarios, and tenant-isolation checks passed before UAT. All six focused
manual scenarios then passed. UAT findings were corrected with focused
regressions for unambiguous option labels, durable-worker batch defaults,
completed-chat hydration after refresh, and first-publication draft/runtime
comparison. Lint and TypeScript passed after the final fix, and the isolated
first-publication regression confirmed that an action becomes `Active` without
a false unpublished-settings warning. No database migration was required, and
no unresolved Critical or High Phase 10 defect remains.

Phase 10 exit gate: businesses can choose either flexible task collection or
fully scripted collection with stable per-option routes.

## Phase 11: Actions, API Operations, And Deterministic Outcomes

Goal: complete the deterministic action baseline and expose every operational
result as a named route.

- [x] Request Intervention supports visitor message, queue, priority, notification intent, and operation notification.
- [x] Conditions support typed values and AND/OR groups.
- [x] Connect Flow supports jump and return behavior with recursion protection.
- [x] Set Attribute and Add Tag persist contact data.
- [x] Wait supports durable pause and resume.
- [x] Operations support mappings, success and failure routing, retries, timeouts, idempotency, encrypted secrets, and attempt history.
- [x] Add Remove Tag, Subscribe, Unsubscribe, Assign Agent, and Assign Team where permissions permit.
- [x] Add HTTP method selection for GET, POST, PUT, PATCH, and DELETE.
- [x] Add friendly query parameter, header, and body editing.
- [x] Add safe test requests with test values.
- [x] Preview sanitized response status and response body.
- [x] Map nested response values through a friendly selector.
- [x] Add custom HTTP status-code outputs.
- [x] Add success, client-error, server-error, timeout, and network-failure outputs.
- [x] Connect every API output directly to a specific node.
- [x] Keep credentials out of flow exports and diagnostics.
- [x] Add publish blockers for invalid URL, method, mapping, secret, and output configuration.
- [x] Confirm every action in `docs/Flow Builder v2.pdf` can be configured and executed.
- [x] Add focused runtime and tenant-isolation tests for every result path.

Phase 11 status: Complete on 2026-08-04. The runtime supports all five remaining contact mutations, five
HTTP methods, friendly request and nested response mapping, isolated test
requests, sanitized previews, five standard result outputs, custom HTTP status
outputs, and direct named output-to-node routes. Credentials are encrypted at
rest and redacted from previews and exports. Publication blocks unavailable or
invalid operations, credentials, mappings, methods, endpoints, and output
routes. TypeScript and lint pass, 47 focused contract/editor/compiler checks
pass, and the scoped contact and named-route database checks pass, including
cross-project rejection. The five existing conversational-operation database
regressions and all 143 shared channel/runtime contracts also pass. No
migration was required. All six focused manual scenarios passed. UAT findings
were corrected with focused changes for friendly validation, nested preview
mapping, secured-header publication, operation and provider feedback, scroll
restoration, and one-time Sonner status messages. Both disposable actions were
archived, the test operation and provider were disabled, and no unresolved
Critical or High Phase 11 defect remains.

Phase 11 exit gate: explicit actions and conversational tasks use the same
approved operation, security, durability, and routing boundaries.

## Phase 12: Universal Channel Adapter Upgrade

Goal: carry conversational tasks and richer deterministic content through the
existing channel adapter boundary.

- [x] Project chat and widget already use the shared browser adapter.
- [x] WhatsApp already uses native and fallback delivery from the shared runtime.
- [x] The reference future adapter already consumes the channel-neutral reply envelope.
- [x] Version the runtime reply envelope for task prompts, structured choices, content, and outcomes.
- [x] Normalize free text and native interactive replies into one inbound contract.
- [x] Preserve stable option and project-resource IDs across adapters.
- [x] Let a task request a question, choices, confirmation, media, or handoff without naming a channel.
- [x] Let adapters select a native interaction or readable fallback.
- [x] Map composed content, lists, products, media, and templates.
- [x] Enforce channel limits without changing the saved task or graph.
- [x] Keep model instructions and task state free of provider-specific payloads.
- [x] Add per-channel preview without changing the universal definition.
- [x] Prevent adapter delivery failure from changing task semantics.
- [x] Extend the certification matrix for every task reply and V2 content capability.

Phase 12 status: Complete on 2026-08-04. The version-one reply and inbound
contracts cover seven task reply intents and five inbound kinds across project
chat, widget, WhatsApp, and the reference future adapter. Automated evidence
includes 22 focused Phase 12 and adapter tests, all 143 channel certification
tests, lint, TypeScript, tenant-scope analysis, and 50 relevant serial browser
and database scenarios. Four unrelated platform-admin and invitation scenarios
require Playwright's isolated test-server environment and are not part of the
focused Phase 12 gate. Focused manual UAT passed all six read-only preview,
stable-value, fallback, refresh, and keyboard-navigation steps with no unresolved
Critical or High Phase 12 defect.

Phase 12 exit gate: the same task and deterministic graph have declared
delivery behavior in project chat, widget, WhatsApp, and a future adapter.

## Phase 13: Cross-Channel Conversational Certification

Goal: prove semantic task parity and deterministic outcome parity across live
channels.

- [x] Execute the reference booking task in project chat.
- [x] Execute the same published task in the website widget.
- [x] Execute the same published task through a UAT WhatsApp Business number.
- [x] Confirm all channels produce the same canonical fields and business outcomes.
- [x] Confirm response wording may vary without changing validation or routes.
- [x] Confirm multi-field extraction, clarification, correction, cancellation, and handoff.
- [x] Confirm button, list, product, location, media, and free-text replies normalize correctly.
- [x] Confirm service-window and approved-template requirements on WhatsApp.
- [x] Confirm content beyond provider limits uses documented readable fallbacks.
- [x] Confirm page refresh and delayed replies resume the correct version-pinned task.
- [x] Confirm duplicate events and stale clients do not duplicate operations.
- [x] Confirm project chat and widget visual acceptance.
- [x] Confirm widget responsive, origin, token, and accessibility acceptance.
- [x] Confirm WhatsApp webhook, media, template, retry, and outbox behavior.
- [x] Record every provider limitation as an adapter rule.

Phase 13 completed on 2026-08-05. All 154 channel contracts and all 24
serialized database-backed task-runtime scenarios pass. Focused live UAT
completed the same published `Book a Spa Service` v4 task through Project Chat,
Widget, and WhatsApp with equivalent seven confirmed canonical values and one
completed Manual Review attempt per channel. Submissions `#516`, `#520`, and
`#523` retain the linked task-run evidence. Widget origin, token,
responsiveness, and keyboard behavior passed; WhatsApp webhook, device
delivery, service-window, fallback, retry, idempotency, and outbox behavior
passed with documented Meta UAT limitations. Audit recipient metadata is
redacted, disposable handoff `#527` is closed, and the disposable wrapper action
is archived. Migration `0037_channel_message_idempotency.sql` remains applied
locally.

Phase 13 exit gate: every production channel reaches equivalent validated task
outcomes without introducing channel-specific task or graph persistence.

## Phase 14: Priority 2 Release Gate

Goal: approve the hybrid conversational platform for continued single-tester
staging and internal beta testing.

Current release evidence recorded on 2026-08-15: the full 10-gate
`npm run certify:release` run passed the production build, 171 channel
contracts, 315 database-backed browser scenarios, tenant isolation, and the
configured live-model path. Project Chat, Widget, and WhatsApp completed the
same staging booking with equivalent canonical fields and one Manual Review
attempt. The focused handoff UI correction, shared form feedback, and handoff
audit visibility passed their staging retests. The release owner accepted the
missing disposable restore environment as a beta limitation and approved the
single-tester internal scope on 2026-08-15. Phase 14 is complete.

To avoid maintaining three copies of the same release status, Phase 14 has no
separate checklist here:

- `BETA_READINESS_CHECKLIST.md` owns the release gates and approval decision.
- `docs/UAT_TEST_PLAN.md` owns the concise remaining staging, live-model,
  cross-channel, recovery, defect, and sign-off checklist.
- This roadmap records only the implementation boundary and exit gate.

Priority 2 exit gate: automated certification and staging UAT approve both
conversational tasks and deterministic flows for continued internal testing.

# Priority 3: Advanced Conversational Platform

Priority 3 broadens the task engine after the bounded booking reference and
production channels are stable.

## Phase 15: Advanced Knowledge, Memory, And Specialist Routing

Goal: extend the Priority 1 Q&A-to-task bridge with richer knowledge policy,
multi-intent selection, durable memory, and bounded specialist routing without
creating an unrestricted whole-bot agent.

- [x] Extend `KnowledgeConversationV1` with source selection, citations, recency, answer policy, and advanced no-answer behavior.
- [x] Keep retrieval sources, citations, recency, answer policy, and no-answer behavior explicit.
- [x] Prevent retrieved content from changing task instructions or tool permissions.
- [x] Keep company, project, and assistant references natural without mentioning internal documents or chunks.
- [x] Add concise grounded support replies with project-level answer guidance.
- [x] Extend baseline knowledge outcomes with moderation, timeout, provider-failure, and specialist-handoff outcomes.
- [x] Extend the baseline single-task recommendation into multi-intent routing with confidence thresholds and deterministic fallback.
- [x] Route into bounded booking, lead, support, and handoff tasks.
- [x] Add bounded specialist-task selection and explicit switch, pause, resume, and return policies.
- [x] Define a tenant-, project-, and contact-scoped memory policy with retention, consent, and selected structured facts.
- [x] Do not expose unrestricted cross-customer or cross-project conversation history to a model.
- [x] Add versioned post-conversation jobs for summaries, CRM logging, quality checks, and structured insights.
- [x] Restrict post-conversation jobs to explicitly approved idempotent tools and prevent channel-control actions.
- [x] Define bounded task/assistant handoff context with current intent, validated fields, prior actions, and handoff reason.
- [x] Track handoff history, enforce a maximum handoff depth, detect cycles, and provide a deterministic human fallback.
- [x] Let visitors change intent while preserving only explicitly reusable fields.
- [x] Add tenant-safe prompt, knowledge, model, and task isolation tests.
- [x] Add token, cost, latency, citation, retrieval, and outcome tracing.
- [x] Add channel-neutral knowledge replies and readable adapter fallbacks.

Phase 15 exit gate: Lia can apply advanced knowledge policy, memory,
multi-intent selection, and bounded specialist handoffs without granting the
model unrestricted graph or tool control.

Implementation closure: completed on 2026-08-08 in checkpoints `52604cd`,
`bba8c6e`, and `b5e0f9c`. Focused contract and runtime tests cover advanced
knowledge policy, bounded intent and handoff routing, governed memory, and
approved post-conversation jobs. Manual staging UAT passed under the
single-tester scope on 2026-08-16; the accepted automatic durable-worker
scheduling limitation remains tracked in `docs/UAT_DEFERRED_ITEMS.md`.

## Phase 16: Contact Lifecycle, Handoff, And Structured Forms

Goal: complete commercial conversation management and optional rich form
experiences.

- [x] Add remove tag, subscribe, unsubscribe, assign agent, and assign team.
- [x] Add reopen, resolve, close, and cancel conversation outcomes.
- [x] Add business-hours and queue-availability conditions.
- [x] Preserve lifecycle actions in audit logs and contact timelines.
- [x] Add permission rules before exposing assignment and lifecycle controls.
- [x] Preserve validated task fields during an authorized human handoff.
- [x] Define a universal structured-form capability.
- [x] Keep WhatsApp Flow JSON and future provider schemas at adapter boundaries.
- [x] Add browser rendering or guided conversational fallback for structured forms.
- [x] Add secure data-exchange, provider validation, versioning, and publication controls.

Phase 16 exit gate: conversations can move safely between tasks, people, and
structured forms while retaining canonical state and audit history.

Implementation closure: completed on 2026-08-09 in checkpoints `1706192` and
`4c43885`. Focused lint, TypeScript, the production build, all 164 contract
tests, and the Phase 16 structured-form contracts passed. The repeated offline
certification build reached its font-download step after those checks and was
blocked only by sandboxed Google Fonts access; the separately network-enabled
production build passed. Detailed manual sign-off is recorded in
`docs/UAT_TEST_PLAN.md` and remains the release-owner checkpoint.

Staging UAT milestone on 2026-08-16: the repaired `Support Ticket` template
published as version 1 with six reachable steps, its published-flow simulation
reached the terminal confirmation, and Project Chat submission `#75` preserved
all five structured fields. The submission then moved from `submitted` to
`under_review` to `completed`, with both transitions recorded in its event
history. Commit `dcc37a8` fixed and staging-verified field-scoped confirmation
edit actions. The Project Chat contact timeline retained the ordered transcript
and linked completed submission. Human handoff submission `#77` preserved the
three validated fields without storing the help request as a name, was claimed,
and moved out of the open queue as completed. Commits `6058ca2` and `60c0c7b`
fixed and staging-verified the deterministic handoff guard and assignment-action
visibility. Widget Preview submission `#78` then preserved the same five-field
support request with source `widget_chat` and no operation attempt. Phase 16
manual staging UAT passed under the single-tester scope on 2026-08-16.

## Phase 17: Reuse, Evaluations, Analytics, And Optimization

Goal: help teams reuse and improve both conversational tasks and deterministic
flows.

- [x] Reusable subflows, custom templates, reusable-field suggestions, flow analytics, and experiment metadata have working foundations.
- [ ] Add a typed reusable-field registry with ownership and compatibility checks.
- [ ] Add reusable task, field-set, node, and composed-content templates.
- [ ] Complete template approval, versioning, duplication, and upgrade guidance.
- [x] Add deterministic simulation fixtures for success, failure, retry, timeout, and provider responses.
- [x] Add generated conversation scenarios that replay published deterministic replies, valid synthetic answers, and exact next-node progression without live side effects or model calls.
- [x] Add a project-scoped conversation diagnostics view with a safe transcript, linked flow lifecycle, task/runtime status, and 24-hour request health.
- [x] Add project-scoped tester findings and promote selected findings into synthetic regression cases without copying transcript values.
- [ ] Add conversational evaluation datasets for extraction, correction, clarification, safety, and completion.
- [ ] Add regression thresholds before model or prompt changes are promoted.
- [ ] Measure task starts, completion, abandonment, correction, validation failure, handoff, and operation success.
- [ ] Measure token, latency, cost, tool usage, and model-fallback rates.
- [ ] Add conversion attribution by task, field, option, route, channel, and published version.
- [ ] Add draft comparison, published-version diff, and rollback controls.
- [ ] Add runtime traffic allocation for approved A/B variants.
- [ ] Add flow and task cloning across projects with safe resource remapping.

The published-flow automated test now synthesizes success, failure, retry,
timeout, and provider-response operation attempts, classifies them with the
production outcome contract, and verifies inline outcome routes against the
immutable published graph. Provider calls, durable jobs, conversations, and
submissions remain suppressed, and every run is retained in the existing audit
history.

The same automated run now generates a scenario for every unique published
deterministic entry route. It verifies non-empty replies, readable option text
fallbacks, valid synthetic field collection, and runtime progression against
the immutable graph. Model-owned, knowledge-owned, and resource-input segments
remain clearly skipped or delegated to their existing focused checks.

Conversation Diagnostics now correlates the project-scoped channel transcript,
linked flow lifecycle events, conversational task runs, execution ownership,
and aggregate 24-hour request health. The read model preserves configured
choice labels and selections while excluding provider payloads, hidden prompts,
credentials, names, contact details, addresses, and free-text collected values.

The same project-scoped diagnostics page now lets an authenticated tester record
a categorized finding against the selected conversation and promote it into one
reusable regression case. Promotion requires a tester-authored synthetic input
and expected behavior; it never copies redacted transcript content into the
regression record. Both mutations are tenant-scoped and auditable.

Phase 17 exit gate: teams can safely reuse, compare, evaluate, measure, and
optimize versioned conversational automations.

## Phase 18: Future Channels And Extension Model

Goal: prove that channels, models, tools, and task families extend the same
universal contracts.

- [x] The reference future adapter consumes the current universal runtime envelope.
- [ ] Document the public conversational task, reply, tool, operation, and V2 adapter contracts.
- [ ] Add conformance tests for third-party channel adapters.
- [ ] Add conformance tests for model providers and business tools.
- [ ] Certify at least one real non-WhatsApp external channel.
- [ ] Define plugin boundaries for inbound normalization and outbound delivery.
- [ ] Define plugin boundaries for capability declarations and readable fallbacks.
- [ ] Define plugin boundaries for encrypted credentials and tool authorization.
- [ ] Evaluate voice as a future adapter over the same task state.
- [ ] Confirm a new channel can be added without changing task or flow persistence.
- [ ] Confirm a new model can be added without changing business task contracts.
- [ ] Confirm a new business tool cannot bypass tenant, validation, confirmation, or audit boundaries.

Priority 3 exit gate: new channels, models, and tools extend Lia without
weakening deterministic business control.

## Recommended Execution Order

Start with Priority 1, Phase 1 of 18 and finish the phases in order.

The first implementation slice should use:

- One bounded reference task.
- One configured model provider behind the provider interface.
- One project-owned service catalog.
- Read-only service and availability tools.
- One idempotent booking operation.
- Project chat as the first development channel.

After the reference task is deterministic and well tested, certify the widget
and WhatsApp through the same runtime and task contract.

Do not begin with an unrestricted agent responsible for the whole chatbot.
Begin with bounded tasks that have explicit fields, tools, rules,
confirmation, outcomes, and fallbacks.

Do not remove or rewrite the existing deterministic runtime. Use it for exact
journeys, task boundaries, operational execution, recovery, and channel
delivery while the conversational task engine is added beside it.

Do not wait for every remaining visual PDF refinement before implementing the
task contract. The task-first runtime is now the primary product direction;
deterministic PDF parity remains mandatory complementary functionality.
