# Cartup + Ushop OLA integration

## Files
Copy the contents of `runner/` into `the scrapers for ola/`, keeping the `scrapers/` directory. Replace `run_ola_local.py`, `sync_ola_sku_lists.py`, `ola_upload.py`. Merge `.gitignore` if you already have one. This package is incremental and does not replace any of the six existing scraper scripts.

## Inputs
The target SKUs are **always** fetched from Supabase `v_account_mappings` (`status=active`). The Excel inputs are generated artifacts, not source-of-truth data. Each new scraper fetches its marketplace full catalog, matches by exact marketplace SKU/product ID, and produces `Account,Branch,Basepack,Account SKU,OLA,...` rows readable by `ola_upload.py`.

Cartup asks for a fresh `sxsrf` token in the terminal before **every live run** (including combined runs). The token is passed only to the Cartup child process for that execution, not saved in `.env.ola.local` or in a manifest. If rejected or expired during scraping, the run fails and can be rerun with a new token. The token is sensitive and must not be added to Git. Its source is DevTools network requests to the Cartup API. Do not set it as a public Next.js variable.

Ushop needs **active Supabase product mappings** for account code `ushop` before it can run. The live UBL project currently has zero such mappings. Populate them through the authoritative master SKU workflow; use Shopify variant SKU or variant ID as the account SKU. The account is currently inactive, and enabling it in monitoring must be done separately from historical enlistment account flags.

## Commands (PowerShell, scraper folder)

```powershell
python -m pip install requests openpyxl
python sync_ola_sku_lists.py --preview --accounts cartup
python run_ola_local.py --accounts cartup --dry-run
python run_ola_local.py --accounts cartup --max-workers 1 --upload
```

After Ushop mappings are added:

```powershell
python sync_ola_sku_lists.py --preview --accounts ushop
python run_ola_local.py --accounts ushop --max-workers 1 --upload
python run_ola_local.py --accounts cartup ushop --max-workers 2 --upload
```

Open `ola_runs/<timestamp>/cartup.log` or `ushop.log` after failures. The audit `daily_files/<account>/<file>.audit.json` includes missing/ambiguous IDs. Missing matches are **unknown** rather than out of stock. This is important when full catalog endpoints return only part of the marketplace catalog.

## Database and frontend
The existing OLA observations table supports additional account codes. Apply the `app/supabase/extend_ola_summary_accounts.sql` patch to include Cartup/Ushop in the account-summary view; it doesn't affect stock/sales files. The central OLA view already selects account rows without a six-account whitelist. Ensure `OLA_DATA_SOURCE=scraped` after validating results.

## Coverage safety
A full catalog request may be scoped to Unilever's shop rather than the whole marketplace. Match coverage must be reviewed before treating the result as an accurate OLA percentage. Never assume absent SKU IDs are out of stock. Cartup's original code computed zero stock for missing stock fields; the integration adapter intentionally uses Unknown instead.

## Scope
The 16 Pandamart darkstores are a separate expansion. These two uploaded files do not contain its store-specific scraping logic, so Pandamart is not changed by this package.
