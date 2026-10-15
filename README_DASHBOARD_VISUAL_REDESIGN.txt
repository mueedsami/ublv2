UBL V2 v2.20.0 — Dashboard Report Visual Redesign

Scope
-----
Presentation-first redesign of /dashboard-report only.
No database or API changes are required.

Replaces:
- components/DashboardReport.tsx
- app/globals.css

What changed
------------
- Presentation-style product hero
- Six executive KPI cards
- Executive readout / key takeaways
- Stock value by account visual
- MTD sales value by account visual
- Account contribution stacked bars
- Marketplace snapshot cards
- Data freshness visual
- Clickable account focus/filter interactions
- Analyst-detail table kept below the visuals
- Methodology moved into a cleaner presentation section
- Responsive tablet/mobile layouts

Existing behavior preserved
---------------------------
- Basepack-across-accounts mode
- Account SKU lookup mode
- Month and as-of controls
- Product search
- CSV export
- Existing API contracts and value calculations
- Foodi rolling-30D warning/comparability treatment

Validation
----------
The redesigned DashboardReport.tsx passed TypeScript syntax transpilation.
A full Next.js production build must still be run in the actual project.

Install
-------
Extract this patch over the current project, then run:

npm run build

If successful:
git add components/DashboardReport.tsx app/globals.css
git commit -m "Redesign dashboard report UI"
git push
