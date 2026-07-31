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

This checkpoint uses a catalog availability value instead of a real booking
provider. Do not click `Queue Operation`; provider execution is covered in
checkpoint 4.

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

This step has two short parts. Part A checks that Lia can answer a project
question. Part B checks that the booking task can pause and resume without
losing its saved values.

### Part A - Ask A Project Question

Starting from the `Book a Spa Service` page shown in the screenshot:

1. Click `Configure Conversation`.
2. Click the `Test` tab.
3. Click `Open Conversation Test`.
4. In `Conversation Context`, select the latest published
   `Book a Spa Service` version.
5. In `Turn Purpose`, select `Answer a question`.
6. In `Visitor Message`, enter:

```text
Where is the Panaji office?
```

7. Click `Test Turn`.

Expected result:

- Lia answers with the Panaji office information from the project knowledge.
- The result does not propose changing a field, calling a tool, changing a
  route, or completing the task.

### Part B - Pause And Resume The Booking Task

1. Click `Back to review`.
2. Click `Open Runtime Test`.
3. Find `Preferred Date` in `Field Lifecycle`.
4. Click `Request` beside `Preferred Date`.
5. Confirm that `Preferred Date` shows `Requested`.
6. At the top of the Runtime Test, click `Ask Side Question`.
7. Confirm that `Response Owner` changes to `Knowledge Q&A`.
8. Click `Return to Task`.

Expected result:

- `Response Owner` changes back to `Conversational Task`.
- `Preferred Date` remains the requested field.
- All seven saved values remain unchanged.
- The pinned task version remains unchanged.

Do not reset the test data during this step.

## Step 5 of 8 - Confirm Without Executing

1. Open `Automation` in a second browser tab.
2. Open `Product Catalog`.
3. Open the catalog containing `Classic Facial`.
4. Click `Edit` beside `Classic Facial`.
5. Set `Current Availability` to `Available`.
6. Click `Save Product`.
7. Return to the still-open Runtime Test tab. Do not reset the test data.
8. Find `Confirmation and Operation Test`.
9. Choose the available write operation.
10. Click `Prepare Summary`.
11. Review the immutable `Confirmation Summary`.
12. Confirm the corrected email is shown:

```text
phase8.corrected@example.com
```

13. Click `Confirm Explicitly`.
14. Do not click `Queue Operation`.

Expected result:

- The summary contains the current canonical task values.
- The confirmation status becomes `Confirmed`.
- The corrected value is used instead of the original email.
- No provider operation is queued or executed.

If `Prepare Summary` says availability could not be verified, reopen the
product and confirm `Current Availability` is `Available`.

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
