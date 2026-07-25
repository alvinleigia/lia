# Lia AI UAT Test Plan

Use this checklist to test Lia AI in phases instead of trying to validate the
whole application in one sitting.

## Document Role

This file contains manual test instructions and evidence for a specific build.
It is not the implementation-status source or the final beta approval source.

- `FLOW_BUILDER_ROADMAP.md` controls flow capability and phase completion.
- `BETA_READINESS_CHECKLIST.md` controls the overall beta release decision.
- A passing item here is evidence for those documents; it does not replace
  their exit gates.

## UAT Environment

- UAT URL:
- Vercel deployment commit:
- Database/environment:
- Tester name:
- Test date:

## UAT Rules

- Test one phase at a time.
- Do not move to the next phase if a critical issue blocks the current phase.
- Capture screenshots for failures.
- Record the exact user, project, action, or submission involved in a failure.
- Use fresh test users where possible.
- Do not use real customer data during UAT.

## How To Mark Each Item

Use this simple status style under each checklist item:

```text
Status: Not started / Pass / Fail / Blocked
Notes:
```

## Incremental Builder Development Acceptance

Use these short checks while the conversational core is being built. Complete
one slice before development moves to the next slice.

### Phase 1 Of 18 - Slice 1 Of 7 - Task Workspace

Build/commit: `9c35c65`

Status: Pass

Tester: Alvin

Test date: 2026-07-24

- [x] Run `npx drizzle-kit migrate`.
  Expected result: The command returns to the prompt without an error.
  Status: Pass
  Notes: Migration `0032_conversational_task_workspace` applied locally.

- [x] Start the app and sign in to an active company account with a selected project.
  Expected result: The signed-in navbar loads and shows `Automation`.
  Status: Pass
  Notes:

- [x] Open `Automation`, then select `Tasks`.
  Expected result: The Conversational Tasks page opens for the selected project.
  Status: Pass
  Notes:

- [x] Select `New Task`.
  Expected result: A separate form asks for task name, objective, and optional internal notes.
  Status: Pass
  Notes:

- [x] Create a task named `Book a Spa Service`.
  Expected result: The task detail page opens and shows `Task created`.
  Status: Pass
  Notes:

- [x] Change the task name or objective and select `Save Changes`.
  Expected result: The page reloads with `Changes saved` and the updated value remains visible.
  Status: Pass
  Notes:

- [x] Return to the task list and open the task again.
  Expected result: The saved values remain after navigation and reload.
  Status: Pass
  Notes:

- [x] Archive the task.
  Expected result: The task moves from the active list to `Archived Tasks`.
  Status: Pass
  Notes:

- [x] Restore the task.
  Expected result: The task returns as an editable draft.
  Status: Pass
  Notes:

- [x] Switch to another project and open `Automation`, then `Tasks`.
  Expected result: The task from the first project is not visible.
  Status: Pass
  Notes: Verified between Ewissen Infra `#194` and Ewissen Inc `#195`.

Exit gate: create, edit, reload, archive, restore, and project isolation all pass
without a runtime error.

### Phase 1 Of 18 - Slices 2-7 - Complete Task Contract

Build/commit: `e477f24`

Status: Not started

Tester:

Test date:

Use this test context:

- Primary project: `Ewissen Infra (#194)`
- Isolation project: `Ewissen Inc (#195)`
- Task: `Book a Spa Service`
- Use only the sample content below. Do not enter real customer information.

#### Step 1 - Confirm The Database Migration

- [ ] If this database has not received this build, stop the development server
  and run:

  ```powershell
  npx drizzle-kit migrate
  ```

  For the current local database, the migration has already been applied. Mark
  this check as passed and do not rerun it only for UAT.

  Expected result: Migration `0033_conversation_contract_foundation` is applied
  once and the command returns to the prompt without an error.
  Status:
  Notes:

#### Step 2 - Open The Conversation Configuration

- [ ] Sign in, select `Ewissen Infra (#194)`, and open `Automation`, then
  `Tasks`.

- [ ] Open `Book a Spa Service`, then select `Configure Conversation`.

  Expected result: Assistant, Fields, Tools, Outcomes, and Review navigation is
  visible without a runtime error.
  Status:
  Notes:

#### Step 3 - Configure The Assistant

- [ ] Open `Assistant` and enter these values:

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

  When no answer exists:

  ```text
  Use fallback
  ```

  Visitor Identity:

  ```text
  Project-scoped visitor
  ```

  Cross-channel linking:

  ```text
  Verified contacts only
  ```

- [ ] Enable `Allow knowledge answers to recommend published tasks`, then save
  the assistant settings and reload the page.

  Expected result: `Conversation policy saved` appears and values remain after
  reload.
  Status:
  Notes:

#### Step 4 - Apply And Verify Booking Fields

- [ ] Open `Fields`.

- [ ] If no task fields are present, select `Apply Booking Starter`. If the
  starter was already applied, do not apply it again.

  Expected result: Seven booking fields, trusted `lia_timezone` context, and
  these dependencies appear:

  - `serviceCategoryId`
  - `serviceId`, dependent on `serviceCategoryId`
  - `preferredDate`, dependent on `serviceId`
  - `preferredTime`, dependent on `preferredDate`
  - `guestName`
  - `guestEmail`
  - `guestPhone`, normalized as E.164

  Status:
  Notes:

#### Step 5 - Test A Temporary Field

- [ ] In `Add Field`, enter these values:

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

  Leave `Depends On`, `Validation Rule`, and `Normalization` empty. Leave
  `Required` unchecked.

- [ ] Add the field, reload the page, and confirm it remains visible.

- [ ] Try to add the same `specialRequest` field key again.

  Expected result: The duplicate field key is rejected. The error appears
  inside the `Add Field` form and all entered field values remain unchanged.

- [ ] Remove the temporary `Special Request` field.

  Expected result: The field is removed without affecting the seven booking
  fields.
  Status:
  Notes:

#### Step 6 - Test Trusted Context

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

  Expected result: The value is rejected because non-system context cannot use
  the reserved `lia_` prefix. The form shows `The lia_ prefix is reserved for
  system context.` and the entered key, source, and type remain unchanged.

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

  Expected result: The valid context persists after reload. The booking
  starter's `lia_timezone` context shows `System protected` and has no edit or
  delete controls.

- [ ] Edit `uatCampaign`, change its source to `Project`, and save.

  Expected result: The source changes to `project`. The key is displayed as
  fixed and cannot be edited.

- [ ] Open `Outcomes`. In `Fallback Message`, enter:

  ```text
  Campaign {{context.uatCampaign}} could not be completed.
  ```

- [ ] Save the policy, return to `Fields`, and find `uatCampaign`.

  Expected result: The variable shows `Used by: Fallback message`. Its delete
  control is disabled, while its edit control remains available. No dependent
  configuration is removed or rewritten.

