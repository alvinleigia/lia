# Calendar lifecycle UAT — 2026-09-22

Deployed candidate: `00991b0`. Host: `https://lia-staging.leigia.com`.
Project 94, action 60. Executed through the live Project Chat UI using a
synthetic identity, UAT Lifecycle Rider, and synthetic reason. Existing Alex
Test appointments were not changed. All times below are Australia/Sydney.

| Scenario | Observed result | Evidence |
| --- | --- | --- |
| One-message booking with date, time, name, phone and reason | Availability acknowledged for 6 October 2026, 3:30 pm; complete review; Confirm succeeded. | Attempt 163; `tmp/staging-calendar-booking.json` |
| Find one upcoming appointment and reschedule | Name/phone lookup selected the one match; review retained its reference and reason, displayed the old 3:30–4:00 pm interval and requested 4:00 pm; Confirm succeeded. | Attempt 170; `tmp/staging-calendar-reschedule.json` |
| Request the newly occupied time | A second synthetic identity requested 4:00 pm. Lia reported unavailability and offered alternatives, including the original 3:30 pm slot freed by rescheduling. The probe was cancelled without creating an appointment. | `tmp/staging-calendar-occupied.json` |
| Find and cancel the rescheduled appointment | Review returned the same reference, retained reason and updated 4:00–4:30 pm interval; Confirm succeeded. | Attempt 175; `tmp/staging-calendar-cancel.json` |
| Lookup after cancellation | No matching appointment returned. The residual request was cancelled. | Attempt 176; `tmp/staging-calendar-no-match.json` |

The lookup and occupied-slot checks corroborate the provider changes beyond a
success message. No independent Google Calendar UI inspection was performed.
The synthetic appointment was cancelled at the end of the run.

Earlier user-led UAT demonstrated delayed confirmation, a manual calendar
conflict between review and Confirm, multiple-match selection and missing-reason
collection. Those screenshots remain historical evidence. The current full
automated regression covers expiry/revalidation and provider-failure branches;
its completion is recorded separately in `UAT_TEST_PLAN.md`. This live batch
does not claim a fresh 15-minute pause, simultaneous-writer race, or live
WhatsApp/Telnyx certification.

## Current-build recovery follow-up

Deployed candidate `7920ca1`, same staging host and project. The repeatable
`tests/staging/calendar-recovery.spec.ts` passed through live Project Chat in
1.4 minutes. It used separate browser sessions and a synthetic identity whose
initial lookup returned no match. No existing Alex Test appointment was changed.

| Scenario | Observed result |
| --- | --- |
| Another session books between review and Confirm | Both sessions reviewed 7 October 2026 at 3:00 pm. The second session booked it (attempt 185). Confirming the first review returned an availability failure and nearby alternatives, excluding 3:00 pm. |
| Alternative time after conflict | Asking `Is 3:30 pm available?` acknowledged availability and returned review with the original name, phone and reason preserved. This request was cancelled without booking. |
| Multiple upcoming matches | A second appointment at 4:00 pm was booked (attempt 192). Reschedule lookup listed both 3:00 pm and 4:00 pm, without demanding a reference. |
| Early time preference while selecting the existing appointment | `Is 3:30 pm available?` was retained while Lia repeated the existing-appointment choices. Selecting 3:00 pm and supplying the new date produced the 3:30 pm availability acknowledgement and review with the correct old appointment, reference and reason. This reschedule request was cancelled without changing the booking. |
| Cleanup and zero-match lookup | Both synthetic bookings were cancelled (attempts 202 and 206). Final lookup returned no match (attempt 207). |

Evidence: `test-results/staging-calendar-recovery-report.json`, with every turn
attached, and `test-results/staging-calendar-recovery/` screenshots. TypeScript
and focused Biome checks passed. No application-code change was needed.

The test is opt-in because it creates and cancels real events in the staging
calendar. It uses `.playwright-auth/appointment.json` and verifies project 94 and
the staging origin before sending messages. With `RUN_STAGING_CALENDAR_UAT=1`
in the process environment, run:

```text
npx playwright test --config=playwright.staging.config.ts calendar-recovery
```

The fixed 7 October 2026 fixture must still be in the future and its requested
times free; the test fails rather than changing unrelated appointments. Cleanup
uses only the synthetic identity verified empty before this run, checks the
reason/name/phone/reference at review and confirms cancellation through the UI.

This closes fresh multiple-match and intervening-booking recovery checks. A
simultaneous provider-write race and a fresh 15-minute confirmation pause remain
distinct from this test. Existing automated expiry/concurrency regressions and
earlier user-led delayed-confirmation evidence still apply; no new claim of
live certification is made for those cases or for WhatsApp/Telnyx.

## Repeatable delayed-confirmation check

The calendar recovery suite also includes two opt-in delayed-confirmation cases:
leaving the chat open, and reloading the chat before confirmation. Each leaves
the review untouched for at least 15 minutes 10 seconds, measured with a monotonic
timer. Neither the browser clock nor server/database timestamps are modified.
The fixed fixtures are 8 October 2026 at 4:00 pm and 3:00 pm Australia/Sydney,
respectively. Synthetic names and phone numbers are checked for no existing
appointment before the test begins.

With `RUN_STAGING_DELAYED_CALENDAR_UAT=1` set in the process environment, run:

