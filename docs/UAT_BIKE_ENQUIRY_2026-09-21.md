# Bike enquiry UAT and shared clarification fix — 21 September 2026

## Scope

Staging project 95, **Bike Service Entity UAT 2026-09-21** uses task 23 v2
(version ID 25), action 61 v1 (version ID 38), and internal Manual Review
operation 92. Required fields are Customer Name, Contact Number, Bike Model,
and Service Reason. All test identities are fictional. This fixture does not
book appointments or contact customers. Appointment project 94 was not changed.

## Observed failure

The original live browser run passed three cases: complete opening details,
missing reason, and an out-of-order bike model. The fourth case correctly
clarified an uncertain reason but discarded the opening message's clear name,
phone, and bike model. After clarification it asked for Customer Name again.

Both runtime paths discarded every candidate whenever the model indicated
ambiguity. The earlier model-only tests did not detect this persistence failure.

## Shared fix

- The structured model contract identifies which configured fields are uncertain.
- Shared filtering retains unrelated, sufficiently confident, uniquely mapped
  visitor candidates. Normal field validation still applies. Unscoped ambiguity,
  unknown fields, uncertain fields, duplicate candidates and low-confidence
  candidates are not accepted by this path.
- Business tasks persist the clear fields and record the clarification's target
  before returning. No lookup, confirmation, operation or routing occurs on
  that clarification turn.
- Ordinary flows retain clear values provisionally, scoped to the published
  action/version. They keep their current step until clarification is answered;
  normal validation and branch traversal then consume the saved values.
- Short clarification answers target the uncertain field. An intervening
  correction to another ordinary-flow field does not erase that target.

This uses existing configured fields and shared runtimes, without bike-specific
extraction. It does not promise that arbitrary language or every possible flow
has been certified.

## Verification

- 339 offline contract tests passed, including scoped ambiguity filtering.
- Four real-model bike enquiry extraction tests passed.
- All 14 ordinary-flow database tests passed. The strengthened clarification
  regression also passed after adding an intervening quantity correction and
  a bare `blue` clarification; no second model call was needed.
- The broader operation run passed its first 17 tests, including confirmation,
  idempotency, operation recovery, calendar selection and detailed opening
  statements. It was stopped to run the directly relevant task-context case.
- Type-check and production build passed. A missing null guard in the existing
  calendar test fixture was added to unblock type-checking.
- The strengthened persisted task regression passed: clear contact values were
  saved, the uncertain reason stayed missing, no confirmation or calendar lookup
  occurred, and a short reason clarification used the real deterministic engine
  before continuing the appointment-selection and time-context checks.
- Post-deployment staging UI verification is pending refreshed authentication.

## Reproduce

```powershell
npx.cmd playwright test --config=playwright.contract.config.ts --grep-invert @live-openai --output=test-results/clarification-contracts
npx.cmd playwright test --config=playwright.runtime.config.ts channel-flow-entry-runtime-db --output=test-results/clarification-flow
npx.cmd playwright test --config=playwright.runtime.config.ts conversational-task-operation-runtime-db --grep 'Early time preference' --output=test-results/clarification-task-scoped
$env:LIA_LIVE_STATEMENT_UAT = '1'
npx.cmd playwright test --config=playwright.contract.config.ts statement-extraction --grep 'live-openai.*bike enquiry' --output=test-results/clarification-model
npx.cmd playwright test --config=playwright.staging.config.ts
```

The staging suite uses `.playwright-auth/staging.json`, saved after manual login
and selection of project 95. This directory is ignored by Git and separate from
Playwright output cleanup. Never commit or share authentication files. The old
login and initial screenshots were accidentally cleared by a default-output
local test run; browser authentication must be refreshed before the final live
retest. The staging suite still asserts the isolated project and action and
never imports local database fixtures.
