# UBL OLA: Supabase-only master SKU source

## Behavior
- The live Supabase `v_account_mappings` view is the **only authoritative list** of active product SKUs/basepacks for all six marketplaces.
- At the beginning of EVERY run, `run_ola_local.py` reads all active SKU mappings from Supabase, validates them, and recreates disposable `sku_lists/*.xlsx` files in the exact format the existing scrapers require.
- These generated workbooks are implementation artifacts, **not sources of truth**. Manual edits will be overwritten. If Supabase is unreachable, the runner **does not scrape from cached/stale workbook data**.
- Pandamart branch membership comes exclusively from Supabase table `ola_pandamart_branch_mappings`; it is ANDed with currently active Pandamart master mappings. The former 11-sheet Excel list is only used once to prepare a reviewed migration SQL.
- Scraping still runs locally; successful outputs can upload to `ola_scrape_runs` / `ola_scrape_observations` via `--upload`.
- The stock and sales file processing remains independent. The existing OLA APIs use the previously provided scraped-source toggle, with `OLA_DATA_SOURCE=scraped` only after database ingestion validation.

## 1. Setup
Put these runner files at the root of the extracted `the scrapers for ola` folder, alongside `scrapers/` and `sku_lists/`:
- `run_ola_local.py`
- `sync_ola_sku_lists.py`
- `ola_upload.py` (from previous OLA integration package)
- `bootstrap_pandamart_branches.py`

Install `requests` and `openpyxl`: `py -m pip install requests openpyxl`.
Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as local shell environment variables. Never expose the service key in browser code or commit it to source control.

## 2. Pandamart migration (one time, before first six-account run)
In Supabase SQL editor, review and execute `app/supabase/ola_pandamart_branch_mappings.sql` (a new table; no existing rows are removed).

Generate migration SQL from the historical workbook **once**:

```powershell
py bootstrap_pandamart_branches.py --source "sku_lists/Pandamart SKU List.xlsx" --sql-out pandamart_branch_seed_review.sql
```

Carefully inspect and run `pandamart_branch_seed_review.sql` in the SQL Editor. Its `JOIN` restricts migrated branch SKUs to products that are **currently active** in the Supabase master mapping. Confirm that all eleven branches have sensible nonzero counts. Do not import old workbook-only SKUs into the master.

**Limitations**: when new Pandamart products need specific branches, an owner must add their branch assignments to this Supabase table. The runner intentionally fails if any of the 11 branch sheets would be empty rather than inventing branch eligibility. There is not yet a browser UI for editing branch assignments.

## 3. Verify and run

```powershell
# Validate live Supabase mappings without rewriting Excel files or scraping
py sync_ola_sku_lists.py --preview

# Regenerate all six source workbooks from Supabase
py sync_ola_sku_lists.py

# Verify commands (this also validates live mapping coverage)
py run_ola_local.py --dry-run

# Start local scraping, regenerate all inputs first, upload successful outputs
py run_ola_local.py --max-workers 3 --upload
```

Every normal runner invocation automatically regenerates the lists, so you need not run the synchronization command separately.

## 4. Existing OLA API
Reuse the original integration package (`app/api/availability/route.ts`, `app/api/central/route.ts`, `app/supabase/ola_scraped_source.sql`) if not applied already. These endpoints are designed to preserve the current dashboard UI and stock/sales processing.

## Validation and rollout
1. Check sample output counts/headers; confirm 11 Pandamart branches and that their mapped active SKU sets are reasonable.
2. Dry-run with live credentials, then start one account at a time to validate actual scraping and DB writes.
3. Compare OLA API returned values to Excel OLA reports before activating `OLA_DATA_SOURCE=scraped`.
4. **No live database writes have been made in preparing this package.** SQL files require deliberate operator review and execution.

## Safety note
The generated files are replaced in-place after successful validation and staging. A mid-replacement disk failure can leave only some local input files updated; re-run synchronization to regenerate all from the authoritative DB. Stock and sales uploads are never read or modified by this process.
