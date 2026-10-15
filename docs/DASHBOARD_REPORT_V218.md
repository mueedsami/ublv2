# Dashboard Report v2.18

## Purpose

Adds a separate **Dashboard Report** page for stock and sales value analysis.

The report supports two workflows:

1. **Basepack across accounts** — search one UBL basepack/product and compare the mapped marketplace SKUs across Daraz, Pandamart, Shajgoj, Foodi and Othoba.
2. **Account SKU lookup** — choose an account, search an exact marketplace SKU or product, and inspect the selected month.

## Common value basis

To keep cross-account totals comparable, the report deliberately uses the UBL master TP as the valuation basis:

- `Stock Value = latest stock quantity × TP`
- `Sales Value = sold quantity for selected reporting period × TP`

This avoids adding together marketplace-specific valuation fields that may use different definitions or units.

## Selected-month rules

- **Current stock:** latest uploaded stock snapshot inside the selected month and on/before the selected `As of` date.
- **Previous month:** selecting a previous month uses the last available stock snapshot in that month and the available sales period within that month.
- **Daraz sales quantity:** `GIS` from the latest Daraz DOD snapshot in the selected month. Stock depletion is not used as sales.
- **Pandamart sales quantity:** sum of daily `sold_qty` rows from month start through `As of`.
- **Shajgoj sales quantity:** latest cumulative monthly sales snapshot for each mapped SKU.
- **Othoba sales quantity:** latest monthly sales snapshot for each mapped SKU.
- **Foodi sales quantity:** current source is rolling 30-day. It is shown with its actual source dates and excluded from calendar-month total sales unless the source period starts on the first day of the selected month.

## Basepack behavior

All active UBL products under the selected basepack are loaded, then marketplace IDs are deduplicated by account + marketplace SKU. Multiple marketplace SKUs mapped to the same basepack are summed inside the account row.

For Pandamart stock, all branch rows present in the latest selected-month stock snapshot are summed into the Pandamart account total.

If a basepack has no marketplace ID for an account in the current V2 master, the row is shown as **Not mapped** rather than guessed from product names.

## Current reporting adapters

- Daraz
- Pandamart
- Shajgoj
- Foodi
- Othoba

Additional accounts can be added later by adding a reporting adapter without changing the page workflow.

## Files

- `app/dashboard-report/page.tsx`
- `app/api/dashboard-report/route.ts`
- `app/api/dashboard-report/search/route.ts`
- `components/DashboardReport.tsx`
- `lib/dashboard-report-data.ts`
- `components/AppShell.tsx`
- `app/globals.css`

No Supabase migration is required for v2.18; it reads the existing normalized V2 stock/sales tables.
