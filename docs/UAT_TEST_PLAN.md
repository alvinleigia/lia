# Lia AI UAT Test Plan

This document contains manual acceptance tests only for the development phase
that has just finished.

Do not add future phases in advance. When a development phase is complete:

1. Add that phase's copy-ready manual test instructions here.
2. Complete manual testing before starting the next development phase.
3. Record failures in the Issue Log.
4. Commit the accepted test evidence.
5. Replace or extend this document only when the next phase is ready for UAT.

The previous full 18-phase draft is preserved in Git commit `625d2ae`.

## Document Authority

- `FLOW_BUILDER_ROADMAP.md` controls development scope and phase completion.
- This file controls manual test instructions and test evidence for the current
  completed phase.
- `BETA_READINESS_CHECKLIST.md` controls the final beta release decision.
- Passing UAT does not mark unfinished roadmap work complete.

## UAT Environment

- UAT URL:
- Build/commit: `67f9bd7`
- Database/environment:
- Tester: Alvin
- Test date: 2026-07-25

## Test Rules

- Test one step at a time.
- Do not use real customer information.
- Stop and record a Critical or High issue if data integrity, tenant isolation,
  publication, or a core workflow fails.
- Capture a screenshot and the exact route when a test fails.
- Use `Status: Pass`, `Fail`, or `Blocked`.
- Do not move to Phase 2 until the Phase 1 exit gate passes.

## Shared Test Fixture

- Primary project: `Ewissen Infra (#194)`
- Isolation project: `Ewissen Inc (#195)`
- Task: `Book a Spa Service`
- Visitor name: `UAT Guest`
- Visitor email: `uat.guest@example.com`
- Visitor phone: `+919876543210`
- Service category: `Massage`
- Service: `Deep Tissue Massage`
- Preferred date: `2026-08-15`
- Preferred time: `15:00`
- Timezone: `Asia/Kolkata`

## Phase 1 Of 18 - Versioned Conversational Task Contract

Goal: verify that a project-scoped conversational task can be created,
configured, validated, versioned, archived, restored, and isolated without
embedding channel- or provider-specific settings.

Roadmap implementation: 48 of 48 Phase 1 items complete.

UAT status: In progress.

Current checkpoint: Step 8 of 13.

Before completing Step 10, confirm that the temporary tool binding created in
Step 7 has been removed.

### Accepted Task Workspace Tests

Build/commit: `9c35c65`

Status: Pass

Test date: 2026-07-24

- [x] Applied migration `0032_conversational_task_workspace`.
- [x] Opened `Automation`, then `Tasks`.
- [x] Opened the separate New Task form.
- [x] Created `Book a Spa Service`.
- [x] Updated and saved the task objective.
- [x] Reopened the task and confirmed values persisted.
- [x] Archived the task.
- [x] Restored the task as an editable draft.
- [x] Confirmed project isolation between `Ewissen Infra (#194)` and
  `Ewissen Inc (#195)`.

Accepted result: task creation, editing, persistence, archive, restore, and
project isolation passed without a runtime error.

### Step 1 Of 13 - Confirm The Database Migration

- [ ] Confirm migration `0033_conversation_contract_foundation` has been
  applied.

If it has not been applied to the current database, stop the development server
and run:

```powershell
npx drizzle-kit migrate
```

Do not rerun the migration only for UAT when it has already been applied.

Expected result: the migration is applied once and the command returns to the
prompt without an error.

Status:

Notes:

### Step 2 Of 13 - Open Conversation Configuration

- [ ] Sign in and select `Ewissen Infra (#194)`.
- [ ] Open `Automation`, then `Tasks`.
- [ ] Open `Book a Spa Service`.
- [ ] Select `Configure Conversation`.

Expected result: `Assistant`, `Fields`, `Tools`, `Outcomes`, and `Review`
navigation is visible without a runtime error.

Status:

Notes:

### Step 3 Of 13 - Configure The Assistant

- [ ] Open `Assistant`.
- [ ] Enter the following values.

Greeting:

```text
Use exact greeting
```

Default Language:

```text
English
```

Greeting Text:

```text
Hello! I can help you choose a spa service and request an appointment.
```

Shared Instructions:

```text
Help visitors choose a spa service and request an appointment.
Ask only for information that is still missing.
Confirm the service, preferred date and time, guest name, email, and phone number before any booking operation.
Answer brief side questions, then return to the booking task.
Do not claim that a booking is confirmed until an approved write operation succeeds.
```

