# Lia appointment adapters

Lia collects and validates task fields, resolves an upcoming appointment, offers choices, checks availability, and requires confirmation before a write. Chat and voice use the same task runtime and choice values. A calendar provider supplies identity-scoped results and performs the actual calendar operation.

## Identity and selection

Collect the configured identity fields before the internal appointment reference. Phone can be the primary lookup factor; retain any additional verification configured for the provider (the existing Google Calendar adapter supports configurable identity factors). A typed phone number is a lookup identifier, not proof of phone ownership. Providers enforce the project's verification policy and scope all queries to the configured project/calendar.

Keep `appointmentRef` as a required **internal, tool-supplied** task field. Bind a read lookup at the lookup stage and map `responsePayload.appointments.0.appointmentRef` to that field. Existing published Google Calendar task mappings remain compatible. Lia filters out appointments that have already started, resolves one upcoming match automatically, and asks the caller to select from multiple matches. The index-zero mapping runs only after Lia resolves a single verified appointment; it never arbitrarily selects the first result.

Choices accept the displayed label, number, ordinal (such as `second`), or an exact matching reference. Identical labels prompt the caller to use a reference or ask staff for help. Lia retains the full offer in the scoped operation ledger, rechecks a chosen reference and its original times with the provider, and invalidates the reference when a lookup identity field changes. Selection itself performs no write. The final booking change still requires confirmation.

## Provider operation contract

Google Calendar keeps its existing `google_calendar.*` operations. A webhook or n8n adapter can implement these provider-neutral operations:

| Operation | Canonical input | Business response |
| --- | --- | --- |
| `appointment.lookup` | Configured identity fields | `status`, `appointments` |
| `appointment.availability` | `date` (`YYYY-MM-DD`) | `status`, `date`, `slots`; optional complete-day `allSlots`, `availabilityComplete` |
| `appointment.book` | `start`, configured patient/contact/reason fields | Verified `status`, `appointmentRef`, `start`, `end`, `spoken` |
| `appointment.reschedule` | `appointmentRef`, `newStart`, configured identity fields | Verified `status`, `appointmentRef`, `start`, `end`, `spoken` |
| `appointment.cancel` | `appointmentRef`, configured identity fields | Verified `status`, `appointmentRef` |

An appointment has `{ appointmentRef, start, end, spoken }`, with optional `timezone` (IANA timezone) and `appointmentReason` (string up to 240 characters, or null when unavailable). Cancellation and rescheduling reviews include the matched appointment's start/end in that timezone, its recorded reason, and its reference. If an adapter omits a timezone, Lia explicitly displays UTC. Missing reasons display "Not recorded". These provider facts are part of the saved confirmation hash; changed facts require fresh approval. References are opaque and at most 200 characters. Start/end are ISO timestamps with an explicit offset; `spoken` is a timezone-labelled, human-readable description (at most 240 characters). Availability slots use the same shape without the reference. Lookup is bounded to 50 unique matches and availability to 16 slots. Invalid or duplicate references and malformed times fail closed. Adapters must paginate upstream results within their configured search horizon; if they cannot return a complete bounded match set, return `rejected` with a reason instead of silently claiming one match.

Webhook requests use Lia's existing operation envelope (`operationType`, `payload`, and correlation/idempotency metadata). The JSON response body uses `status: success | no_result | rejected | provider_failure | timeout | outcome_unknown | cancelled` and an optional safe `reason` code. HTTP success alone is insufficient. The transport response remains in the audit record; the business response is available at `responsePayload` for mappings.

Only lookup and availability are read-only. Book/reschedule/cancel remain confirmed writes. Bind availability and its booking/rescheduling operation to the same provider. Adapters must enforce authorization and availability again at write time, preserve booking details such as the reason during rescheduling, implement idempotency, and report success only after verifying the upstream change. Use `outcome_unknown` when the result cannot be verified; do not retry a possibly completed write blindly.

## Current coverage

Google Calendar and a mocked webhook adapter exercise the same Lia matching and selection logic. The webhook regression also covers availability and confirmation before rescheduling. No live Calendly adapter or account has been configured. Calendly integration requires implementing and validating this contract against its API and the target account's identity/booking data; changing the communication channel does not supply that adapter.


## Preferred times beyond the first offer

`slots` remains the short display list (maximum 16). To support a complete search
of the requested business day, an adapter may additionally return
`availabilityComplete: true` and `allSlots`, containing every available start on
that day, within the configured opening hours, duration, slot interval, and
scheduling horizon. Each item has the same `{start, end, spoken}` shape as `slots`.
The full set is bounded to 300 unique valid starts; do not mark a truncated result
complete. Google Calendar now supplies this full set from the same daily free/busy
read used to construct its short list, without an additional provider request.

Lia owns exact-time matching, local-time window filtering, and nearest-slot ranking.
A request such as "Is 3:30 pm available?" or "after 2 pm" triggers a fresh read in
an active slot-selection conversation. Lia selects a single verified exact match,
or offers up to six matching/nearby choices. It retains the task's date, identity,
reason, and selected existing appointment. An ambiguous clock/timezone requires
clarification. A provider failure is not reported as an unavailable time.

The scoped ledger retains the complete result. Field validation, reviews, and
confirmation-time revalidation use it, so a later selected slot is not rejected
merely because it was outside the initial display list. Writes still require
confirmation and the provider's final availability/idempotency checks.

Older adapters returning only `slots` remain supported. Lia can verify slots they
return, but cannot claim that an omitted time is unavailable or search beyond that
partial set. Such adapters need to implement the complete-day response contract
before offering full preferred-time search. This is an adapter capability, not a
per-flow code change. The hosted Google Calendar tool result also exposes the
bounded complete-day fields for voice consumers; no new Telnyx account or live
Calendly integration is part of this change.


A preferred clock time may be collected before the appointment to change or its
new date. Lia retains it as an unverified visitor candidate and resolves it against
this availability contract after the prerequisites are collected. It is not a
booking-ready timestamp until a provider-returned slot matches. Side questions
retain pending appointment choices, and ambiguous values require clarification.
This behavior reuses the existing field ledger and adapter bindings.
