# Unilever Stock Intelligence — Complete Local Scraper Bundle

This bundle contains the current V2 local scraper worker plus recovered legacy scraper sources.

## Current scraper readiness

| Account | Current V2 adapter | Status |
|---|---|---|
| Daraz | Playwright + Daraz search/XHR matching by `itemId_BD-skuId` | Prepared for local smoke test |
| Pandamart | Foodpanda GraphQL, branch-wise | Prepared for 10 recovered branches |
| Shajgoj | Shajgoj search API, exact `product_sku` match | Prepared for local smoke test |
| Othoba | Othoba search/page parser | Prepared; exact matching must be validated with CPP file |
| Foodi | Placeholder only | NOT IMPLEMENTED — live Foodimart request/API still needs capture |

### Pandamart recovered branches

Bashundhara, Dhanmondi, Gulshan 1, Gulshan 2, Mirpur 02, Mogbazar, Mohammadpur, Rampura, Uttara, Wari.

Still pending vendor-ID capture: Mirpur 03, Chittagong 1, Sylhet 2, Khulna, Rajshahi, Lalbagh, Central DC.

## Recommended workflow for now

Run locally -> create CSV -> upload CSV into the Next.js system.

The current bundle can also write directly to Supabase, but for manual operation use `--no-db --export-csv`.

## 1. Setup on Windows

Open PowerShell/Terminal in this folder and run:

```bat
setup_windows.bat
```

Or manually:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r scraper_worker\requirements.txt
python -m playwright install chromium
copy .env.example .env
```

Fill `.env` with your Supabase URL + backend key if you want to use the current V2 master SKU list as scraper targets.

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_BACKEND_SECRET_KEY
TIMEZONE=Asia/Dhaka
SCRAPER_RUN_TIMES=10:00,18:00
```

The key stays local. Do not put it in browser code or commit it to GitHub.

## 2. Smoke test before a full run

```powershell
.\.venv\Scripts\Activate.ps1
python -m scraper_worker.cli --accounts shajgoj --checkpoint manual --target-source master --limit 5 --no-db --export-csv
python -m scraper_worker.cli --accounts othoba --checkpoint manual --target-source master --limit 5 --no-db --export-csv
python -m scraper_worker.cli --accounts daraz --checkpoint manual --target-source master --limit 3 --no-db --export-csv
python -m scraper_worker.cli --accounts pandamart --checkpoint manual --target-source master --limit 2 --no-db --export-csv
```

Output appears under:

```text
scraper_outputs/YYYY-MM-DD/
```

## 3. Full AM / PM local runs

AM:

```bat
run_am_local.bat
```

PM:

```bat
run_pm_local.bat
```

These currently run Daraz, Pandamart, Shajgoj and Othoba. Foodi is deliberately excluded until its scraper is implemented.

Equivalent manual command:

```powershell
python -m scraper_worker.cli --accounts daraz,pandamart,shajgoj,othoba --checkpoint am --target-source master --no-db --export-csv
```

## 4. Fully local target CSV mode

If you do not want the scraper to read target SKUs from Supabase, use a target CSV:

```powershell
python -m scraper_worker.cli --accounts shajgoj --checkpoint am --target-source csv --targets-csv scraper_worker\targets.example.csv --no-db --export-csv
```

This mode needs no Supabase credentials because it neither reads nor writes Supabase.

## Output CSV columns

- account
- account_sku
- product_name
- live_price
- original_price
- in_stock
- scrape_status
- branch_code
- branch_name
- product_url
- scraped_at
- raw_json

These files are intended to become the manual scraper-upload input for the CPP module.

## Direct Supabase mode later

Remove `--no-db` if you want the worker to create `scraper_runs` and `scraper_price_observations` directly in the current V2 Supabase project.

Example:

```powershell
python -m scraper_worker.cli --accounts shajgoj --checkpoint am --target-source master --export-csv
```

This both stores the observations in Supabase and creates the local CSV evidence file.

## Twice-daily scheduler later

After all scrapers are verified, run:

```powershell
python -m scraper_worker.scheduler
```

The default `.env` times are `10:00,18:00` Asia/Dhaka.

## Folder guide

- `scraper_worker/` — current V2 scraper worker and account adapters
- `recovered_originals/` — original legacy marketplace scripts recovered from previous work
- `legacy_cpp_orchestrator/` — recovered old CPP twice-daily orchestration for reference
- `supabase/migrations/` — current V2 scraper runtime schema migrations

## Important

This package does not invent missing scraper integrations. Foodi is still pending, and the additional Pandamart branches require current vendor IDs before they can be automated.
