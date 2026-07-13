# Lia AI UAT Test Plan

Use this checklist to test Lia AI in phases instead of trying to validate the
whole application in one sitting.

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

- [ ] Add a terminal step.
  Instructions: Select `Message` from the Blocks panel. Set the label to
  `Complete` and the message to `Thank you. Your request is complete.` Create
  the step and configure it as the final step if the dialog presents terminal
  routing controls.
  Expected result: A Complete node appears and the flow has a final path.
  Status:
  Notes:

### 6.4 Test canvas content editing

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
  Expected result: The saved steps, content, order, and canvas positions remain
  unchanged.
  Status:
  Notes:

### 6.5 Test compact and advanced editing

- [ ] Open the compact Edit Step dialog.
  Instructions: Select the Email node itself, outside its inline controls.
  Change its prompt to `Where can we contact you?` and save the common
  settings.
  Expected result: A focused Edit Step dialog opens and the updated prompt is
  visible on the node.
  Status:
  Notes:

- [ ] Test advanced validation.
  Instructions: Select the Email node again, expand `Advanced settings`, set an
  invalid-value message to `Enter a valid email address.`, and save.
  Expected result: Advanced settings remain hidden until expanded and the
  validation message persists after reopening the node.
  Status:
  Notes:

### 6.6 Test routing and branching

- [ ] Confirm the normal route order.
  Instructions: Connect or configure the default path as Welcome, Service
  Choice, Email, Complete. Save the layout if `Save Layout` becomes enabled.
  Expected result: The canvas shows the intended route and diagnostics report
  no blocking route error.
  Status:
  Notes:

- [ ] Add a conditional branch.
  Instructions: Select the Service Choice node, expand `Branching`, create a
  rule that sends `Support` to the Complete step, and save it.
  Expected result: A branch route appears on the canvas and the branch count
  increases.
  Status:
  Notes:

- [ ] Edit the branch from the canvas.
  Instructions: Select the branch line, confirm its condition and destination,
  then close the dialog without changing it.
  Expected result: The branch is understandable and editable from the canvas.
  Status:
  Notes:

### 6.7 Validate and publish

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

- [ ] Confirm final submission.
  Expected result: Submission is saved.
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
  Expected result: Provider and operation pages load.
  Status:
  Notes:

- [ ] Create manual review provider.
  Expected result: Provider is saved.
  Status:
  Notes:

- [ ] Create webhook or n8n provider if test URL is available.
  Expected result: Provider is saved without exposing secrets.
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
  Expected result: Attempt is logged as success/failure.
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
  Expected result: Settings save for selected project.
  Status:
  Notes:

- [ ] Verify webhook token flow if configured.
  Expected result: Webhook verification succeeds.
  Status:
  Notes:

- [ ] Send test message if credentials are available.
  Expected result: Test message sends or shows clear provider error.
  Status:
  Notes:

- [ ] Use approved template settings in a flow.
  Expected result: Template block saves and validates variables.
  Status:
  Notes:

- [ ] Test media/product fallback behavior.
  Expected result: Flow still works without native WhatsApp send.
  Status:
  Notes:

Exit gate: WhatsApp can be configured later without changing the flow builder model.

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
npm run lint
npm run build
npm run check:tenant-scope
npm run check:cron-config
npm run test:tenant-isolation
npm run test:e2e
```

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
