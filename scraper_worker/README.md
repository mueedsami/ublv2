# UBL V2.12 — Price Scraper Runtime Prep

This worker is intentionally separate from the Next.js/Vercel app. The website is the control/reporting plane; browser/API scraping runs in a Python worker and writes normalized observations to Supabase.

## What is ready

| Account | Adapter | Readiness |
|---|---|---|
| Shajgoj | Recovered `khoj.shajgoj.com/products` API logic | Prepared |
| Othoba | Recovered Othoba search/page parsing | Prepared; exact-ID matching should be validated against the new CPP file |
| Daraz | Recovered Playwright + search XHR interception | Prepared |
| Pandamart | Recovered Foodpanda GraphQL + 10 legacy branch vendor IDs | Prepared for those 10 branches |
| Foodi | Worker slot exists | Pending live Foodimart API/request capture |

No CPP compliance calculation is included yet. This package only creates raw scraper runs and live-price observations. CPP uploads will be the next layer.

## Current Pandamart automation scope

Recovered vendor IDs exist for Bashundhara, Dhanmondi, Gulshan 1, Gulshan 2, Mirpur 02, Mogbazar, Mohammadpur, Rampura, Uttara and Wari.

The current V2 master also contains Mirpur 03, Chittagong 1, Sylhet 2, Khulna, Rajshahi, Lalbagh and Central DC. These need fresh vendor-ID capture before they are enabled in automated scraping.

## Install locally

```bash
cd scraper_worker
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
copy .env.example .env   # Windows
# cp .env.example .env   # Linux/macOS
```

Fill `SUPABASE_URL` and a backend-only Supabase secret/service-role key. Never expose that key to Next.js browser code.

## Smoke test first

Do not begin with all products. Run 3–5 targets per account:

```bash
python -m scraper_worker.cli --accounts shajgoj --checkpoint manual --target-source master --limit 5
python -m scraper_worker.cli --accounts othoba --checkpoint manual --target-source master --limit 5
python -m scraper_worker.cli --accounts daraz --checkpoint manual --target-source master --limit 3
python -m scraper_worker.cli --accounts pandamart --checkpoint manual --target-source master --limit 2
```

The current build environment used to prepare this package has no outbound DNS, so live marketplace calls were not executed here. These smoke tests must be run from your own machine/server before enabling the scheduler.

## Manual target file

For controlled tests before CPP upload:

```bash
python -m scraper_worker.cli --accounts shajgoj --checkpoint manual --target-source csv --targets-csv scraper_worker/targets.example.csv
```

## Twice daily

`.env` defaults to:

```env
TIMEZONE=Asia/Dhaka
SCRAPER_RUN_TIMES=10:00,18:00
```

Start the long-running worker:

```bash
python -m scraper_worker.scheduler
```

The first time is stored as `am`; the second is `pm`. Re-running the same account/date/checkpoint creates a new revision while the old run remains in history.

## Deployment

Use the included Dockerfile on a persistent worker/container service. Do not run the browser scraping process inside a normal Vercel request. Vercel continues to host Next.js; the worker connects directly to the same Supabase project.

## Next CPP phase

When account CPP files are uploaded, we will:

1. parse account SKU + approved price (+ branch for Pandamart when applicable),
2. version/activate each account's CPP reference set,
3. use those active CPP rows as the scraper target list instead of the current master fallback,
4. compare each AM/PM observation to the approved CPP,
5. show/export exceptions in the Next.js CPP dashboard.