- [ ] Return to `Outcomes` and restore `Fallback Message` to:

  ```text
  I could not complete that booking request. Let me connect you with the team.
  ```

- [ ] Save the policy, return to `Fields`, and remove `uatCampaign`.

  Expected result: The usage message is gone, deletion is available, and the
  unreferenced variable can be removed. The protected `lia_timezone` variable
  remains present.
  Status:
  Notes:

#### Step 7 - Verify Tool Permissions

- [ ] Open `Tools`.

  Expected result: No operation is permitted by default. Active project
  operations can be selected, but operations from another project are never
  shown.
  Status:
  Notes:

- [ ] If an active test operation is available, select it and use:

  Permission:

  ```text
  Read data
  ```

  Allowed stage:

  ```text
  Lookup
  ```

  Leave the other stages unchecked, bind the operation, and reload the page.

  Expected result: The versioned `operation:<id>` binding persists and can be
  removed without changing the underlying project operation.

- [ ] Remove the temporary binding.

  If no active operation is available, record `No active project operation
  available` in Notes and mark only the binding subtest as `Blocked`. Confirm
  that the page remains default-deny; do not create a provider operation only
  for this Phase 1 test.

  Status:
  Notes:

#### Step 8 - Verify And Extend Outcomes

- [ ] Open `Outcomes`.

  Expected result: The booking starter includes:

  - `Completed`
  - `Cancelled`
  - `Needs Team Help`
  - `Booking Failed`

- [ ] Add this temporary outcome:

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

- [ ] Reload the page, confirm the outcome remains, and then remove it.

  Expected result: Named outcomes can be added, persisted, and removed without
  changing the four booking starter outcomes.
  Status:
  Notes:

#### Step 9 - Configure Behavior And Safety

- [ ] In `Behavior and Safety`, enter these values:

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

  Completed return behavior:

  ```text
  Return to knowledge
  ```

  Cancelled return behavior:

  ```text
  Return to knowledge
  ```

  Failed return behavior:

  ```text
  Handoff
  ```

  No Answer return behavior:

  ```text
  Return to knowledge
  ```

  Handoff return behavior:

  ```text
  Suspend
  ```

  Field retention days:

  ```text
  365
  ```

  Message retention days:

  ```text
  90
  ```

- [ ] Enable `Consent required` and `Export allowed`, save the policy, and
  reload the page.

  Expected result: The saved behavior, retention, consent, and export settings
  remain unchanged after reload.
  Status:
  Notes:

#### Step 10 - Review The Draft

- [ ] Open `Review`.

  Expected result: Fields, context, tools, and outcomes are summarized. The
  clean test state shows seven fields, one trusted context variable, four
  outcomes, and no temporary tool binding. The page is either ready to publish
  or lists a precise blocker that identifies what must be corrected.
  Status:
  Notes:

#### Step 11 - Publish Version 1

- [ ] Resolve any listed blocker, then select `Publish New Version`.

  Expected result: Version 1 appears in Version History.
  Status:
  Notes:

#### Step 12 - Prove Versioned Publishing

- [ ] Return to `Assistant` and add this final line to `Shared Instructions`:

  ```text
  When the visitor changes a detail, use the latest confirmed value.
  ```

- [ ] Save the assistant policy, return to `Review`, and publish another
  version.

  Expected result: Version 2 is added and Version 1 remains listed in Version
  History. Publishing creates a new immutable version instead of replacing the
  previous version.
  Status:
  Notes:

#### Step 13 - Verify Project Isolation

- [ ] Copy or note the task ID from the current task URL.

- [ ] Switch to `Ewissen Inc (#195)` and open `Automation`, then `Tasks`.

- [ ] Try to open the `Ewissen Infra (#194)` task URL while project `#195` is
  selected.

  Expected result: The task and its versions are not accessible from the
  second project. The application returns to a safe task view or shows that the
  task was not found; it must not display the first project's configuration.

- [ ] Switch back to `Ewissen Infra (#194)` and reopen the task's `Review`
  page.

  Expected result: Both published versions remain visible in the correct
  project.
  Status:
  Notes:

Exit gate: the reference booking task validates and publishes immutable
versions that pin the project policy, task fields, context, tool bindings,
outcomes, return behavior, safety, and data policy without channel- or
provider-specific configuration.

## Cross-Cutting Form UX Regression

Run these checks once per release candidate. They verify the shared form
behavior used across authentication, account management, project settings,
catalogs, channels, operations, flow steps, branch rules, and conversational
tasks.

### Check 1 - Project Form Values Survive Validation

- [ ] Open `Projects`, select `New Project`, and enter:

  Project Name:

  ```text
  UAT Project Name That Is Intentionally Longer Than One Hundred And Twenty Characters To Trigger Server Validation Without Clearing The Entered Value
  ```

- [ ] Select `Create Project`.

  Expected result: A validation message appears inside the New Project form.
  The page does not navigate to an error query string and the entered value
  remains in the field.
  Status:
  Notes:

### Check 2 - Catalog Product Values Survive Validation

- [ ] Open `Projects`, `Product Catalog`, and enter:

  Product Name:

  ```text
  UAT Invalid Price Product
  ```

  SKU:

  ```text
  UAT-PRICE-001
  ```

  Price:

  ```text
  12.345
  ```

  Currency:

  ```text
  INR
  ```

- [ ] Select `Add Product`.

  Expected result: `Price must be a valid amount with up to 2 decimals`
  appears inside the Add Product form. Product name, SKU, price, currency, and
  selected catalog remain unchanged. No product is created.
  Status:
  Notes:

### Check 3 - Operation JSON Is Validated Before Side Effects

- [ ] Open `Automation`, `Operations`, then find `Create API Request`.

- [ ] Enter:

  Name:

  ```text
  UAT Invalid Mapping
  ```

  Provider:

  ```text
  Webhook
  ```

  Endpoint URL:

  ```text
  https://example.com/uat-invalid-mapping
  ```

  Input Mapping:

  ```text
  {"guestEmail":
  ```

- [ ] Keep the remaining defaults and select `Create API Request`.

  Expected result: The JSON error appears inside the Create API Request form,
  all entered values remain, and no provider or operation named `UAT Invalid
  Mapping` is created.
  Status:
  Notes:

### Check 4 - Flow Step Form Values Survive Validation

- [ ] Open a draft action and create or edit a step.

- [ ] Enter:

  Label:

  ```text
  UAT Contact Preference
  ```

  Field Key:

  ```text
  uatContactPreference
  ```

  Prompt:

  ```text
  How would you prefer us to contact you?
  ```

- [ ] Set an invalid or duplicate step order and save.

  Expected result: The step-order error appears inside the step form and the
  label, field key, prompt, selected behavior, and advanced settings remain
  unchanged.
  Status:
  Notes:

### Check 5 - Bulk Handoff Validation Stays Local

- [ ] Open `Automation`, `Handoffs`.

