# SoS Phase 1 — Keyword & Target Product Library (V2.14)

Phase 1 adds the configuration layer required before any Share of Search scraper is integrated into the web application.

## What is included

- New sidebar section: `SoS -> Keywords & Targets`.
- Import account-wise keyword mapping workbooks in the formats currently used by Pandamart, Shajgoj, Othoba and Cartup.
- Preview the detected worksheet before committing.
- Canonical main keyword + format library.
- Account-specific search terms under each main keyword.
- Target-product assignments against the existing V2 UBL master / marketplace mappings.
- Automatic target matching by marketplace SKU first, then exact product name, then conservative product-name matching.
- Unresolved workbook target rows are retained for review rather than silently discarded.
- Manual target assignment and removal from the current account marketplace master.
- Re-importing an account replaces its active search terms and imported target assignments while preserving manual target assignments.

## Current workbook parser checks

The supplied files were parsed with the new Phase 1 parser:

| Account | Main keywords | Search terms | Target rows |
| --- | ---: | ---: | ---: |
| Pandamart | 11 | 40 | 21 |
| Shajgoj | 6 | 19 | 16 |
| Othoba | 11 | 38 | 24 |
| Cartup | 11 | 38 | 23 |

Cartup currently has one source consistency warning: its Shampoo group says `Search Listing = 3` but only two target product rows are present in the supplied workbook. The importer surfaces this as a warning instead of inventing a third target.

## Data model

- `sos_keyword_imports`: import history and audit counts.
- `sos_keywords`: canonical main keywords and formats shared across accounts.
- `sos_keyword_terms`: active account-specific search terms used by future scrapers.
- `sos_keyword_targets`: actual expected UBL target products per account and main keyword.
- `sos_import_target_candidates`: every target row from the workbook, including unresolved rows.
- `v_sos_product_lookup`: service-role-only marketplace product lookup backed by the current V2 master.
- `commit_sos_keyword_import_v1(jsonb)`: atomic keyword import commit function.

All new tables have RLS enabled. The application continues the current internal-server pattern: `anon` and `authenticated` have no access, while the server-side service role performs the operations.

## Import behaviour

1. Select an account.
2. Upload the existing `.xlsx` account keyword workbook.
3. Preview counts, warnings, detected search terms and target matching.
4. Commit the keyword set.
5. Open any keyword from the library.
6. Review its search terms.
7. Review imported target products and unresolved workbook targets.
8. Search the current V2 marketplace master and manually add/remove targets when required.

The upload itself does **not** run any search scraper. Scraper integration begins in Phase 2.

## Phase 2 hand-off

The scraper should read active rows from `sos_keyword_terms`, execute each account's search logic, and store ranked results. Results will then be classified as:

- Target UBL
- UBL — non-target
- Competitor
- Unmatched

The first scraper/dashboard implementation should prioritize Shajgoj and Pandamart as agreed.
