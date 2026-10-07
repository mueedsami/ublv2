# Othoba V2.10 Flags

Othoba flags are account-specific and use both families in the source workbook:

- Sales & Stock Report: stock, MTD sold qty, run rate, stock value, sales value.
- Sales Report month sheets: monthly SKU sales history used for pace comparison.

## Active rules

- Repeated OOS: OOS on both latest and previous actual stock observations.
- High-sales OOS: stock 0 with at least 5 units sold MTD.
- Low days of cover: stock / run rate; <=7 days critical, 8-14 days warning.
- Missing from latest upload: mapped basepack has no mapped SKU row in latest stock file.
- OOS with demand: OOS with 1-4 MTD units sold.
- High-value stagnant: stock value >= 18,000 with zero MTD sales.
- Sales pace drop: current-month daily sales pace <50% of previous month when previous pace >=0.5/day.
- OOS no recent sales: OOS with zero MTD sales.
- No sales with stock: inventory present but no MTD sales.
- Overstock slow mover: >=60 days cover and stock value >=8,000.
- Sales pace surge: current daily pace >=150% of previous month, current month sold >=5.
- Recovered: latest stock available after previous observation was OOS.

Thresholds are calibrated to the current Othoba distribution and can be moved to configurable settings later if required.