Conversation Entry:

```text
Knowledge first
```

When No Answer Exists:

```text
Use fallback
```

Visitor Identity:

```text
Project-scoped visitor
```

Cross-Channel Linking:

```text
Verified contacts only
```

- [ ] Enable `Allow knowledge answers to recommend published tasks`.
- [ ] Save and reload the page.

Expected result: `Conversation policy saved` appears and every value remains
after reload.

Status:

Notes:

### Step 4 Of 13 - Apply And Verify Booking Fields

- [ ] Open `Fields`.
- [ ] Select `Apply Booking Starter` only if no task fields are present.

Expected result: these seven fields are visible:

- `serviceCategoryId`
- `serviceId`, dependent on `serviceCategoryId`
- `preferredDate`, dependent on `serviceId`
- `preferredTime`, dependent on `preferredDate`
- `guestName`
- `guestEmail`
- `guestPhone`, normalized as E.164

Expected result: trusted context contains `lia_timezone`.

Status:

Notes:

### Step 5 Of 13 - Test A Temporary Field

- [ ] In `Add Field`, enter the following values.

Visitor Label:

```text
Special Request
```

Field Key:

```text
specialRequest
```

Type:

```text
Text
```

Sensitivity:

```text
Standard
```

Confirmation:

```text
When changed
```

- [ ] Leave `Depends On`, `Validation Rule`, and `Normalization` empty.
- [ ] Leave `Required` unchecked.
- [ ] Add the field and reload the page.
- [ ] Try to add `specialRequest` again.

Expected result: the duplicate key is rejected inside the Add Field form and
the entered values remain available for correction.

- [ ] Remove the temporary `Special Request` field.

Expected result: the temporary field is removed without affecting the seven
booking fields. The Add Field form and stale error state are cleared after the
successful collection change.

Status:

Notes:

### Step 6 Of 13 - Test Trusted Context

- [ ] In `Add Context`, first enter:

Key:

```text
lia_campaignCode
```

Source:

```text
Project
```

Type:

```text
Text
```

- [ ] Try to add the context.

Expected result: the form shows `The lia_ prefix is reserved for system
context.` The entered values remain unchanged.

- [ ] Replace the values with:

Key:

```text
uatCampaign
```

Source:

```text
Default
```

Type:

```text
Text
```

- [ ] Add the context and reload the page.

Expected result: `uatCampaign` persists. `lia_timezone` shows `System
protected` and has no edit or delete controls.

- [ ] Edit `uatCampaign`, change Source to `Project`, and save.

Expected result: the source changes to `project`; the context key remains fixed
and cannot be edited.

- [ ] Open `Outcomes`.
- [ ] Set Fallback Message to:

```text
Campaign {{context.uatCampaign}} could not be completed.
```

- [ ] Save, return to `Fields`, and find `uatCampaign`.

Expected result: the variable shows `Used by: Fallback message`. Delete is
disabled while Edit remains available.

- [ ] Restore Fallback Message to:

```text
I could not complete that booking request. Let me connect you with the team.
```

- [ ] Save, return to `Fields`, and remove `uatCampaign`.

Expected result: the unreferenced variable can be removed. The protected
`lia_timezone` variable remains present.

Status:

Notes:

### Step 7 Of 13 - Verify Tool Permissions

- [ ] Open `Tools`.

Expected result: no operation is permitted by default. Active operations from
the current project may be selected. Operations from another project are not
shown.

If an active test operation is available:

- [ ] Select the operation.
- [ ] Set Permission to `Read data`.
- [ ] Enable only the `Lookup` stage.
- [ ] Bind the operation and reload the page.

Expected result: a versioned `operation:<id>` binding persists without copying
provider credentials into the task.

- [ ] Remove the temporary binding.

If no active operation is available, record `No active project operation
available` below and mark only the binding subtest as `Blocked`. Do not create
an operation only for this Phase 1 test.

Status:

Notes:

### Step 8 Of 13 - Verify And Extend Outcomes

- [ ] Open `Outcomes`.

Expected result: the booking starter includes:

- `Completed`
- `Cancelled`
- `Needs Team Help`
- `Booking Failed`

- [ ] Add this temporary outcome.

Outcome Name:

```text
No Availability
```

Outcome Key:

```text
noAvailability
```

Result Type:

