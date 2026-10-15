Unilever Stock Intelligence System — SoS Phase 1 (V2.14)

LIVE DATABASE
- SoS Phase 1 tables/view/function are already created in Supabase.
- Do NOT manually execute the SQL migration against the live project again.
- The migration file is included only so the repository keeps schema history.

INSTALL
1. Extract this patch into the root of your existing ubl-availability-v2 project.
2. Allow files to overwrite when prompted.
3. From PowerShell in the project root run:

   npm install
   npm run typecheck
   npm run build

4. Start/deploy the app as you normally do.
5. Open: /sos/keywords

FIRST CHECK — PANDAMART
- Choose Pandamart.
- Upload: Pandamart Search Keyword_Update.xlsx
- Click Preview import.
- Expected parser structure from the supplied file:
    Main keywords: 11
    Search terms : 40
    Target rows  : 21
- Review Auto-mapped vs Need review.
- If the preview looks correct, click Import this keyword set.
- Open Bodywash and inspect Search terms + Target products.
- Try searching for a UBL master product and manually assigning/removing it.

SECOND CHECK — SHAJGOJ
- Choose Shajgoj.
- Upload: Shajgoj Keywords.xlsx
- Expected parser structure:
    Main keywords: 6
    Search terms : 19
    Target rows  : 16

Do not move to SoS scraping/report integration until these Phase 1 checks are accepted.
