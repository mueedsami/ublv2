# Shajgoj V2.4 — sparse stock snapshots + cumulative sales

## Source workbook contract

For a chosen stock date **X**, the Shajgoj sheet for that calendar month is authoritative.

- `SKU` — Shajgoj marketplace SKU ID used to map to the master.
- `Total Stock QTY` — stock snapshot on **X**.
- changing month-range column such as `October 1-4th, 2026` — cumulative sold quantity from day 1 through **X-1**.
- `Total Sold` — cumulative sales value for that same period.

The selected stock date is validated against the current month-range column. A file whose sold column ends on 4 Oct cannot be committed as a 7 Oct stock snapshot.

## Sparse dates are intentional

Uploads do not have to be daily. If the observed stock dates are 5 Oct and 7 Oct, the database contains two OLA observations only. 6 Oct is not fabricated and the 5 Oct stock is not carried forward.

If an older missing date is uploaded later, it is inserted/backfilled without replacing a newer current stock snapshot.

## Sales history

Sales are cumulative month-to-date snapshots. Example:

- 5 Oct stock file -> sales snapshot 1–4 Oct
- 7 Oct stock file -> sales snapshot 1–6 Oct

Skipped stock-upload dates therefore do not lose sales. The latest cumulative period remains available for monthly reporting, while earlier cumulative snapshots remain historical states.

Completed historical month sheets in the same calendar year are also imported as sales snapshots. Their stock columns are not treated as dated OLA observations because no exact historical stock date is implied by the sheet alone.

## OLA

Shajgoj OLA is basepack-level availability using the master as source of truth:

- basepack is expected when it has an active Shajgoj ID in master;
- available when any mapped SKU under that basepack has `Total Stock QTY > 0` on the observed stock date;
- otherwise unavailable.

A frozen basepack/metadata snapshot is stored per observed stock date so future master revisions do not rewrite historical OLA.

Monthly OLA is the average of observed daily OLA snapshots only. `days_with_data` is always exposed alongside the monthly percentage.