- [ ] Without selecting a handoff, select `Claim`.

  Expected result: `Select at least one handoff` appears inside the handoff
  queue form. The current queue and filter remain unchanged.
  Status:
  Notes:

### Check 6 - Upload Errors Explain Browser Reselection

- [ ] Open `Projects`, `Media Library`.

- [ ] Try an unsupported or empty test file.

  Expected result: The error appears inside the Upload Media form. The page
  explains that the file must be selected again. No asset is created.
  Status:
  Notes:

### Check 7 - Sensitive Values Stay Out Of The URL

- [ ] Open `Projects`, `WhatsApp`, enter disposable invalid settings, and save.

  Expected result: Validation appears inside the Channel Settings form. No
  token, app secret, verify token, recipient number, or message content appears
  in the browser URL.
  Status:
  Notes:

Exit gate: validation errors are local, non-file values remain available for
correction, sensitive values never enter query strings, command forms still
complete normally, and uploads clearly communicate the browser-enforced file
reselection requirement.

## Phase 0 - Environment Readiness

Goal: confirm the UAT environment is safe to test.

- [ ] Open the UAT URL.
  Expected result: Landing page loads with one top navbar only.
  Status:
  Notes:

- [ ] Confirm latest commit.
  Expected result: Deployment uses the intended GitHub commit.
  Status:
  Notes:

- [ ] Confirm env variables.
  Expected result: App has database, auth, OpenAI, app URL, and admin email configured.
  Status:
  Notes:

- [ ] Confirm database schema.
  Expected result: Latest migrations are applied.
  Status:
  Notes:

- [ ] Confirm platform admin email.
  Expected result: `support@leigia.com` is included in platform admin emails.
  Status:
  Notes:

- [ ] Confirm cron setup.
  Expected result: Upload queue cron is configured for daily processing.
  Status:
  Notes:

Suggested technical checks:

```bash
npm run check:local-env
npm run check:cron-config
npm run check:tenant-scope
```

Exit gate: UAT URL loads, sign-in/sign-up pages load, and no deployment error is visible.

## Phase 1 - Public Site And Authentication

Goal: confirm public access, signup, signin, and signout work.

- [ ] Open `/` while signed out.
  Expected result: Landing page displays Lia AI and auth actions.
  Status:
  Notes:

- [ ] Click `Sign Up`.
  Expected result: Signup page opens.
  Status:
  Notes:

- [ ] Create a new test account.
  Expected result: Account is created and user is redirected into the app.
  Status:
  Notes:

- [ ] Sign out.
  Expected result: User returns to signed-out state.
  Status:
  Notes:

- [ ] Sign in with the same account.
  Expected result: User can access the project area again.
  Status:
  Notes:

- [ ] Try wrong password.
  Expected result: Login fails with a clear error.
  Status:
  Notes:

- [ ] Use profile menu signout.
  Expected result: User is signed out successfully.
  Status:
  Notes:

Test data:

```text
Email: uat.owner+<date>@leigia.com
Password: Use a temporary UAT password only
```

Exit gate: a normal user can sign up, sign in, and sign out.

## Phase 2 - Platform Admin And Tenant Management

Goal: confirm SaaS admin basics work before inviting real testers.

- [ ] Sign in as `support@leigia.com`.
  Expected result: User lands on or can open `/platform`.
  Status:
  Notes:

- [ ] Open `/platform`.
  Expected result: Tenant/company list is visible.
  Status:
  Notes:

- [ ] Open a tenant detail page by clicking `View` on a tenant row.
  Expected result: Members, projects, and read-only pending invitations are visible.
  Status:
  Notes:

- [ ] Confirm platform admin cannot create tenant invitations.
  Expected result: No invite form or cancel button is available on the platform tenant detail page.
  Status:
  Notes:

- [ ] Disable a tenant.
  Expected result: Tenant owner cannot use the app normally.
  Status:
  Notes:

- [ ] Re-enable the tenant.
  Expected result: Tenant owner can use the app again.
  Status:
  Notes:

- [ ] Sign in as non-admin and open `/platform`.
  Expected result: Access is denied or redirected.
  Status:
  Notes:

Exit gate: platform admin can manage tenants without exposing admin pages to normal users.

## Phase 3 - User Profile, Team, And Projects

Goal: confirm account setup and project management.

- [ ] Open `/profile`.
  Expected result: User details, account details, and access state display correctly.
  Status:
  Notes:

- [ ] Update display name.
  Expected result: Header/profile show the updated user name.
  Status:
  Notes:

- [ ] Open `/team`.
  Expected result: Member list is visible.
  Status:
  Notes:

- [ ] Invite a teammate.
  Expected result: Pending invite is created from the company owner Team area.
  Status:
  Notes:

- [ ] Accept teammate invite.
  Expected result: Teammate can join the same company/account.
  Status:
  Notes:

- [ ] Disable teammate.
  Expected result: Disabled teammate cannot access active tenant resources.
  Status:
  Notes:

- [ ] Create a new project.
  Expected result: Project appears in project list and selector.
  Status:
  Notes:

- [ ] Rename project.
  Expected result: New project name displays in list/header.
  Status:
  Notes:

- [ ] Archive project.
  Expected result: Project becomes archived and widget access is disabled.
  Status:
  Notes:

- [ ] Unarchive project.
  Expected result: Project becomes available again.
  Status:
  Notes:

Exit gate: one company account can manage users and multiple projects.

## Phase 4 - Documents And Project Chat

Goal: confirm knowledge-base upload, indexing, source quality guidance, and RAG chat.

- [ ] Open `/projects/documents`.
  Expected result: Document page loads for selected project.
  Status:
  Notes:

- [ ] Review the Source Quality panel.
  Expected result: Tester sees guidance for precise facts, current details, and clear answer boundaries.
  Status:
  Notes:

- [ ] Upload a small `.txt` or `.md` file.
  Expected result: Source document is created.
  Status:
  Notes:

- [ ] Process queued document.
  Expected result: Chunks are created and status updates.
  Status:
  Notes:

- [ ] Open `/projects/chat`.
  Expected result: Chat page loads.
  Status:
  Notes:

- [ ] Ask a question answered by the uploaded file.
  Expected result: Assistant answers from project documents.
  Status:
  Notes:

- [ ] Ask unrelated question.
  Expected result: Assistant handles missing context safely.
  Status:
  Notes:

- [ ] Delete document.
  Expected result: Document and related knowledge are removed from UI.
  Status:
  Notes:

Suggested test document:

```text
Lia UAT Salon offers a Gold Facial package for 2500 INR. The appointment takes 60 minutes.
```

Suggested question:

```text
What is the price of the Gold Facial package?
```

Exit gate: selected project can upload knowledge and chat can retrieve it.

## Phase 5 - AI Answer Controls And Answer Tests

Goal: confirm project-level AI behavior settings produce short, precise, business-safe answers.

- [ ] Open a project settings page.
  Expected result: AI Behavior section is visible.
  Status:
  Notes:

