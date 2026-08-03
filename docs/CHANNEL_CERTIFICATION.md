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
