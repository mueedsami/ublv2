# Othoba V2.6 — Stock + dual sales ingestion

## Workbook interpretation

Othoba workbooks contain two independent but complementary sales sources.

1. `*Sales & Stock Report` sheets are operational snapshots. The sheet matching the selected stock month drives current stock and OLA. Its `Sold Qty(1-N)` column is stored as a period sales snapshot. Historical Sales & Stock sheets are imported as sales history only; their stock columns are not assigned invented historical stock dates.
2. `Sales Report <Month>` / `<Month> Sales Report` sheets are detailed sales exports. The same SKU may occur more than once because it sold at different selling prices. V2.6 aggregates these rows by SKU and month/period before persistence.

For `othoba 5 oct.xlsx`, selecting 2026-10-05 means:
- stock date: 2026-10-05 from `October-Sales & Stock Report`
- current snapshot sales: 2026-10-01 through 2026-10-04
- historical operational sales snapshots: July, August, September
- detailed sales history: January through October

## Tables
- `othoba_stock_daily`
- `othoba_sales_snapshots`
- `othoba_monthly_sales`
- `othoba_basepack_daily`

## RPC
- `commit_othoba_upload_v2(jsonb)`

## Views
- `v_othoba_current_basepacks`
- `v_othoba_daily_ola`
- `v_othoba_monthly_ola`
- `v_othoba_sales_snapshot_summary`
- `v_othoba_monthly_sales_summary`

## OLA rule
Expected scope is the set of active basepacks with an Othoba account mapping in the master. A basepack is available when any mapped Othoba SKU under that basepack has stock greater than zero on the uploaded stock date.
