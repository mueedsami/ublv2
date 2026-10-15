UBL V2 — Daraz Compact DOD Upload Hotfix v2.17.1

Problem
-------
Newer Daraz DOD exports can omit `sku_status_details`.
The existing parser rejected those files even when they still contained:
- daraz_sku
- Total - Stock
- Stock Valuation

Verified on:
DOD Report-XL Point- (Uniliver) 12-10-2026.xlsx

That workbook contains:
- Sheet1
- 422 unique Daraz SKUs
- Total - Stock
- Stock Valuation
- MRP / Sale Price / BM / TP / GIS / GMV / NMV / SHD / NIS
- NO sku_status_details column

Safety behavior
---------------
1. Old/full DOD format:
   If sku_status_details exists, behavior is unchanged:
   only status = Normal rows are imported.

2. New/compact DOD format:
   If sku_status_details is absent:
   - the workbook is accepted;
   - all SKU rows are stored as raw Daraz observations;
   - OLA and mapped movement KPIs still use ONLY Daraz IDs present
     in the active V2 master;
   - non-master rows cannot make a basepack Available and are excluded
     from mapped movement summaries.

This avoids fabricating a Normal status that the source file did not provide.

Install
-------
Replace:
lib/stock-parser.ts

No Supabase migration is required.

Then run:
npm run typecheck
npm run build

After restarting the app, retry the same Daraz file with the correct stock date
selected in the Uploads page.
