# Channel Provider Limitations

This document is the Phase 13 operator view of the typed rules in
`src/lib/channel-provider-rules.ts`. Runtime code remains authoritative; the
registry imports its numeric limits so documentation and certification fail
together if a provider rule changes.

## Project Chat

- Access requires an authenticated user who can open the selected project.
- Buttons, lists, and text are browser-native. Media and catalogue replies need
  valid project resources. Templates and handoff instructions use readable
  browser fallbacks.

## Website Widget

- Access requires an active project-scoped widget token.
- When allowed domains are configured, requests must provide a matching
  `Origin` or `Referer`. An empty allowlist intentionally permits every origin.
- The browser reply behavior matches Project Chat. The visitor session remains
  anonymous until the application associates it with a verified contact.

## WhatsApp

- Regular replies are limited to the 24-hour customer-service window. Outside
  that window, the next outbound message must be a template with an approved
  status, name, and language.
- Native interactive limits are 3 reply buttons, 10 list rows, and 30 product
  items. Larger or incomplete interactive payloads preserve their meaning as
  readable text instead of being silently dropped.
- Inbound media is limited to 16 MiB by the shared media validator. Outbound
  media needs an absolute public URL, or a configured application base URL that
  resolves the stored public path; otherwise the text fallback is sent.
- Outbound replies are written to a deduplicated durable outbox. Delivery is
  retried with bounded backoff and stops after 5 attempts.
- Webhook messages are bound to an active phone-number channel and require a
  valid provider signature when an application secret is configured. Duplicate
  inbound message identifiers must not repeat task or operation effects.

## Certification Rule

Wording and presentation may differ by channel. Canonical field keys, validated
values, pinned task versions, route decisions, outcomes, idempotency, and audit
ownership must not differ. A provider fallback passes only when the visitor can
still understand and complete the same business action.
