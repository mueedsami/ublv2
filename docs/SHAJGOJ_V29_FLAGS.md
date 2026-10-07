# Shajgoj V2.9 Flags

Shajgoj flags are intentionally account-specific. They use the latest observed Shajgoj stock date, the latest available Shajgoj cumulative sales period, and the previous observed stock date when available.

## Flags

- **Repeated OOS** — out of stock on both the latest and previous observed stock dates.
- **High-sales OOS** — current stock is zero and latest-period sold quantity is at least 25 units.
- **OOS with demand** — current stock is zero and latest-period sales are positive but below the high-sales threshold.
- **OOS, no recent sales** — current stock is zero and latest-period sales are zero.
- **Low days of cover** — stock cover is <=7 days (critical) or <=14 days (warning), using `stock / (sold_qty / sales_period_days)`.
- **No sales with stock** — current stock is positive while latest-period sold quantity is zero.
- **Recovered** — current stock is positive after being OOS on the previous observed stock date.
- **Missing from latest upload** — a mapped basepack has no Shajgoj SKU row in the latest stock upload.

The system does not fabricate missing dates. Repeated OOS and recovery compare only actual observed stock dates.
