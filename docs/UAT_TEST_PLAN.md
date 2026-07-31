# UAT Test Plan

Phase: 8 of 18

Checkpoint: 3 of 6

Test: Task correction, side questions, cancellation, confirmation, and
completion

Progress: Implementation and automated checks complete; focused manual UAT
pending

Project: `Ewissen Infra (#194)`

Database migration: Not required for this checkpoint

Use the existing published task:

```text
Book a Spa Service
```

This checkpoint uses the task test screens so availability from a real booking
provider is not required. Do not click `Queue Operation`; provider execution is
covered in checkpoint 4.

## Step 1 of 8 - Start A Clean Runtime Test

1. Open `Automation`.
2. Open `Conversational Tasks`.
3. Open `Book a Spa Service`.
4. Click `Configure Conversation`.
5. Open the `Test` tab.
6. Click `Open Runtime Test`.
7. Click `Reset Test Data` if an older test is displayed.
8. Click `Start Test Run`.

Expected result:

- The active task is `Book a Spa Service`.
- The run status is `Active`.
- A published version is pinned.
- Seven fields are shown in `Field Lifecycle`.

## Step 2 of 8 - Save The Required Values

In `Save or Correct a Value`, save these values one at a time.

Service Category:

```text
catalog:76
```

Service:

```text
product:71
```

Preferred Date:

```text
2026-08-15
```

Preferred Time:

```text
15:30
```

Guest Name:

```text
Phase 8 Guest
```

Guest Email:

```text
phase8.guest@example.com
```

Guest Phone:

```text
+919876543210
```

Expected result:

- Every value is shown against the correct field.
- Every field is marked `Valid` or `Confirmed`.
- The run remains active and keeps the same pinned version.
- If `catalog:76` or `product:71` is no longer present, use the current active
  Facial catalog ID and Classic Facial product ID shown by the catalog.

## Step 3 of 8 - Correct A Value

1. Select `Guest Email` in `Save or Correct a Value`.
2. Enter:

```text
phase8.corrected@example.com
```

3. Click `Save Value`.

Expected result:

- Guest Email changes to `phase8.corrected@example.com`.
- The other six values are preserved.
- The task does not restart.
- The attempt count for Guest Email increases.

## Step 4 of 8 - Test A Grounded Side Question And Resume

First verify the answer:

1. Return to the task `Test` page in a second browser tab.
2. Click `Open Conversation Test`.
3. Select the latest `Book a Spa Service` version as the conversation context.
4. Select `Answer a question` as the turn purpose.
5. Enter:

```text
Where is the Panaji office?
```

6. Click `Test Turn`.

Expected result:

- Lia gives a grounded project answer.
- No task field, tool, route, or outcome is changed by the answer.

Then verify the durable resume:

1. Return to the Runtime Test tab.
2. Click `Request` beside `Preferred Date`.
3. Confirm `Preferred Date` shows the `Requested` badge.
4. Click `Ask Side Question`.
5. Confirm the response owner changes to `Knowledge Q&A`.
6. Click `Return to Task`.

Expected result:

- The run pauses for the side question and returns to the same task.
- `Preferred Date` remains the requested field.
- All seven saved values remain unchanged.
- The pinned task version remains unchanged.

## Step 5 of 8 - Confirm Without Executing

1. Find `Confirmation and Operation Test`.
2. Choose the available write operation.
3. Click `Prepare Summary`.
4. Review the immutable `Confirmation Summary`.
5. Confirm the corrected email is shown:

```text
phase8.corrected@example.com
```

6. Click `Confirm Explicitly`.
7. Do not click `Queue Operation`.

Expected result:

- The summary contains the current canonical task values.
- The confirmation status becomes `Confirmed`.
- The corrected value is used instead of the original email.
- No provider operation is queued or executed.

## Step 6 of 8 - Complete The Task

1. Find `Task Lifecycle`.
2. Click `Complete`.

Expected result:

- The run status becomes `Completed`.
- The configured completed outcome is recorded.
- The response owner returns to `Knowledge Q&A`.
- The pinned version and completed field values remain visible for audit.

## Step 7 of 8 - Cancel A New Run

1. Click `Start Test Run`.
2. Click `Request` beside `Service Category`.
3. Click `Cancel` under `Task Lifecycle`.

Expected result:

- The new run status becomes `Cancelled`.
- The response owner returns to `Knowledge Q&A`.
- The conversation remains available for ordinary project questions.
- No write operation is created.

## Step 8 of 8 - Verify The Audit Trail

Review `Safe Audit Trail`.

Expected result:

- The trail includes the correction.
- The trail includes side-question suspension and resume.
- The trail includes explicit confirmation.
- The trail includes task completion.
- The trail includes the later cancellation.
- Routine events do not expose collected field values, secrets, or unnecessary
  personal information.

After reviewing the audit trail, click `Reset Test Data`.

## Checkpoint Result

Checkpoint 3 passes when all eight steps pass.

After passing, report:

```text
Phase 8 checkpoint 3 UAT complete.
```

The next roadmap target is Phase 8 checkpoint 4: provider operations, outcomes,
idempotency, and interruption recovery.
