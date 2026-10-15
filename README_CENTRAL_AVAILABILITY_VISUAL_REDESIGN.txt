UBL V2 v2.21.0 — Central Availability Visual Redesign

Scope
-----
Heavy, presentation-first redesign of Central Availability.
No Supabase schema change and no API change are required.

Replaces
--------
- components/CentralAvailabilityDashboard.tsx
- app/globals.css

What changed
------------
- Executive hero with scope OLA gauge
- Strongest account / weakest account / riskiest brand summary
- Six executive KPI cards
- Executive readout with account gap, brand risk and cross-account issue
- Ranked OLA-by-account horizontal visual
- Availability composition donut
- Lowest-performing category visual
- Account data-freshness visualization
- Cross-account critical basepack exception board
- Brand x account heatmap
- Heavy availability matrix / pivot redesign
- Click-to-focus interactions from account, category, brand and basepack visuals
- Existing filters and CSV export retained
- Not-scoped cells remain separate from OOS
- Pandamart partial branch coverage remains distinct from binary account OLA

Existing behavior preserved
---------------------------
- Existing /api/central endpoint
- Business unit/category/sub-category/brand/basepack filters
- Account selectors
- Available/unavailable filter
- Search
- CSV export
- Brand/basepack pivot
- Grouped management pivots
- Current account-specific observation dates

Validation
----------
CentralAvailabilityDashboard.tsx passed TypeScript syntax transpilation.
Run the full Next.js production build in the real project before deploying.

Install
-------
Extract over the current project, then run:

npm run build

If successful:
git add components/CentralAvailabilityDashboard.tsx app/globals.css
git commit -m "Redesign Central Availability dashboard"
git push
