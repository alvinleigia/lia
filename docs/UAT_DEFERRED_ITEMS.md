# Deferred UAT Items

Use this file only for checks that were explicitly accepted during manual UAT
and must be revisited after all active phase UAT is complete. Active defects
stay in `docs/UAT_TEST_PLAN.md` and must not be moved here to bypass a phase
gate.

## Items To Revisit

| ID | Phase | Deferred check | Why it was left | Revisit and close when | Status |
| --- | --- | --- | --- | --- | --- |
| `P14-UAT-13` | 14 | Restore a current database backup into a disposable environment and run integrity and tenant-isolation smoke checks. | Only the active staging and main test instances exist. Overwriting either instance is unsafe. The release owner accepted this limitation for Phase 14 beta on 2026-08-15. | A third disposable database/environment exists, the restore succeeds, and the restored data passes the smoke checks. | Open |
| `P15-UAT-01` | 15 | Configure automatic calls to the protected durable execution worker. | The current Vercel setup does not schedule `/api/durable/process-next`; one-tester UAT used a manual protected worker run, which drained all 108 jobs with no failures on 2026-08-16. | A scheduler regularly calls the durable worker and a later Execution Health check remains at zero queued, processing, and failed jobs without manual intervention. | Open |

## Review Point

2026-09-22 audit: project 94's live Execution Health showed 72 queued,
0 processing, 2 failed and 115 completed. Recent queued Post Conversation jobs
had not been attempted. `P15-UAT-01` remains open; no automatic scheduler or
third disposable restore target has been verified. See `UAT_TEST_PLAN.md` for
the evidence and outstanding infrastructure details.

Review every open row after all phases in `docs/UAT_TEST_PLAN.md` are complete.
Close an item only after recording its result here and linking the validating
commit, test run, or UAT evidence.
