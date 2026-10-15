UBL V2 v2.24.1 — Enlistment UI Repair

This is a corrective UI patch based on the real rendered screenshots.

Problems fixed
--------------
- Removed the redundant second KPI section that was stacking as four giant full-width cards.
- Kept one compact Workflow Health summary as the only top KPI surface.
- Rebuilt the Product Workbench filters as a proper 3-column grid with styled search/select controls.
- Rebuilt Bulk Assignment account selectors as compact selectable pills instead of raw browser checkboxes.
- Tightened Account Progress into a compact status strip.
- Reduced table width/spacing and improved product/status hierarchy.
- Added explicit status colors for Pending/Ready/Sent/Under Review/Enlisted/Correction/Rejected.
- Rebuilt Recent Exports into structured rows with file icon, filename, account, format, row count and date.
- Improved responsive behavior.

No database/API/business logic changes.

Files
-----
- components/EnlistmentPanel.tsx
- app/globals.css

Validation
----------
EnlistmentPanel.tsx passed TypeScript syntax transpilation.
Run the full project production build after applying.

Install
-------
Copy over the two files and run:

npm run build

Then check /enlistment again.
