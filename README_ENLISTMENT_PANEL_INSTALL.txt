UBL V2 v2.19.0 — Enlistment Panel
==================================

What this patch adds
--------------------
- New sidebar tab: Enlistment
- Upload the UBL internal product enlistment CSV/XLSX
- Target Platforms / Enlisted Platforms from the source file are deliberately ignored
- Manual account selection per product
- Bulk add target accounts to selected products
- Independent account-wise statuses:
  Pending, Ready, Sent, Under review, Enlisted, Needs correction, Rejected
- Account notes and Daraz-specific required fields
- Bulk export to the exact account template family:
  * Daraz -> Daraz template
  * Pandamart -> Pandamart template
  * every other active account -> Regular template
- Excel (.xlsx) and CSV export
- Export history
- Re-imports update products by barcode and preserve account targets/statuses

Database
--------
The Enlistment database foundation is already live in the UBL Availability V2 Supabase project.
DO NOT manually run SQL for this patch.

Install
-------
Extract this patch over the current app root.

Then run:
  npm run typecheck
  npm run build

Open:
  /enlistment

First validation
----------------
1. Upload UBL_Product_Enlistment_2026-10-07.csv
2. Preview should show 2 products.
3. It should explicitly warn that Target Platforms / Enlisted Platforms are ignored.
4. Import.
5. Open one product and manually select target accounts.
6. Set statuses independently for each account.
7. For Daraz, fill any required Daraz-specific fields.
8. Select products in the main table and export for an account.

Important
---------
Downloading an export does NOT mark the product as Sent or Enlisted. Status remains manual.
