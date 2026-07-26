# Lia AI UAT Test Plan

## Current Test

Phase: 6 of 18

Test: Conversational Task Builder Experience

Progress: Implementation complete; manual UAT pending

Project: `Ewissen Infra (#194)`

URL: `http://localhost:3000`

Database migration: Not required for Phase 6

## What You Are Testing

This phase checks that a business user can create, configure, publish, and test
a conversational booking task without writing prompts, JSON, provider settings,
or a separate flow node for every answer.

Use the temporary task below. The values are supplied so you can copy and paste
them without inventing test data.

## Step 1 of 10 - Create A Booking Task

**Do this**

1. Select `Ewissen Infra (#194)` in the header.
2. Open `Automation`.
3. Open `Tasks`.
4. Select `New Task`.
5. Select the `Booking` starting point.
6. Enter the following task name:

```text
Phase 6 Builder UAT
```

7. Enter the following objective:

```text
Help visitors choose a spa service, share their preferred schedule, and submit a booking request.
```

8. Enter the following internal notes:

```text
Temporary task used to test the Phase 6 conversational task builder.
```

9. Set `After completion` to `Continue helping the visitor`.
10. Select `Create Task`.

**Pass when**

1. The task opens without an error.
2. Its status is `Draft`.
3. The task details show the name, objective, and internal notes you entered.
4. `Save Changes`, `Configure Conversation`, and `Archive Task` appear in one
   organized action row.

## Step 2 of 10 - Check The Guided Workspace

**Do this**

1. Select `Configure Conversation`.
2. Confirm these seven views appear:

```text
Behavior
Context
Tools
Knowledge
Workflow
Test
Versions
```

3. Open `Behavior`.
4. Confirm the common conversation settings are visible.
5. Confirm `Advanced model and transition limits` is collapsed by default.
6. Open and close that section once.
7. Do not change or save the shared project behavior during this test.

**Pass when**

1. All seven views are easy to reach.
2. The advanced section opens and closes correctly.
3. Raw JSON, provider credentials, and voice-only settings are not present in
   the primary editor.

## Step 3 of 10 - Add And Manage A Friendly Field

**Do this**

1. Open `Context`.
2. Confirm the booking starter created these seven field cards:

```text
Service Category
Service
Preferred Date
Preferred Time
Guest Name
Guest Email
Guest Phone
```

3. In `Add Field`, enter:

```text
Visitor Label: Special Request
Answer Type: Short text
Required: Required only when...
When field: Service
Condition: has an answer
Value: leave blank
```

4. Open `Visitor wording`.
5. Enter this exact question:

```text
Do you have any special requests for the appointment?
```

6. Open `Validation and privacy`.
7. Set:

```text
Privacy: Standard
Confirmation: Confirm corrections
Validation: Maximum characters
Characters: 300
```

8. Select `Add Field`.
9. On the new `Special Request` card, select its up-arrow control once.
10. Select its duplicate control.
11. Delete only the duplicated card.
12. Edit the original `Special Request` card.
13. Replace its exact question with:

```text
Please share any special requests for the appointment.
```

14. Save the field.

**Pass when**

1. The app generates a stable field key automatically.
2. The field card is marked `Conditional`.
3. Add, move, duplicate, delete, and edit all work.
4. The edit dialog shows the saved values in friendly controls.
5. No raw field contract or JSON is required.

## Step 4 of 10 - Add Typed Trusted Context

**Do this**

1. Stay on `Context`.
2. Find `Trusted Context`.
3. In `Add Context Variable`, enter:

```text
Key: campaignCode
Source: project
Type: text
```

4. Open `Default, privacy, and expiry`.
5. Enter:

```text
Default Value: phase-6-uat
Sensitivity: Standard
Expires After (minutes): 60
```

6. Keep `Visible to the assistant` selected.
7. Keep `Visible to allowed tools` selected.
8. Select `Add Context`.
9. Edit `campaignCode`.
10. Change its default value to:

```text
phase-6-uat-updated
```

11. Save the change.

**Pass when**

1. The new context variable appears in the list.
2. Its source and type are visible.
3. Edit preserves the other settings.
4. The custom key remains in `Trusted Context` without using the reserved
   `lia_` prefix.

## Step 5 of 10 - Check Project Data Setup

**Do this**

1. Inspect the `Service Category` and `Service` field cards.
2. If the project has an active catalog and services, confirm neither card says
   `Needs setup`.
3. Edit the `Service` field.
4. Open `Choices and project data`.
5. Confirm:

```text
Answer Source: Use project catalog data
Project Data: Catalog item or service
Filter Using: Service Category
```

6. In `Catalog`, select the active spa catalog if it is listed. Otherwise keep
   `Any active catalog`.
7. Save the field.
8. If `Reuse an Automation Field` is displayed, select one field and use
   `Reuse Field`. If no reusable field is available, record `Not applicable`
   and continue.

**Pass when**

1. Catalog options use business names instead of internal IDs.
2. Missing resources are clearly marked `Needs setup`; the app does not invent
   defaults.