```text
npx playwright test --config=playwright.staging.config.ts calendar-recovery --grep "delayed confirmation" --workers=2
```

Parallel workers use separate browser contexts, identities and slots. Each test
requires the date to remain in the future, the requested slot to be available,
and the project 94 staging session to be authenticated. The assertion checks
that one Confirm after the pause completes without a repeated review or field
prompt. Cleanup looks up the resulting appointment to verify its name, phone,
reason, exact time, timezone and reference, cancels it through the UI and checks
that a final lookup finds no match. Timing evidence and turn replies are attached
to the Playwright report. These tests are skipped without their explicit opt-in.

### Live results on `ee9a364`

Both cases passed on 2026-09-22, using the deployed server and live calendar:

- Reload: review at `03:46:31.443 UTC`; pause completed at `04:01:41.451 UTC`
  after 910,004 ms. Reload restored the review. One Confirm completed booking
  attempt 216 without a further confirmation prompt. Lookup verified the 3:00 pm
  appointment and all supplied details; cancellation attempt 220 succeeded and
  final lookup attempt 221 returned no match.
- Chat left open: review at `03:48:15.561 UTC`; pause completed at
  `04:03:25.563 UTC` after 910,000 ms. One Confirm completed booking attempt 224
  without repeating review or requesting previously supplied details. Lookup
  verified the 4:00 pm appointment, timezone, reason and reference. Cancellation
  attempt 228 succeeded and final lookup attempt 229 returned no match.

Evidence: `test-results/staging-calendar-delayed-report.json` (reload),
`test-results/staging-calendar-delayed-open-report.json` (open chat), and the
corresponding screenshot directories without the `-report.json` suffix. Each
report contains elapsed timing and all test-turn replies. The two scenarios were
launched independently; the retained suite groups them for parallel execution
with the command above. TypeScript and focused Biome checks passed.

No application-code fix was needed: this verifies the existing expiry/recovery
behavior on the deployed build. Both synthetic appointments were removed. The
fresh delayed-confirmation gate is now passed. The later simultaneous-confirmation
results are recorded below. Live WhatsApp/Telnyx remain deferred and worker
scheduling remains inactive.

## Simultaneous confirmation follow-up

Initial deployed candidate `898fd99`: two isolated callers reviewed 9 October
2026 at 3:00 pm Australia/Sydney. The browser harness held both UI-generated
Confirm requests and released them 2.39 ms apart. One booking succeeded
(attempt 237); the other was rejected (attempt 239). Separate identity lookups
found exactly one appointment. It was cancelled in attempt 244, and final lookup
245 found no match.

The live check exposed a recovery defect: the rejected caller received a generic
team-review outcome instead of available alternatives. Failure log:
`tmp/staging-calendar-race.log`. The isolated database test
reproduced the same failure (`tmp/calendar-write-race-repro.log`).

The fix retains the task only for calendar booking/rescheduling operations that
return a verified `rejected`/`slot_taken` outcome. It still records the failed
attempt and confirmation, refreshes availability immediately and reuses the
existing slot-recovery prompt. A new time needs a new confirmation. Other
rejections and unknown outcomes retain their existing handling. Four focused
database cases passed, including completing an alternative slot with retained
identity/reason and two distinct confirmation records. All 346 offline contract
tests passed (15 optional cases skipped).

The seven related calendar regressions also passed: stale/invalid slot checks,
detailed statement handling, and expired confirmations with available, busy,
failed-provider, reload and changed-detail outcomes. Production build,
TypeScript, tenant-scope checks and lint passed (three existing lint warnings).

The retained live test runs three rounds at 3:00 pm, 3:30 pm and 4:00 pm. Set
`RUN_STAGING_CALENDAR_RACE_UAT=1` in the process environment and run:

```text
npx playwright test --config=playwright.staging.config.ts calendar-recovery --grep "simultaneous booking" --max-failures=1
```

Each round requires two initially empty synthetic identities, future/free slots,
one successful result, fresh alternatives for the other caller, retained details
when choosing an alternative, exactly one actual booking across both identities,
and successful cleanup. The test stops on failure. Browser release timing does
not establish exact provider arrival ordering; this is a live concurrency sample,
not a guarantee against every possible external calendar writer or load level.

### Deployed race retest

Fix `7465b76` deployed successfully to staging and production. All three live
staging rounds passed in 2.9 minutes:

| Slot (9 October 2026, Australia/Sydney) | Request release difference | Booking attempt | Cancellation | Final empty lookup |
| --- | --- | --- | --- | --- |
| 3:00 pm | 3.19 ms | 254 | 263 | 264 |
| 3:30 pm | 3.32 ms | 273 | 282 | 283 |
| 4:00 pm | 1.69 ms | 291 | 299 | 300 |

Every round produced one successful booking and an availability-recovery reply
for the other caller. The rejected caller selected an alternative and reached a
new review with the same name, phone and reason; that alternative request was
cancelled without another booking. Lookup across the two identities found exactly
one actual appointment per round. All three bookings were cancelled and the final
lookups returned no match. Evidence:
`test-results/staging-calendar-race-fixed-report.json`,
`test-results/staging-calendar-race-fixed/` screenshots and
`tmp/staging-calendar-race-fixed.log`.

The live simultaneous-booking UAT gate is passed for these tested Lia sessions.
WhatsApp and Telnyx were not exercised and remain deferred by the owner.
