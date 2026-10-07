# UBL Availability V2.3

A deliberately small availability system:

**Master Data → Daily Stock Dump → Basepack Availability**

## Core business model

- `Packsize` = **Basepack** and is the base identity used for availability.
- `UBL Code` = a SKU/product underneath a basepack.
- One basepack can have multiple UBL SKUs (regular, CP/promo, etc.).
- Marketplace/account SKU IDs remain attached to the relevant UBL SKU rows from the master.
- Availability is rolled up to basepack level: if **any mapped SKU under a basepack has stock > 0**, the basepack is Available for that account.

On the supplied master workbook:

- 236 UBL SKU rows
- 229 unique basepacks (`Packsize`)
- 1,601 account-ID mappings

## Master fields preserved

The importer reads the exact master structure and stores:

- `UBL Code`
- `Sku Updated Perfect Name`
- `Status`
- `Brand`
- `TP`
- `MRP`
- `SKU`
- `TYPE OF WEIGHT`
- `WEIGHT`
- `BUSINESS GROUP`
- `Type`
- `Retail Type`
- `Packsize` → Basepack
- `UBL CAT`
- `Sub Category`
- `VARIANT`
- `Description`
- `Highlights`
- `Updated Hero Image`
- all recognized account ID columns

Recognized account columns:
`Daraz`, `Pandamart`, `Shajgoj`, `Cartup`, `Othoba`, `Foodimart`, `Chaldal`, `Rokomari`, `Ogerio`, `Chardike`, `Arogga`, `Meena Bazar`, `Shwapno`.

Blank account cells mean the basepack/SKU is not listed through that master row for the account.

## Availability logic

For a basepack and account:

- No account ID under any active SKU in that basepack → **Not Listed**
- Account ID exists but no stock dump has ever been uploaded → **No Data**
- Any mapped account SKU has stock > 0 in the latest dump → **Available**
- Listed, but all mapped account SKUs are absent/zero in latest dump → **Out**

The KPI denominator is **basepacks**, not SKU rows.

## Availability filters

The main Availability page can filter by:

- Account
- Business Group
- UBL Category
- Sub Category
- Brand
- Basepack (`Packsize`)
- Type
- Retail Type
- Variant

The search box also searches basepack and hierarchy values.

## Pages

- `/` — basepack availability matrix + account summary + hierarchy filters
- `/uploads` — Master Data and Daily Stock only
- `/master` — read-only basepack/SKU master

## Daily stock workflow

1. Choose account.
2. Choose stock date.
3. Upload `.xlsx`.
4. Choose sheet.
5. Choose marketplace SKU/Product ID column.
6. Choose stock column(s).
7. Preview basepack availability.
8. Commit.

Duplicate stock rows are aggregated first. Sales columns are ignored.

## Live Supabase project

This project points only to the new separate database:

- Project: `UBL Availability V2`
- Project ref: `swuogverexpxefenoujq`
- Region: `ap-south-1`
- API URL: `https://swuogverexpxefenoujq.supabase.co`

The previous UBL database is not referenced or modified.

The V2.1 basepack schema has already been applied to that new Supabase project.

## Environment

Copy `.env.example` to `.env.local` and set the server secret key for the **new V2 project**:

```text
SUPABASE_URL=https://swuogverexpxefenoujq.supabase.co
SUPABASE_SECRET_KEY=...
```

## Run

```bash
npm install
npm run dev
```

## Database

Seven small tables:

- `accounts`
- `basepacks`
- `products`
- `product_account_ids`
- `master_imports`
- `stock_uploads`
- `stock_rows`

Primary reporting views:

- `v_basepack_availability`
- `v_account_availability_summary`
- `v_master_skus`
- `v_product_availability` (SKU drill-down support)
- `v_account_mappings`

## Excel reader

V2.1 keeps the dependency-free Node XLSX reader introduced in 2.0.1. It does not use ExcelJS, `unzipper`, AWS SDK, or SheetJS.

## V2.1.1 master import fix

If you were on V2.1.0 and `/api/master/commit` returned `Master import failed.`, update to V2.1.1. The live V2 Supabase project already has the safe full-master replacement fix.

## V2.2 Pandamart daily stock profile

Pandamart daily files are now auto-configured. The app uses only `Store Wise Stock T-1 Day`, reads the T-1 date from the workbook, maps by `sku`, sums all customer-facing store stock columns, and explicitly excludes `DC`. See `docs/PANDAMART_DAILY_STOCK_PROFILE.md`.


## Pandamart V2.3
Pandamart daily workbooks now preserve branch-wise stock history and day-wise sales. Branch OLA is stored daily and rolled into monthly history; DC is excluded from OLA but retained for flags. See `docs/PANDAMART_V23_HISTORY_AND_FLAGS.md`.

## v2.3.1 UI organization

Pandamart intelligence now has its own `/pandamart` sidebar page. The existing Pandamart data is split into in-page tabs: Overview, Branch OLA, Flags, Daily History, and Monthly History. This release changes UI organization only; no database, API, parser, upload, OLA, or flag logic changed.

## V2.4 — Shajgoj sparse history

Shajgoj now has a locked workbook profile and dedicated `/shajgoj` drill-down. The upload date represents `Total Stock QTY`; cumulative month-to-date sold quantity is read through X-1. Missing stock dates are not fabricated. Daily/monthly OLA and month-by-month cumulative sales history are stored separately. See `docs/SHAJGOJ_V24_SPARSE_STOCK_SALES.md`.


## V2.5 Foodi

Foodi is now a first-class account intelligence module. A Foodi workbook uses the selected stock date X for `Total Stock`, while `30 Day Sale Qty` is stored as a rolling 30-day sales snapshot ending on X-1. The system preserves sparse observed dates, freezes basepack OLA against the active Foodi master scope at upload time, and exposes current stock, rolling 30-day sales, daily OLA, and monthly OLA views.

Database objects: `foodi_stock_daily`, `foodi_sales_30d`, `foodi_basepack_daily`, `commit_foodi_upload_v2`, `v_foodi_daily_ola`, `v_foodi_monthly_ola`, `v_foodi_sales_30d_summary`, and `v_foodi_current_basepacks`.


## Othoba V2.6
Othoba now supports current stock/OLA, Sales & Stock period snapshots, and aggregated detailed monthly sales reports. See `docs/OTHObA_V26_DUAL_SALES.md`.


## Daraz v2.7
Dedicated Normal-SKU stock/valuation history, mapped basepack OLA, and observation-to-observation implied depletion/replenishment analytics.

## V2.8 — Central Availability + Pivot

The home dashboard now normalizes Pandamart, Shajgoj, Foodi, Othoba and Daraz into one central basepack layer. It supports cascading Business Unit → Category → Sub-category → Brand → Basepack filters, account toggles, filtered Central OLA, filtered account-wise OLA, a brand summary, lowest-availability exceptions, and a Pivot tab with Brand → Basepack or management rollup dimensions.

Central OLA excludes unmapped account/basepack combinations. Pandamart contributes branch coverage per basepack; the other four account modules contribute binary availability.
