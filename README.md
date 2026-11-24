# UBL Enlistment – optional account-specific product URLs

Replace these files from the ZIP into the corresponding project paths:
- `components/EnlistmentPanel.tsx`
- `app/globals.css`
- `lib/enlistment-data.ts`
- `app/api/enlistment/targets/route.ts`

Behavior:
- When changing N/D to Enlisted from the quick capsule, the optional URL editor appears. Save & Enlist or Skip URL.
- In Manage drawer, switching to Enlisted prompts for the optional URL; Cancel/empty skips.
- URL can be edited or cleared later in Manage > account progress > URL.
- View product opens the stored URL in a new tab.
- HTTP(S) URL is validated client- and server-side.
- Stored on `enlistment_targets.account_fields.product_url` for the specific account; no schema migration required.
- Existing URL persists through status transitions unless explicitly cleared with Save URL.
- Historical import button is removed from the visible UI; no historical database rows are deleted.

No Supabase database data or schema was changed by preparing this package.

After replacing files run `npm run build` and verify in the UI with a test product before using live data.
