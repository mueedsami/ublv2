UBL V2 v2.26.0 — Account Pages Refinement

This patch consolidates the latest account UI work for:
- Daraz
- Pandamart
- Shajgoj
- Foodi

It also includes the shared AccountVisuals update and the latest account-page CSS.

Daraz
-----
- Keeps implied depletion explicitly separate from confirmed sales.
- Adds a compact number strip for:
  - available basepacks
  - OOS basepacks
  - low-stock watch count
  - observation gap
- Replaces the repetitive low-stock cards with a ranked compact operational watchlist.
- Low-stock rows are now visually distinct from healthy Available rows.
- Uses the newer line/area OLA trend instead of the old chunky scrolling bars.

Pandamart
---------
- Replaces the duplicate OLA donut in the hero with a Branch Health panel:
  - healthy branches >=80%
  - watch branches 70–79%
  - critical branches <70%
  - network coverage
- Adds a compact branch-health number strip.
- Priority queue now diversifies critical issues by flag type before repeating the same rule.
- Cleans business labels:
  - DC Stock Stuck
  - Stockout Risk
  - Distribution Imbalance
  - Dead Stock
  - Sales Decline
- Tightens the Flags hero.
- Keeps branch-centric availability and DC/customer-facing distinction unchanged.
- Uses the newer line/area OLA trend.

Shajgoj
-------
Includes the v2.25 number-forward redesign:
- Current OLA
- Current stock
- latest MTD sold qty
- latest MTD sales value
- selling SKU count/share
- average sales value per sold unit
- sold qty/day
- sales value/day
- stronger Sales History KPI + chart layer
- account-specific flags retained

Foodi
-----
Includes the v2.25 number-forward redesign:
- Current OLA
- Current stock
- rolling 30-day sold qty
- selling SKU count/share
- available/unavailable basepacks
- avg sold per selling SKU
- demand-linked OOS
- rolling 30-day volume history
- window-to-window change clearly labelled as overlapping-window direction, not MoM

Shared
------
- Compact responsive line/area OLA trend.
- No internal trend scrollbar.
- More consistent table/workbench spacing.

No database schema or API changes are required.

Validation
----------
All five TS/TSX files in this patch passed TypeScript syntax transpilation.
Run the full Next.js build in the real project before deploying.

Install
-------
Extract over your current project and run:

npm run build

If successful:

git add components/AccountVisuals.tsx components/DarazPanel.tsx components/PandamartPanel.tsx components/ShajgojPanel.tsx components/FoodiPanel.tsx app/globals.css
git commit -m "Refine Daraz Pandamart Shajgoj and Foodi account pages"
git push
