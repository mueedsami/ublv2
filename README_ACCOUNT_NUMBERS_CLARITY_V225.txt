UBL V2 v2.25.0 — Account Numbers & Clarity Refinement

Scope
-----
Corrects the Othoba commercial interpretation and makes Othoba, Shajgoj and Foodi more number-forward and easier to read.

No Supabase schema change and no API change are required.

Files
-----
- components/AccountVisuals.tsx
- components/OthobaPanel.tsx
- components/ShajgojPanel.tsx
- components/FoodiPanel.tsx
- app/globals.css

Important Othoba correction
---------------------------
The previous UI calculated:

  Total Amount - Total Product Cost

and labelled that result as Gross Margin.

That was not supported by the Othoba source file. The source only provides:
- Total Product Cost
- Total Amount

It does NOT define their difference as margin.

Therefore v2.25.0 removes all inferred margin / gross-margin language.

Othoba now shows:
- Selling Amount = source Total Amount
- Product Cost Value = source Total Product Cost
- Avg Selling Amount / Unit
- Avg Product Cost / Unit
- Sold Qty
- Daily selling-amount pace
- Daily sold-qty pace

For partial current months, the page no longer compares the raw MTD total against a full previous month total.
Instead it compares daily pace versus the previous month daily pace.

The MTD Sales & Stock file can contain sold quantity without a usable sales-value field.
Where that source value is 0/not supplied, the UI now says "Not provided" rather than implying zero selling amount.

Shajgoj improvements
--------------------
- Current OLA
- Current stock
- Latest MTD sold qty
- Latest MTD sales value
- Selling SKU count and selling-SKU share
- Avg sales value per sold unit
- Current sold-qty daily pace
- Current sales-value daily pace
- Monthly sales-value chart
- Monthly sold-qty chart
- Stronger Sales History KPI layer and richer tables

Foodi improvements
------------------
- Current OLA
- Current stock
- Latest rolling-30-day sold qty
- Selling SKU count and selling-SKU share
- Available / unavailable basepack counts
- Avg sold qty per selling SKU
- Demand-linked OOS count
- Rolling 30-day volume history
- Window-to-window change clearly labelled as overlapping-window direction, NOT month-on-month growth
- Stronger 30-Day Sales KPI layer and richer table

Shared chart improvement
------------------------
The old chunky OLA pulse bars with internal scrolling have been replaced by a compact responsive line/area trend:
- actual dates
- percentage labels
- no internal scrollbar
- clearer trend reading

This shared change also improves account pages that already use AccountVisuals.MiniTrend.

Validation
----------
All modified TS/TSX files passed TypeScript syntax transpilation.

A full Next.js production build should still be run in the actual project.

Install
-------
Extract over the current project, then run:

npm run build

If successful:

git add components/AccountVisuals.tsx components/OthobaPanel.tsx components/ShajgojPanel.tsx components/FoodiPanel.tsx app/globals.css
git commit -m "Clarify account sales metrics and improve number visibility"
git push