- [ ] Select a Conversation Goal.
  Expected result: Conversation goal saves and remains selected after reload.
  Status:
  Notes:

- [ ] Set answer length to `short`.
  Expected result: Saved chat answers are concise by default.
  Status:
  Notes:

- [ ] Set follow-up policy to `only when required`.
  Expected result: Assistant does not ask unnecessary follow-up questions.
  Status:
  Notes:

- [ ] Set extra help policy to `only when asked` or `never`.
  Expected result: Assistant does not offer email drafts, checklists, or extra tasks unless allowed.
  Status:
  Notes:

- [ ] Add fallback phone/email/message.
  Expected result: Assistant uses configured fallback details only when verified information is unavailable.
  Status:
  Notes:

- [ ] Add Answer Guidance.
  Expected result: Guidance saves and influences chat answers.
  Status:
  Notes:

- [ ] Open `/projects/answer-tests`.
  Expected result: Answer Tests page loads for selected project.
  Status:
  Notes:

- [ ] Review test prompt list.
  Expected result: Prompts include baseline tests and conversation-goal-specific tests.
  Status:
  Notes:

- [ ] Run at least five Answer Test prompts in `/projects/chat`.
  Expected result: Responses match the expected behavior shown on the Answer Tests page.
  Status:
  Notes:

- [ ] Complete the Evaluation Checklist manually.
  Expected result: Each response is checked for directness, brevity, grounding, no internal terms, no unasked extras, and safe boundaries.
  Status:
  Notes:

Suggested Ewissen-style checks:

```text
Where is the company based?
Tell me about Bliss Aqua plots.
What is the price of Bliss Aqua plots?
Can you guarantee this is a good investment?
How can I contact your sales team?
```

Exit gate: answer tests pass for the selected project without long, generic, or unsafe responses.

## Phase 6 - Flow Builder Basics

Goal: confirm a non-technical user can create, edit, route, and publish a
visual flow without affecting an existing live action.

Use a disposable action for these checks. Do not modify the published `Book
Spa Service` action while learning the builder.

### 6.1 Confirm the actions area

- [ ] Open `/projects/actions`.
  Instructions: Confirm the selected project is correct, then review the
  existing actions and their status.
  Expected result: The actions list loads and `New Action` is available.
  Status:
  Notes:

- [ ] Confirm the bundled template created earlier.
  Instructions: Open `Book Spa Service` and confirm its nine steps and current
  published version are still present. Return to the actions list without
  changing it.
  Expected result: The template action remains available and unchanged.
  Status:
  Notes:

### 6.2 Create a disposable test action

- [ ] Create a blank action.
  Instructions: Select `New Action`, scroll to `Blank Action`, and enter:
  Action Name: `UAT Flow Test`
  Description: `Temporary flow used for builder acceptance testing.`
  Trigger Phrases: `start uat flow`
  Select `Create Action`.
  Expected result: A draft action named `UAT Flow Test` is created and its
  detail page opens.
  Status:
  Notes:

- [ ] Open the visual canvas.
  Instructions: Select `Canvas` from the action detail page.
  Expected result: The canvas loads with the Blocks panel, an empty canvas,
  canvas controls, and no error overlay.
  Status:
  Notes:

### 6.3 Create the basic steps

- [ ] Add a message step.
  Instructions: Select `Message` from the Blocks panel. In the Create Step
  dialog, set the label to `Welcome`, enter `Welcome to the UAT flow.` as the
  visitor-facing message, keep the step enabled, and create it.
  Expected result: A Welcome node appears on the canvas and its content is
  readable without overflowing the node.
  Status:
  Notes:

- [ ] Add a choice step.
  Instructions: Select `Choice` from the Blocks panel. Set the label to
  `Service Choice`, the prompt to `Which option would you like?`, and add
  `Sales` and `Support` as choices. Create the step.
  Expected result: A Service Choice node appears and shows both choices.
  Status:
  Notes:

- [ ] Add a collect-input step.
  Instructions: Select `Ask Question` from the Blocks panel. Set the label to
  `Email`, field key to `customerEmail`, prompt to `What is your email?`, input
  type to `Email`, and enable `Required`. Create the step.
  Expected result: An Email node appears with the field key and required input
  configuration saved.
  Status:
  Notes:

- [ ] Add an answer step for content testing.
  Instructions: Select `Ask Question` from the Blocks panel. Set the label to
  `Contact Method`, field key to `preferredContact`, prompt to `How should we
  contact you?`, input type to `Text`, and enable `Required`. Create the step.
  Expected result: A Contact Method node appears without an existing choice or
  list content block.
  Status:
  Notes:

- [ ] Add a terminal step.
  Instructions: Select `Message` from the Blocks panel. Set the label to
  `Complete` and the message to `Thank you. Your request is complete.` Create
  the step and configure it as the final step if the dialog presents terminal
  routing controls.
  Expected result: A Complete node appears and the flow has a final path.
  Status:
  Notes:

### 6.4 Test canvas content editing

- [ ] Review every Add Content option on a message node.
  Instructions: On the Welcome node, select `Add content`. Confirm the menu
  shows Text message, Text + buttons, List message, Media, Catalogue message,
  Single product, Multiple products, Template, and Request intervention.
  Expected result: All options remain visible. Text message is available.
  Options that need an answer, media, catalog, product, or standalone step are
  disabled with a plain-language reason.
  Status:
  Notes:

- [ ] Confirm answer-specific content becomes available.
  Instructions: Close the Welcome menu. On the Contact Method node, select
  `Add content` and choose `List message`. Add two options: `Email` and `Phone`.
  Save the node.
  Expected result: List message is available on this answer step, both options
  appear in the node, and the content is identified as a list message.
  Status:
  Notes:

- [ ] Confirm duplicate choice content is prevented.
  Instructions: Reopen `Add content` on the Contact Method node.
  Expected result: Text + buttons and List message remain visible but are
  disabled with `This step already has a choice or list block.`
  Status:
  Notes:

- [ ] Review the friendly choice editor.
  Instructions: Edit the Contact Method list content. Confirm the editor shows
  `Question or introduction`, the Buttons, List, and Typed reply presentation
  choices, editable option labels, and controls to add, move, and remove
  options. Move `Phone` above `Email`, add `Other`, and save.
  Expected result: The editor uses visitor-facing labels, List remains selected,
  and the reordered options persist without exposing raw configuration.
  Status:
  Notes:

- [ ] Review text guidance and limits.
  Instructions: Edit a Welcome text block and enter a short message.
  Expected result: The editor identifies the field as `Message`, displays a
  live character count, and prevents text longer than the supported limit.
  Status:
  Notes:

- [ ] Review media content when an active asset exists.
  Instructions: Upload an active test image in Media Library, return to the
  canvas, add Media content to a message node, choose the file by name, add a
  caption, and save.
  Expected result: The editor shows a named file selector and caption field;
  the saved node displays the selected media content without asking for an ID.
  Status:
  Notes:

