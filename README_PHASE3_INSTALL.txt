Unilever Stock Intelligence System — SoS Phase 3 (Pandamart) v2.16.0
====================================================================

This is a PATCH-ONLY package. Overlay it on top of the current v2.15 application.

What Phase 3 adds
-----------------
- SoS -> Pandamart Report navigation.
- Uses the Phase 1 Pandamart keyword library as the scraper source.
- Branch-aware Pandamart GraphQL search scraping.
- Supports the 10 branches for which proven Pandamart vendor IDs are currently available.
- Top 4 classification per branch + search term:
    TARGET UBL
    UBL - NON TARGET
    COMPETITOR
- UBL Share of Search and Target Achievement remain separate measurements.
- Run a single selected branch first, or all configured branches.
- Branch comparison table.
- Branch / Format / Main Keyword / Search Term / Result Type filters.
- Historical SoS runs continue to use the generic Phase 2 SoS tables.

Important branch coverage
-------------------------
The proven standalone Pandamart search scraper contains vendor IDs for 10 branches:
Bashundhara, Dhanmondi, Gulshan 1, Gulshan 2, Uttara, Mohammadpur,
Mirpur 02, Wari, Rampura and Mogbazar.

Current store branches still missing search vendor IDs are shown in the UI instead of being silently skipped.
Central DC is not treated as a customer-facing search branch.

Database
--------
No new database objects are required for Phase 3. The generic branch-aware tables created in Phase 2
(sos_runs, sos_term_runs, sos_search_results and sos_run_targets) already support branch_code / branch_name.

Recommended verification
------------------------
1. Confirm the Pandamart keyword set has already been imported in SoS -> Keywords & Targets.
2. Open /sos/pandamart.
3. Keep Uttara selected and click Run selected branch.
4. Inspect Bodywash and one other keyword to verify TARGET UBL / UBL non-target / competitor classifications.
5. Only after the single-branch run looks correct, click Run all 10 branches.

Local validation commands after overlay
---------------------------------------
npm install
npm run typecheck
npm run build