3. The service remains dependent on the selected service category.

## Step 6 of 10 - Allow A Ready Tool

**Do this**

1. Open `Tools`.
2. Inspect the `Tool Library`.
3. Confirm each tool shows:

```text
Friendly name and description
Read only or Can take action
Version number
Ready or Needs setup
```

4. Confirm a `Needs setup` tool cannot be selected.
5. Under `Allow a Tool`, choose any tool marked `Ready`.
6. Under `When Lia May Use It`, clear the default stage and select only the
   stage appropriate for that tool. For a read-only lookup, use:

```text
While checking business data
```

7. Select `Allow Tool`.

**Pass when**

1. The allowed tool appears under `Allowed for This Task`.
2. Its friendly name, access level, pinned version, and allowed stage are
   visible.
3. Tools remain off until explicitly allowed.

If no tool is marked `Ready`, stop here and record the tool names and their
`Needs setup` messages. Do not bind an unavailable tool.

## Step 7 of 10 - Configure Outcomes And Safety

**Do this**

1. Open `Workflow`.
2. Under `Add an Outcome`, enter:

```text
Outcome Name: Waitlisted
Result: Could not complete
```

3. Open `Advanced routing`.
4. Enter:

```text
Completion Condition: serviceId is present
Internal Key: leave blank
Canvas Destination: leave blank
```

5. Select `Add Outcome`.
6. In `Behavior and Safety`, set:

```text
Task Language: en
Response Length: Short
Visitor Identity: Anonymous allowed
Task Consent: Use project policy
```

7. Open `Optional wording`.
8. Enter:

```text
Task Instructions: Keep the booking conversation concise and confirm the chosen service before completion.
When Lia Cannot Continue: I could not finish this booking. Please try again.
When Lia Hands Off: I will ask our team to help with this booking.
```

9. Open `After each result`.
10. Set:

```text
Go to after completed: Return to normal Q&A
Go to after failed: Hand off to the team
```

11. Leave `Project data handling` unchanged because it is shared across the
    project.
12. Select `Save Policies`.

**Pass when**

1. `Waitlisted` appears with `Could not complete`.
2. Its condition is shown in plain language below the outcome.
3. The internal key and canvas destination are generated without requiring
   technical input.
4. Optional and advanced controls remain collapsible.
5. The page confirms that policies were saved.

## Step 8 of 10 - Check Knowledge And Publish

**Do this**

1. Open `Knowledge`.
2. Confirm the document and indexed-section counts are visible.
3. Set `When the answer is not available` to:

```text
Use the project fallback
```

4. Keep `Recommend published tasks` selected.
5. Select `Save Knowledge Settings`.
6. Open `Versions`.
7. Confirm the page says `Ready to publish`.
8. Confirm the field, context, tool, and outcome counts include the items added
   in this test.
9. Select `Publish New Version`.

**Pass when**

1. Knowledge settings save successfully.
2. Publishing shows no blocker.
3. A new immutable version appears in version history.
4. The new version is marked `Current`.

If the page says `Needs attention`, stop and record every blocker exactly as
shown.

## Step 9 of 10 - Preview And Test The Task

**Do this**

1. Open `Test`.
2. Open each channel preview:

```text
Project Chat
Widget
WhatsApp
```

3. Confirm all three show the same field and outcome counts.
4. Select `Open Conversation Test`.
5. Set `Conversation Context` to the published `Phase 6 Builder UAT` version.
6. Set `Turn Purpose` to `Collect details`.
7. Enter:

```text
I want to book a Classic Facial on 2026-08-15 at 15:30. My name is Phase Six Guest and my email is phase6.guest@example.com.
```

8. Select `Test Turn`.
9. Return to the `Test` view.
10. Select `Open Runtime Test`.
11. Confirm the active task is `Phase 6 Builder UAT` and the run is pinned to
    the version you published.

**Pass when**

1. Channel wording is adapted without changing the task contract.
2. The conversation test returns a natural visitor reply.
3. Diagnostics remain separate from the visitor reply.
4. Model suggestions are proposals only; no live operation is performed.
5. Runtime Test opens against the published version.

## Step 10 of 10 - Clean Up And Sign Off

**Do this**

1. Return to the `Phase 6 Builder UAT` task.
2. Select `Archive Task`.
3. Confirm it moves to `Archived Tasks`.
4. Do not delete shared catalogs, operations, documents, or project settings.

**Pass when**

1. The temporary task is no longer in the active task list.
2. It remains available to restore.
3. No other project task or resource was changed unexpectedly.

## Sign-Off

Use this result after all ten steps:

```text
Phase 6 UAT: PASS
Project: Ewissen Infra (#194)
Published task version:
Browser:
Notes:
```

Use this result if a step fails:

```text
Phase 6 UAT: FAIL
Failed step:
What I clicked:
Expected:
Actual:
Screenshot:
```

Phase 6 passes only when all ten steps pass and there are no unresolved
critical or high-severity defects.
