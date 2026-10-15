Unilever Stock Intelligence System — SoS Phase 2 / v2.15
=========================================================

This is a PATCH-ONLY package and assumes v2.14 Phase 1 is already installed.

IMPORTANT
---------
The Phase 2 Supabase schema has already been created in the live project.
Do NOT manually run the SQL migration against the live database.
The migration file is included only so the application source stays reproducible.

Before the first Phase 2 run
----------------------------
1. In SoS -> Keywords & Targets, select Shajgoj.
2. Upload Shajgoj Keywords.xlsx.
3. Preview it.
4. Click "Import this keyword set".
5. Resolve target mappings where practical. Any unresolved target rows will be shown as a warning on the Shajgoj report.

Install the patch
-----------------
Extract this ZIP over the current project root and allow overwrites.

Then run:
  npm install
  npm run typecheck
  npm run build

Open:
  /sos/shajgoj

Click:
  Run Shajgoj SoS scrape

The report uses the top 4 search results per active Shajgoj search term.

Definitions
-----------
UBL SoS = UBL positions in top 4 / 4 per successful searched term.
Target Achievement = assigned target products found / assigned target products per successful searched term.

A UBL product that is NOT assigned to the keyword still helps UBL SoS, but does not help Target Achievement.

Notes
-----
- Failed search terms are excluded instead of being interpreted as zero SoS.
- Every run is preserved historically.
- Target assignments are snapshotted at run time.
- Phase 3 will add Pandamart branch-aware SoS using the same runtime foundation.
