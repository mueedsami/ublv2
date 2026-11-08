# UBL — Sales & Stock / OLA separation

## Scope and files

Copy the `app/` and `components/` directories **from this patch** into the root of your Next.js UBL app, preserving relative paths. **Do not replace the whole app directory**; copy only the listed files. Existing APIs, Supabase keys, uploaded stock/sales data and scraper runner files are unchanged.

New routes:
- `/ola/<account>` for daraz, arogga, othoba, shwapno, shajgoj, pandamart, cartup, ushop, foodi
- `/api/ola/history?account=<account>` scraped-history report

Updated:
- `components/AppShell.tsx`: top-level **Sales & Stock** group links to existing account routes; independent **OLA** group links to `/ola/<account>`.
- `components/AccountOlaHistory.tsx`: daily and monthly histories, filtering, exporting, explicit Unknown counts, latest and monthly KPIs.
- Five existing account panels: legacy daily/monthly OLA tabs hidden from Sales & Stock navigation (their underlying reports/API retained; overview still includes some legacy commercial OLA indicators). 
- Five account page headings updated to Sales & Stock.

Database change **already applied to the connected Supabase project**: `public.v_ola_scraped_run_metrics`, a run-level aggregation of existing scraper data. No old records were deleted or rewritten. SQL is provided in `supabase/ola_scraped_run_metrics.sql` for reproducibility, but **you do not need to run it again** for the connected project.

## Data behavior
- Scraped OLA derives from `ola_scrape_runs` and `ola_scrape_observations`, not uploaded sales/stock files.
- One snapshot per Bangladesh calendar date and account: latest success for that day; if no success, latest partial run.
- Daily OLA = available rows / (available + unavailable). Unknown does NOT count as OOS.
- Monthly average = arithmetic mean of daily OLA values on days with confirmed statuses. No data days are NOT counted as zero.
- Scrape retries are kept in the database but not double-counted as separate calendar days.
- Historical uploaded-stock OLA (where available in old APIs) is available under **Historical uploaded OLA** in each OLA account page, separate from scraped metrics. It uses preexisting daily and monthly values.
- The old Sales & Stock account dashboards are intact, except their separate daily/monthly OLA tabs are removed from navigation. Their commercial overview may still show old stock-derived availability indicators until a later full component refactor.
- Existing Central Availability continues using its current source configuration. Scraper output and uploads do not change.

## Install and smoke test
1. Back up the working app (or commit Git changes).
2. Copy patch files to matching paths. Do not delete other files.
3. In the **Next.js root**: `npm run dev` (restart dev server). No new packages needed.
4. Sidebar should have Sales & Stock (old account pages) and OLA (new pages).
5. Open `/ola/cartup`: should show its recorded scraped run, known/unknown split and monthly average.
6. Open `/ola/shajgoj`: use Scraped OLA and Historical uploaded OLA to compare source histories.
7. Open `/daraz`: Sales & Stock tabs remain. Check existing stock/movement data.
8. Verify `/api/ola/history?account=cartup` returns JSON `daily` and `monthly`.
9. Optionally run `npm run build` for full type checking with your local dependencies.

## Not performed
No local Next.js build (the uploaded project snapshot contains no package manifest/dependencies). No browser deployment verification. Supabase aggregate view itself was created and queried successfully.
