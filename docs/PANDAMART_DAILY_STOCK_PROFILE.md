# Pandamart Daily Stock Profile (V2.2)

Pandamart is now account-specific and automatic.

## Accepted daily workbook

The workbook must contain:

- `Store Wise Stock T-1 Day`
- `date`
- `sku`
- store stock columns
- optional `DC`

`Last 30 Days Sales` is ignored by Availability V2.

## Availability rule

Pandamart customer availability is based only on store inventory.

- Marketplace key: `sku`
- Stock quantity: sum of the 16 store columns in the supplied 5 Oct workbook
- `DC`: explicitly excluded from availability
- Stock date: read from the workbook `date` column
- Basepack: `Packsize` from master
- A basepack is Available if any mapped Pandamart SKU under it has store stock > 0.
- Stock IDs not present in the current master are ignored.
- Master-listed basepacks with no stock in the dump are Out.

## 5 Oct validation file

`pandamart 5 oct.xlsx` resolves to:

- stock sheet: `Store Wise Stock T-1 Day`
- stock date: `2026-10-04` (T-1)
- 16 store columns
- 248 unique Pandamart stock IDs
- 106,971 store stock units
- 62,024 DC units excluded
- no duplicate stock IDs

Against `ONly actives for now...(1).xlsx`:

- 198 unique Pandamart IDs in master
- 196 expected Pandamart basepacks
- 177 stock IDs match master
- 71 stock IDs are outside current master scope and are ignored
- 173 basepacks are available in stores
- Pandamart availability = 88.27%

If DC were incorrectly counted, three additional mapped IDs would become available, so DC exclusion is intentional.
