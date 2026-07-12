# Lia AI UAT Test Plan

Use this checklist to test Lia AI in phases instead of trying to validate the
whole application in one sitting.

Record the UAT environment details before starting.

| Item | Value |
| --- | --- |
| UAT URL |  |
| Vercel deployment commit |  |
| Database/environment |  |
| Tester name |  |
| Test date |  |

## UAT Rules

- Test one phase at a time.
- Do not move to the next phase if a critical issue blocks the current phase.
- Capture screenshots for failures.
- Record the exact user, project, action, or submission involved in a failure.
- Use fresh test users where possible.
- Do not use real customer data during UAT.

## Phase 0 - Environment Readiness

Goal: confirm the UAT environment is safe to test.

| Check | Expected Result | Status | Notes |
| --- | --- | --- | --- |
| Open the UAT URL | Landing page loads with one top navbar only |  |  |
| Confirm latest commit | Deployment uses the intended GitHub commit |  |  |
| Confirm env variables | App has database, auth, OpenAI, app URL, and admin email configured |  |  |
| Confirm database schema | Latest migrations are applied |  |  |
| Confirm platform admin email | `support@leigia.com` is included in platform admin emails |  |  |
| Confirm cron setup | Upload queue cron is configured for daily processing |  |  |

Suggested technical checks:

```bash
npm run check:local-env
npm run check:cron-config
npm run check:tenant-scope
```

Exit gate: UAT URL loads, sign-in/sign-up pages load, and no deployment error is visible.

## Phase 1 - Public Site And Authentication

Goal: confirm public access, signup, signin, and signout work.

| Step | Expected Result | Status | Notes |
| --- | --- | --- | --- |
| Open `/` while signed out | Landing page displays Lia AI and auth actions |  |  |
| Click `Sign Up` | Signup page opens |  |  |
| Create a new test account | Account is created and user is redirected into the app |  |  |
| Sign out | User returns to signed-out state |  |  |
| Sign in with the same account | User can access the project area again |  |  |
| Try wrong password | Login fails with a clear error |  |  |
| Use profile menu signout | User is signed out successfully |  |  |

Test data:

```text
Email: uat.owner+<date>@leigia.com
Password: Use a temporary UAT password only
```

Exit gate: a normal user can sign up, sign in, and sign out.

## Phase 2 - Platform Admin And Tenant Management

Goal: confirm SaaS admin basics work before inviting real testers.

| Step | Expected Result | Status | Notes |
| --- | --- | --- | --- |
| Sign in as `support@leigia.com` | User lands on or can open `/platform` |  |  |
| Open `/platform` | Tenant/company list is visible |  |  |
| Open a tenant detail page | Members, projects, and invitations are visible |  |  |
| Create a tenant invitation | Invitation is created and listed |  |  |
| Cancel a pending invitation | Invitation is cancelled or removed from active list |  |  |
| Disable a tenant | Tenant owner cannot use the app normally |  |  |
| Re-enable the tenant | Tenant owner can use the app again |  |  |
| Sign in as non-admin and open `/platform` | Access is denied or redirected |  |  |

Exit gate: platform admin can manage tenants without exposing admin pages to normal users.

## Phase 3 - User Profile, Team, And Projects

Goal: confirm account setup and project management.

| Step | Expected Result | Status | Notes |
| --- | --- | --- | --- |
| Open `/profile` | User details, account details, and access state display correctly |  |  |
| Update display name | Header/profile show the updated user name |  |  |
| Open `/team` | Member list is visible |  |  |
| Invite a teammate | Pending invite is created |  |  |
| Accept teammate invite | Teammate can join the same company/account |  |  |
| Disable teammate | Disabled teammate cannot access active tenant resources |  |  |
| Create a new project | Project appears in project list and selector |  |  |
| Rename project | New project name displays in list/header |  |  |
| Archive project | Project becomes archived and widget access is disabled |  |  |
| Unarchive project | Project becomes available again |  |  |

Exit gate: one company account can manage users and multiple projects.

## Phase 4 - Documents And Project Chat

Goal: confirm knowledge-base upload, indexing, and RAG chat.