- [ ] Review catalog and product content when test products exist.
  Instructions: With an active catalog and products available, add Catalogue
  message, Single product, and Multiple products content in turn. Choose the
  catalog by name, switch between Grid, List, and Featured layouts, and select
  products using the visible product names.
  Expected result: Catalogs and products are selected by name, single-product
  content permits one product, and multiple-product content permits several.
  Status:
  Notes:

- [ ] Edit content directly inside a node.
  Instructions: On the Welcome node, select the pencil icon beside its content.
  Change the message to `Welcome. How can we help today?` and save it.
  Expected result: The node updates without leaving the canvas or opening a
  full-page editor.
  Status:
  Notes:

- [ ] Add another content block inside the node.
  Instructions: On the Welcome node, select `Add content`, choose `Text
  message`, enter `Please choose an option below.`, and save it.
  Expected result: Both messages appear in the node in the saved order.
  Status:
  Notes:

- [ ] Reorder and duplicate node content.
  Instructions: Use the arrow controls to move the second message above the
  first. Duplicate one text message, edit the duplicate, then remove the
  duplicate.
  Expected result: Move, duplicate, edit, and remove operations persist; node
  borders and text remain fully visible.
  Status:
  Notes:

- [ ] Confirm content persists after reload.
  Instructions: Refresh the browser and reopen the UAT Flow Test canvas.
  Expected result: The saved steps, text content, Contact Method list mode,
  options, content order, and canvas positions remain unchanged.
  Status:
  Notes:

### 6.5 Test compact and advanced editing

- [ ] Confirm the compact editor uses the same Add Content menu.
  Instructions: Select the Contact Method node itself, outside its inline
  controls. In the Edit Step dialog, select `Add content`.
  Expected result: The same nine options and disabled reasons shown on the
  canvas are present in the compact editor.
  Status:
  Notes:

- [ ] Open the compact Edit Step dialog.
  Instructions: Select the Email node itself, outside its inline controls.
  Change its prompt to `Where can we contact you?` and save the common
  settings.
  Expected result: A focused Edit Step dialog opens and the updated prompt is
  visible on the node.
  Status:
  Notes:

- [ ] Confirm friendly editors are identical in both editing surfaces.
  Instructions: Reopen the Contact Method node and edit its saved list content
  from the compact Edit Step dialog.
  Expected result: The same question field, presentation choices, option order,
  character guidance, and save behavior appear as in inline canvas editing.
  Status:
  Notes:

- [ ] Review template message progressive disclosure.
  Instructions: Create or edit a Template message step. Confirm its visible
  fields focus on template name and message preview, then expand `Delivery
  details`.
  Expected result: Language, category, approval status, and variables remain
  available inside Delivery details instead of crowding the main editor.
  Status:
  Notes:

- [ ] Test advanced validation.
  Instructions: Select the Email node again, expand `Advanced settings`, set an
  invalid-value message to `Enter a valid email address.`, and save.
  Expected result: Advanced settings remain hidden until expanded and the
  validation message persists after reopening the node.
  Status:
  Notes:

- [ ] Confirm dedicated input blocks choose their answer format automatically.
  Instructions: Create an `Ask Email` block and inspect its main fields.
  Expected result: The editor says `Answer format: Email address`, does not show
  a redundant Input Type selector, and explains that email format is validated
  automatically. Repeat with Ask Phone, Ask Date, Ask Time, and Ask Number.
  Status:
  Notes:

- [ ] Confirm Ask Question permits a general answer format.
  Instructions: Create an `Ask Question` block and switch Answer format between
  Text, Email address, Phone number, Date, Time, Whole number, and Number.
  Expected result: Every option remains selectable and the validation guidance
  changes to match the selected format without changing the block behavior.
  Status:
  Notes:

- [ ] Confirm validation fields are relevant to the input family.
  Instructions: Expand Advanced options for Text, Number, Date, and Email
  inputs in turn.
  Expected result: Text and Email show character limits; Number shows minimum
  and maximum values; Date shows earliest and latest dates; unrelated controls
  are absent. Custom answer pattern remains collapsed until opened.
  Status:
  Notes:

- [ ] Confirm structured address and location guidance.
  Instructions: Create Ask Address and Ask Location blocks, then preview each
  flow input.
  Expected result: Address collects reusable address parts. Location accepts a
  place label or valid browser coordinates. Neither editor exposes irrelevant
  text, number, or date constraints.
  Status:
  Notes:

- [ ] Confirm friendly file-upload restrictions.
  Instructions: Create an Ask Media block, expand Advanced options, and switch
  Files visitors may upload between Common files, Images only, Documents only,
  and Custom file types.
  Expected result: Presets save without entering MIME identifiers. Custom file
  types reveals one optional field for extensions or media types.
  Status:
  Notes:

### 6.6 Test friendly action editors

- [ ] Add a completion action.
  Instructions: Select `Submit` from the Actions group. Give the step a clear
  name, add the short confirmation shown to the visitor, keep it active, and
  save it.
  Expected result: Only the step name, optional confirmation, and active state
  are shown. The saved action appears as a terminal step.
  Status:
  Notes:

- [ ] Add and edit an integration action.
  Instructions: Ensure a project operation exists under `/projects/operations`,
  then add `API Request`. Select the operation by name, choose `During the
  conversation`, expand `Result and routing`, enter a result field, and select
  success and failure destinations. Save, close, and reopen the step.
  Expected result: The operation, timing, result field, and route destinations
  persist. Exactly one friendly integration editor is shown and no duplicate
  technical action form appears.
  Status:
  Notes:

- [ ] Add a human handoff action.
  Instructions: Add `Request Intervention`. Enter the visitor message, team or
  queue, priority, and whether the team should be notified. Optionally select a
  notification operation when one is configured.
  Expected result: Handoff settings use business language and save without
  exposing operation IDs or raw settings.
  Status:
  Notes:

- [ ] Add a connected-flow action.
  Instructions: Create a second disposable action, then add `Connect Flow` to
  the UAT flow. Select the other flow by name and choose whether to return to
  the current flow or end it after the connected flow finishes.
  Expected result: Only active flows from the selected project can be chosen,
  and the selected flow and return behavior persist after reopening.
  Status:
  Notes:

- [ ] Add contact-detail and contact-tag actions.
  Instructions: Add `Set Attribute`, choose a reusable answer or a fixed value,
  and save it. Add `Add Tag` with two plain-language tags.
  Expected result: Each action displays only its relevant fields. The reusable
  answer list uses field names already collected by this project's flows.
  Status:
  Notes:

- [ ] Confirm planned actions are honest.
  Instructions: Review `AI and Knowledge` and `Wait` in the Actions palette.
  Expected result: Both remain visible but disabled. Each shows a specific
  reason describing the runtime contract that must be completed first.
  Status:
  Notes:

### 6.7 Test routing and branching

- [ ] Confirm the normal route order.
  Instructions: Connect or configure the default path as Welcome, Service
  Choice, Email, Complete. Save the layout if `Save Layout` becomes enabled.
  Expected result: The canvas shows the intended route and diagnostics report
  no blocking route error.
  Status:
  Notes:

- [ ] Add a conditional branch.
  Instructions: Select the Contact Method node, expand `Branching`, create a
  rule that sends `Support` from Service Choice to the Complete step, and save
  it.
  Expected result: A branch route appears on the canvas and the branch count
  increases.
  Status:
  Notes:

- [ ] Add a second condition to the branch.
  Instructions: Reopen the branch line. Select `Add condition`, choose Contact
  Method, set it to equal `Phone`, then switch matching between `All
  conditions` and `Any condition`. Save with `Any condition` selected.
  Expected result: Both conditions remain visible, the route preview uses
  plain `or` language, and the canvas keeps the optional route name.
  Status:
  Notes:

- [ ] Confirm grouped conditions survive reload.
  Instructions: Refresh the canvas, select the same branch line, and review
  its Match section.
  Expected result: `Any condition`, both answers, comparisons, values, route
  destination, active state, and advanced priority are restored.
  Status:
  Notes:

- [ ] Confirm comparisons follow the answer type.
  Instructions: Add a temporary Number or Date answer before a later branch
  source. In that branch, select the typed answer and review Comparison and
  Value controls.
  Expected result: Number and date answers offer equal, not equal, greater
  than, less than, and empty checks. Text-only `Contains` is not offered, and
  the Value control uses the matching number or date input.
  Status:
  Notes:

- [ ] Edit the branch from the canvas.
  Instructions: Select the branch line, confirm its condition and destination,
  then close the dialog without changing it.
  Expected result: The branch is understandable and editable from the canvas.
  Status:
  Notes:

- [ ] Confirm unreachable-step warnings.
  Instructions: In the disposable flow, temporarily set a default route that
  skips an enabled middle step. Review `Flow checks`, then restore the intended
  route.
  Expected result: The skipped step is reported as an `Unreachable step`
  warning. It does not appear as a vague route error.
  Status:
  Notes:

- [ ] Confirm routing loops are blocked.
  Instructions: Temporarily connect two non-terminal steps back to each other,
  review `Flow checks`, and attempt to return to publishing. Remove the loop
  after recording the result.
  Expected result: A `Loop` error names the involved step numbers and the
  action cannot be published until the loop is removed.
  Status:
  Notes:

- [ ] Confirm every reachable path can finish.
  Instructions: Temporarily create a reachable path that has no terminal or
  natural review outcome, then review `Flow checks`. Restore a path to Submit,
  Request Intervention, Connect Flow, Confirmation, or a natural final review.
  Expected result: A `Finish path` error identifies the affected steps. After
  repair, the success message reads `Flow compiled. Every reachable path can
  finish.`
  Status:
  Notes:

### 6.8 Validate and publish

- [ ] Review diagnostics before publishing.
  Instructions: Return to the action detail page and review readiness warnings.
  Expected result: Missing configuration is described clearly. A valid flow is
  marked ready to publish.
  Status:
  Notes:

- [ ] Publish the UAT Flow Test action.
  Instructions: Select `Publish` only after diagnostics show no blockers.
  Expected result: Published Version changes from none to version 1 and the
  version appears in Version History.
  Status:
  Notes:

- [ ] Confirm the existing template was not changed.
  Instructions: Reopen `Book Spa Service` and check its version and nine steps.
  Expected result: The original Spa flow remains unchanged.
  Status:
  Notes:

Exit gate: the tester can create, visually edit, route, reload, and publish a
basic disposable flow without developer help or damage to an existing action.

## Phase 7 - Flow Runtime And Submissions

Goal: confirm flows run in project chat and save submissions.

Runtime boundary: project chat and widget use the same server-owned flow
engine. Browser clients display structured replies and submit user input; they
must not calculate routing or mutate submission fields directly. Both browser
surfaces render the server replies through the shared browser channel adapter.

- [ ] Set trigger phrase for an active action.
  Expected result: Trigger phrase is saved.
  Status:
  Notes:

- [ ] Open `/projects/chat`.
  Expected result: Chat loads selected project.
  Status:
  Notes:

- [ ] Type trigger phrase.
  Expected result: Action flow starts.
  Status:
  Notes:

- [ ] Enter valid answers.
  Expected result: Flow advances step by step.
  Status:
  Notes:

- [ ] Enter invalid email, phone, or date where applicable.
  Expected result: Validation message appears.
  Status:
  Notes:

- [ ] Test branch answer.
  Expected result: Runtime follows expected branch.
  Status:
  Notes:

- [ ] Refresh the browser during an in-progress flow and continue it.
  Expected result: The same saved flow resumes without losing collected fields
  or creating a second in-progress submission.
  Status:
  Notes:

- [ ] Duplicate the browser tab while a flow is waiting for an answer.
  Instructions: Submit the current answer in the first tab. In the duplicated
  tab, submit an answer to the older question.
  Expected result: The duplicated tab refreshes to the latest saved question,
  explains that the request changed in another tab, and does not save the stale
  answer.
  Status:
  Notes:

- [ ] Retry the same media upload after a temporary connection interruption.
  Expected result: The flow shows one uploaded file, records one media event,
  and advances only once. The project Media Library contains one new asset.
  Status:
  Notes:

- [ ] Rapidly click or submit the same flow control more than once.
  Expected result: One answer is collected and one route is followed. No
  duplicate submission, field event, or external operation is created.
  Status:
  Notes:

- [ ] At the review step, edit one collected answer.
  Expected result: The selected question is asked again and the review returns
  with the other answers preserved.
  Status:
  Notes:

- [ ] Confirm final submission.
  Expected result: Submission is saved once, using the edited values.
  Status:
  Notes:

- [ ] Open `/projects/submissions`.
  Expected result: Submission appears in list.
  Status:
  Notes:

- [ ] Open submission detail.
  Expected result: Fields, status, and events are visible.
  Status:
  Notes:

- [ ] Update submission status.
  Expected result: Status change is saved.
  Status:
  Notes:

Exit gate: project chat can complete an action flow and create a submission.

## Phase 8 - Website Widget

Goal: confirm embeddable widget setup and runtime.

- [ ] Open `/projects/widget`.
  Expected result: Widget settings page loads.
  Status:
  Notes:

- [ ] Generate or rotate token.
  Expected result: Token is created and active.
  Status:
  Notes:

- [ ] Add allowed domain.
  Expected result: Allowed domain saves correctly.
  Status:
  Notes:

- [ ] Open the widget from a domain that is not on the allowlist.
  Expected result: Widget runtime access is blocked without exposing project
  data.
  Status:
  Notes:

