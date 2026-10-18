# UBL CPP v2.28.1 — Progress + Parallel Account Runner

This is a patch on top of v2.28.0.

## What changed

### Progress for every account
All account runs now print progress while targets are being processed.

Examples:

```text
[daraz] progress 25/341 targets (7.3%) | observations=25 | ok=18, issue=4, unavailable=3
[shajgoj] progress 50/135 targets (37.0%) | observations=50 | ok=...
[arogga] progress 10/80 targets (12.5%) | observations=10 | ...
```

The worker also prints explicit stages for:
- loading CPP targets
- opening the CPP run
- starting scrape
- CSV export
- Supabase save
- completion / failure

Additional catalog loading visibility was added for:
- Pandamart branch catalogs
- Othoba flagship catalog
- Shwapno tag catalog

Daraz already prints seller-catalog loading details.

### Parallel account execution
Use:

```powershell
.\.venv\Scripts\python.exe -m scraper_worker.cli --accounts all --checkpoint manual --target-source cpp --export-csv --parallel --max-workers 6
```

This starts separate workers for the CPP-supported accounts at the same time:
- Arogga
- Daraz
- Othoba
- Pandamart
- Shajgoj
- Shwapno

Each account uses its own scraper adapter and Supabase client.

Accounts with no live/scrapable CPP reference are safely skipped.

### Batch file
Double-click / run:

```text
run_cpp_all_parallel.bat
```

`run_cpp_manual.bat` has also been updated to parallel mode.

### Scheduled runs
The CPP scheduler now runs the accounts in parallel as well.

Optional `.env`:

```env
CPP_MAX_WORKERS=6
CPP_RUN_TIMES=10:00,18:00
```

Then:

```powershell
.\.venv\Scripts\python.exe -m scraper_worker.cpp_scheduler
```

## Notes

Parallel means account-level concurrency, not hundreds of simultaneous requests inside one marketplace.

This is intentional:
- Daraz still loads its seller catalog efficiently once.
- Pandamart still loads each configured branch catalog once and caches it.
- Othoba still loads its flagship catalog once.
- Shwapno still loads its catalog once.
- Shajgoj and Arogga process their target SKUs independently.

This keeps the scraper safer and more stable while allowing the six marketplaces to run concurrently.
