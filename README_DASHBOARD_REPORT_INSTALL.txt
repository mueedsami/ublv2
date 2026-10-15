UBL V2.18 — Dashboard Report

Install this PATCH ONLY over the existing project root.

New page:
  /dashboard-report

Then run:
  npm run typecheck
  npm run build

No Supabase SQL or migration is required.

Recommended first validation:
1. Open Dashboard Report.
2. Basepack mode.
3. Search: Lux Body Wash Freesia
4. Choose the matching basepack.
5. Month: October 2026.
6. Confirm Daraz / Pandamart / Shajgoj account rows and their source dates.
7. Switch to Account SKU lookup and test one Daraz or Shajgoj SKU.

Value logic:
  Stock Value = latest stock qty × UBL TP
  Sales Value = selected-period sold qty × UBL TP

Daraz sales uses GIS from the DOD workbook. It does NOT use inferred stock depletion as sales.
