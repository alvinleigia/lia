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
