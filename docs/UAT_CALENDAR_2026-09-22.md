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
