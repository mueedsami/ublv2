UBL V2 v2.22.0 — Account Intelligence Visual Redesign

Scope
-----
Heavy UI/UX redesign of all current account-wise OLA/intelligence pages:
- Pandamart
- Shajgoj
- Foodi
- Othoba
- Daraz

Primary focus: operational Flags pages for Pandamart, Shajgoj and Othoba.

No Supabase schema migration or API change is required.
Existing account APIs and business calculations are preserved.

Main improvements
-----------------
1. Consistent account page structure
   - presentation-style hero
   - executive KPIs
   - visual OLA pulse / ranking charts
   - operational watchlists
   - detailed tables below visuals

2. Filter placement fixed
   - filters are no longer squeezed into table/card headings
   - dedicated workbench/filter cards sit above the affected table
   - search + status + brand/filter controls use the same layout across accounts
   - reset and export actions are placed consistently

3. Flags pages rebuilt as action centers
   Pandamart, Shajgoj and Othoba now include:
   - action-center hero
   - critical/warning/watch/positive KPI cards where supported
   - severity composition visual
   - flag-type frequency visual
   - critical priority queue
   - dedicated flag workbench with search/severity/type filters
   - richer metric chips in the flag table
   - account-specific flag-rule explanation

4. Foodi and Daraz
   These accounts do not currently have formal database flag engines, so this patch does NOT invent new formal flags.
   Instead their overview pages include operational watchlists derived only from data already returned by their APIs:
   - Foodi: unavailable basepacks with rolling-30D demand
   - Daraz: mapped low-stock basepacks
   These are explicitly labelled watchlists, not formal flags.

5. Daraz semantic protection
   Stock depletion remains labelled "implied depletion" / observed stock movement and is never renamed to sales.

Files
-----
components/AccountVisuals.tsx
components/PandamartPanel.tsx
components/ShajgojPanel.tsx
components/FoodiPanel.tsx
components/OthobaPanel.tsx
components/DarazPanel.tsx
app/pandamart/page.tsx
app/shajgoj/page.tsx
app/foodi/page.tsx
app/othoba/page.tsx
app/daraz/page.tsx
app/globals.css

Validation
----------
All new TSX files passed TypeScript syntax transpilation in the build environment.
A full Next.js production build must still be run in the actual project.

Install
-------
Extract this patch over the current v2 project, then run:

npm run build

If successful:

git add components/AccountVisuals.tsx components/PandamartPanel.tsx components/ShajgojPanel.tsx components/FoodiPanel.tsx components/OthobaPanel.tsx components/DarazPanel.tsx app/pandamart/page.tsx app/shajgoj/page.tsx app/foodi/page.tsx app/othoba/page.tsx app/daraz/page.tsx app/globals.css
git commit -m "Redesign account intelligence and flags pages"
git push
