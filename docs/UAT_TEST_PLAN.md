# Lia AI UAT Test Plan

This document contains manual acceptance tests only for the development phase
that has just finished. Earlier accepted UAT evidence remains available in Git
history.

## Document Authority

- `FLOW_BUILDER_ROADMAP.md` controls development scope and phase completion.
- This file controls manual test instructions and evidence for the current
  completed phase.
- `BETA_READINESS_CHECKLIST.md` controls the final beta release decision.

## UAT Environment

- UAT URL: `http://localhost:3000`
- Implementation commits: `2bbeed7`, `a319026`, `da339cd`, `018e8a1`,
  `736ba60`
- Database migration: `0034_conversational_task_runtime`
- Tester: Alvin
- Test date:

## Test Rules

- Test one step at a time.
- Use the exact sample values below; do not use real customer information.
- Record each step as `Pass`, `Fail`, or `Blocked`.
- Capture the route and a screenshot for every failure.
- Stop on a Critical or High data-integrity, tenant-isolation, or lifecycle
  failure.
- Do not start Phase 3 until the Phase 2 exit gate passes.

## Shared Test Fixture

- Primary project: `Ewissen Infra (#194)`
- Isolation project: `Ewissen Inc (#195)`
- Primary task: `Book a Spa Service`
- Switch target: any different active task with at least one published version
- Service category: `Massage`
- Service: `Deep Tissue Massage`
- Preferred date: `2026-08-15`
- Preferred time: `15:00`
- Guest name: `UAT Guest`
- Guest email: `uat.guest@example.com`
- Guest phone: `+919876543210`

## Phase 2 Of 18 - Durable Task State And Field Lifecycle

Goal: verify that a published conversational task can collect, correct,
pause, resume, switch, cancel, and complete durable project-scoped state
without duplicate or cross-project mutation.

Roadmap implementation: 33 of 33 Phase 2 items complete.

UAT status: Pending.

Completed checkpoint: Step 0 of 10.

### Step 1 Of 10 - Open The Runtime Test

1. Sign in and select `Ewissen Infra (#194)`.
2. Open `Automation`, then `Tasks`.
3. Open `Book a Spa Service`.
4. Select `Configure Conversation`, then `Review`.
5. Confirm at least one published version is listed.
6. Select `Open Runtime Test`.

Expected result:

- The page opens without a runtime error.
- The header says `Runtime Lifecycle Test`.
- `Start Test Run` is enabled.
- No customer field values are shown before a run starts.

Status: Pending

Notes:

### Step 2 Of 10 - Start A Version-Pinned Run

1. Select `Start Test Run`.
2. Note the `Pinned Version` number.
3. Reload the page.

Expected result:

- `Active test run` is shown.
- Run Status is `active`.
- Response Owner is `Conversational Task`.
- The pinned version remains unchanged after reload.
- Every published task field begins as `missing`.
- The Safe Audit Trail contains `task.started`.

Status: Pending

Notes:

### Step 3 Of 10 - Reject Premature Completion

1. Before adding all required values, select `Complete`.

Expected result:

- Completion is rejected with `required_fields_incomplete`.
- The run remains active.
- Existing field state is not cleared.

Status: Pending

Notes:

### Step 4 Of 10 - Collect And Persist Values

In `Save or Correct a Value`, add each value separately.

1. Select `Service Category`, enter:

```text
Massage
```

2. Select `Save Value`.
3. Repeat for the remaining fields:

```text
Service: Deep Tissue Massage
Preferred Date: 2026-08-15
Preferred Time: 15:00
Guest Name: UAT Guest
Guest Email: uat.guest@example.com
Guest Phone: +919876543210
```

4. Reload the page.

Expected result:

- Every value remains after reload.
- Each saved field is `valid`.
- Natural values are readable and no field is stored in a chat message.
- The attempt count increases only for the field being saved.

Status: Pending

Notes:

### Step 5 Of 10 - Correct And Clear A Dependent Value

1. Select `Service Category`.
2. Enter:

```text
Facial
```

3. Select `Save Value`.
4. Inspect `Service`.

Expected result: `Service Category` changes to `Facial`. The dependent
`Service` value is marked for revalidation instead of being silently reused.