| Step | Expected Result | Status | Notes |
| --- | --- | --- | --- |
| Open `/projects/documents` | Document page loads for selected project |  |  |
| Upload a small `.txt` or `.md` file | Source document is created |  |  |
| Process queued document | Chunks are created and status updates |  |  |
| Open `/projects/chat` | Chat page loads |  |  |
| Ask a question answered by the uploaded file | Assistant answers from project documents |  |  |
| Ask unrelated question | Assistant handles missing context safely |  |  |
| Delete document | Document and related knowledge are removed from UI |  |  |

Suggested test document:

```text
Lia UAT Salon offers a Gold Facial package for 2500 INR. The appointment takes 60 minutes.
```

Suggested question:

```text
What is the price of the Gold Facial package?
```

Exit gate: selected project can upload knowledge and chat can retrieve it.

## Phase 5 - Flow Builder Basics

Goal: confirm actions and visual flow setup are usable.

| Step | Expected Result | Status | Notes |
| --- | --- | --- | --- |
| Open `/projects/actions` | Actions list loads |  |  |
| Apply a bundled template | Template creates an action with steps |  |  |
| Create a custom action | Action is saved as draft |  |  |
| Open action detail | Step list and settings are visible |  |  |
| Open visual canvas | Canvas displays the action steps and routes |  |  |
| Add a message step | Step is saved and appears in the flow |  |  |
| Add a collect input step | Field key and validation settings save correctly |  |  |
| Add a choice step | Options save correctly |  |  |
| Add a branch rule | Rule appears in diagnostics/canvas |  |  |
| Publish or activate action | Missing setup warnings are clear; valid flow can become active |  |  |

Exit gate: tester can create or modify a basic flow without developer help.

## Phase 6 - Flow Runtime And Submissions

Goal: confirm flows run in project chat and save submissions.

| Step | Expected Result | Status | Notes |
| --- | --- | --- | --- |
| Set trigger phrase for an active action | Trigger phrase is saved |  |  |
| Open `/projects/chat` | Chat loads selected project |  |  |
| Type trigger phrase | Action flow starts |  |  |
| Enter valid answers | Flow advances step by step |  |  |
| Enter invalid email/phone/date where applicable | Validation message appears |  |  |
| Test branch answer | Runtime follows expected branch |  |  |
| Confirm final submission | Submission is saved |  |  |
| Open `/projects/submissions` | Submission appears in list |  |  |
| Open submission detail | Fields, status, and events are visible |  |  |
| Update submission status | Status change is saved |  |  |

Exit gate: project chat can complete an action flow and create a submission.

## Phase 7 - Website Widget

Goal: confirm embeddable widget setup and runtime.

| Step | Expected Result | Status | Notes |
| --- | --- | --- | --- |
| Open `/projects/widget` | Widget settings page loads |  |  |
| Generate or rotate token | Token is created and active |  |  |
| Add allowed domain | Allowed domain saves correctly |  |  |
| Copy embed snippet | Snippet contains UAT app URL and token |  |  |
| Open widget embed page | Widget UI loads |  |  |
| Send normal chat message | Widget receives a response |  |  |
| Trigger active action flow | Widget starts the same channel-independent flow |  |  |
| Complete widget flow | Submission is saved with widget source |  |  |
| Disable token | Widget access is blocked |  |  |
| Re-enable token | Widget access works again |  |  |

Exit gate: widget works as a customer-facing channel for the selected project.

## Phase 8 - Media And Product Catalog

Goal: confirm reusable media and catalog blocks are ready for flows.

| Step | Expected Result | Status | Notes |
| --- | --- | --- | --- |
| Open `/projects/media` | Media library loads |  |  |
| Upload small image/PDF | Media asset is saved under selected project |  |  |
| Archive media asset | Asset is no longer active |  |  |
| Open `/projects/catalog` | Catalog page loads |  |  |
| Create a catalog | Catalog appears in list |  |  |
| Add a product | Product appears with name, price, and optional URL/image |  |  |
| Configure WhatsApp catalog IDs if available | WhatsApp metadata saves |  |  |
| Use media/product step in action | Flow can reference selected media/product |  |  |
| Run flow in chat/widget | Media/product content renders with fallback where needed |  |  |

