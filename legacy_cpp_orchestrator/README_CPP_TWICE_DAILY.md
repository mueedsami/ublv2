# CPP Twice-Daily Price Compliance

This update reuses the existing marketplace scrapers and replaces the old Excel-only CPP comparison flow with a Supabase-backed price compliance history.

## Business rule

For each CPP target:

- **OK**: actual marketplace price <= expected CPP price
- **Half Issue**: actual price is above CPP, but within the configured tolerance (default 1%)
- **Issue**: actual price is above CPP by more than the tolerance
- **Unavailable**: product is found but unavailable / OLA is false
- **Missing**: the target SKU/Product ID was not returned by the scraper
- **Error**: scraper returned an error for the target

`OK` and `Half Issue` are treated as compliant. Missing, unavailable and error rows are kept separate from the real-price compliance denominator.

For Shajgoj the actual price is `Sale Price` when present, otherwise `Price`.
Pandamart remains branch-wise.

## Important architecture

CPP targets are intentionally independent from the OLA/master scope.

A SKU/Product ID can be uploaded to CPP and scraped even if it has not yet been mapped into the master catalog. If a master mapping exists, the dashboard enriches the CPP target with basepack, UBL SKU, brand and category.

## 1. Upload a CPP reference file

Open the dashboard **Price / CPP** page.

Choose an account, effective date and tolerance, then upload the account CPP Excel file.

The parser looks for:

- the marketplace SKU/Product ID for that account
- expected/reference price
- optional product name, brand, category, URL and tolerance
- optional branch for Pandamart

Preview the file first, then activate it.

Activating a new reference file replaces the previous live reference set for that account without deleting the old historical set/checks.

## 2. Run the scraper manually

From the collector project root:

```bash
python -m ubl_collector.cli cpp --accounts all --checkpoint manual
```

Specific accounts:

```bash
python -m ubl_collector.cli cpp --accounts arogga,shajgoj --checkpoint manual
```

Run the AM slot manually:

```bash
python -m ubl_collector.cli cpp --accounts all --checkpoint am
```

Run the PM slot manually:

```bash
python -m ubl_collector.cli cpp --accounts all --checkpoint pm
```

Re-running the same account/date/checkpoint creates a new revision and supersedes the previous current run. Historical revisions remain in Supabase.

## 3. Twice-daily scheduler

Set exactly two times in `.env`:

```env
TIMEZONE=Asia/Dhaka
CPP_RUN_TIMES=10:00,18:00
```

Then run:

```bash
python -m ubl_collector.scheduler
```

The first configured time is stored as the `am` checkpoint and the second as the `pm` checkpoint.

Change the times to your operational requirement, for example:

```env
CPP_RUN_TIMES=09:30,17:30
```

The scheduler deliberately requires exactly two times so CPP cannot silently run only once per day.

## 4. Supabase credentials for the collector

Use a backend-only Supabase key:

```env
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SECRET_KEY=<secret-key>
```

Legacy projects can continue using:

```env
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Never expose either backend key in browser code.

## 5. Dashboard

The **Price / CPP** page shows:

- today's compliance KPI
- real issues
- valid checks
- missing / unavailable / error count
- AM vs PM price/status matrix
- expected CPP vs actual price difference
- account/branch summary
- recent scraper run history
- currently active CPP reference sets

## 6. Supported scraper accounts

The current original scraper bundle supports CPP for:

- Arogga
- Daraz
- Othoba
- Pandamart
- Shajgoj
- Shwapno

Pandamart CPP currently supports the branches available in the original web scraper:

- Bashundhara
- Dhanmondi
- Gulshan
- Gulshan 2
- Mirpur 02
- Mirpur 03
- Mogbazar
- Mohammadpur
- Rampura
- Uttara
- Wari

## 7. Starting from today

The database and code are ready to record CPP history from today onward. However, a price checkpoint cannot be created until at least one CPP reference set is uploaded and activated.

Operational sequence:

```text
Upload/activate CPP reference file
        ↓
Run AM scrape
        ↓
Supabase stores AM expected-vs-actual checks
        ↓
Run PM scrape
        ↓
Supabase stores PM expected-vs-actual checks
        ↓
Dashboard shows AM/PM + history
```

## Migration note

`20261004141939_cpp_twice_daily_price_monitoring_023.sql` has already been applied to the current live `ubl-digital-intelligence` Supabase project. Keep the file in source control so migration history matches production; do not manually rerun it on that same project.
