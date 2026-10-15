# V2.13 — CPP Reference Uploader

CPP is the approved account price reference used later to compare marketplace live selling prices from the twice-daily scraper.

## Upload flow

Open **Uploads → CPP Reference**.

1. Choose the account.
2. Set the allowed price tolerance (default 1%).
3. Choose the monthly CPP workbook.
4. Preview the file.
5. Review mapping / scrapable counts and warnings.
6. Confirm the effective dates.
7. Click **Activate CPP reference set**.

A new reference set becomes the live set for the selected account. The previous live set is retained as `replaced` history instead of being deleted.

## Daraz — October 2026 profile

Source workbook profile:

- sheet: `Working File`
- direct marketplace key: `Daraz sku`
- MRP: `MRP`
- support: `October Backmargin`
- effective dates: `Start Date` / `End Date`

Expected CPP is calculated as:

```text
CPP = MRP - October Backmargin
```

The October workbook supplied for implementation contains 341 valid, unique Daraz SKUs and resolves its validity as 2026-10-01 through 2026-10-31.

A Daraz CPP row remains scrapable even if that Daraz SKU is not currently in the OLA master, because the marketplace SKU is present directly in the CPP workbook. Master mapping is still used for enrichment when available.

## Shajgoj — October 2026 profile

Source workbook profile:

- sheet: `All sku CPP sku`
- source identity: `Packsize`
- expected CPP: `Selling Price`
- product metadata: `Sku Updated Perfect Name`, brand, category, MRP

The supplied October workbook contains 240 valid unique base CPP rows.

This October workbook does not contain a `Shajgoj code` column, so marketplace SKU is resolved conservatively against the current master:

1. exact normalized `Packsize`
2. exact normalized product name
3. conservative same-brand / same-size fuzzy match

Every mapping method and score is shown in preview. Rows that cannot be resolved are still stored in the reference set but are marked **non-scrapable** until a marketplace SKU is mapped. No Shajgoj ID is invented.

The auxiliary sheets are not part of the base-SKU CPP target set yet:

- `Need to enlistment` — informational
- `Vaseline B1G1 Offer` — combo/offer structure requiring separate offer tracking

## Database objects

### `cpp_reference_sets`
Versioned monthly account-level reference imports, effective dates, status and mapping counts.

### `cpp_targets`
One row per source CPP target, preserving the workbook row, expected price, optional master enrichment, mapping method and scrapable state.

### Views

- `v_cpp_master_lookup` — account SKU ↔ product/basepack lookup for the uploader
- `v_cpp_live_targets` — current active reference rows
- `v_cpp_scrapable_targets` — only rows with a resolved marketplace SKU; intended scraper target source
- `v_cpp_reference_history` — current/replaced reference set history

## Security

CPP tables have RLS enabled. `anon` and `authenticated` have no direct access. The Next.js server and scraper backend use service-role access only.

## Next step

Once the reference files are active, the local scraper worker should read `v_cpp_scrapable_targets`, produce AM/PM price observations, and those observations can then be compared against `expected_price` for CPP compliance.
