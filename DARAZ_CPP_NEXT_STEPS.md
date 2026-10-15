# Daraz CPP — Next Steps

The active CPP reference set is the source of truth. The worker reads Daraz targets from `v_cpp_scrapable_targets`.

## 1. Smoke test

```powershell
.\run_daraz_cpp_smoke.bat
```

This scrapes 5 active Daraz CPP targets and writes a CSV under `scraper_outputs/YYYY-MM-DD/`.

## 2. Review smoke output

Expected columns include account SKU, product, live price, original price, status, URL and timestamp.

Good statuses: `ok`. Diagnostic statuses such as `missing`, `price_missing`, or `error` must be reviewed before full run.

## 3. Full run

Morning:
```powershell
.\run_daraz_cpp_am.bat
```

Evening:
```powershell
.\run_daraz_cpp_pm.bat
```

The full run uses all active Daraz rows from the CPP set (currently 341). It does not write observations to Supabase because manual CSV upload is the chosen Phase-1 workflow.

## 4. Important

The local `.env` must contain the real backend Supabase key because the worker needs to read the active CPP target view. Keep this key local and never commit `.env`.
