# UAT Test Plan

Phase: 8 of 18

Checkpoint: 1 of 6

Test: Relative Dates And Channel-Adaptive Inputs

Progress: Implementation complete; focused manual UAT pending

Project: `Ewissen Infra (#194)`

URL: `http://localhost:3000`

Database migration: Not required for this checkpoint

This verifies only the first Phase 8 checkpoint. It does not sign off the
complete booking journey or Phase 8.

## Step 1 of 6 - Start A Fresh Project Chat

1. Open `http://localhost:3000/projects/chat`.
2. Confirm the selected project is `Ewissen Infra (#194)`.
3. Open the browser developer console.
4. Paste this command and press Enter:

```js
sessionStorage.removeItem("lia:project-chat:194");
location.reload();
```

Expected result:

- The chat reloads with a fresh conversation.
- No database data, task definition, or published version is deleted.

## Step 2 of 6 - Enter The Booking Task

Send:

```text
I want to book a spa service.
```

When asked, enter:

```text
Facial
```

Then enter:

```text
Classic Facial
```

Expected result:

- Lia enters `Book a Spa Service`.
- Lia asks only for the next missing field.
- The existing task contract remains the source of the requested fields.

## Step 3 of 6 - Use Native Date And Time Controls

1. Continue until Lia requests `Preferred Date`.
2. Confirm a labeled date control appears above the chat input.
3. Choose:

```text
2026-08-15
```

4. Submit the value.
5. Confirm Lia next requests `Preferred Time`.
6. Confirm a labeled time control appears.
7. Choose:

```text
15:30
```

8. Submit the value.

Expected result:

- The date control uses the browser's native date picker.
- The time control uses the browser's native time picker.
- The accepted values are displayed as `2026-08-15` and `15:30`.
- Lia advances to the next missing field.

## Step 4 of 6 - Accept Tomorrow

1. Repeat Step 1 to start a fresh conversation.
2. Repeat Step 2 to reach `Preferred Date`.
3. Leave the date control unused.
4. In the normal chat input, send:

```text
tomorrow
```

Expected result:

- Lia accepts `tomorrow` using the trusted turn time and project timezone.
- The saved task value is a canonical `YYYY-MM-DD` date.
- Lia advances to `Preferred Time`.
- Lia does not ask the visitor to convert `tomorrow` into an exact date.

## Step 5 of 6 - Clarify An Ambiguous Weekday

1. Repeat Step 1 to start a fresh conversation.
2. Repeat Step 2 to reach `Preferred Date`.
3. In the normal chat input, send:

```text
next Friday
```

Expected result:

- Lia does not silently choose a calendar date.
- Lia asks for an exact date because the relative weekday is ambiguous.
- The native date control remains available.
- No invalid date is saved.

The clarification should communicate:

```text
Please choose an exact date so there is no calendar ambiguity.
```

## Step 6 of 6 - Verify Channel Fallback

Run:

```powershell
npx playwright test tests/e2e/channel-adapter.spec.ts --config=playwright.contract.config.ts
```

Expected result:

- All channel-adapter tests pass.
- Browser channels preserve the typed date/time request metadata.
- WhatsApp keeps a readable text prompt when no native WhatsApp Flow control
  is configured.
- The WhatsApp fallback does not expose browser-only input metadata.

## Checkpoint Result

Checkpoint 1 passes when all six steps pass.

After passing, report:

```text
Phase 8 checkpoint 1 UAT complete.
```

The next roadmap target is Phase 8 checkpoint 2: reference catalog
dependencies and deterministic business lookups.
