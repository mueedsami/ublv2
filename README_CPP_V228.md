# UBL V2 v2.28.0 — CPP Direct-SKU Price Intelligence

This update makes CPP use the active CPP target table directly. The old account SKU-list workbooks are no longer required for daily CPP runs.

## Final flow

```text
Active CPP reference set
        ↓
Marketplace SKU / Product ID
        ↓
Account scraper
        ↓
Current selling price + availability
        ↓
Expected CPP comparison
        ↓
Supabase CPP run/check history
        ↓
/CPP dashboard
```

## Supported CPP adapters

- Daraz — Unilever seller AJAX catalogue once, browser fallback only when unresolved.
- Pandamart — Unilever category GraphQL once per configured branch, then exact SKU lookup locally.
- Shajgoj — exact SKU through Khoj first, then persistent slug / Next-data fallback.
- Othoba — flagship-store catalogue cached once, UNFS code normalized to numeric product ID, then target product page price.
- Arogga — direct `/product/{sku}` JSON-LD price.
- Shwapno — full Unilever tag catalogue once, exact article-code lookup locally.

Foodi is intentionally not enabled for CPP because no proven CPP/product-price scraper was supplied for it.

## Comparison rule

The scraper never decides compliance itself. It only returns marketplace facts.

The CPP comparison layer then applies the tolerance stored on each active CPP target:

- `OK`: live selling price <= CPP
- `Within tolerance` (`half_issue` internally): live price > CPP but <= CPP × (1 + tolerance)
- `Issue`: live price > allowed tolerance
- `Unavailable`: product found but unavailable
- `Missing`: SKU/product or usable live price not found
- `Error`: scraper/runtime failure

Only OK / Within tolerance / Issue are in the price-compliance denominator.

## Pandamart

Pandamart remains branch-wise. One CPP target generates one observation for each configured customer-facing branch:

- Bashundhara
- Dhanmondi
- Gulshan 1
- Gulshan 2
- Mirpur 02
- Mogbazar
- Mohammadpur
- Rampura
- Uttara
- Wari

A branch can therefore show a price issue even if the other branches are compliant.

## Database

The live database migration for `cpp_price_runs`, `cpp_price_checks`, and the CPP report views has already been applied to project `swuogverexpxefenoujq` during implementation.

Keep `supabase/migrations/20261016_cpp_price_runtime_v228.sql` in source control. Do not rerun it manually against the same live project unless you intentionally need idempotent repair.

## Environment

Backend/local worker `.env` needs:

```env
SUPABASE_URL=https://swuogverexpxefenoujq.supabase.co
SUPABASE_SECRET_KEY=<backend secret/service-role key>
TIMEZONE=Asia/Dhaka
CPP_RUN_TIMES=10:00,18:00
SCRAPER_REQUEST_TIMEOUT=20
SCRAPER_DELAY_SECONDS=0.35
DARAZ_HEADLESS=true
```

Never expose `SUPABASE_SECRET_KEY` in browser code.

## Install worker dependencies

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r scraper_worker\requirements.txt
python -m playwright install chromium
```

## First smoke test — Daraz

The live system currently has a Daraz CPP reference set. Start with five targets:

```powershell
.\.venv\Scripts\python.exe -m scraper_worker.cli --accounts daraz --checkpoint manual --target-source cpp --limit 5 --export-csv --no-db
```

`--no-db` still reads CPP targets from Supabase; it simply avoids writing the result history.

Then run five targets and save them:

```powershell
.\.venv\Scripts\python.exe -m scraper_worker.cli --accounts daraz --checkpoint manual --target-source cpp --limit 5 --export-csv
```

Then full Daraz:

```powershell
.\.venv\Scripts\python.exe -m scraper_worker.cli --accounts daraz --checkpoint manual --target-source cpp --export-csv
```

## Run all accounts with active CPP targets

```powershell
.\.venv\Scripts\python.exe -m scraper_worker.cli --accounts all --checkpoint manual --target-source cpp --export-csv
```

Accounts without an active scrapable CPP reference are skipped cleanly rather than failing the whole run.

Or double-click:

```text
run_cpp_manual.bat
```

## Twice-daily automation

Set your two run times in `.env`:

```env
CPP_RUN_TIMES=10:00,18:00
```

Then:

```powershell
.\.venv\Scripts\python.exe -m scraper_worker.cpp_scheduler
```

or double-click `run_cpp_scheduler.bat`.

This process can stay running on the Windows machine that already performs the scraping. The marketplace users do not need Python or Linux; only the collector machine runs the worker.

## Web dashboard

Open:

```text
/cpp
```

It shows:

- latest compliance
- real price issues
- valid vs non-checkable rows
- account readiness / active target count
- current selling price vs CPP
- branch-wise Pandamart checks
- today's AM / PM matrix
- recent run history
- active reference sets
- copyable manual-run command

## Reference upload

Existing Daraz and Shajgoj CPP upload behavior is preserved. The worker is already ready for Othoba, Pandamart, Arogga and Shwapno; those accounts simply need an active CPP reference set with marketplace SKU/Product ID + expected CPP price before they participate in a run.