Exit gate: project-scoped media and catalog data can be used in flows.

## Phase 9 - Operations And Handoff

Goal: confirm integrations and manual review workflows.

| Step | Expected Result | Status | Notes |
| --- | --- | --- | --- |
| Open `/projects/operations` | Provider and operation pages load |  |  |
| Create manual review provider | Provider is saved |  |  |
| Create webhook or n8n provider if test URL is available | Provider is saved without exposing secrets |  |  |
| Create an operation | Operation is saved and can be enabled/disabled |  |  |
| Add operation step to flow | Step references selected operation |  |  |
| Run flow with operation | Attempt is logged as success/failure |  |  |
| Replay or retry attempt | New attempt is logged |  |  |
| Add handoff step | Submission moves to Under Review |  |  |
| Open `/projects/handoffs` | Handoff queue lists unassigned items |  |  |
| Claim and release handoff | Assignment state updates correctly |  |  |

Exit gate: operations and handoff queues are usable for internal follow-up.

## Phase 10 - WhatsApp Channel Readiness

Goal: confirm WhatsApp setup screens and shared-flow readiness. Skip live sends
if Meta test credentials are not available.

| Step | Expected Result | Status | Notes |
| --- | --- | --- | --- |
| Open `/projects/channels/whatsapp` | WhatsApp channel page loads |  |  |
| Save test channel settings | Settings save for selected project |  |  |
| Verify webhook token flow if configured | Webhook verification succeeds |  |  |
| Send test message if credentials are available | Test message sends or shows clear provider error |  |  |
| Use approved template settings in a flow | Template block saves and validates variables |  |  |
| Test media/product fallback behavior | Flow still works without native WhatsApp send |  |  |

Exit gate: WhatsApp can be configured later without changing the flow builder model.

## Phase 11 - Analytics, Audit, And Tenant Safety

Goal: confirm admin visibility and tenant boundaries.

| Step | Expected Result | Status | Notes |
| --- | --- | --- | --- |
| Open `/projects/analytics` | Chat/widget metrics are visible |  |  |
| Confirm recent chat/widget activity | Counts and route rows update after tests |  |  |
| Open `/projects/audit` | Recent company-scoped events are visible |  |  |
| Confirm project/document/widget/action events | Sensitive actions appear in audit log |  |  |
| Create second user/company | Separate company/project is created |  |  |
| Try opening first tenant project from second tenant | Access is blocked |  |  |
| Try widget token from disabled tenant | Widget access is blocked |  |  |

Suggested technical checks:

```bash
npm run test:tenant-isolation
npm run test:e2e
```

Exit gate: testers cannot see or mutate another tenant's data.

## Phase 12 - Final Regression And Sign-Off

Goal: confirm the UAT build is acceptable for the next release decision.

| Check | Expected Result | Status | Notes |
| --- | --- | --- | --- |
| Run smoke test across phases 1-7 | No critical workflow is blocked |  |  |
| Review open UAT bugs | Critical and high bugs are resolved or accepted |  |  |
| Review audit warnings | Known npm audit residuals are understood |  |  |
| Confirm no test data contains real customer information | UAT data is safe |  |  |
| Confirm backups/restore plan for UAT database | Recovery path is known |  |  |
| Confirm deferred items | Billing, custom domains, RLS, object storage remain documented deferrals |  |  |

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

| ID | Phase | Severity | Summary | Owner | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| UAT-001 |  |  |  |  |  |  |

Severity guide:

- Critical: blocks sign-in, tenant isolation, deployment, or data integrity.
- High: blocks a core workflow such as project creation, chat, flow runtime, or widget.
- Medium: workaround exists but the workflow is confusing or unreliable.
- Low: cosmetic issue or minor copy/UI polish.

## Sign-Off

| Role | Name | Date | Approved? | Notes |
| --- | --- | --- | --- | --- |
| Product owner |  |  |  |  |
| Technical owner |  |  |  |  |
| UAT tester |  |  |  |  |

