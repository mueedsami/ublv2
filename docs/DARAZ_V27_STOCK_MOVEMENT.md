# Daraz v2.7 — Normal SKU Stock + Movement

- Import only `sku_status_details = Normal`.
- `daraz_sku` is matched against the active Daraz master mapping.
- Raw Normal stock snapshots preserve `Total - Stock`, `Stock Valuation`, aging, MRP, Sale Price, TP, GIS, GMV, NMV and NIS.
- Only mapped IDs affect OLA and UBL movement metrics.
- Estimated depletion = `max(previous_stock - current_stock, 0)`.
- Replenishment = `max(current_stock - previous_stock, 0)`.
- Depletion value uses the previous observation's unit stock valuation where available.
- These are implied stock movements, not confirmed sales, because replenishment/adjustments can occur between observations.
- The number of days between observations is retained.
