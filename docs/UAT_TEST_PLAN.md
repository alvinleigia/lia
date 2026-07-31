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

1. Keep the current Runtime Test tab open.
2. Open a second browser tab for Lia.
3. In the second tab, click the top navigation menu `Projects`.
4. Click `Product Catalog`. This opens `/projects/catalog`.
5. In the `Products` section, find `Classic Facial`.
6. Click `Edit` beside `Classic Facial`.
7. Set `Current Availability` to `Available`.
8. Click `Save Product`.
9. Return to the original Runtime Test tab. Do not reset the test data.
10. Find `Confirmation and Operation Test`.
11. Choose the available write operation.
12. Click `Prepare Summary`.
13. Review the immutable `Confirmation Summary`.
14. Confirm the corrected email is shown:

```text
phase8.corrected@example.com
```

15. Click `Confirm Explicitly`.
16. Do not click `Queue Operation`.

Expected result:

- The summary contains the current canonical task values.
- The confirmation status becomes `Confirmed`.
- The corrected value is used instead of the original email.
- No provider operation is queued or executed.

If `Prepare Summary` says availability could not be verified, reopen the
product and confirm `Current Availability` is `Available`.

## Step 6 of 8 - Execute The Required Operation

Continue from the confirmed summary created in Step 5. Do not reset the test
data.

1. Find `Confirmation and Operation Test`.
2. Confirm its status is `Confirmed`.
3. Click `Queue Operation`.
4. Click `Process and Reconcile`.
5. Stay in `Confirmation and Operation Test`.
6. Confirm the green success message appears inside this section.
7. Confirm the operation attempt shows `Completed`.
8. Scroll to `Runtime Lifecycle Test` and confirm the run status is
   `Completed`.

Expected result:

- Exactly one operation attempt is completed.
- `Process and Reconcile` records the configured terminal outcome and
  completes the task automatically.
- The run status becomes `Completed`.
- The configured completed outcome is recorded.
- The response owner returns to `Knowledge Q&A`.
- The pinned version and completed field values remain visible for audit.
- `Task Lifecycle` controls are no longer shown because there is no active run.

Do not look for or click a separate `Complete` button after the operation. That
control is available only while a task run is active.

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
