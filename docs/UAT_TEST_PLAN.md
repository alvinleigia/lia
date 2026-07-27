# Lia AI UAT Test Plan

## Current Test

Phase: 7 of 18

Test: Hybrid Graph Compiler And Runtime Integration

Progress: Implementation complete; manual UAT pending

Project: `Ewissen Infra (#194)`

URL: `http://localhost:3000`

Database migration: Not required for Phase 7

## What You Are Testing

This phase checks that one published action can move safely between:

1. Knowledge Q&A.
2. A published conversational business task.
3. An exact deterministic message.
4. Knowledge Q&A again.

The test also checks normal and channel entry rules, immutable published
versions, one response owner at a time, and the local project-chat runtime.

Create only the temporary action described below. Do not edit or delete the
existing `Book a Spa Service` task.

## Step 1 of 8 - Create A Temporary Action

**Do this**

1. Select `Ewissen Infra (#194)` in the header.
2. Open `Automation`.
3. Open `Actions`.
4. Select `New Action`.
5. Find `Blank Action`.
6. Enter this action name:

```text
Phase 7 Hybrid UAT
```

7. Enter this description:

```text
Temporary hybrid flow used to test knowledge, task, exact-message, entry, return, and version routing.
```

8. Enter these trigger phrases:

```text
phase seven hybrid test
book a spa service
```

9. Select `Create Action`.
10. Open `Canvas`.

**Pass when**

1. The action opens without an error.
2. The canvas is empty.
3. `Knowledge` and `Business Task` are available in `Blocks`.

## Step 2 of 8 - Add Four Blocks

Add the blocks in this exact order.

### Block 1 - Knowledge

1. Select `Knowledge`.
2. Enter this step name:

```text
Project Questions
```

3. Enter this goal:

```text
Answer verified project questions briefly. Recommend the booking task when the visitor wants to book a spa service.
```

4. Set `Conversation Style` to `Natural conversation`.
5. Turn on `Keep answering questions`.
6. Set `After Answering` to `Stay in Knowledge`.
7. Set `When No Answer Is Found` to `End Conversation`.
8. Set `When Human Help Is Needed` to `End Conversation`.
9. Under `Tasks Lia May Recommend`, confirm this message appears:

```text
Add a Business Task block to enable recommendations.
```

This is expected because the Business Task block has not been added yet.

10. Confirm `Enabled` is on.
11. Select `Create Knowledge Step`.

Before creating the block, its complete configuration should be:

```text
Step Name: Project Questions
Conversation Style: Natural conversation
Keep answering questions: On
After Answering: Stay in Knowledge
When No Answer Is Found: End Conversation
When Human Help Is Needed: End Conversation
Tasks Lia May Recommend: Not available yet
Enabled: On
```

### Block 2 - Business Task

1. Select `Business Task`.
2. Enter this step name:

```text
Book Spa Service
```

3. In `Published Business Task`, select the latest published version of
   `Book a Spa Service`.
4. Leave every outcome set to `End Conversation` for now.
5. Leave `Values Shared With This Task` collapsed. Do not select any visitor
   answers or trusted context for this focused test.
6. Confirm `Enabled` is on.
7. Select `Create Business Task Step`.

Before creating the block, its complete configuration should be:

```text
Step Name: Book Spa Service
Published Business Task: Book a Spa Service - latest version shown
Every After the Task outcome: End Conversation
Values Shared With This Task: None
Enabled: On
```

### Block 3 - Message

1. Select `Message`.
2. Confirm `Step Behavior` is `Message`.
3. Enter this label:

```text
Task Finished
```

4. In `Message`, enter:

```text
The booking task has finished. I can continue helping with project questions.
```

5. Confirm `Enabled` is selected.
6. Leave `Advanced options` collapsed and unchanged.
7. Select `Create Step`.

Before creating the block, its complete configuration should be:

```text
Step Behavior: Message
Label: Task Finished
Message: The booking task has finished. I can continue helping with project questions.
Enabled: On
Advanced options: Unchanged
```

### Block 4 - Knowledge

1. Select `Knowledge`.
2. Enter this step name:

```text
Return To Questions
```

3. Enter this goal:

```text
Continue answering verified project questions after the booking task finishes.
```

4. Set `Conversation Style` to `Natural conversation`.
5. Turn on `Keep answering questions`.
6. Set `After Answering` to `Stay in Knowledge`.
7. Set `When No Answer Is Found` to `End Conversation`.
8. Set `When Human Help Is Needed` to `End Conversation`.
9. Under `Tasks Lia May Recommend`, leave `Book Spa Service` unselected.
10. Confirm `Enabled` is on.
11. Select `Create Knowledge Step`.

Before creating the block, its complete configuration should be:

```text
Step Name: Return To Questions
Conversation Style: Natural conversation
Keep answering questions: On
After Answering: Stay in Knowledge
When No Answer Is Found: End Conversation
When Human Help Is Needed: End Conversation
Tasks Lia May Recommend: None selected
Enabled: On
```

**Pass when**

1. The canvas shows four blocks.
2. Each block has a distinct name.
3. No block is disabled.
4. Amber warning icons may appear on Blocks 2-4 because their routes are not
   configured yet. Hover or focus each icon and confirm it explains that the
   step cannot currently be reached from the start of the flow.
5. Do not treat these temporary reachability warnings as a failure. Step 3
   connects the blocks and clears the relevant diagnostics.

