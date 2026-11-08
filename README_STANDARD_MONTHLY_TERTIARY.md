# Tertiary Report — Standardized Monthly Sales Upload (v2)

## Purpose
Replace account-specific dump parsers with ONE standardized monthly spreadsheet, already supplied at `public/templates/UBL_Tertiary_Monthly_Account_Sales_Upload_Template.xlsx`.

**CRITICAL:** All valid account SKU sales count in the Tertiary Report even when the SKU is not mapped to Master SKU. Missing Master mappings are an enrichment gap, never an import rejection and never a reason to omit sales.

## Install
1. Back up local changes to `components/TertiaryUploadCenter.tsx`, `app/api/tertiary/import/route.ts`, and `app/dashboard-report/page.tsx` (if replacing the page).
2. Merge/copy patch files into Next.js project root, preserving folders. Existing `lib/excel.ts` and `lib/supabase-admin.ts` must remain untouched.
3. Keep the existing `URL_MAPPING_ADMIN_TOKEN` in the project-root `.env.local` (at least 16 characters, server-side only); this panel reuses that admin key.
4. The `public.commit_tertiary_monthly_batch` function has already been updated in the live UBL Supabase database to support all existing account codes. `supabase/tertiary_monthly_imports.sql` is provided as a reference/redeployment schema, not an instruction to reset your database.
5. Restart `npm run dev` and visit **Tertiary Report** (`/dashboard-report`).
6. Download the template in the app. In `MONTHLY_UPLOAD`, set B4=account and B5=month (`YYYY-MM`), then paste rows from row 10.
7. Select the matching account/month in the app, enter admin access, upload file, preview. The preview shows matched/unmatched counts and every valid sales item remains eligible for approval.
8. Approve. Review all sales in Monthly Master Report. Filter to **Unmatched only** as needed. CSV export includes those rows, with unavailable metadata blank.

## Required Excel columns (row 9, don't reorder)
- A: `Account SKU ID *` — mandatory; copied EXACTLY; format as text to preserve leading zeros.
- B: `Units Sold *` — mandatory, numeric >= 0 (zero is valid).
- C: `Sales Revenue (BDT)` — optional; blank is stored as NULL, not zero. Use actual sales-value figure, not current price × units.
- D: `Product Name (optional)` — optional, used as fallback name for unmatched products.
- E: `Notes (optional)` — optional guidance column, **not persisted** by this release.

Upload one account + one month per file. Repeated SKU IDs within the same monthly file block approval to prevent accidental double-counting. Aggregate actual daily transactions into a single monthly SKU row first.

## Mapping behavior
The importer compares `account_code + account_sku` to `v_account_mappings` only to display mapping coverage. It DOES NOT filter account sales by Master SKU mapping.

Database facts: `tertiary_import_batches` and `tertiary_monthly_facts`. The view `v_tertiary_monthly_master` LEFT JOINs master product metadata where available; unmatched SKU sales remain in the report. When a product is properly mapped to Master SKU in the future, the view can enrich its historical rows automatically. Unmatched SKU records can also be reviewed and exported without first creating a Master mapping.

A re-upload of the same account/month stores a new active batch and marks the old batch superseded; old batches remain for audit. It does not add sales twice.

## Important boundaries
- No updates to `products`, `product_account_ids`, OLA, Enlistment, CPP, SoS, or Sales & Stock.
- This does NOT fix or standardize the raw account dump spreadsheets. The operator uses the fixed monthly upload format.
- The source `Notes` column is not stored; don't put vital audit evidence there until a future release adds it.
- Browser preview shows first 30 lines; reporting table shows first 500, while exported CSV includes all retrieved rows for selected filters.
- A local full Next.js build still needs validation against the latest local repository.