- [ ] Open the widget from the exact allowed domain and an allowed wildcard
  subdomain.
  Expected result: Both allowed origins can use the widget runtime.
  Status:
  Notes:

- [ ] Copy embed snippet.
  Expected result: Snippet contains UAT app URL and token.
  Status:
  Notes:

- [ ] Open widget embed page.
  Expected result: Widget UI loads.
  Status:
  Notes:

- [ ] Send normal chat message.
  Expected result: Widget receives a response.
  Status:
  Notes:

- [ ] Trigger active action flow.
  Expected result: Widget starts the same channel-independent flow.
  Status:
  Notes:

- [ ] Complete widget flow.
  Expected result: Submission is saved with widget source.
  Status:
  Notes:

- [ ] Disable token.
  Expected result: Widget access is blocked.
  Status:
  Notes:

- [ ] Re-enable token.
  Expected result: Widget access works again.
  Status:
  Notes:

Exit gate: widget works as a customer-facing channel for the selected project.

## Phase 9 - Media And Product Catalog

Goal: confirm reusable media and catalog blocks are ready for flows.

- [ ] Open `/projects/media`.
  Expected result: Media library loads.
  Status:
  Notes:

- [ ] Upload small image/PDF.
  Expected result: Media asset is saved under selected project.
  Status:
  Notes:

- [ ] Archive media asset.
  Expected result: Asset is no longer active.
  Status:
  Notes:

- [ ] Open `/projects/catalog`.
  Expected result: Catalog page loads.
  Status:
  Notes:

- [ ] Create a catalog.
  Expected result: Catalog appears in list.
  Status:
  Notes:

- [ ] Add a product.
  Expected result: Product appears with name, price, and optional URL/image.
  Status:
  Notes:

- [ ] Configure WhatsApp catalog IDs if available.
  Expected result: WhatsApp metadata saves.
  Status:
  Notes:

- [ ] Use media/product step in action.
  Expected result: Flow can reference selected media/product.
  Status:
  Notes:

- [ ] Run flow in chat/widget.
  Expected result: Media/product content renders with fallback where needed.
  Status:
  Notes:

Exit gate: project-scoped media and catalog data can be used in flows.

## Phase 10 - Operations And Handoff

Goal: confirm integrations and manual review workflows.

- [ ] Open `/projects/operations`.
  Expected result: Provider, operation, and Execution Health sections load.
  Status:
  Notes:

- [ ] Review Execution Health before creating test work.
  Expected result: Queued, Processing, Failed, and Completed totals are shown;
  recent items never expose payloads, destinations, or credentials.
  Status:
  Notes:

- [ ] Create manual review provider.
  Expected result: Provider is saved.
  Status:
  Notes:

- [ ] Create webhook or n8n provider if test URL is available.
  Expected result: Provider is saved without exposing secrets in the provider
  list or page source.
  Status:
  Notes:

- [ ] Create an operation.
  Expected result: Operation is saved and can be enabled/disabled.
  Status:
  Notes:

- [ ] Add operation step to flow.
  Expected result: Step references selected operation.
  Status:
  Notes:

- [ ] Run flow with operation.
  Expected result: Attempt is logged and durable work becomes completed,
  queued for retry, or failed after its bounded attempts.
  Status:
  Notes:

- [ ] Expand Trace details on one durable item and one operation attempt.
  Expected result: Both show a trace id that can be used to follow the request;
  no provider secret is visible.
  Status:
  Notes:

- [ ] Call the durable worker without authorization.
  Instructions: Send `POST /api/durable/process-next` without a bearer token.
  Expected result: The endpoint returns HTTP 401.
  Status:
  Notes:

- [ ] Call the durable worker with `DURABLE_QUEUE_SECRET` or `CRON_SECRET`.
  Expected result: The endpoint returns queue results scoped by project and
  safely reports idle when no work is due.
  Status:
  Notes:

- [ ] Add a Wait step before a normal message or input step.
  Instructions: Set the wait to one minute, save the flow, confirm the graph
  has a terminal path, and publish a new version.
  Expected result: Wait is available as an enabled universal action and the
  published flow passes validation.
  Status:
  Notes:

- [ ] Start the published flow in project chat and reach the Wait step.
  Expected result: The wait message appears once, the submission remains in
  progress, and Execution Health shows one queued `flow_resume` job with no
  payload or destination exposed.
  Status:
  Notes:

- [ ] Process the durable worker after the wait is due.
  Instructions: Call `POST /api/durable/process-next` with the configured
  worker bearer token.
  Expected result: The conversation continues from the step after Wait, the
  job becomes completed, and the submission has `flow.paused` and
  `flow.resumed` trace events.
  Status:
  Notes:

- [ ] Call the durable worker again for the completed wait.
  Expected result: No duplicate reply or side effect is created and the worker
  safely reports no due resume work.
  Status:
  Notes:

- [ ] Start another wait and reply `Cancel` before it is due.
  Expected result: The submission and queued resume job become cancelled, and
  processing the worker later does not resume the flow.
  Status:
  Notes:

- [ ] Replay or retry attempt.
  Expected result: New attempt is logged.
  Status:
  Notes:

- [ ] Add handoff step.
  Expected result: Submission moves to Under Review.
  Status:
  Notes:

- [ ] Open `/projects/handoffs`.
  Expected result: Handoff queue lists unassigned items.
  Status:
  Notes:

- [ ] Claim and release handoff.
  Expected result: Assignment state updates correctly.
  Status:
  Notes:

Exit gate: operations and handoff queues are usable for internal follow-up.

## Phase 11 - WhatsApp Channel Readiness

Goal: confirm WhatsApp setup screens and shared-flow readiness. Skip live sends
if Meta test credentials are not available.

- [ ] Open `/projects/channels/whatsapp`.
  Expected result: WhatsApp channel page loads.
  Status:
  Notes:

- [ ] Save test channel settings.
  Expected result: Settings save for the selected project and credential
  fields remain masked. Leaving them blank on the next save retains them.
  Status:
  Notes:

- [ ] Verify webhook token flow if configured.
  Expected result: Webhook verification succeeds.
  Status:
  Notes:

- [ ] Send test message if credentials are available.
  Expected result: Test message sends or shows a clear provider error. Flow
  replies create outbound delivery health records with trace details.
  Status:
  Notes:

- [ ] Use approved template settings in a flow.
  Expected result: Template block saves and validates variables.
  Status:
  Notes:

- [ ] Compare the same published flow in project chat and the website widget.
  Instructions: Run the same trigger phrase and select the same answers in both
  channels.
  Expected result: Text, choices, media, products, validation, and routing are
  consistent between both browser channels.
  Status:
  Notes:

- [ ] Test WhatsApp button and list limits.
  Instructions: Test a choice with up to three button options and another with
  four. If available, also test a list with up to ten options and another with
  eleven.
  Expected result: Supported sizes use native WhatsApp interactive messages;
  larger choices remain usable as numbered text fallback.
  Status:
  Notes:

