# SoS Phase 4A — Othoba v2.17.0

Othoba is implemented on the generic SoS run model created in Phase 2.

## Data flow

Othoba keyword import -> active search terms -> Othoba HTML search -> Top 4 -> UBL master match -> target match -> historical SoS run -> report.

## Search behavior

The integrated scraper mirrors the supplied standalone Othoba scraper:

- `https://othoba.com/ts/search/<keyword>?t=t&q=<keyword>`
- a browser-like session is warmed first
- only `h4.product-name` nodes are accepted as products
- price is read from `.actual-price`
- old/reference price is preserved inside raw data
- results are processed sequentially with pacing and retry/backoff

## Metrics

UBL SoS remains `UBL positions in top 4 / 4` per successful search term.

Target Achievement remains `expected target products found / assigned targets` per successful search term.

UBL products outside the keyword target assignment are classified `ubl_non_target`: they improve UBL SoS but not Target Achievement.

## Import compatibility

Othoba V2 master IDs commonly use the `UNFS` prefix, while the provided keyword workbook may contain the numeric ID only. The Phase 4 patch treats those forms as equivalent for direct target mapping.
