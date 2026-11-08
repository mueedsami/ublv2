# UBL OLA — Month-first Daily Matrix & Account Trend Charts

## Install

Back up your existing files first. Copy these paths into the **Next.js project root** (not into `the scrapers for ola`):

- `app/ola/page.tsx` — changes `/ola` from Daraz redirect into OLA Monthly Overview.
- `app/api/ola/overview/route.ts` — month-scoped, paginated Supabase reporting API.
- `components/OlaMonthlyOverview.tsx` — calendar-day by account matrix, monthly averages, charts and CSV export.
- `components/AccountOlaHistory.tsx` — account-specific month selection and chart. Uses the catalog-based version of the existing history component as a base.
- `components/AppShell.tsx` — adds **Monthly Overview** under OLA, retaining your requested sidebar ordering and adding BeautyBooth.

Run `npm run dev` in the Next.js root. Open `/ola`. Choose a month. Click account headers for account-level history.

## Logic

- **One month at a time.** Each row of the matrix is a calendar day for the selected month. Accounts are columns, alphabetically sorted.
- Daily OLA is the percentage of available observations among observations having a **confirmed** available or unavailable status. Unknown rows are excluded from the percentage denominator.
- **One run per account/day:** latest successful snapshot; if none succeeded that day, use the latest partial snapshot.
- **Monthly average** is the *unweighted arithmetic average* of daily confirmed OLA percentages in that month. No scrape or unknown-only scrape gives a missing value, not 0%.
- Account charts follow the same chosen month and include gaps for days without confirmed OLA.
- BeautyBooth and Ushop remain catalog-based accounts: their percentages represent catalog observations, not mapped basepacks. Data from other accounts remains master-linked.
- Source is existing `public.v_ola_scraped_run_metrics`; no Supabase schema changes, uploads, Sales & Stock, CPP, SOS, Enlistment, or scraper changes.
- `/ola` displays monthly report; `/ola/<account>` retains daily records and historical uploaded-OLA mode when applicable. Export is CSV.

## Validation

TypeScript/JSX transpile diagnostics checked; syntax passed. The existing `v_ola_scraped_run_metrics` view was previously confirmed live in Supabase. Full Next.js build and browser testing need to be performed locally because the latest full Next.js working tree isn't available here.

## Caution

`components/AccountOlaHistory.tsx` is sourced from the most recent catalog-based integration ZIP available in this conversation. If you've changed this component locally since that patch, merge the new `month` default and daily trend chart rather than overwriting unrelated changes. The same applies to `AppShell.tsx`.
