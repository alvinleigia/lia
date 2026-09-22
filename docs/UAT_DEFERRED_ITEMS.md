# Deferred UAT Items

Use this file only for checks that were explicitly accepted during manual UAT
and must be revisited after all active phase UAT is complete. Active defects
stay in `docs/UAT_TEST_PLAN.md` and must not be moved here to bypass a phase
gate.

Owner decision confirmed on 2026-09-22: keep all four items below deferred.
Continue UAT on Vercel Hobby without activating the durable-worker scheduler.
No extra database is available for the restore drill. Resume WhatsApp and Telnyx
later, with Telnyx last. Deferred means unverified, not passed or closed.

## Items To Revisit

| ID | Phase | Deferred check | Why it was left | Revisit and close when | Status |
| --- | --- | --- | --- | --- | --- |
| `P14-UAT-13` | 14 | Restore a current database backup into a disposable environment and run integrity and tenant-isolation smoke checks. | No extra database is available. The owner reaffirmed deferral on 2026-09-22; do not overwrite staging or production. This limitation was originally accepted for Phase 14 beta on 2026-08-15. | A separate disposable database/environment is available, the owner resumes the check, the restore succeeds, and integrity/tenant-isolation checks pass. | Deferred by owner |
| `P15-UAT-01` | 15 | Configure automatic calls to the protected durable execution worker. | The owner will retain Vercel Hobby during UAT and revisit scheduling later. The runner is prepared but scheduling remains inactive. Historical manual processing does not certify automation. | The owner resumes activation, a scheduler regularly calls the worker, and due work/retries are processed reliably with failures reviewed. | Deferred by owner |
| `CHANNEL-WHATSAPP` | Channel certification | Run live WhatsApp delivery, configured-field collection, corrections, confirmation, resume and duplicate-message UAT. | The owner explicitly deferred WhatsApp until later on 2026-09-22. | The owner resumes live WhatsApp UAT with a configured test channel and the channel-specific checks pass. | Deferred by owner |
| `CHANNEL-TELNYX` | 18 | Complete live Telnyx hosted-AI UAT, including collection, tools, confirmation, recovery, handoff and latency/cost evidence. | The owner explicitly deferred Telnyx and requested that it be tested last. | The owner resumes the Phase 18 live hosted-AI checklist after the other planned UAT work and its required checks pass. | Deferred by owner — last |

## Review Point

2026-09-22 channel decision: the owner explicitly deferred live WhatsApp and
Telnyx UAT until later, with Telnyx last. Neither channel is certified by the
passing Project Chat, widget or automated adapter tests. Revisit live message
delivery/collection/recovery for WhatsApp and the Phase 18 hosted-AI checklist
for Telnyx when those channel tests are resumed.

2026-09-22 follow-up: the owner chose to retain Hobby and prepare worker setup
without activating a scheduler. `scripts/run-durable-worker.mjs` and
[`DURABLE_WORKER_SETUP.md`](DURABLE_WORKER_SETUP.md) are ready; the command defaults
to validation without a request. Six mocked runner tests passed. No live worker
execution or backlog replay was performed. `P15-UAT-01` remains open, with
activation intentionally deferred.

After deployment `9169c05`, live project 94 showed 76 queued, 0 processing,
2 failed and 117 completed. Both failures are Hosted Voice Tool jobs from
2026-09-07 at attempt 1 of 5, marked `provider_rejected`. The UI now exposes
them before recent items. This identifies their recorded error, not its provider
root cause. Evidence: `test-results/staging-failed-job-details.txt`.

2026-09-22 audit: project 94's live Execution Health showed 72 queued,
0 processing, 2 failed and 115 completed. Recent queued Post Conversation jobs
had not been attempted. `P15-UAT-01` remains open; no automatic scheduler or
third disposable restore target has been verified. See `UAT_TEST_PLAN.md` for
the evidence and outstanding infrastructure details.

Revisit deferred rows when the owner resumes their scope and prerequisites exist.
Close an item only after recording its result here and linking the validating
commit, test run, or UAT evidence.
