# UAT Test Plan

Phase: 8 of 18

Checkpoint: 2 of 6

Test: Universal Catalog Management

Progress: Implementation and automated checks complete; focused manual UAT
pending

Project: `Ewissen Infra (#194)`

Start URL: `http://localhost:3000/projects/catalog`

Database migration: Not required for this checkpoint

This checkpoint verifies that Lia has one project-owned catalog for all
channels. WhatsApp identifiers are optional mappings and do not make the
catalog WhatsApp-specific.

## Step 1 of 8 - Open The Catalog

1. Open `http://localhost:3000/projects/catalog`.
2. Confirm the selected project is `Ewissen Infra (#194)`.
3. Confirm the page shows active and archived catalog and product counts.

Expected result:

- The page loads without an error.
- Catalogs and products for another project are not shown.
- The page explains that Lia is the source of truth for every channel.

## Step 2 of 8 - Create A Catalog

In `Create Catalog`, enter:

Catalog Name:

```text
Phase 8 Service Catalog
```

Description:

```text
Universal service catalog used for Phase 8 channel testing.
```

WhatsApp Catalog ID:

```text
uat-meta-catalog-001
```

Click `Create Catalog`.

Expected result:

- `Catalog created.` appears near the catalog form.
- The entered values are displayed in the active catalog list.
- The WhatsApp ID is shown only as an optional channel mapping.

## Step 3 of 8 - Add A Product

In `Add Product`, enter:

Catalog:

```text
Phase 8 Service Catalog
```

Product Name:

```text
Classic Facial UAT
```

SKU:

```text
UAT-FACIAL-001
```

Price:

```text
95.00
```

Currency:

```text
INR
```

Description:

```text
Classic facial treatment used for Phase 8 catalog UAT.
```

Image URL:

```text
https://example.com/classic-facial.jpg
```

Product URL:

```text
https://example.com/services/classic-facial
```

WhatsApp Retailer ID:

```text
uat-classic-facial
```

Click `Add Product`.

Expected result:

- `Product created.` appears near the product form.
- The active product list shows `Classic Facial UAT`.
- The displayed price is `₹95.00`, not `9500`.
- The WhatsApp retailer ID is an optional mapping.

## Step 4 of 8 - Edit The Catalog And Product

1. Click `Edit` beside `Phase 8 Service Catalog`.
2. Change Catalog Name to:

```text
Phase 8 Service Catalog Updated
```

3. Change Description to:

```text
Updated universal catalog used for Phase 8 channel testing.
```

4. Click `Save Catalog`.
5. Click `Back to catalog`.
6. Click `Edit` beside `Classic Facial UAT`.
7. Change Product Name to:

```text
Classic Facial UAT Updated
```

8. Change Price to:

```text
105.50
```

9. Click `Save Product`.

Expected result:

- Success messages appear inside the relevant form.
- The edited values remain visible after saving.
- The price is displayed as `₹105.50`.
- A failed validation keeps the entered values and shows its error in the form.

## Step 5 of 8 - Archive And Restore The Product

1. On the product page, click `Archive`.
2. Confirm the product status changes to archived.
3. Click `Restore Product`.

Expected result:

- The product can no longer be used as an active choice while archived.
- Restoring returns it to active status.
- The catalog and other products remain unchanged.

## Step 6 of 8 - Archive And Restore The Catalog

1. Return to the catalog page.
2. Open `Phase 8 Service Catalog Updated`.
3. Click `Archive`.
4. Confirm `Restore Catalog` is shown.
5. Click `Restore Catalog`.

Expected result:

- The catalog moves between archived and active states.
- Its product is preserved.
- An archived parent catalog cannot supply active product choices.

## Step 7 of 8 - Verify Project Isolation

1. Use the selected-project control in the header.
2. Switch to a different project.
3. Open `/projects/catalog`.
4. Confirm the Phase 8 catalog and product are absent.
5. Switch back to `Ewissen Infra (#194)`.

Expected result:

- The Phase 8 catalog is visible only in project `#194`.
- No catalog or product data crosses the project boundary.

## Step 8 of 8 - Clean Up

1. Open `Classic Facial UAT Updated`.
2. Click `Archive`.
3. Click `Delete Permanently`.
4. Open `Phase 8 Service Catalog Updated`.
5. Click `Archive`.
6. Click `Delete Permanently`.

Expected result:

- The unreferenced archived product is permanently deleted.
- The now-empty unreferenced archived catalog is permanently deleted.
- The app returns to the catalog page with a success message.

Automated reference-safety coverage:

```powershell
npx playwright test tests/e2e/catalog-resource-dependencies.spec.ts
```

Expected result:

- All dependency-scanner tests pass.
- Catalog and product references are detected inside draft and published
  contracts.
- Referenced resources cannot be permanently deleted.

## Checkpoint Result

Checkpoint 2 passes when all eight steps and the automated reference-safety
check pass.

After passing, report:

```text
Phase 8 checkpoint 2 UAT complete.
```

The next roadmap target is Phase 8 checkpoint 3: corrections, side questions,
cancellation, confirmation, and completion.
