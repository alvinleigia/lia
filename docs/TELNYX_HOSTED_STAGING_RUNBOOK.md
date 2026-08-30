# Telnyx Hosted Assistant Staging Runbook

This runbook prepares and executes Phase 18.14. It is for staging only. Use a
dedicated Telnyx number, Google calendar, transfer destination, and approved
test callers. Never use patient data or put API keys, binding credentials,
service-account keys, phone numbers, transcripts, or raw provider payloads in
Git, tickets, chat, or the UAT record.

## Release-owner inputs

The release owner must provide these through the relevant secret store or
provider console, not through source control:

- A staging-only Telnyx API key with the narrowest account access available.
- The Telnyx Ed25519 public key used to verify event webhooks.
- A dedicated Telnyx test number and an approved test-caller allowlist.
- A non-production transfer destination.
- A dedicated Google calendar shared only with the restricted Lia service
  account, with the `google_calendar` operation provider already configured.
- A public HTTPS staging origin in `NEXT_PUBLIC_APP_URL` and a high-entropy
  `VOICE_TOOL_COMMIT_SECRET` in the deployment secret store.

Do not continue if the staging origin is not HTTPS, the number receives public
traffic, or the calendar contains real customer or patient data.

For the first English-language latency baseline, use these provider values:

- Model ID: `moonshotai/Kimi-K2.6`
- Voice ID: `Telnyx.NaturalHD.astra`
- Transcription model ID: `deepgram/flux`
- Transcription language: `en`
- Estimated cost microunits/minute: `0` during setup; replace it with the
  observed staging rate before cost sign-off.

Keep the separate Lia voice-definition locale as `en-AU` and timezone as
`Australia/Sydney`. If Telnyx no longer offers one of these IDs in the Portal,
stop and select a currently listed native equivalent before publishing.

## 1. Publish a Lia candidate

1. Deploy the commit containing this runbook and open
   `/projects/channels/telnyx/hosted` as a member with
   `company.widget.manage` permission.
2. Save the hosted-provider settings. The API key is write-only and remains in
   Lia's encrypted provider-secret store. Add the Telnyx webhook public key so
   signed call-ended events can be accepted.
3. Select the published conversational task versions that contain the five
   Google Calendar operations: availability, book, lookup, reschedule, and
   cancel. Confirm the displayed locale, timezone, identity policy, explicit
   write-confirmation policy, retention, greeting, and instructions.
4. Publish the draft. Lia must create or reuse a verified **non-main** Telnyx
   Assistant candidate. Record masked Assistant, candidate, prior-main, Lia
   deployment-version, and definition-hash identifiers in the UAT record.

Publishing a candidate must not route production traffic or make it main.

## 2. Bind candidate tools

1. Select **Rotate candidate binding** once. This revokes the previous binding
   and displays one new bearer credential plus a candidate setup manifest.
2. Immediately create a Telnyx Integration Secret from that credential. Use
   the Telnyx Portal's secret selector when configuring authorization for each
   webhook tool. Do not put the credential in a URL, tool body, Assistant
   instructions, or Lia configuration. Lia will not show it again.
3. Apply every tool entry from the manifest to the exact non-main candidate
   version. Match its name, URL, method, body schema, async flag, and timeout.
   Configure the `Authorization` header as bearer authentication backed by the
   Integration Secret; the manifest intentionally contains no secret value.
4. Keep read operations as one `read` tool. Keep each write as separate
   `prepare` and `commit` tools. The Assistant must ask for explicit caller
   confirmation after prepare and pass the returned `commitToken` unchanged to
   commit. Never synthesize, edit, or reuse a commit token for another request.
   Availability and lookup are reads; booking, rescheduling, and cancellation
   are writes. Stop if the generated manifest classifies them differently.
5. Configure Telnyx-native transfer and hangup tools on the same candidate.
   Transfer may target only the approved staging destination.
6. Configure the manifest's signed event webhook URL for conversation-ended
   delivery. Send a test event and confirm Lia accepts a valid signature and
   rejects a missing, stale, or invalid signature.

If the Telnyx Portal cannot attach an Integration Secret to a webhook header,
stop and record the Portal/API behavior. Do not fall back to a credential in
the URL or instructions.

## 3. Route isolated test traffic

Use Telnyx candidate-version traffic distribution to route only the dedicated
staging number or approved caller targets to the candidate. Verify an
unapproved call remains on the existing main version. Do not promote yet.

## 4. Execute Phase 18.14

Run the ten checks in `docs/UAT_TEST_PLAN.md` section 18.14 in order:

1. Candidate isolation and version attribution.
2. Native greeting, ordinary conversation, barge-in, transfer, and hangup.
3. Availability, booking, lookup, reschedule, and cancellation.
4. Explicit confirmation and duplicate-delivery idempotency.
5. Two-call race for one slot.
6. Fast, pending, provider-failure, and `outcome_unknown` behavior.
7. Direct managed-field drift detection and overwrite blocking.
8. Candidate promotion and verified rollback.
9. Metadata-only, project-scoped, redacted diagnostics.
10. Normal-turn and tool P50/P95/P99 latency, actual call cost, and estimated
    cost per verified booking.

Never accept a spoken booking success without a verified Lia operation result.
A committed write continues authoritatively if the caller interrupts; a
pending asynchronous result must use truthful wait/pending wording.

## 5. Close the test window

1. Remove candidate traffic routing and verify the intended main version.
2. Revoke the temporary binding if the candidate will not be used again.
3. Remove test appointments and revoke temporary provider access through the
   owning consoles when no longer needed.
4. Add only masked IDs, aggregated latency/cost metrics, and defect links to
   the UAT record. Mark Phase 18.14 and the roadmap complete only after every
   check passes and rollback is proven.

If any check fails, leave Phase 18 in progress, restore the verified prior main
version, isolate the staging number, and attach a redacted defect reference.
