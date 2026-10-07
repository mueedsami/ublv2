# Foodi V2.5 — Stock + Rolling 30-Day Sales

## Source file

The Foodi workbook is a single-sheet export with `SKU`, `Product Name`, `30 Day Sale Qty`, and `Total Stock`. TP/MRP/Selling Price are preserved on the rolling-sales snapshot for later diagnostics.

## Date semantics

For selected stock date **X**:

- `Total Stock` is the stock position on **X**.
- `30 Day Sale Qty` is stored for the rolling 30-day window **X-30 through X-1**, inclusive.
- Missing upload dates are preserved as missing; no forward-fill is performed.
- Re-uploading the same date replaces that date only.

## Availability

Foodi SKU IDs are mapped through the active UBL master to UBL SKUs and basepacks. A listed basepack is Available when any mapped Foodi SKU under it has stock greater than zero. The basepack scope and filter metadata are frozen for each observed date so later master changes do not rewrite historical OLA.

## Dashboard

The Foodi page exposes Overview, Current Stock, 30-Day Sales, Daily OLA, and Monthly OLA. Rolling 30-day snapshots overlap and therefore must not be summed as if they were daily sales.
