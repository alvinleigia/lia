# Lia AI UAT Test Plan

## Current Test

Phase: 4 of 18

Test: Deterministic Validation And Business Tools

Progress: Not tested - 0 of 8 steps passed

Project: `Ewissen Infra (#194)`

Task: `Book a Spa Service`

URL: `http://localhost:3000`

No database migration is required for this phase.

## What You Are Testing

This phase checks that Lia converts visitor answers into safe, consistent
values and gets current business facts only from approved project tools.

The model must not invent a product, price, duration, or availability result.
A lookup may show `No result` when that fact is not configured. That is a valid
and safer result than a guessed answer.

## Step 1 of 8 - Allow the Business Lookups

**Do this**

1. Select `Ewissen Infra (#194)` in the header.
2. Open `Automation`.
3. Open `Tasks`.
4. Open `Book a Spa Service`.
5. Select `Configure Conversation`.
6. Select `Tools`.
7. If `Manual Review` says `Read data / lookup / v1`, select its trash icon.
8. In `Allow a Tool`, choose `Manual Review`.
9. Under `Allowed Stages`, check only `operation`.
10. Select `Allow Tool`.
11. In `Allow a Tool`, choose `Service Details`.
12. Under `Allowed Stages`, check only `lookup`.
13. Select `Allow Tool`.
14. Repeat steps 11-13 for:

```text
Service Price
Service Duration
Service Availability
```

**Pass when**

1. All four tools appear in the allowed-tools list.
2. Each tool says `Read data / lookup / v1`.
3. `Manual Review` says `Take action / operation / v1`.
4. No error is shown.

Status: Not tested

## Step 2 of 8 - Publish the Tool Contract

**Do this**

1. Select `Review`.
2. Read the publish checks.
3. Select `Publish`.
4. Open `Runtime Test`.

**Pass when**

1. Review shows no tool-contract blocker.
2. Publishing creates a new immutable version.
3. Runtime Test shows that new version under `Pinned Version`.
4. A `Business Lookup Test` section is visible.

Status: Not tested

## Step 3 of 8 - Start a Clean Test Run

**Do this**

1. On Runtime Test, select `Reset Test Data`.
2. Start a new test run if the page asks you to do so.
3. Confirm that `Run Status` is `Active`.

**Pass when**

1. The active task is `Book a Spa Service`.
2. The run is pinned to the version published in Step 2.
3. All task fields start as `Not collected`.
4. No previous lookup result remains.

Status: Not tested

## Step 4 of 8 - Test Canonical Field Values

Use `Save or Correct a Value` to save these values one at a time.

**Copy and paste**

For `Service Category`:

```text
Facial
```

For `Service`:

```text
Classic Facial
```

For `Preferred Date`:

```text
15/08/2026
```

For `Preferred Time`:

```text
3:30 PM
```

For `Guest Name`:

```text
  UAT Guest
```

For `Guest Email`:

```text
  UAT.Guest@Example.COM
```

For `Guest Phone`:

```text
0091 98765-43210
```

**Pass when**

1. `Service Category` and `Service` are accepted as project resources.
2. The date becomes `2026-08-15`.
3. The time becomes `15:30`.
4. The name becomes `UAT Guest`.
5. The email becomes `uat.guest@example.com`.
6. The phone becomes `+919876543210`.
7. Required fields show `Valid`, not merely `Candidate`.

Status: Not tested

## Step 5 of 8 - Run the Service Details Lookup

**Do this**

1. Find `Business Lookup Test`.
2. Choose `Service Details`.
3. Select `Run Lookup`.

**Pass when**

1. The lookup status becomes `success`.
2. The result belongs to `Classic Facial`.
3. Only approved result fields are displayed.
4. No secret, credential, provider payload, or unrelated project data appears.

Status: Not tested

## Step 6 of 8 - Run Price and Duration Lookups

**Do this**

1. Choose `Service Price`, then select `Run Lookup`.
2. Choose `Service Duration`, then select `Run Lookup`.

**Pass when**

1. Each lookup ends as `success` or `no result`.
2. A successful price result shows only the configured amount and currency.
3. A successful duration result shows only the configured duration.
4. A `no result` response is plain and does not invent a value.
5. Both attempts appear in the lookup history.

Status: Not tested

## Step 7 of 8 - Run the Availability Lookup

**Do this**

1. Choose `Service Availability`.
2. Select `Run Lookup`.

**Pass when**

1. The result is `success` or `no result`.
2. A successful result uses the selected `Classic Facial` service.
3. The result does not claim live availability unless the project has an
   approved availability value.
4. The result does not expose internal provider data.

Status: Not tested

## Step 8 of 8 - Test Missing-Input Protection

**Do this**

1. In `Field Lifecycle`, clear the `Service` field.
2. In `Business Lookup Test`, choose `Service Price`.
3. Select `Run Lookup`.

**Pass when**

1. The lookup does not run.
2. The error appears inside the lookup form.
3. The message asks you to collect the required task fields.
4. Existing values for the other fields remain unchanged.
5. No failed lookup exposes a provider message, secret, or raw payload.

After this check, save `Classic Facial` as the `Service` again.

Status: Not tested

## If a Step Fails

Send:

```text
Phase 4
Step number:
What I clicked:
What I entered:
What happened:
Screenshot:
```

Stop at the failed step. Do not continue to Phase 5.

## Phase 4 Sign-Off

Phase 4 passes when all eight steps pass and no Critical or High issue remains.

Approved: No

Approved by:

Date:

Notes:
