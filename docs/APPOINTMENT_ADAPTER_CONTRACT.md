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
| `appointment.availability` | `date` (`YYYY-MM-DD`) | `status`, `date`, `slots` |
| `appointment.book` | `start`, configured patient/contact/reason fields | Verified `status`, `appointmentRef`, `start`, `end`, `spoken` |
| `appointment.reschedule` | `appointmentRef`, `newStart`, configured identity fields | Verified `status`, `appointmentRef`, `start`, `end`, `spoken` |
| `appointment.cancel` | `appointmentRef`, configured identity fields | Verified `status`, `appointmentRef` |

An appointment has `{ appointmentRef, start, end, spoken }`. References are opaque and at most 200 characters. Start/end are ISO timestamps with an explicit offset; `spoken` is a timezone-labelled, human-readable description (at most 240 characters). Availability slots use the same shape without the reference. Lookup is bounded to 50 unique matches and availability to 16 slots. Invalid or duplicate references and malformed times fail closed. Adapters must paginate upstream results within their configured search horizon; if they cannot return a complete bounded match set, return `rejected` with a reason instead of silently claiming one match.

Webhook requests use Lia's existing operation envelope (`operationType`, `payload`, and correlation/idempotency metadata). The JSON response body uses `status: success | no_result | rejected | provider_failure | timeout | outcome_unknown | cancelled` and an optional safe `reason` code. HTTP success alone is insufficient. The transport response remains in the audit record; the business response is available at `responsePayload` for mappings.

Only lookup and availability are read-only. Book/reschedule/cancel remain confirmed writes. Bind availability and its booking/rescheduling operation to the same provider. Adapters must enforce authorization and availability again at write time, preserve booking details such as the reason during rescheduling, implement idempotency, and report success only after verifying the upstream change. Use `outcome_unknown` when the result cannot be verified; do not retry a possibly completed write blindly.

## Current coverage

Google Calendar and a mocked webhook adapter exercise the same Lia matching and selection logic. The webhook regression also covers availability and confirmation before rescheduling. No live Calendly adapter or account has been configured. Calendly integration requires implementing and validating this contract against its API and the target account's identity/booking data; changing the communication channel does not supply that adapter.
