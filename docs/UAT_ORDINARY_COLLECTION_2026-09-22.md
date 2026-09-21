# Ordinary collection UAT — 2026-09-22

Scope: live Project Chat on `https://lia-staging.leigia.com`, isolated project
95, action 62. The flow uses ordinary configured input steps, not a Business
Task. Synthetic enquiries only; no calendar operation or external notification.
The reusable import is `tests/staging/fixtures/ordinary-collection.json`.

## Deployed retest

Candidate `00991b0` deployed successfully to staging and production. On staging,
all ten ordinary-form Project Chat scenarios passed, including malformed contact
correction, mobile time entry, and draft/publication/version pinning. The seven
Bike Service Business Task scenarios also passed again. Evidence:
`test-results/staging-nonvoice-candidate-report.json` (17 Project Chat passes;
its two widget failures were test synchronization issues, retested below).

The embedded widget passed on desktop and mobile: a complete natural-language
request retains valid fields while rejecting quantity 99, accepts quantity 2,
skips Colour on the inspection branch, resumes review after iframe reload, and
saves after confirmation. Evidence:
`test-results/staging-widget-candidate-report-3.json` (2 passes).
The browser harness now waits for the actual iframe navigation before typing
after reload; previously it typed into the document being replaced.

The publication check restored the original prompt and published it again;
action 62 is now version 5. These cases verify reusable configured fields in
ordinary flows and Business Tasks, not arbitrary unsupported field types or
unconfigured external providers.

## Initial live results before the fixes

On deployed commit `7b5e37d`, eight scenarios passed:

- All eight fields extracted from one natural message; confirmation saves the enquiry.
- Quantity outside the configured range rejected; later details retained.
- Branch skips Colour and excludes even a supplied Colour from review.
- Missing Time requested; a short time answer completes the review.
- Ambiguous Colour clarified; unrelated details retained.
- Browser reload resumes the pending question and retained fields.
- Edit Email changes only that field and returns to review.
- Draft prompt changes do not affect runtime; publication affects new conversations;
  an existing conversation retains its published version after reload.

Evidence: `test-results/staging-ordinary-report-2.json`,
`test-results/staging-ordinary-recovery-report.json`, and
`test-results/staging-ordinary-version-report.json`. The version test restores
the original prompt and publishes it again (version 3 at that point).

One scenario failed: a message containing an invalid email and short phone
number caused Lia to ask for the already supplied name. A direct model
reproduction also treated malformed email as semantic ambiguity. The extraction
instruction now preserves explicit malformed values as candidates for server
validation. Both the focused live-model regression and deployed UI retest now
pass, including correcting email and phone without recollecting other details.

## Changes and automated verification

- Review, resume, completion and preview summaries use configured field labels.
- Updated the existing Radix Slot dependency from 1.2.3 to 1.2.5 to consume lazy
  React children. The old version omitted Canvas and other slotted navigation
  links during local browser regression; the affected test now passes.
- Tenant-scope checker accepts project-scoped audit queries, matching the existing
  database boundary. No tenant read/write rules were loosened.
- Disabled-tenant browser regression waits for the streamed dashboard and accepts
  the existing Disable Company dialog. It now passes, including blocked login,
  widget and WhatsApp access.
- 340 offline contract tests and 14 ordinary-flow database tests passed.
- Migration journal (47 files), tenant-isolation database checks and cron-config
  checks passed. Cron-config success does not certify durable-worker scheduling.

The fresh full offline run completed: 572 passed, five failed, and 14 were
skipped after a serial failure. All five failures were resolved and the skipped
tests passed on focused reruns. One runtime fix prevents calendar detection from
querying the database with a nonnumeric generic tool handler. This preserves
ordinary task collection; valid calendar IDs still use the existing provider
checks. See `UAT_TEST_PLAN.md` for the complete evidence and the separate live
WhatsApp, metrics, operational scheduler and disposable backup-restore gates.
