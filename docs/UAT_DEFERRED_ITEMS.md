# Deferred UAT Items

Use this file only for checks that were explicitly accepted during manual UAT
and must be revisited after all active phase UAT is complete. Active defects
stay in `docs/UAT_TEST_PLAN.md` and must not be moved here to bypass a phase
gate.

## Items To Revisit

| ID | Phase | Deferred check | Why it was left | Revisit and close when | Status |
| --- | --- | --- | --- | --- | --- |
| `P14-UAT-13` | 14 | Restore a current database backup into a disposable environment and run integrity and tenant-isolation smoke checks. | Only the active staging and main test instances exist. Overwriting either instance is unsafe. The release owner accepted this limitation for Phase 14 beta on 2026-08-15. | A third disposable database/environment exists, the restore succeeds, and the restored data passes the smoke checks. | Open |

## Review Point

Review every open row after all phases in `docs/UAT_TEST_PLAN.md` are complete.
Close an item only after recording its result here and linking the validating
commit, test run, or UAT evidence.