```text
No answer
```

Output Port:

```text
noAvailability
```

- [ ] Reload and confirm the outcome remains.
- [ ] Remove `No Availability`.

Expected result: the temporary outcome persists and can be removed without
changing the four booking starter outcomes. Every outcome form control has a
visible label.

Status:

Notes:

### Step 9 Of 13 - Configure Behavior And Safety

- [ ] In `Behavior and Safety`, enter the following values.

Task Language:

```text
English
```

Response Length:

```text
Short
```

Fallback Message:

```text
I could not confirm availability. Please choose another date or ask for help from the spa team.
```

Handoff Message:

```text
I will connect you with the spa team for further help.
```

Completed Return Behavior:

```text
Return to knowledge
```

Cancelled Return Behavior:

```text
Return to knowledge
```

Failed Return Behavior:

```text
Handoff
```

No Answer Return Behavior:

```text
Return to knowledge
```

Handoff Return Behavior:

```text
Suspend
```

Field Retention Days:

```text
365
```

Message Retention Days:

```text
90
```

- [ ] Enable `Consent required`.
- [ ] Enable `Export allowed`.
- [ ] Save and reload.

Expected result: behavior, return policies, retention, consent, and export
settings remain unchanged after reload.

Status:

Notes:

### Step 10 Of 13 - Review The Draft

- [ ] Confirm the temporary Step 7 tool binding has been removed.
- [ ] Open `Review`.

Expected result: the clean test state shows:

- Seven task fields.
- One trusted context variable: `lia_timezone`.
- Four booking starter outcomes.
- No temporary tool binding.

Expected result: the page is ready to publish or shows a precise blocker that
identifies what must be corrected.

Status:

Notes:

### Step 11 Of 13 - Publish Version 1

- [ ] Resolve any listed blocker.
- [ ] Select `Publish New Version`.

Expected result: Version 1 appears in Version History and contains the current
task contract.

Status:

Notes:

### Step 12 Of 13 - Prove Immutable Versioning

- [ ] Return to `Assistant`.
- [ ] Add this final line to Shared Instructions:

```text
When the visitor changes a detail, use the latest confirmed value.
```

- [ ] Save the assistant policy.
- [ ] Return to `Review`.
- [ ] Publish another version.

Expected result: Version 2 is added and Version 1 remains visible. Publishing
creates a new immutable version instead of replacing Version 1.

Status:

Notes:

### Step 13 Of 13 - Verify Project Isolation

- [ ] Note the task ID from the current URL.
- [ ] Switch to `Ewissen Inc (#195)`.
- [ ] Open `Automation`, then `Tasks`.
- [ ] Try to open the `Ewissen Infra (#194)` task URL.

Expected result: the task and its versions are not accessible from project
`#195`. The app returns to a safe task view or shows that the task was not
found. It must not display project `#194` configuration.

- [ ] Switch back to `Ewissen Infra (#194)`.
- [ ] Reopen the task's `Review` page.

Expected result: Versions 1 and 2 remain visible in the correct project.

Status:

Notes:

## Phase 1 Exit Gate

Phase 1 passes only when:

- [ ] Every Phase 1 test is Pass or has an explicitly accepted non-blocking
  limitation.
- [ ] The task contract contains the expected assistant policy, seven fields,
  protected context, default-deny tool bindings, four outcomes, return
  behavior, safety, and data policy.
- [ ] Publishing creates immutable Versions 1 and 2.
- [ ] Project isolation passes.
- [ ] No Critical or High Phase 1 issue remains unresolved.
- [ ] The accepted test evidence is committed before Phase 2 development
  begins.

Final Phase 1 status:

Final notes:

## Issue Log

Use this format for each issue:

```text
ID:
Phase: 1
Step:
Severity: Critical / High / Medium / Low
Summary:
Route:
Build/commit:
Owner:
Status:
Notes:
```

Severity guide:

- Critical: tenant isolation, data integrity, publication, or sign-in is broken.
- High: the task cannot be configured, reviewed, or versioned.
- Medium: a workaround exists but the workflow is confusing or unreliable.
- Low: cosmetic or minor copy issue.

## Phase 1 Sign-Off

Product owner:

- Name:
- Date:
- Approved:
- Notes:

Technical owner:

- Name:
- Date:
- Approved:
- Notes:

UAT tester:

- Name:
- Date:
- Approved:
- Notes:
