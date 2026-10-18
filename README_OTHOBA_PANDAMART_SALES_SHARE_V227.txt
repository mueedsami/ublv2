UBL V2 v2.27.0 — Othoba + Pandamart Sales Contribution

Scope
-----
Adds brand-wise and format-wise sales contribution visuals to:
- Othoba
- Pandamart

No Supabase schema migration is required.

Format definition
-----------------
"Format" uses the existing UBL master Product Type field.
Examples in the current master include:
- Regular
- CP

The system does NOT guess a format when a product cannot be mapped.
Unresolved rows remain visible as "Unmapped".

Mapping strategy
----------------
1. Exact marketplace SKU mapping from product_account_ids.
2. If SKU mapping is absent, an exact normalized product-name match is attempted.
3. Anything still unresolved remains "Unmapped".

This is intentional so the charts stay auditable.

Othoba
------
Monthly Sales now contains a Sales Contribution section with:
- period selector
- Selling Amount / Sold Qty toggle
- Brand Share donut + exact ranked numbers
- Format Share donut + exact ranked numbers
- Top brand
- Top format
- Master mapping coverage
- Top 6 contributors + Others

The latest partial month remains clearly labelled MTD.

Value metric:
- Othoba source Total Amount

Pandamart
---------
Adds a new "Sales Mix" tab.

Period selector:
- Latest day
- MTD
- Last 30 days

Metric toggle:
- GFV value
- Sold qty

Visuals:
- Brand Share donut + ranked values
- Format Share donut + ranked values
- Total sold qty
- Total GFV
- Top brand
- Top format
- Master mapping coverage

Value metric:
- Pandamart source GFV (gfv_local)

Shared visual
-------------
A reusable SalesShareDonut was added to AccountVisuals.
It shows:
- Top contributors
- Others aggregation
- share %
- exact selected metric
- sold qty / value cross-reference
- SKU count

Files
-----
- lib/sales-share.ts
- app/api/othoba/route.ts
- app/api/pandamart/route.ts
- components/AccountVisuals.tsx
- components/OthobaPanel.tsx
- components/PandamartPanel.tsx
- app/globals.css

Validation
----------
All modified TS/TSX files passed TypeScript syntax transpilation.
Run the full Next.js build in the actual project before deployment.

Install
-------
Extract over the current project and run:

npm run build

If successful:

git add lib/sales-share.ts app/api/othoba/route.ts app/api/pandamart/route.ts components/AccountVisuals.tsx components/OthobaPanel.tsx components/PandamartPanel.tsx app/globals.css
git commit -m "Add Othoba and Pandamart sales contribution charts"
git push