- [ ] Test an approved template outside the customer-service window if Meta
  test credentials are available.
  Expected result: The approved template can be sent. A regular flow reply is
  blocked until the customer-service window is open.
  Status:
  Notes:

- [ ] Test media/product fallback behavior.
  Instructions: Test once with complete public media or Meta catalog metadata,
  then remove one native-provider requirement in a disposable draft.
  Expected result: Complete metadata uses native delivery where supported;
  incomplete metadata produces a readable text fallback and a builder warning.
  Status:
  Notes:

Exit gate: one flow remains usable across project chat, widget, and WhatsApp,
with native delivery or an explicit readable fallback as appropriate.

## Phase 12 - Analytics, Audit, And Tenant Safety

Goal: confirm admin visibility and tenant boundaries.

- [ ] Open `/projects/analytics`.
  Expected result: Chat/widget metrics are visible.
  Status:
  Notes:

- [ ] Confirm recent chat/widget activity.
  Expected result: Counts and route rows update after tests.
  Status:
  Notes:

- [ ] Open `/projects/audit`.
  Expected result: Recent company-scoped events are visible.
  Status:
  Notes:

- [ ] Confirm project/document/widget/action events.
  Expected result: Sensitive actions appear in audit log.
  Status:
  Notes:

- [ ] Create second user/company.
  Expected result: Separate company/project is created.
  Status:
  Notes:

- [ ] Try opening first tenant project from second tenant.
  Expected result: Access is blocked.
  Status:
  Notes:

- [ ] Try widget token from disabled tenant.
  Expected result: Widget access is blocked.
  Status:
  Notes:

Suggested technical checks:

```bash
npm run test:tenant-isolation
npm run test:e2e
```

Exit gate: testers cannot see or mutate another tenant's data.

## Phase 13 - Final Regression And Sign-Off

Goal: confirm the UAT build is acceptable for the next release decision.

- [ ] Run smoke test across phases 1-8.
  Expected result: No critical workflow is blocked.
  Status:
  Notes:

- [ ] Review open UAT bugs.
  Expected result: Critical and high bugs are resolved or accepted.
  Status:
  Notes:

- [ ] Review audit warnings.
  Expected result: Known npm audit residuals are understood.
  Status:
  Notes:

- [ ] Confirm no test data contains real customer information.
  Expected result: UAT data is safe.
  Status:
  Notes:

- [ ] Confirm backups/restore plan for UAT database.
  Expected result: Recovery path is known.
  Status:
  Notes:

- [ ] Confirm deferred items.
  Expected result: Billing, custom domains, RLS, and object storage remain documented deferrals.
  Status:
  Notes:

Suggested final commands:

```bash
npm run certify:release:fast
npm run certify:release
```

The fast command runs deterministic checks without starting the application or
using the database. The full command also builds the application, runs the
complete database-backed browser suite, and checks tenant isolation. A passing
command does not replace the live channel checks below.

## Phase 14 - Cross-Channel Certification

Goal: confirm one published flow behaves safely across project chat, widget,
WhatsApp, and the documented future-channel adapter contract.

- [ ] Run `npm run certify:release:fast`.
  Expected result: Lint, TypeScript, tenant scope, cron configuration, and all
  channel contract tests pass.
  Status:
  Notes:

- [ ] Run `npm run certify:release` from a machine that can reach the UAT
  database and the internet.
  Expected result: The production build, complete E2E suite, and database
  tenant-isolation checks pass in addition to the fast gates.
  Status:
  Notes:

- [ ] Publish a test flow containing a text message, choice, input,
  confirmation, and submit step.
  Expected result: Publishing succeeds and creates a new immutable version.
  Status:
  Notes:

- [ ] Complete the published flow in Project Chat.
  Expected result: Prompts, choices, validation, confirmation, and submission
  render correctly with no duplicated replies.
  Status:
  Notes:

- [ ] Complete the same published flow in the website widget.
  Expected result: The widget follows the same step order and produces the
  same submission fields as Project Chat.
  Status:
  Notes:

- [ ] Embed the widget on an allowed UAT origin and reload the host page.
  Expected result: The widget loads once, resumes its conversation, and the
  browser console has no origin, token, or frame-policy error.
  Status:
  Notes:

- [ ] Start a flow, publish a changed version while the first run is active,
  and finish the active run.
  Expected result: The active run finishes on its original published version;
  a new run uses the new version.
  Status:
  Notes:

- [ ] Run a flow with a short Wait step in Project Chat or the widget.
  Expected result: The flow pauses once, resumes after the configured delay,
  and does not duplicate the submission or outbound reply.
  Status:
  Notes:

- [ ] Connect a UAT WhatsApp Business number with valid Meta credentials.
  Expected result: Verification succeeds, the number is active, and an inbound
  test message creates or resumes the correct project conversation.
  Status:
  Notes:

- [ ] Send text, three reply buttons, and a list of ten rows inside the
  WhatsApp customer-service window.
  Expected result: Each message uses its native WhatsApp presentation.
  Status:
  Notes:

- [ ] Test four reply buttons and a list of eleven rows in WhatsApp.
  Expected result: Each safely becomes readable numbered text; the flow
  remains usable and no reply is silently dropped.
  Status:
  Notes:

- [ ] Send a public media asset and configured catalog products in WhatsApp.
  Expected result: Valid provider resources render natively; incomplete
  provider metadata produces a readable text fallback.
  Status:
  Notes:

- [ ] Send an approved WhatsApp template outside the customer-service window.
  Expected result: The approved template is delivered. A draft or rejected
  template and ordinary text are blocked outside the window.
  Status:
  Notes:

- [ ] Run a WhatsApp flow containing a short Wait step.
  Expected result: The resumed reply is queued through the outbox and delivered
  once to the same contact and conversation.
  Status:
  Notes:

- [ ] Review the automated reference-future adapter result in the fast command.
  Expected result: All enabled step types have a declared certification family,
  all nine reply capabilities preserve their neutral versioned envelope, and
  no database channel or production UI was created for the reference adapter.
  Status:
  Notes:

- [ ] Record the production channel decision.
  Expected result: Project Chat, widget, and WhatsApp each have an explicit
  Pass, Pass with accepted limitations, or Fail result in the notes.
  Status:
  Notes:

Exit gate: automated certification passes, each live production channel has a
recorded result, and no critical or high cross-channel defect remains open.

## Issue Log

Use this format for each issue:

```text
ID:
Phase:
Severity: Critical / High / Medium / Low
Summary:
Owner:
Status:
Notes:
```

Severity guide:

- Critical: blocks sign-in, tenant isolation, deployment, or data integrity.
- High: blocks a core workflow such as project creation, chat, flow runtime, or widget.
- Medium: workaround exists but the workflow is confusing or unreliable.
- Low: cosmetic issue or minor copy/UI polish.

## Sign-Off

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
