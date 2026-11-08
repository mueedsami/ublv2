# Tertiary Report — account-wise Excel upload + monthly master (Phase 1)

This patch reuses `lib/excel.ts` and `lib/supabase-admin.ts` **already present** in your UBL Next.js project. It does not modify those files or the Sales & Stock uploader, OLA, CPP, SOS, or Enlistment.

## Install
1. Back up your current `app/dashboard-report/page.tsx` and other local changes.
2. Copy the `components`, `app`, and `lib/tertiary-parser.ts` folders from this patch to your Next.js project, preserving paths. Do **not** replace your existing `lib/excel.ts`; the supplied patch does not include that file.
3. The SQL in `supabase/tertiary_monthly_imports.sql` has already been applied to your connected UBL Supabase database. For new environments, execute it once in Supabase SQL editor.
4. The API reuses the **server-side** `URL_MAPPING_ADMIN_TOKEN` already configured for the SKU URL manager (>=16 characters). Enter it only in the Tertiary upload panel. Keep the key private.
5. Restart `npm run dev`, open sidebar `Tertiary Report` (route `/dashboard-report`).
6. Choose account and reporting month, upload `.xlsx`, click **Inspect & Preview Upload**, review, then **Approve Monthly Import**.
7. Switch to **Monthly Master Report** to load the selected month and export a CSV in first-tab style.

## Supported account dumps from `tert.xlsx`
- Arogga: `p_id`, `p_name`, `sales_qty_AUG/SEP`. Revenue is null.
- Cartup: `Shop SKU`, `Item`, `GIS-Jul/Aug/Sep`; GIS is *provisionally* interpreted as units, **explicit confirmation required**. Revenue is null. Current SP is not sales revenue.
- Shajgoj: `SKU`, `Name`, `September ,2026` (units), `Total Sold` (sales value). This example adapter only supports September 2026.
- Othoba: `Sku`, `ProductName`, `Sold Qty(1-30)`, `Sales Value`. Month is user-supplied; source doesn't identify period.
- Pandamart: `Date`, `Item_Id`, `Item_Name`, `sold_qty`, `gfv_local`; dates parsed and filtered to selected month, daily lines aggregated per SKU.

**Important**: This is a first-pass integration for the FIVE exact formats in the supplied workbook, not a general autodetection engine for all versions. Daraz and other account-specific formats are not supported until verified source dumps are provided. CSV is not yet supported.

## Safeguards
- Preview is read-only. Approval requires re-upload of the exact same bytes, account, month, sheet (SHA256 scope check).
- Monthly-only repeated account SKUs block approval, preventing silent double-counting.
- Pandamart repeated daily SKU lines sum into SKU-month totals.
- Imported batches are versioned. New approval supersedes old **Tertiary-only** snapshot for that account/month, keeping previous versions for audit.
- Master enrichment is exact account + SKU mapping. Unmatched rows remain in Tertiary reports with empty Master fields.
- Sales values are never synthesized from TP, MRP or SP.
- All month-wise reporting is based only on Tertiary fact tables, separate from stock and OLA history.

## Limitations
- The original file's first tab has `ACCOUNT TYPE`, `PACK SIZE`, and `FORMAT`; this initial report uses live Master metadata where available. Exact first-tab layout and unmapped metadata still require a mapping/backfill step. Account type is not yet exported.
- `gfv_local` is treated as the Pandamart sales-value metric but is not assumed to be unit-level selling price.
- For initial safety, only the first 500 rows are displayed in the browser; downloadable CSV uses all fetched rows.
- No live imported sales were seeded automatically. You approve them using the UI.
