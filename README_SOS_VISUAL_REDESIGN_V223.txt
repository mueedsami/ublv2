UBL V2 v2.23.0 — Share of Search Visual Redesign

Scope
-----
Heavy presentation-first redesign of the current SoS suite:
- Keyword & Target Product Library
- Shajgoj SoS
- Pandamart SoS
- Othoba SoS

No Supabase schema change and no scraper/backend logic change are required.

Files replaced / added
----------------------
- components/SosVisuals.tsx             (NEW shared visual layer)
- components/SosKeywordManager.tsx
- components/SosShajgojReport.tsx
- components/SosPandamartReport.tsx
- components/SosOthobaReport.tsx
- app/globals.css

Major UI changes
----------------
1. SoS report pages now begin with a presentation-style hero:
   - UBL Share of Search ring
   - Target Achievement ring
   - run context
   - measured top-slot context

2. Dedicated filter workbench:
   - moved immediately below the executive KPIs
   - consistent reset button
   - account-specific filters retained
   - all existing filter behavior preserved

3. Search-result composition:
   - Target UBL
   - UBL non-target
   - Competitor
   shown as one visual composition.

4. Keyword visibility pressure:
   - weakest Target Achievement first
   - paired UBL SoS + Target Achievement bars
   - clickable drill-down into the selected keyword.

5. Executive readout:
   - strongest keyword/branch
   - largest target gap
   - UBL non-target visibility
   - search health / failed checks.

6. Pandamart receives extra emphasis:
   - branch visibility comparison
   - branch-aware dual-metric leaderboard
   - strongest branch / weakest target branch callouts
   - keyword pressure inside the current branch/filter scope
   - existing branch tables and branch-aware scraper controls preserved.

7. Keyword & Target Product Library:
   - presentation hero per account
   - target coverage ring
   - mapping-readiness ring
   - assigned/unresolved/untargeted summary
   - existing import, manual assignment and removal workflows preserved.

Metric semantics preserved
--------------------------
UBL Share of Search:
  approved UBL positions / measured top-N slots.

Target Achievement:
  assigned target products found / target opportunities.

UBL non-target positions improve UBL SoS but do not count toward Target Achievement.
Failed terms/checks remain excluded rather than being counted as zero.

Validation
----------
All five changed TS/TSX files passed TypeScript syntax transpilation.
A full Next.js production build still needs to be run inside the real project.

Install
-------
Extract this patch over your current project and run:

npm run build

If successful:

git add components/SosVisuals.tsx components/SosKeywordManager.tsx components/SosShajgojReport.tsx components/SosPandamartReport.tsx components/SosOthobaReport.tsx app/globals.css
git commit -m "Redesign Share of Search dashboards"
git push
