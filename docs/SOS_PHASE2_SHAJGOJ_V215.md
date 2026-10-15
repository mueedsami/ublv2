# SoS Phase 2 — Shajgoj Search Intelligence (v2.15)

Phase 2 connects the Phase 1 Shajgoj keyword/target library to a real search run and a historical in-app report.

## Flow

1. Import and confirm the Shajgoj keyword workbook in **SoS → Keywords & Targets**.
2. Resolve target products as far as practical. Unresolved workbook targets are not silently guessed.
3. Open **SoS → Shajgoj Report**.
4. Click **Run Shajgoj SoS scrape**.
5. The server reads the active Shajgoj search terms from Supabase and queries `https://khoj.shajgoj.com/products` for the top 4 results per term.
6. Every result is classified and committed to a historical run.

## Classification

Each top-4 result is one of:

- `target_ubl` — UBL product and one of the products explicitly assigned to the main keyword.
- `ubl_non_target` — UBL product, but not one of that keyword's assigned target products.
- `competitor` — not matched to the approved UBL product master.

UBL matching order:

1. exact Shajgoj marketplace SKU from the current V2 account mapping;
2. exact normalized product name in the active UBL product master;
3. conservative strong-name + pack-size match.

Target matching uses the Phase 1 assignment by basepack/SKU. The active target list is snapshotted into each run, so historical Target Achievement does not change if target assignments are edited later.

## Metrics

For a successful search term:

- **UBL SoS** = UBL products in the top 4 / 4.
- **Target Achievement** = distinct assigned target products found in the top 4 / assigned target products.
- **UBL non-target** products improve UBL SoS but do not improve Target Achievement.

At main-keyword level, the report aggregates all successful search terms belonging to that main keyword. Failed scraper terms are excluded from SoS/Target Achievement and shown as errors rather than being treated as zero visibility. A successful search that genuinely returns fewer than four results still uses four top slots, preserving the existing SoS definition.

## Dashboard

The Shajgoj report includes:

- historical run selector;
- one-click Shajgoj scrape;
- UBL SoS and Target Achievement KPIs;
- target UBL, UBL non-target and competitor counts;
- filters for format, main keyword, searched term, result type and product search;
- needs-attention cards;
- main-keyword performance table;
- per-search-term performance table;
- full top-4 result detail with SKU, price, stock, product URL and UBL match method.

## Database

New generic SoS runtime tables:

- `sos_runs`
- `sos_run_targets`
- `sos_term_runs`
- `sos_search_results`

New views:

- `v_sos_term_metrics`
- `v_sos_keyword_metrics`

Commit RPC:

- `commit_sos_run_v1(payload jsonb)`

The tables use RLS and are intentionally backend/service-role only, consistent with the existing internal V2 application. The views use `security_invoker = true`.

## Phase 2 boundary

This release implements Shajgoj only. Pandamart branch-aware SoS is Phase 3. The runtime schema is account-generic so Pandamart can reuse the same run/result history without redesigning the data model.
