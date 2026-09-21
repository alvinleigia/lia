# Ordinary collection UAT — 2026-09-22

Scope: live Project Chat on `https://lia-staging.leigia.com`, isolated project
95, action 62. The flow uses ordinary configured input steps, not a Business
Task. Synthetic enquiries only; no calendar operation or external notification.
The reusable import is `tests/staging/fixtures/ordinary-collection.json`.

## Live results before the fixes

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
the original prompt and publishes it again. Action 62 is now version 3.

One scenario failed: a message containing an invalid email and short phone
number caused Lia to ask for the already supplied name. A direct model
reproduction also treated malformed email as semantic ambiguity. The extraction
instruction now preserves explicit malformed values as candidates for server
validation. The focused live-model regression passes; deployed UI retest remains
required before closing this defect.

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

The initial full offline run was stopped after finding failures; it is not a
full-suite pass. Current-build appointment lifecycle, widget/mobile, configured
live WhatsApp, operational scheduler and disposable backup-restore checks remain
separate gates in `UAT_TEST_PLAN.md`.
