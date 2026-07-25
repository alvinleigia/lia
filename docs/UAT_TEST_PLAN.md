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

Roadmap implementation: 55 of 55 Phase 1 items complete.

UAT status: original 13-step suite passed; closure addendum pending.

Completed checkpoint: original Step 13 of 13; closure Step 0 of 4.

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

- [x] Confirm migration `0033_conversation_contract_foundation` has been
  applied.

If it has not been applied to the current database, stop the development server
and run:

```powershell
npx drizzle-kit migrate
```

Do not rerun the migration only for UAT when it has already been applied.

Expected result: the migration is applied once and the command returns to the
prompt without an error.

Status: Pass

Notes:

### Step 2 Of 13 - Open Conversation Configuration

- [x] Sign in and select `Ewissen Infra (#194)`.
- [x] Open `Automation`, then `Tasks`.
- [x] Open `Book a Spa Service`.
- [x] Select `Configure Conversation`.

Expected result: `Assistant`, `Fields`, `Tools`, `Outcomes`, and `Review`
navigation is visible without a runtime error.

Status: Pass

Notes:

### Step 3 Of 13 - Configure The Assistant

- [x] Open `Assistant`.
- [x] Enter the following values.

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

- [x] Enable `Allow knowledge answers to recommend published tasks`.
- [x] Save and reload the page.

Expected result: `Conversation policy saved` appears and every value remains
after reload.

Status: Pass

Notes:

### Step 4 Of 13 - Apply And Verify Booking Fields

- [x] Open `Fields`.
- [x] Select `Apply Booking Starter` only if no task fields are present.

Expected result: these seven fields are visible:

- `serviceCategoryId`
- `serviceId`, dependent on `serviceCategoryId`
- `preferredDate`, dependent on `serviceId`
- `preferredTime`, dependent on `preferredDate`
- `guestName`
- `guestEmail`
- `guestPhone`, normalized as E.164

Expected result: trusted context contains `lia_timezone`.

Status: Pass

Notes:

### Step 5 Of 13 - Test A Temporary Field

- [x] In `Add Field`, enter the following values.

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

- [x] Leave `Depends On`, `Validation Rule`, and `Normalization` empty.
- [x] Leave `Required` unchecked.
- [x] Add the field and reload the page.
- [x] Try to add `specialRequest` again.

Expected result: the duplicate key is rejected inside the Add Field form and
the entered values remain available for correction.

- [x] Remove the temporary `Special Request` field.

Expected result: the temporary field is removed without affecting the seven
booking fields. The Add Field form and stale error state are cleared after the
successful collection change.

Status: Pass

Notes:

### Step 6 Of 13 - Test Trusted Context

- [x] In `Add Context`, first enter:

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

- [x] Try to add the context.

Expected result: the form shows `The lia_ prefix is reserved for system
context.` The entered values remain unchanged.

- [x] Replace the values with:

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

- [x] Add the context and reload the page.

Expected result: `uatCampaign` persists. `lia_timezone` shows `System
protected` and has no edit or delete controls.

- [x] Edit `uatCampaign`, change Source to `Project`, and save.

Expected result: the source changes to `project`; the context key remains fixed
and cannot be edited.

- [x] Open `Outcomes`.
- [x] Set Fallback Message to:

```text
Campaign {{context.uatCampaign}} could not be completed.
```

- [x] Save, return to `Fields`, and find `uatCampaign`.

Expected result: the variable shows `Used by: Fallback message`. Delete is
disabled while Edit remains available.

- [x] Restore Fallback Message to:

```text
I could not complete that booking request. Let me connect you with the team.
```

- [x] Save, return to `Fields`, and remove `uatCampaign`.

Expected result: the unreferenced variable can be removed. The protected
`lia_timezone` variable remains present.

Status: Pass

Notes:

### Step 7 Of 13 - Verify Tool Permissions

- [x] Open `Tools`.

Expected result: no operation is permitted by default. Active operations from
the current project may be selected. Operations from another project are not
shown.

If an active test operation is available:

- [x] Select the operation.
- [x] Set Permission to `Read data`.
- [x] Enable only the `Lookup` stage.
- [x] Bind the operation and reload the page.

Expected result: a versioned `operation:<id>` binding persists without copying
provider credentials into the task.

- [x] Remove the temporary binding.

If no active operation is available, record `No active project operation
available` below and mark only the binding subtest as `Blocked`. Do not create
an operation only for this Phase 1 test.

Status: Pass

Notes:

### Step 8 Of 13 - Verify And Extend Outcomes

- [x] Open `Outcomes`.

Expected result: the booking starter includes:

- `Completed`
- `Cancelled`
- `Needs Team Help`
- `Booking Failed`

- [x] Add this temporary outcome.

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

- [x] Reload and confirm the outcome remains.
- [x] Remove `No Availability`.

Expected result: the temporary outcome persists and can be removed without
changing the four booking starter outcomes. Every outcome form control has a
visible label.

Status: Pass

Notes:

### Step 9 Of 13 - Configure Behavior And Safety

- [x] In `Behavior and Safety`, enter the following values.

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

- [x] Enable `Consent required`.
- [x] Enable `Export allowed`.
- [x] Save and reload.

Expected result: behavior, return policies, retention, consent, and export
settings remain unchanged after reload.

Status: Pass

Notes:

### Step 10 Of 13 - Review The Draft

- [x] Confirm the temporary Step 7 tool binding has been removed.
- [x] Open `Review`.

Expected result: the clean test state shows:

- Seven task fields.
- One trusted context variable: `lia_timezone`.
- Four booking starter outcomes.
- No temporary tool binding.

Expected result: the page is ready to publish or shows a precise blocker that
identifies what must be corrected.

Status: Pass

Notes:

### Step 11 Of 13 - Publish Version 1

- [x] Resolve any listed blocker.
- [x] Select `Publish New Version`.

Expected result: Version 1 appears in Version History and contains the current
task contract.

Status: Pass

Notes:

### Step 12 Of 13 - Prove Immutable Versioning

- [x] Return to `Assistant`.
- [x] Add this final line to Shared Instructions:

```text
When the visitor changes a detail, use the latest confirmed value.
```

- [x] Save the assistant policy.
- [x] Return to `Review`.
- [x] Publish another version.

Expected result: Version 2 is added and Version 1 remains visible. Publishing
creates a new immutable version instead of replacing Version 1.

Status: Pass

Notes:

### Step 13 Of 13 - Verify Project Isolation

- [x] Note the task ID from the current URL.
- [x] Switch to `Ewissen Inc (#195)`.
- [x] Open `Automation`, then `Tasks`.
- [x] Try to open the `Ewissen Infra (#194)` task URL.

Expected result: the task and its versions are not accessible from project
`#195`. The app returns to a safe task view or shows that the task was not
found. It must not display project `#194` configuration.

- [x] Switch back to `Ewissen Infra (#194)`.
- [x] Reopen the task's `Review` page.

Expected result: Versions 1 and 2 remain visible in the correct project.

Status: Pass

Notes:

## Original Phase 1 Exit Gate

Phase 1 passes only when:

- [x] Every Phase 1 test is Pass or has an explicitly accepted non-blocking
  limitation.
- [x] The task contract contains the expected assistant policy, seven fields,
  protected context, default-deny tool bindings, four outcomes, return
  behavior, safety, and data policy.
- [x] Publishing creates immutable Versions 1 and 2.
- [x] Project isolation passes.
- [x] No Critical or High Phase 1 issue remains unresolved.
- [x] The accepted test evidence is committed before Phase 2 development
  begins.

Final Phase 1 status: Pass

Final notes: Alvin completed all 13 Phase 1 manual UAT steps. No unresolved
Critical or High Phase 1 issue was reported.

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

## Original Phase 1 Sign-Off

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

- Name: Alvin
- Date: 2026-07-25
- Approved: Yes
- Notes: Phase 1 manual UAT completed.

## Phase 1 Closure Addendum

Goal: verify the industry-neutral settings added by the Phase 1 closure audit
without repeating the 13 accepted tests above.

Closure build/commit:

Closure UAT status: Pending

Completed checkpoint: Step 0 of 4

### Closure Step 1 - Advanced Assistant And Identity Policy

1. Switch to `Ewissen Infra (#194)`.
2. Open `Automation`, `Tasks`, and the existing `Book a Spa Service` task.
3. Select `Configure Conversation`, then `Assistant`.
4. Confirm `Visitor Identity` contains:
   - `Project-scoped visitor`
   - `Verified contact`
   - `Authenticated user`
5. Confirm `Cross-channel linking` contains:
   - `Never link`
   - `Verified contacts only`
   - `Authenticated users only`
6. Leave `Visitor Identity` as `Project-scoped visitor`.
7. Leave `Cross-channel linking` as `Verified contacts only`.
8. Expand `Advanced model and transition limits`.
9. Enter these values:

