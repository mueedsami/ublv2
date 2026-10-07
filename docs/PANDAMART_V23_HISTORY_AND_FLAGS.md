# Pandamart V2.3 — Daily History, OLA, Sales & Flags

Pandamart is still part of the unified Availability system. It does not get a separate top-level application.

## Daily workbook interpretation

- `Store Wise Stock T-1 Day` is the authoritative stock snapshot.
- `date` inside the workbook is the stock date. The filename/upload date is not used as the stock date.
- `sku` maps to the Pandamart SKU ID in the master.
- 16 customer-facing branch columns are stored individually.
- `DC` is stored but excluded from OLA.
- `Last 30 Days Sales` is imported as day-wise sales. Overlapping dates are refreshed by `(sale_date, account_sku)` rather than duplicated.

## History

Every upload stores raw `stock_date × account SKU × branch × quantity` history. Re-uploading the same stock date replaces that date only; a new date appends a new day.

A frozen `basepack × branch × date` availability snapshot is also stored. This freezes the master scope and hierarchy for that historical date, so later master changes do not rewrite old OLA.

## OLA definitions

- **Branch OLA** = available basepack-branch cells / all expected basepack-branch cells. This is the primary Pandamart OLA KPI.
- **Network coverage** = basepacks available in at least one customer-facing branch / expected basepacks. This is secondary and must not be labelled OLA.
- Monthly OLA = average of the stored daily branch OLA values for dates present in the month.

## Initial automated flags

The V2 flag view uses the same categories as the previous system, with explicit initial thresholds:

- Stockout risk: recent sales exist and customer-facing days of cover <= 7 (critical <= 3 or zero branch stock)
- Distribution imbalance: stock exists in <= 3 customer-facing branches (critical <= 1)
- DC-stuck: DC > 0 while customer-facing store stock = 0
- Zero network stock: stores = 0 and DC = 0
- Sales decline: once >= 30 days of sales history exist, recent 15 days are >= 30% below prior 15 days (critical >= 50% drop)
- Store health: branch OLA < 65% (critical < 50%)

These thresholds are documented defaults, not claimed to be recovered verbatim from the old implementation.
