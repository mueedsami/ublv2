# SoS Phase 3 — Pandamart branch-aware search intelligence

Phase 3 reuses the generic SoS storage introduced in Phase 2 and adds a Pandamart search runner and report.

## Measurement

Each active Pandamart search term is searched within each selected configured Pandamart branch.
Only the first four results are measured.

Every returned result is classified as:

- `target_ubl` — a UBL product that is assigned as an expected target for the main keyword.
- `ubl_non_target` — a UBL product, but not one of that keyword's assigned target products.
- `competitor` — no conservative match to the current active UBL product master.

`UBL SoS = UBL positions / Top-4 slots`.

`Target Achievement = expected target appearances found / expected target opportunities`.

A UBL non-target result improves UBL SoS but does not improve Target Achievement.

## Branch coverage

The recovered and previously working standalone Pandamart search scraper supplied proven vendor IDs for 10 branches. Phase 3 intentionally uses only those proven mappings. It does not invent vendor IDs for the remaining branches.

The report API compares those configured branches against `pandamart_branches` and shows store branches still waiting for a search vendor ID. Central DC is excluded from customer-search coverage.

## Run strategy

The report page has two execution paths:

- **Run selected branch** — recommended for validation and quick checks.
- **Run all configured branches** — full branch comparison. With 40 current search terms and 10 configured branches this means 400 branch × term requests.

The route uses bounded concurrency, one retry, and a five-minute server max duration. If hosted serverless limits are tighter, the same logic can later be moved into the local scraper worker without changing the database/report model.

## Historical integrity

Target assignments are snapshotted into `sos_run_targets` for every run. Later changes to keyword target assignments therefore do not rewrite older Pandamart reports.