## Step 3 of 8 - Configure The Routes

### Configure Project Questions

1. Select `Project Questions`.
2. Select its edit control.
3. Confirm `Keep answering questions` is on.
4. Confirm `After Answering` is `Stay in Knowledge`.
5. Confirm both fallback selections are `End Conversation`.
6. Under `Tasks Lia May Recommend`, select `Book Spa Service`.
7. Confirm `Enabled` is on.
8. Select `Save Knowledge Step`.

### Configure Book Spa Service

1. Select `Book Spa Service`.
2. Select its edit control.
3. Under `After the Task`, set every available outcome to `Task Finished`.
4. Leave `Values Shared With This Task` unchanged.
5. Confirm `Enabled` is on.
6. Select `Save Business Task Step`.

### Configure Task Finished

1. Close any open editor.
2. On the canvas, find the small output handle on the right side of
   `Task Finished`.
3. Drag from that handle to the small input handle on the left side of
   `Return To Questions`.
4. Confirm a solid route connects the two blocks.
5. Confirm the `Default Routes` count increases.
6. Select `Save Layout`.

**Pass when**

1. Knowledge can recommend `Book Spa Service`.
2. Every task outcome has a destination.
3. A solid default route connects `Task Finished` to
   `Return To Questions`.
4. The diagnostics show no blockers.

## Step 4 of 8 - Configure Entry Rules

1. Select `Entry Rules`.
2. Set `Normal Conversations` to `Project Questions`.
3. Under `Channel Rules`, add this rule:

```text
Match Value: project_chat
Start At: Project Questions
```

4. Add this rule:

```text
Match Value: widget
Start At: Project Questions
```

5. Add this rule:

```text
Match Value: whatsapp
Start At: Project Questions
```

6. Select `Save Entry Rules`.

**Pass when**

1. The normal route is saved.
2. All three channel rules are visible.
3. No WhatsApp-specific data is stored inside a block or business task.

## Step 5 of 8 - Publish The Graph

1. Select `Overview`.
2. Confirm the action reports no publish blockers.
3. Select `Publish`.
4. Confirm the first published version appears in `Version History`.
5. Select `Test Flow`.

**Pass when**

1. Publication succeeds.
2. `Published Flow Test` opens.
3. It shows four nodes and the published version number.
4. The page states that the test does not create live conversations,
   submissions, or tool attempts.

## Step 6 of 8 - Test The Complete Hybrid Path

1. Set `Start From` to `Normal conversation`.
2. Select `Start Test`.
3. Confirm the current node is `Project Questions`.
4. Confirm the response owner is `Knowledge Q&A`.
5. Select `Answer and stay here`.
6. Confirm the current node remains `Project Questions`.
7. Select `Recommend Book Spa Service`.
8. Confirm the current node becomes `Book Spa Service`.
9. Confirm the response owner becomes `Conversational task`.
10. Select `Ask a side question`.
11. Confirm the same task remains active.
12. Select any named task outcome.
13. Confirm the current node becomes `Task Finished`.
14. Confirm the response owner becomes `Flow step`.
15. Select `Continue`.
16. Confirm the current node becomes `Return To Questions`.
17. Confirm the response owner becomes `Knowledge Q&A`.
18. Select `Answer and stay here`.

**Pass when**

1. Only one response owner is shown at every point.
2. The side question does not leave or restart the task.
3. The named outcome controls the route.
4. The exact message runs before Knowledge Q&A resumes.
5. `Test Trail` records the same sequence.

## Step 7 of 8 - Test Universal Channel Entry

Repeat these instructions for `project_chat`, `widget`, and `whatsapp`.

1. Set `Start From` to `Channel`.
2. Select one channel in `Entry Rule`.
3. Select `Start Again`.
4. Confirm the current node is `Project Questions`.
5. Confirm the response owner is `Knowledge Q&A`.

**Pass when**

1. All three channel keys enter the same published graph.
2. The nodes and routes do not change by channel.
3. No live WhatsApp number or provider delivery is required in this phase.

Live website-widget and WhatsApp-provider delivery certification belongs to
Phase 13.

## Step 8 of 8 - Project Chat Smoke Test And Cleanup

### Project chat smoke test

1. Open `Projects`.
2. Open `Chat`.
3. Start a new conversation if an old conversation is active.
4. Send:

```text
phase seven hybrid test
```

5. Then send:

```text
I want to book a spa service.
```

6. Confirm Lia enters the published booking task and asks only for a missing
   booking detail.
7. Send:

```text
cancel
```

8. Confirm the task ends without creating a booking and Lia can answer an
   ordinary project question again.

### Cleanup

1. Return to `Automation`.
2. Open `Actions`.
3. Open `Phase 7 Hybrid UAT`.
4. Open `Settings`.
5. Select `Delete Action`.
6. Confirm the deletion.
7. Do not delete or archive `Book a Spa Service`.

**Pass when**

1. Project chat uses the published hybrid action without a duplicate reply.
2. Cancelling returns response ownership to Knowledge Q&A.
3. The temporary action is removed.
4. The existing business task, catalogs, documents, and operations remain
   unchanged.

## Phase 7 Sign-Off

Phase 7 passes when all eight steps pass.

After passing, report:

```text
Phase 7 UAT complete.
```

Do not continue to Phase 8 until Phase 7 is recorded as complete in
`FLOW_BUILDER_ROADMAP.md`.