```text
Model Policy: Use platform default
Maximum Task Switches: 2
Connected Flow Depth: 3
Handoff Depth: 1
```

10. Select `Save Policy`.
11. Reload the page and expand the advanced section again.

Expected result: all saved selections remain visible. No provider, WhatsApp,
or industry-specific setting appears in the task contract.

Status: Pending

Notes:

### Closure Step 2 - Repeatable And Resource-Backed Fields

1. Open `Automation`, then `Tasks`.
2. Create a task with:

```text
Task Name: Phase 1 Contract Closure
Objective: Collect one or more service interests and prepare a project-scoped enquiry.
Internal Notes: Temporary UAT task for the Phase 1 contract closure.
```

3. Open `Configure Conversation`, then `Fields`.
4. Add the first field with:

```text
Visitor Label: Preferred Treatments
Field Key: preferredTreatments
Type: enum
Visitor Prompt: Which treatments are you interested in?
Answers Allowed: Multiple answers
Sensitivity: Standard
Confirmation: When changed
Required: checked
Choice Source: Static choices
Static Choices:
massage|Massage
facial|Facial
body_treatment|Body Treatment
```

5. Add the second field with:

```text
Visitor Label: Service
Field Key: serviceId
Type: project resource
Visitor Prompt: Which service would you like?
Answers Allowed: One answer
Sensitivity: Standard
Confirmation: When changed
Required: checked
Depends On: preferredTreatments
Choice Source: Project resource
Resource Type: service
Collection Key: serviceCatalog
Filter By Field: preferredTreatments
```

Expected result: both fields are added without losing entered values. The first
field is shown as `multiple`; both choice sources remain part of the saved task
definition.

Status: Pending

Notes:

### Closure Step 3 - Trusted Context Privacy And Expiry

1. Remain on the closure task's `Fields` page.
2. Add this context variable:

```text
Key: campaignCode
Source: project
Type: text
Default Value: uat-closure
Sensitivity: Personal
Expires After (minutes): 720
Visible to the assistant: checked
Visible to allowed tools: checked
```

3. Select the edit icon beside `campaignCode`.
4. Change `Expires After (minutes)` to `1440`.
5. Clear `Visible to allowed tools`.
6. Save the edit.

Expected result: the stable key remains `campaignCode`; the row shows
`project / text / personal / expires in 1440 minutes`. Reopening the editor
shows the saved default, visibility, sensitivity, and expiry values.

Status: Pending

Notes:

### Closure Step 4 - Outcome, Safety, Dependency, And Publication

1. Open the closure task's `Outcomes` page.
2. Add this outcome:

```text
Outcome Name: Qualified Follow Up
Outcome Key: qualifiedFollowUp
Result Type: handoff
Output Port: qualifiedFollowUp
Completion Condition: {{context.campaignCode}} is present
```

3. In `Behavior and Safety`, enter:

```text
Task Language: English
Response Length: Short
Visitor Identity: Verified contact required
Task Consent: Always require consent
Task Instructions: Use {{context.campaignCode}} only for internal routing. Never reveal it unless the visitor supplied it.
Fallback Message: I could not complete that request.
Handoff Message: I will connect you with the team.
```

4. Expand `Unavailable-service behavior` and confirm model, retrieval, tool,
   and outbound-channel fallbacks are configurable.
5. Expand `Project data handling` and use:

```text
Field Retention: 365
Message Retention: 90
Deletion: On request
Sensitive Data in Model: Current task only
Sensitive Data in Tools: Allowed bindings only
Require consent for all project conversations: unchecked
Allow data export: checked
```

6. Save the policies.
7. Return to `Fields`.
8. Confirm `campaignCode` shows usage by the task instructions and outcome
   condition.
9. Confirm its delete control is disabled.
10. Open `Review`.
11. Confirm there are no publish blockers.
12. Publish a new version.

Expected result: the task publishes an immutable version containing the
advanced task contract and the current project AI behavior. The referenced
context variable cannot be deleted. Automated tests separately verify
duplicate-key, cyclic-dependency, malformed-choice, tool-stage, lifecycle, and
legacy-compatibility blockers.

Status: Pending

Notes:

After this step passes, archive the temporary `Phase 1 Contract Closure` task.

## Phase 1 Closure Gate

- [ ] Closure Steps 1 through 4 pass.
- [ ] The published closure task has no contract blockers.
- [ ] Referenced context deletion remains blocked.
- [ ] No Critical or High closure issue remains unresolved.

Final Phase 1 closure status: Pending
