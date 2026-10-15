UBL SoS Phase 4A — Othoba v2.17.0

This patch adds Othoba as the next SoS account.

Before running Othoba SoS:
1. Go to SoS -> Keywords & Targets.
2. Select Othoba.
3. Upload and preview: Othoba Search Keyword.xlsx
4. Import the keyword set.
5. Resolve important target rows if any remain in Need Review.

Then open:
/sos/othoba

Click:
Run Othoba SoS scrape

Architecture:
- Reads active Othoba search terms from Supabase.
- Warms an Othoba web session and reuses returned cookies.
- Searches the same Othoba endpoint as the proven standalone Python scraper.
- Uses h4.product-name only, avoiding navigation/category false positives.
- Saves top 4 results per search term.
- Classifies each row as TARGET UBL / UBL NON-TARGET / COMPETITOR.
- Calculates UBL Share of Search and Target Achievement.
- Stores historical runs in the generic SoS tables already created in Phase 2.
- Sequential, rate-limit-aware requests with retry/backoff.

Phase 1 compatibility improvement:
- Othoba workbook IDs such as 842869 can now directly match V2 master IDs such as UNFS842869 where applicable.

No Supabase migration is required for this patch.

After extracting over the current app:
npm run typecheck
npm run build
