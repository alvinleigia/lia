# Lia AI UAT Test Plan

## Current Test

Phase: 2 of 18

Test: Durable Task State and Field Lifecycle

Progress: Step 2 of 10

Project: `Ewissen Infra (#194)`

Task: `Book a Spa Service`

URL: `http://localhost:3000`

Do not start Phase 3 until all ten steps below pass.

## What This Screen Means

The `Runtime Lifecycle Test` page is an internal test screen. It lets us test
how Lia stores and changes a task while a conversation is in progress.

`Active Task` is the task currently being tested.

`Pinned Version` is the published task version frozen for this test run. It
must not change while the run is active.

`Run Status` shows whether the test is active, paused, completed, or cancelled.

`Response Owner` shows which part of Lia currently controls the conversation.
`Conversational Task` means the booking task is in control. `Knowledge Q&A`
means Lia is temporarily answering a general question.

`Field Lifecycle` shows the information collected for the task.

`Safe Audit Trail` shows what happened without showing private field values.

## Test Values

Use these exact values. Do not use real customer information.

```text
Service Category: Massage
Service: Deep Tissue Massage
Preferred Date: 2026-08-15
Preferred Time: 15:00
Guest Name: UAT Guest
Guest Email: uat.guest@example.com
Guest Phone: +919876543210
```

## Step 1 of 10 - Open the Test Screen

**Do this**

1. Select `Ewissen Infra (#194)`.
2. Open `Automation`.
3. Open `Tasks`.
4. Open `Book a Spa Service`.
5. Select `Configure Conversation`.
6. Select `Review`.
7. Select `Open Runtime Test`.

**Pass when**

- The page heading is `Runtime Lifecycle Test`.
- A `Start Test Run` button is visible.
- The page has no runtime error.

Status: Pending

Notes:

## Step 2 of 10 - Start and Reload the Run

You are currently on this step.

**Do this**

1. Confirm the page shows `Active test run`.
2. Note the displayed `Pinned Version`. Your current screenshot shows `v2`.
3. Confirm every field says `Not collected`.
4. Confirm the Safe Audit Trail contains `task.started`.
5. Refresh the browser page.

**Pass when**

- Run Status is still `Active`.
- Response Owner is still `Conversational Task`.
- Pinned Version is still `v2`.
- Every field is still `Not collected`.
- `task.started` remains in the Safe Audit Trail.

Status: Pending

Notes:

## Step 3 of 10 - Prevent an Incomplete Task

**Do this**

1. Leave all fields as `Not collected`.
2. In `Task Lifecycle`, select `Complete`.

**Pass when**

- Lia shows `required_fields_incomplete`.
- Run Status remains `Active`.
- No field is removed or changed.

Status: Pending

Notes:

## Step 4 of 10 - Save the Test Values

Use the `Save or Correct a Value` form near the bottom of `Field Lifecycle`.

**Do this**

1. Choose `Service Category`.
2. Enter `Massage`.
3. Select `Save Value`.
4. Choose `Service`.
5. Enter `Deep Tissue Massage`.
6. Select `Save Value`.
7. Choose `Preferred Date`.
8. Enter `2026-08-15`.
9. Select `Save Value`.
10. Choose `Preferred Time`.
11. Enter `15:00`.
12. Select `Save Value`.
13. Choose `Guest Name`.
14. Enter `UAT Guest`.
15. Select `Save Value`.
16. Choose `Guest Email`.
17. Enter `uat.guest@example.com`.
18. Select `Save Value`.
19. Choose `Guest Phone`.
20. Enter `+919876543210`.
21. Select `Save Value`.
22. Refresh the browser page.

**Pass when**

- All seven values remain after the refresh.
- Every saved field shows `Valid`.
- Saving one field does not change the other fields.

Status: Pending

Notes:

## Step 5 of 10 - Correct and Replace a Value

**Do this**

1. In `Save or Correct a Value`, choose `Service Category`.
2. Replace `Massage` with `Facial`.
3. Select `Save Value`.
4. Inspect the existing `Service` value.

**Pass when**

