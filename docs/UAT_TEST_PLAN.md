# Lia AI UAT Test Plan

## Current Test

Phase: 5 of 18

Test: Confirmation, Operations, And Outcomes

Progress: Not tested - 0 of 8 steps passed

Project: `Ewissen Infra (#194)`

Task: `Book a Spa Service`

URL: `http://localhost:3000`

Database migration: Complete

## What You Are Testing

This phase checks that Lia:

1. Builds a confirmation summary from validated task values.
2. Requires an explicit confirmation before a write operation.
3. Invalidates an old confirmation after a value changes.
4. Queues the same operation only once.
5. Reports success only after the operation result is stored.
6. Routes the task using the persisted operation outcome.

The automated database suite already covers uncertain provider responses,
manual reconciliation, failed outcomes, handoff, tenant isolation, and
sanitized operation results. You do not need to create a broken provider for
this manual UAT.

## Step 1 of 8 - Verify And Publish The Write Operation

**Do this**

1. Select `Ewissen Infra (#194)` in the header.
2. Open `Automation`.
3. Open `Tasks`.
4. Open `Book a Spa Service`.
5. Select `Configure Conversation`.
6. Select `Tools`.
7. Look for `Manual Review`.
8. If it already says `Take action / operation / v1`, do not add it again.
9. If it is missing, use `Allow a Tool` with:

```text
Operation: Manual Review via Manual Review
Permission: Take action
Allowed Stage: operation
```

10. Select `Allow Tool`.
11. Select `Review`.
12. Confirm the page says the task is ready to publish.
13. Select `Publish New Version`.
14. Select `Open Runtime Test`.

**Pass when**

1. `Manual Review` is allowed only as a write operation.
2. Review shows no publish blocker.
3. A new immutable version appears in `Version History`.
4. Runtime Test opens without an error.

Status: Not tested

## Step 2 of 8 - Start A Clean Runtime

**Do this**

1. Select `Reset Test Data`.
2. Select `Start Test Run`.
3. Confirm `Run Status` is `Active`.
4. Confirm `Active Task` is `Book a Spa Service`.

**Pass when**

1. The run is pinned to the version published in Step 1.
2. All seven fields show `Not collected`.
3. No old confirmation or operation attempt is visible.

Status: Not tested

## Step 3 of 8 - Save Valid Task Values

Use `Save or Correct a Value` to save each value separately.

For `Service Category`:

```text
Facial
```

For `Service`:

```text
Classic Facial
```

For `Preferred Date`:

```text
2026-08-15
```

For `Preferred Time`:

```text
15:30
```

For `Guest Name`:

```text
Phase 5 Guest
```

For `Guest Email`:

```text
phase5.guest@example.com
```

For `Guest Phone`:

```text
+919876543210
```

**Pass when**

1. Every required field says `Valid`.
2. `Facial` and `Classic Facial` resolve to project resources.
3. No field remains `Candidate`, `Invalid`, or `Not collected`.

Status: Not tested

## Step 4 of 8 - Prepare The Confirmation Summary

**Do this**

1. Scroll to `Confirmation and Operation Test`.
2. Under `Write Operation`, choose `Manual Review`.
3. Select `Prepare Summary`.

**Pass when**

1. `Confirmation Summary` appears.
2. Its status is `Awaiting confirmation`.
3. Every displayed value matches the validated values from Step 3.
4. `Confirm Explicitly` is visible.
5. `Queue Operation` is not yet visible.
6. No operation attempt has been created.

Status: Not tested

## Step 5 of 8 - Correct A Value Before Confirming

**Do this**

1. Return to `Save or Correct a Value`.
2. Choose `Guest Email`.
3. Save:

```text
phase5.corrected@example.com
```

4. Return to `Confirmation and Operation Test`.
5. Confirm the old summary says `Needs review`.
6. Select `Prepare Summary` again.

**Pass when**

1. The old confirmation cannot be queued.
2. The refreshed summary says `Awaiting confirmation`.
3. It shows `phase5.corrected@example.com`.
4. No operation attempt has been created.

Status: Not tested

## Step 6 of 8 - Confirm Explicitly

**Do this**

1. Read the refreshed summary.
2. Select `Confirm Explicitly`.

**Pass when**

1. The confirmation status becomes `Confirmed`.
2. `Queue Operation` becomes visible.
3. The operation was not queued before this explicit action.

Status: Not tested

## Step 7 of 8 - Verify Exactly-Once Queueing

**Do this**

1. Select `Queue Operation`.
2. Note the displayed `Attempt` number.
3. Select `Verify Duplicate Protection`.
4. Select `Verify Duplicate Protection` once more.

**Pass when**

1. The confirmation status is `Queued`.
2. The same attempt number remains visible after both duplicate checks.
3. No second attempt is created.
4. No success message is shown yet.

Do not select `Process and Reconcile` until Step 8.

Status: Not tested

## Step 8 of 8 - Process And Verify The Persisted Outcome

**Do this**

1. Select `Process and Reconcile`.
2. Review the confirmation, attempt, run status, and audit trail.

**Pass when**

1. Confirmation status becomes `Completed`.
2. Delivery Status becomes `Completed`.
3. `Finished` shows a date and time.
4. Run Status becomes `Completed`.
5. Response Owner becomes `Knowledge Q&A`.
6. The audit trail includes:

```text
confirmation.prepared
confirmation.confirmed
operation.queued
operation.completed
```

7. No credential, provider secret, raw provider payload, or unrelated project
   data is displayed.

Status: Not tested

## If A Step Fails

Stop at that step and report:

```text
Phase 5 UAT
Failed step:
Expected:
What happened:
Screenshot:
```

Do not continue to Phase 6 until the failed step is corrected.

## Phase 5 Sign-Off

Phase 5 passes when all eight steps pass and no Critical or High issue remains.

When finished, report:

```text
Phase 5 UAT complete
```
