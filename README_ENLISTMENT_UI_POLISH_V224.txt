UBL V2 v2.24.0 — Enlistment UI Polish

Scope
-----
A cleaner, more polished Enlistment Panel without turning it into an overly visual dashboard.

No Supabase/database/API changes are required.

Files
-----
- components/EnlistmentPanel.tsx
- app/globals.css

Main improvements
-----------------
- Added a compact workflow-health summary with overall completion.
- Added clearer KPI cards for enlisted, in-progress, completion and attention-needed tasks.
- Added account-wise enlistment progress cards.
- Cleaned up filter placement into a dedicated workbench.
- Split bulk account assignment and account export into two clear action cards.
- Improved product table hierarchy:
  - product marker
  - product-level enlistment progress
  - progress bar
  - clearer attention state
  - improved status grouping
- Improved product drawer with a compact progress summary.
- Kept existing import, manual account selection, status tracking, Daraz-specific fields and export logic unchanged.
- Kept the page operational rather than making it overly flashy.

Validation
----------
The updated EnlistmentPanel.tsx passed TypeScript syntax transpilation.
Run the full Next.js production build in the real project before deployment.

Install
-------
Extract over the current project and run:

npm run build

If successful:

git add components/EnlistmentPanel.tsx app/globals.css
git commit -m "Polish enlistment panel UI"
git push