- Service Category now shows `Facial`.
- `Deep Tissue Massage` is not silently kept as a valid Facial service.

Continue:

1. Select `Clear` beside `Service`.
2. Choose `Service` in the form.
3. Enter `Classic Facial`.
4. Select `Save Value`.

**Pass when**

- Service shows `Classic Facial`.
- The new Service value shows `Valid`.
- The Safe Audit Trail records the changes without displaying the actual
  customer values.

Status: Pending

Notes:

## Step 6 of 10 - Pause and Resume

**Do this**

1. Select `Pause`.
2. Refresh the browser page.

**Pass when**

- Run Status is `Paused`.
- All saved values remain visible.
- Value-changing controls cannot be used while the run is paused.

Continue:

1. Select `Rotate Session`.
2. Select `Resume`.

**Pass when**

- Run Status returns to `Active`.
- Response Owner returns to `Conversational Task`.
- Rotating the session did not remove the task or its values.

Status: Pending

Notes:

## Step 7 of 10 - Answer a Side Question

This tests whether Lia can temporarily answer a general question and then
continue the booking task from the same place.

**Do this**

1. Select `Request` beside `Preferred Date`.
2. Select `Ask Side Question`.

**Pass when**

- Response Owner changes to `Knowledge Q&A`.
- Preferred Date remains the requested field.
- Task values cannot be changed while Knowledge Q&A is in control.

Continue:

1. Select `Return to Task`.

**Pass when**

- Response Owner returns to `Conversational Task`.
- Preferred Date is still the requested field.
- All saved values remain unchanged.

Status: Pending

Notes:

## Step 8 of 10 - Switch to Another Task

The `Published Task` list needs a second active task with a published version.

If the list is empty, create this temporary task:

```text
Task Name: Phase 2 Switch Target
Objective: Collect a temporary service request for runtime switching UAT.
```

Apply the booking starter, resolve any Review blocker, and publish Version 1.

**Do this**

1. Return to the primary task's `Runtime Lifecycle Test`.
2. Under `Switch Active Task`, choose the temporary published task.
3. Select `Switch Task`.

**Pass when**

- The previous run becomes `Cancelled`.
- The temporary task becomes the Active Task.
- The temporary task is pinned to its published version.
- The same test conversation continues.
- Unpublished and archived tasks are not offered in the list.

Status: Pending

Notes:

## Step 9 of 10 - Restart, Complete, and Cancel

**Do this**

1. Select `Restart`.

**Pass when**

- The active task remains active.
- Its collected values return to `Not collected`.

Continue:

1. Save all required values using the Test Values above.
2. Select `Complete`.

**Pass when**

- Run Status becomes `Completed`.
- Response Owner becomes `Knowledge Q&A`.
- A completed result is recorded.

Continue:

1. Select `Start Test Run`.
2. Select `Cancel`.

**Pass when**

- The new run becomes `Cancelled`.
- Response Owner becomes `Knowledge Q&A`.
- The earlier completed run was not overwritten.

Status: Pending

Notes:

## Step 10 of 10 - Reset and Check Project Isolation

**Do this**

1. Select `Reset Test Data`.

**Pass when**

- The test data is removed.
- `Start Test Run` is visible again.

Continue:

1. Copy the current Runtime Lifecycle Test URL.
2. Switch to `Ewissen Inc (#195)`.
3. Open the copied URL.

**Pass when**

- Project `#195` cannot view or change project `#194` task data.
- No field, version, audit event, or Response Owner from project `#194` is
  displayed.
- Lia returns to a safe task page or reports that the task was not found.

Finish:

1. Switch back to `Ewissen Infra (#194)`.
2. Archive `Phase 2 Switch Target` if you created it.

Status: Pending

Notes:

## Phase 2 Sign-Off

Phase 2 passes when all ten steps pass and no Critical or High issue remains.

Tester: Alvin

Date:

Approved:

Notes:

## If Something Fails

Stop on the failed step and send:

```text
Step number:
What I clicked:
What I expected:
What happened:
Page URL:
```

Also attach a screenshot when possible.