5. Select `Clear` beside `Service`.
6. Save this replacement:

```text
Classic Facial
```

Expected result: the old service is cleared, the replacement is valid, and the
audit trail records the lifecycle events without displaying field values.

Status: Pending

Notes:

### Step 6 Of 10 - Pause, Rotate, And Resume

1. Select `Pause`.
2. Reload the page.

Expected result:

- Run Status is `paused`.
- Collected values remain visible.
- Save, Request, Clear, and Complete controls are unavailable while paused.

3. Select `Rotate Session`.
4. Select `Resume`.

Expected result:

- Session rotation does not clear the task or its values.
- Run Status returns to `active`.
- Response Owner returns to `Conversational Task`.

Status: Pending

Notes:

### Step 7 Of 10 - Answer A Side Question And Return

1. Select `Request` beside `Preferred Date`.
2. Select `Ask Side Question`.

Expected result:

- Response Owner changes to `Knowledge Q&A`.
- Field mutation controls are unavailable.
- The requested field remains `Preferred Date`.

3. Select `Return to Task`.

Expected result:

- Response Owner returns to `Conversational Task`.
- `Preferred Date` is still marked as the requested field.
- All collected values remain unchanged.

Status: Pending

Notes:

### Step 8 Of 10 - Switch The Active Task

Use any second active task with a published version. If none exists, create a
temporary task with:

```text
Task Name: Phase 2 Switch Target
Objective: Collect a temporary service request for runtime switching UAT.
```

Apply the booking starter, resolve any Review blocker, and publish Version 1.

1. Return to the primary task's Runtime Lifecycle Test.
2. Under `Switch Active Task`, select the different published task.
3. Select `Switch Task`.

Expected result:

- The previous run becomes `cancelled`.
- The new task becomes the active task.
- The new run is pinned to the selected task's published version.
- The conversation session remains intact.
- An unpublished or archived task is not available as a target.

Status: Pending

Notes:

### Step 9 Of 10 - Restart, Cancel, And Complete

1. Select `Restart`.

Expected result: values for the active task are reset and the run remains
active.

2. Add all required values using the sample fixture.
3. Select `Complete`.

Expected result:

- Run Status becomes `completed`.
- The completed outcome is recorded.
- Response Owner returns to `Knowledge Q&A`.

4. Select `Start Test Run` to create a new run.
5. Select `Cancel`.

Expected result:

- The new run becomes `cancelled`.
- Response Owner returns to `Knowledge Q&A`.
- The completed run remains in durable history and is not overwritten.

Status: Pending

Notes:

### Step 10 Of 10 - Reset And Verify Project Isolation

1. Select `Reset Test Data`.

Expected result: the isolated UAT runtime data is removed and `Start Test Run`
is shown again.

2. Copy the Runtime Lifecycle Test URL.
3. Switch to `Ewissen Inc (#195)`.
4. Open the copied URL.

Expected result:

- Project `#195` cannot read or mutate project `#194` task runtime data.
- The app returns to a safe task view or reports that the task was not found.
- No field value, audit event, task version, or response owner from project
  `#194` is displayed.

5. Switch back to `Ewissen Infra (#194)`.
6. Archive the temporary `Phase 2 Switch Target` task if one was created.

Status: Pending

Notes:

## Phase 2 Exit Gate

Phase 2 passes only when:

- [ ] Steps 1 through 10 pass.
- [ ] The run remains pinned to an immutable published version.
- [ ] Corrections and dependency invalidation do not reuse stale values.
- [ ] Pause, session rotation, side questions, and task switching preserve the
  expected execution position.
- [ ] Premature completion is rejected.
- [ ] Completion and cancellation return control according to policy.
- [ ] Project isolation passes.
- [ ] No Critical or High Phase 2 issue remains unresolved.

Final Phase 2 status: Pending

## Issue Log

```text
ID:
Phase: 2
Step:
Severity: Critical / High / Medium / Low
Summary:
Route:
Build/commit:
Owner:
Status:
Notes:
```

## Phase 2 Sign-Off

UAT tester:

- Name: Alvin
- Date:
- Approved:
- Notes:
