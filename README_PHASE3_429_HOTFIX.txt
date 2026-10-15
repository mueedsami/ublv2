UBL SoS Phase 3 Pandamart v2.16.1 — HTTP 429 Hotfix

Cause confirmed from the saved SoS run:
Pandamart returned HTTP 429 rate-limit responses during the 400-check all-branch run.

Changes:
- Removes concurrency=6 from Pandamart search.
- Uses one request at a time, matching the proven standalone scraper.
- Reorders work as search-term -> branches, like the standalone scraper.
- Adds 400–800 ms random spacing between successful requests.
- Retries HTTP 429 up to 5 times with exponential backoff.
- Honors Retry-After when Pandamart sends it.
- Adds a 10 second cooldown only if all 429 retries for a request are exhausted.
- Keeps failed checks excluded from SoS rather than counting them as zero.
- Worker version: sos-v2.16.1-pandamart-rate-limit-safe.

No database migration is required.

Install:
Replace:
app/api/sos/pandamart/run/route.ts

Then:
npm run typecheck
npm run build

Recommended validation:
1. Run Uttara only.
2. If 40/40 succeeds, run all 10 branches.
3. The old partial 205/400 run remains historical and can be ignored.
